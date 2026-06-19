// ─── handlers/notificationHandlers.js ───────────────────────────────────────
// Trata eventos que geram notificações para usuários (ex: novo lance, fim de leilão).

async function onNotifyBid(event) {
  const { bidId, auctionId, userId, amount } = event.data;

  if (!auctionId || !userId) {
    throw new Error(`Payload inválido em notificação de lance: ${JSON.stringify(event.data)}`);
  }

  console.log(`[Notification] Novo lance no leilão ${auctionId}: R$${amount} por usuário ${userId}`);

  // Aqui entraria: WebSocket push, push notification, email em tempo real, etc.
}

async function onNotifyAuctionEnd(event) {
  const { auctionId, winner, totalBids } = event.data;

  if (!auctionId) {
    throw new Error(`Payload inválido em notificação de encerramento: ${JSON.stringify(event.data)}`);
  }

  const msg = winner
    ? `Leilão ${auctionId} encerrado. Vencedor: ${winner.userId} com R$${winner.amount}`
    : `Leilão ${auctionId} encerrado sem lances.`;

  console.log(`[Notification] ${msg} | Total de lances: ${totalBids}`);

  // Aqui entraria: broadcast WebSocket para todos os participantes, etc.
}

module.exports = {
  onNotifyBid,
  onNotifyAuctionEnd,
};
