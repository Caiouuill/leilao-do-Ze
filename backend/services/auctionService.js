const { randomUUID } = require('crypto');
const { publishEvent } = require('./eventBus');

const auctions = new Map();
const bids     = new Map();

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
  });
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function buildEvent(eventType, data) {
  return {
    eventId       : randomUUID(),
    eventType,
    eventVersion  : 1,
    occurredAt    : new Date().toISOString(),
    producer      : 'leilao-api',
    correlationId : randomUUID(),
    data,
  };
}

// ─── Criar leilão ────────────────────────────────────────────────────────────

async function createAuction(req, res) {
  const { auctionId = randomUUID(), item, startingPrice = 0 } = await getBody(req);
  const auction = { auctionId, item, startingPrice, status: 'OPEN', createdAt: new Date().toISOString() };
  auctions.set(auctionId, auction);
  bids.set(auctionId, []);

  const event = buildEvent('auction.created', auction);
  await publishEvent('auction.created', event);

  json(res, 201, { message: 'Leilão criado', auction, event });
}


async function placeBid(req, res) {
  const { auctionId, userId, amount } = await getBody(req);

  const requestEvent = buildEvent('bid.requested', { auctionId, userId, amount, requestedAt: new Date().toISOString() });
  await publishEvent('bid.requested', requestEvent);

  // Validação
  const auction    = auctions.get(auctionId);
  const auctionBids = bids.get(auctionId) || [];
  const highest    = auctionBids.reduce((max, b) => Math.max(max, b.amount), auction?.startingPrice ?? 0);

  if (!auction) {
    const rejEvent = buildEvent('bid.rejected', {
      auctionId, userId, amount,
      reason: 'Leilão não encontrado',
      correlationId: requestEvent.eventId,
    });
    await publishEvent('bid.rejected', rejEvent);
    return json(res, 404, { error: 'Leilão não encontrado', event: rejEvent });
  }

  if (auction.status !== 'OPEN') {
    const rejEvent = buildEvent('bid.rejected', {
      auctionId, userId, amount,
      reason: 'Leilão encerrado',
      correlationId: requestEvent.eventId,
    });
    await publishEvent('bid.rejected', rejEvent);
    return json(res, 400, { error: 'Leilão encerrado', event: rejEvent });
  }

  if (amount <= highest) {
    const rejEvent = buildEvent('bid.rejected', {
      auctionId, userId, amount, highest,
      reason: `Lance deve ser maior que R$${highest}`,
      correlationId: requestEvent.eventId,
    });
    await publishEvent('bid.rejected', rejEvent);
    return json(res, 400, { error: `Lance deve ser maior que R$${highest}`, event: rejEvent });
  }

  // Lance válido
  const bid = { bidId: randomUUID(), auctionId, userId, amount, createdAt: new Date().toISOString() };
  auctionBids.push(bid);
  bids.set(auctionId, auctionBids);

  const placedEvent = buildEvent('bid.placed', { ...bid, correlationId: requestEvent.eventId });
  await publishEvent('bid.placed', placedEvent);

  json(res, 201, { message: 'Lance registrado', bid, event: placedEvent });
}

// ─── Encerrar leilão ─────────────────────────────────────────────────────────

async function endAuction(req, res) {
  const { auctionId } = await getBody(req);
  const auction = auctions.get(auctionId);

  if (!auction) {
    return json(res, 404, { error: 'Leilão não encontrado' });
  }

  auction.status  = 'ENDED';
  auction.endedAt = new Date().toISOString();

  const auctionBids = bids.get(auctionId) || [];
  const winner      = auctionBids.sort((a, b) => b.amount - a.amount)[0] || null;

  const event = buildEvent('auction.ended', { auctionId, winner, totalBids: auctionBids.length });
  await publishEvent('auction.ended', event);

  json(res, 200, { message: 'Leilão encerrado', auction, winner, event });
}

module.exports = { createAuction, placeBid, endAuction };
