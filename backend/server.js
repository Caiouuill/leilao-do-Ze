const http = require('http');

const port = 3000;
const host = 'localhost';

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Servidor local com JS funcional!\n');
});

server.listen(port, host, () => {
  console.log(`Servidor rodando em http://${host}:${port}/`);
});