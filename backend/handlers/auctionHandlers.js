async function onAuctionCreated(event) {
  const { auctionId, item, startingPrice } = event.data;
  if (!auctionId || !item) throw new Error(`Payload inválido: ${JSON.stringify(event.data)}`);
  console.log(`[Handler] ✅ Leilão criado — id=${auctionId} | item="${item}" | lance inicial=R$${startingPrice}`);
}

async function onBidRequested(event) {
  const { auctionId, userId, amount } = event.data;
  if (!auctionId || !userId || amount == null) throw new Error(`Payload inválido: ${JSON.stringify(event.data)}`);
  console.log(`[Handler] 📨 Lance solicitado — leilão=${auctionId} | usuário=${userId} | valor=R$${amount}`);
}

async function onBidPlaced(event) {
  const { bidId, auctionId, userId, amount } = event.data;
  if (!bidId || !auctionId || !userId || amount == null) throw new Error(`Payload inválido: ${JSON.stringify(event.data)}`);
  console.log(`[Handler] ✅ Lance aceito — leilão=${auctionId} | usuário=${userId} | valor=R$${amount}`);
}

async function onBidRejected(event) {
  const { auctionId, userId, amount, reason } = event.data;
  console.log(`[Handler] ❌ Lance rejeitado — leilão=${auctionId} | usuário=${userId} | valor=R$${amount} | motivo="${reason}"`);
}

async function onAuctionEnded(event) {
  const { auctionId, winner, totalBids } = event.data;
  if (!auctionId) throw new Error(`Payload inválido: ${JSON.stringify(event.data)}`);
  if (winner) {
    console.log(`[Handler] 🏁 Leilão encerrado — id=${auctionId} | vencedor=${winner.userId} | lance=R$${winner.amount} | total=${totalBids}`);
  } else {
    console.log(`[Handler] 🏁 Leilão encerrado sem lances — id=${auctionId}`);
  }
}

module.exports = { onAuctionCreated, onBidRequested, onBidPlaced, onBidRejected, onAuctionEnded };
