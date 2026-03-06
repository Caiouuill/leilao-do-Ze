const electionController = require("../controllers/electionController");

function handleRoutes(req, res, nodeId) {

  if (req.url === "/ping") {
    res.end("ok");
    return true;
  }

  if (req.method === "POST") {

    let body = "";

    req.on("data", chunk => body += chunk);

    req.on("end", () => {

      const data = JSON.parse(body);

      if (req.url === "/election") {
        electionController.handleElection(req, res, data, nodeId);
      }

      if (req.url === "/coordinator") {
        electionController.handleCoordinator(req, res, data);
      }
    });

    return true;
  }

  return false;
}

module.exports = handleRoutes;