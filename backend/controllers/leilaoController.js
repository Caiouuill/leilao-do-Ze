const leilao = require("../services/leilao");

function handleMeuServico(req, res, nodeId) {
  const result = leilao.executar(nodeId);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end(result);
}

module.exports = {
  handleMeuServico
};