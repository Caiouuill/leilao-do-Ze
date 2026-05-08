const { subscribe } = require('./eventBus');

const processed = new Set();

async function idempotentProcess(event, work) {
  if (processed.has(event.eventId)) return;
  await work();
  processed.add(event.eventId);
}

async function startConsumers() {
  await subscribe('notification-service.queue', ['bid.*', 'auction.ended'], async (event) => {
    await idempotentProcess(event, async () => {
      console.log(`[notification-service] ${event.eventType}`, event.data);
    });
  });

  await subscribe('audit-service.queue', ['auction.*', 'bid.*'], async (event) => {
    await idempotentProcess(event, async () => {
      console.log(`[audit-service] ${event.eventType} id=${event.eventId}`);
    });
  });
}

module.exports = { startConsumers };