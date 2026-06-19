// ─── utils/idempotency.js ────────────────────────────────────────────────────
// Garante que cada evento seja processado exatamente uma vez por fila,
// mesmo que o RabbitMQ reentregue a mensagem após falha de ACK.
//
// Em produção, o Set em memória deve ser substituído por Redis (SETNX com TTL)
// ou uma tabela de eventos processados no PostgreSQL.

const processed = new Map(); // eventId => { at, queue }
const TTL_MS    = 24 * 60 * 60 * 1000; // remove entradas após 24h

/**
 * Executa work() apenas se o evento ainda não foi processado por esta fila.
 *
 * @param {object}   event      Evento com campo eventId
 * @param {string}   queueName  Nome da fila consumidora
 * @param {Function} work       async () => void
 */
async function idempotent(event, queueName, work) {
  const key = `${queueName}::${event.eventId}`;

  if (processed.has(key)) {
    console.warn(`[Idempotency] Evento duplicado ignorado: ${key}`);
    return;
  }

  await work();

  processed.set(key, { at: Date.now(), queue: queueName });
  _cleanup();
}

// Remove entradas antigas para evitar crescimento ilimitado do Map
function _cleanup() {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, meta] of processed.entries()) {
    if (meta.at < cutoff) processed.delete(key);
  }
}

module.exports = { idempotent };
