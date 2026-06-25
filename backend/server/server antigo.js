const http = require("http");
const host = '0.0.0.0';

const handleRoutes     = require("../routes/routes");
const startHeartbeat   = require("../utils/heartbeat");
const bullyService     = require("../services/bullyService");
const leaderMiddleware = require("../middleware/leaderMiddleware");

const { connectEventBus, closeEventBus } = require("../services/eventBus");
const { startConsumers }                 = require("../services/eventConsumers");

const nodeId = parseInt(process.env.ID)   || 1;
const port   = parseInt(process.env.PORT) || 3000;

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

async function start() {
  // 1. Conecta ao RabbitMQ e declara exchanges ANTES de abrir o servidor HTTP.
  //    Assim nenhuma requisição chega antes das filas existirem.
  try {
    console.log(`[Node ${nodeId}] Conectando ao RabbitMQ...`);
    await connectEventBus();
    await startConsumers();
    console.log(`[Node ${nodeId}] RabbitMQ pronto — exchanges e filas declaradas.`);
  } catch (err) {
    console.error(`[Node ${nodeId}] Falha ao conectar RabbitMQ:`, err.message);
    console.error("Verifique se o RabbitMQ está rodando e a variável RABBITMQ_URL está correta.");
    process.exit(1); // encerra o processo em vez de subir sem mensageria
  }

  // 2. Só então abre o servidor HTTP
  server.listen(port, host, () => {
    console.log(`[Node ${nodeId}] HTTP rodando em http://${host}:${port}`);

    startHeartbeat(nodeId);

    setTimeout(() => {
      bullyService.startElection();
    }, 1000);
  });
}

process.on("SIGINT", async () => {
  console.log("\nEncerrando graciosamente...");
  await closeEventBus();
  process.exit(0);
});

start();
