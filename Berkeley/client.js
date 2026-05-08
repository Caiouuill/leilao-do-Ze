const net = require('net');

const GET_TIME = 'GET_TIME';
const TIME = 'TIME';
const ADJUST = 'ADJUST';

let offset = Math.floor(Math.random() * 5000) - 2500;

const PORT = process.argv[2];

const server = net.createServer((socket) => {

  socket.on('data', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === GET_TIME) {
      const currentTime = Date.now() + offset;

      socket.write(JSON.stringify({
        type: TIME,
        time: currentTime
      }));

      console.log(`[${PORT}] Enviou tempo: ${currentTime}`);
    }

    if (msg.type === ADJUST) {
      console.log(`[${PORT}] Offset antes: ${offset}`);

      offset += msg.adjustment;

      console.log(`[${PORT}] Ajuste recebido: ${msg.adjustment}`);
      console.log(`[${PORT}] Offset depois: ${offset}`);
      console.log(`[${PORT}] Novo tempo: ${Date.now() + offset}`);
    }
  });

});

server.listen(PORT, () => {
  console.log(`Node rodando na porta ${PORT}`);
  console.log(`Offset inicial: ${offset}`);
});