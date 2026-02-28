const http = require('http');

const port = 3000;
const host = '201.54.204.45';

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('VAI SE FODER!\n');
});

server.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});