const net = require('net');

const GET_TIME = 'GET_TIME';
const TIME = 'TIME';
const ADJUST = 'ADJUST';

const nodes = [3001, 3002, 3003];

function getTime(port) {
  return new Promise((resolve) => {
    const client = net.createConnection({ port }, () => {
      client.write(JSON.stringify({ type: GET_TIME }));
    });

    client.on('data', (data) => {
      const msg = JSON.parse(data.toString());
      resolve(msg.time);
      client.end();
    });
  });
}

function sendAdjust(port, adjustment) {
  const client = net.createConnection({ port }, () => {
    client.write(JSON.stringify({
      type: ADJUST,
      adjustment
    }));
    client.end();
  });
}

async function sync() {
  const coordTime = Date.now();

  const times = await Promise.all(
    nodes.map(port => getTime(port))
  );

  const diffs = times.map(t => t - coordTime);

  const avg =
    diffs.reduce((a, b) => a + b, 0) / (diffs.length + 1);

  console.log("Diferenças:", diffs);
  console.log("Média:", avg);

  for (let i = 0; i < nodes.length; i++) {
    const adjustment = avg - diffs[i];
    sendAdjust(nodes[i], adjustment);
  }

  console.log("Sincronização concluída!");
}

sync();