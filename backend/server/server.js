const http = require("http");
const host = '0.0.0.0';

const handleRoutes = require("../routes/routes");
const startHeartbeat = require("../utils/heartbeat");
const bullyService = require("../services/bullyService");
const leaderMiddleware = require("../middleware/leaderMiddleware");

const { connectEventBus, closeEventBus } = require("../services/eventBus");
const { startConsumers } = require("../services/eventConsumers");


const nodeId = parseInt(process.env.ID) || 1;
const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  const internalRoutes = ["/ping", "/election", "/coordinator"];

  if (!internalRoutes.includes(req.url)) {

    const proceed = leaderMiddleware(req, res, nodeId);

    if (!proceed) return;
  }

  const handled = handleRoutes(req, res, nodeId);

  if (!handled) {

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end(`Servidor do node ${nodeId}\n`);
  }
});

server.listen(port, host, async() => {
  console.log(`Node ${nodeId} rodando na porta ${port}`);
  startHeartbeat(nodeId);
  setTimeout(() => {
    bullyService.startElection();
  }, 1000);

  try {
    await connectEventBus();
    await startConsumers();
    console.log("RabbitMQ EventBus conectado e consumidores iniciados");
  } catch (error) {
    console.error("Falha ao iniciar EventBus:", error.message);
  }
});

process.on("SIGINT", async () => {
  await closeEventBus();
  process.exit(0);
});