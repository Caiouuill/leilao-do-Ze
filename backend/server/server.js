const http = require("http");

const handleRoutes = require("../routes/routes");
const startHeartbeat = require("../utils/heartbeat");

const nodeId = parseInt(process.env.ID) || 1;
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  const handled = handleRoutes(req, res, nodeId);

  if (!handled) {

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end(`Servidor do node ${nodeId}\n`);
  }
});

server.listen(port, () => {

  console.log(`Node ${nodeId} rodando na porta ${port}`);

  startHeartbeat(nodeId);
});