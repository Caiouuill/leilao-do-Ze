const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'leilao.eventbus';

let connection;
let channel;

async function connectEventBus() {
  if (channel) return { connection, channel };

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createConfirmChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  connection.on('error', (err) => {
    console.error('RabbitMQ connection error:', err.message);
  });

  connection.on('close', () => {
    console.warn('RabbitMQ connection closed');
    channel = null;
    connection = null;
  });

  return { connection, channel };
}

async function publishEvent(routingKey, event) {
  await connectEventBus();

  const payload = Buffer.from(JSON.stringify(event));

  channel.publish(EXCHANGE, routingKey, payload, {
    contentType: 'application/json',
    persistent: true,
    messageId: event.eventId,
    timestamp: Date.now(),
  });

  await channel.waitForConfirms();
}

async function subscribe(queueName, patterns, handler) {
  await connectEventBus();

  await channel.assertQueue(queueName, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': `${EXCHANGE}.dlx`,
    },
  });

  await channel.assertExchange(`${EXCHANGE}.dlx`, 'topic', { durable: true });
  await channel.assertQueue(`${queueName}.dlq`, { durable: true });
  await channel.bindQueue(`${queueName}.dlq`, `${EXCHANGE}.dlx`, '#');

  for (const pattern of patterns) {
    await channel.bindQueue(queueName, EXCHANGE, pattern);
  }

  await channel.prefetch(20);

  await channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      await handler(event);
      channel.ack(msg);
    } catch (error) {
      console.error(`Erro processando mensagem em ${queueName}:`, error.message);
      channel.nack(msg, false, false);
    }
  }, { noAck: false });
}

async function closeEventBus() {
  if (channel) await channel.close();
  if (connection) await connection.close();
  channel = null;
  connection = null;
}

module.exports = {
  EXCHANGE,
  connectEventBus,
  publishEvent,
  subscribe,
  closeEventBus,
};