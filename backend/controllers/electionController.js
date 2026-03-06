const bullyService = require("../services/bullyService");

function handleElection(req, res, data, nodeId) {

  console.log(`Recebi eleição de ${data.from}`);

  if (nodeId > data.from) {
    bullyService.startElection();
  }

  res.end("ok");
}

function handleCoordinator(req, res, data) {

  bullyService.setCoordinator(data.id);

  console.log(`Novo coordenador: ${data.id}`);

  res.end("ok");
}

module.exports = {
  handleElection,
  handleCoordinator
};