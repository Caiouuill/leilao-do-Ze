const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE     = process.env.RABBITMQ_EXCHANGE || 'leilao.eventbus';
const DLX          = `${EXCHANGE}.dlx`;

const MAX_RETRIES   = 3;
const RETRY_DELAYS  = [2000, 8000, 30000]; // backoff exponencial em ms

let connection;
let channel;

// ─── Conexão ────────────────────────────────────────────────────────────────

async function connectEventBus() {
  if (channel) return { connection, channel };

  connection = await amqp.connect(RABBITMQ_URL);
  channel    = await connection.createConfirmChannel();

  // Exchange principal (topic) e Dead Letter Exchange (topic)
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DLX,      'topic', { durable: true });

  connection.on('error', (err) => {
    console.error('[EventBus] Erro na conexão RabbitMQ:', err.message);
  });

  connection.on('close', () => {
    console.warn('[EventBus] Conexão RabbitMQ encerrada');
    channel    = null;
    connection = null;
  });

  return { connection, channel };
}

// ─── Publicação com confirm ──────────────────────────────────────────────────

async function publishEvent(routingKey, event) {
  await connectEventBus();

  const payload = Buffer.from(JSON.stringify(event));

  channel.publish(EXCHANGE, routingKey, payload, {
    contentType : 'application/json',
    persistent  : true,
    messageId   : event.eventId,
    timestamp   : Date.now(),
    headers     : { 'x-retry-count': 0 },
  });

  await channel.waitForConfirms();
  console.log(`[EventBus] Publicado: ${routingKey} | id=${event.eventId}`);
}

// ─── Inscrição com retry + DLQ ───────────────────────────────────────────────

/**
 * @param {string}   queueName  Nome da fila
 * @param {string[]} patterns   Routing keys (suporta wildcards: bid.*, #)
 * @param {Function} handler    async (event) => void  — lança exceção em caso de falha
 */
async function subscribe(queueName, patterns, handler) {
  await connectEventBus();

  const dlqName = `${queueName}.dlq`;

  // Fila principal: mensagens com falha vão para o DLX
  await channel.assertQueue(queueName, {
    durable   : true,
    arguments : { 'x-dead-letter-exchange': DLX },
  });

  // Dead Letter Queue: guarda mensagens que esgotaram os retries
  await channel.assertQueue(dlqName, {
    durable   : true,
    arguments : { 'x-message-ttl': 7 * 24 * 60 * 60 * 1000 }, // 7 dias
  });
  await channel.bindQueue(dlqName, DLX, '#'); // captura qualquer routing key no DLX

  for (const pattern of patterns) {
    await channel.bindQueue(queueName, EXCHANGE, pattern);
  }

  await channel.prefetch(1); // processa uma mensagem por vez por consumer

  await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    let event;
    try {
      event = JSON.parse(msg.content.toString());
    } catch (parseErr) {
      console.error(`[EventBus][${queueName}] JSON inválido — descartando`, parseErr.message);
      channel.nack(msg, false, false); // vai para DLQ imediatamente
      return;
    }

    const retryCount = (msg.properties.headers?.['x-retry-count'] ?? 0);

    try {
      await handler(event);
      channel.ack(msg);
      console.log(`[EventBus][${queueName}] ✓ Processado: ${event.eventType} | id=${event.eventId}`);
    } catch (err) {
      console.error(
        `[EventBus][${queueName}] ✗ Falha (tentativa ${retryCount + 1}/${MAX_RETRIES}):`,
        event.eventType, '—', err.message
      );

      if (retryCount < MAX_RETRIES) {
        await _requeue(msg, event, queueName, retryCount);
      } else {
        console.error(`[EventBus][${queueName}] Esgotadas tentativas — enviando para DLQ: id=${event.eventId}`);
        channel.nack(msg, false, false); // roteado pelo DLX para a DLQ
      }
    }
  }, { noAck: false });
}

// ─── Requeue manual com delay (backoff) ─────────────────────────────────────

async function _requeue(msg, event, queueName, currentRetry) {
  const nextRetry = currentRetry + 1;
  const delay     = RETRY_DELAYS[currentRetry] ?? RETRY_DELAYS.at(-1);

  console.log(`[EventBus][${queueName}] Reagendando em ${delay}ms (tentativa ${nextRetry}/${MAX_RETRIES})`);

  // Cria fila de espera temporária com TTL = delay, após o qual re-roteia para a fila original
  const waitQueue = `${queueName}.wait.${delay}ms`;

  await channel.assertQueue(waitQueue, {
    durable   : true,
    arguments : {
      'x-message-ttl'          : delay,
      'x-dead-letter-exchange'  : EXCHANGE,
      'x-dead-letter-routing-key': msg.fields.routingKey,
      'x-expires'               : delay * 2, // auto-delete a fila de espera depois
    },
  });

  const payload = Buffer.from(JSON.stringify(event));

  channel.sendToQueue(waitQueue, payload, {
    persistent  : true,
    contentType : 'application/json',
    messageId   : event.eventId,
    headers     : {
      ...msg.properties.headers,
      'x-retry-count'     : nextRetry,
      'x-original-queue'  : queueName,
      'x-original-routing': msg.fields.routingKey,
    },
  });

  channel.ack(msg); // confirma a mensagem original para sair da fila principal
}

// ─── Monitor da DLQ ─────────────────────────────────────────────────────────

/**
 * Consome mensagens da DLQ de uma fila monitorada.
 * Em produção, aqui entraria: alerta, persistência, reprocessamento manual, etc.
 *
 * @param {string}   queueName  Nome da fila original (o monitor usa queueName.dlq)
 * @param {Function} [onDead]   async (event, meta) => void  — callback opcional
 */
async function monitorDLQ(queueName, onDead) {
  await connectEventBus();

  const dlqName = `${queueName}.dlq`;

  // Garante que a DLQ existe (caso o monitor suba antes do subscribe)
  await channel.assertQueue(dlqName, {
    durable   : true,
    arguments : { 'x-message-ttl': 7 * 24 * 60 * 60 * 1000 },
  });
  await channel.bindQueue(dlqName, DLX, '#');

  await channel.prefetch(1);

  await channel.consume(dlqName, async (msg) => {
    if (!msg) return;

    let event;
    try {
      event = JSON.parse(msg.content.toString());
    } catch {
      event = { raw: msg.content.toString() };
    }

    const meta = {
      routingKey  : msg.fields.routingKey,
      retryCount  : msg.properties.headers?.['x-retry-count'] ?? 0,
      originalQueue: msg.properties.headers?.['x-original-queue'] ?? queueName,
      deadAt      : new Date().toISOString(),
    };

    console.error('[DLQ Monitor] ☠ Mensagem morta recebida:', {
      eventType: event.eventType,
      eventId  : event.eventId,
      ...meta,
    });

    if (typeof onDead === 'function') {
      try {
        await onDead(event, meta);
      } catch (err) {
        console.error('[DLQ Monitor] Erro no callback onDead:', err.message);
      }
    }

    channel.ack(msg); // ACK para remover da DLQ após processamento pelo monitor
  }, { noAck: false });

  console.log(`[DLQ Monitor] Monitorando: ${dlqName}`);
}

// ─── Fechamento gracioso ─────────────────────────────────────────────────────

async function closeEventBus() {
  if (channel)    await channel.close();
  if (connection) await connection.close();
  channel    = null;
  connection = null;
}

module.exports = {
  EXCHANGE,
  connectEventBus,
  publishEvent,
  subscribe,
  monitorDLQ,
  closeEventBus,
};
