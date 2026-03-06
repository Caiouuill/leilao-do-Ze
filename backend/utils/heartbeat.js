const nodes = require("../config/nodes");
const sendRequest = require("../services/requestService");
const bullyService = require("../services/bullyService");

function startHeartbeat(nodeId) {

  setInterval(async () => {

    const coordinator = bullyService.getCoordinator();

    if (!coordinator || coordinator === nodeId) return;

    const leader = nodes.find(n => n.id === coordinator);

    try {
      await sendRequest(leader, "/ping");
    } catch {

      console.log("Coordenador caiu");

      bullyService.startElection();
    }

  }, 5000);
}

module.exports = startHeartbeat;