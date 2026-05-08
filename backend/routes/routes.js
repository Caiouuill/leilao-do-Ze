const electionController = require("../controllers/electionController");
const auctionService = require("../services/auctionService");
const { handleLeilao } = require("../controllers/leilaoController");


function handleRoutes(req, res, nodeId) {

  if (req.url === "/ping") {
    res.end("ok");
    return true;
  }

  if (req.method === "POST") {
        if (req.url === "/auction") {
      auctionService.createAuction(req, res);
      return true;
    }

    if (req.url === "/bid") {
      auctionService.placeBid(req, res);
      return true;
    }

    if (req.url === "/auction/end") {
      auctionService.endAuction(req, res);
      return true;
    }

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

      if (req.url === "/leilao") {
        leilaoController.handleLeilao(req, res, nodeId);
        return;
      }
    });

    return true;
  }

  return false;
}

module.exports = handleRoutes;