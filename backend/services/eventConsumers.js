const { subscribe, monitorDLQ } = require('./eventBus');
const { idempotent }            = require('../utils/idempotency');
const {
  onAuctionCreated,
  onBidRequested,
  onBidPlaced,
  onBidRejected,
  onAuctionEnded,
} = require('../handlers/auctionHandlers');
const { onNotifyBid, onNotifyAuctionEnd } = require('../handlers/notificationHandlers');

const HANDLERS = {
  'auction.created' : onAuctionCreated,
  'bid.requested'   : onBidRequested,
  'bid.placed'      : onBidPlaced,
  'bid.rejected'    : onBidRejected,
  'auction.ended'   : onAuctionEnded,
};

const NOTIFICATION_HANDLERS = {
  'bid.placed'   : onNotifyBid,
  'bid.rejected' : async (event) => {
    const { auctionId, userId, reason } = event.data;
    console.log(`[Notification] ❌ Lance de ${userId} no leilão ${auctionId} rejeitado: ${reason}`);
  },
  'auction.ended': onNotifyAuctionEnd,
};

function makeDispatcher(handlerMap, queueName) {
  return async (event) => {
    const handler = handlerMap[event.eventType];
    if (!handler) {
      console.warn(`[${queueName}] Nenhum handler para: ${event.eventType} — ignorando`);
      return;
    }
    await idempotent(event, queueName, () => handler(event));
  };
}

async function startConsumers() {
  await subscribe(
    'auction-service.queue',
    ['auction.*', 'bid.*'],
    makeDispatcher(HANDLERS, 'auction-service.queue')
  );

  await subscribe(
    'notification-service.queue',
    ['bid.placed', 'bid.rejected', 'auction.ended'],
    makeDispatcher(NOTIFICATION_HANDLERS, 'notification-service.queue')
  );

  await monitorDLQ('auction-service.queue', async (event, meta) => {
    console.error(`[DLQ] ⚠ Evento não processável — tipo=${event.eventType ?? 'desconhecido'} | tentativas=${meta.retryCount}`);
  });

  await monitorDLQ('notification-service.queue', async (event, meta) => {
    console.error(`[DLQ] ⚠ Notificação perdida — tipo=${event.eventType ?? 'desconhecido'} | tentativas=${meta.retryCount}`);
  });

  console.log('[Consumers] Todos os consumers iniciados.');
}

module.exports = { startConsumers };
