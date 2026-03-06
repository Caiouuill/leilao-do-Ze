const nodes = require("../config/nodes");
const sendRequest = require("./requestService");

let coordinator = null;
const nodeId = parseInt(process.env.ID);

async function startElection() {

  console.log(`Node ${nodeId} iniciou eleição`);

  const higherNodes = nodes.filter(n => n.id > nodeId);

  let answered = false;

  for (const node of higherNodes) {

    try {
      await sendRequest(node, "/election", "POST", { from: nodeId });
      answered = true;
    } catch {}
  }

  if (!answered) {
    becomeCoordinator();
  }
}

async function becomeCoordinator() {

  coordinator = nodeId;

  console.log(`Node ${nodeId} virou coordenador`);

  for (const node of nodes) {

    if (node.id !== nodeId) {

      try {
        await sendRequest(node, "/coordinator", "POST", { id: nodeId });
      } catch {}
    }
  }
}

function setCoordinator(id) {
  coordinator = id;
}

function getCoordinator() {
  return coordinator;
}

module.exports = {
  startElection,
  becomeCoordinator,
  setCoordinator,
  getCoordinator
};