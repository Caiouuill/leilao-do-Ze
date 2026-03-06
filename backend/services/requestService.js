const http = require("http");

function sendRequest(node, path, method = "GET", body = null) {

  return new Promise((resolve, reject) => {

    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: node.host,
      port: node.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? data.length : 0
      }
    };

    const req = http.request(options, res => {
      resolve();
    });

    req.on("error", reject);

    if (data) req.write(data);
    req.end();
  });
}

module.exports = sendRequest;