const bullyService = require("../services/bullyService");
const nodes = require("../config/nodes");

function leaderMiddleware(req, res, nodeId) {

  const coordinator = bullyService.getCoordinator();

  if (!coordinator) {
    res.statusCode = 503;
    res.end("Nenhum coordenador disponível");
    return false;
  }

  if (coordinator === nodeId) {
    return true;
  }

  const leader = nodes.find(n => n.id === coordinator);

  res.statusCode = 307;
  res.setHeader("Location", `http://${leader.host}:${leader.port}${req.url}`);

  res.end();

  return false;
}

module.exports = leaderMiddleware;