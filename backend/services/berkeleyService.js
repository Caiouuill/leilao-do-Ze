/**
 * berkeleyService.js
 * Implementação do algoritmo de Berkeley integrada ao backend HTTP.
 *
 * Cada nó mantém um offset em memória.
 * O coordenador (eleito pelo Bully) coleta os tempos via GET /berkeley/time,
 * calcula a média dos desvios e envia os ajustes via POST /berkeley/adjust.
 */

const axios = require("axios");
const nodes = require("../config/nodes");

// offset local em milissegundos — aplicado sobre Date.now()
let offset = 0;

function getTime() {
  return Date.now() + offset;
}

function applyAdjust(adjustment) {
  const anterior = offset;
  offset += adjustment;
  console.log(`[Berkeley] Offset: ${anterior}ms → ${offset}ms (ajuste: ${adjustment > 0 ? "+" : ""}${adjustment}ms)`);
}

async function runSync(coordinatorId) {
  const coordTime = Date.now() + offset;
  console.log(`[Berkeley] Coordenador Node ${coordinatorId} iniciando sincronização...`);

  // coleta tempo de cada nó (incluindo o próprio coordenador)
  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const res = await axios.get(`http://${node.host}:${node.port}/berkeley/time`, { timeout: 3000 });
      return { nodeId: node.id, time: res.data.time };
    })
  );

  const tempos = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  if (tempos.length < 2) {
    console.log("[Berkeley] Nós insuficientes para sincronizar.");
    return;
  }

  // calcula desvio de cada nó em relação ao coordenador
  const desvios = tempos.map((t) => ({ nodeId: t.nodeId, desvio: t.time - coordTime }));
  const media = desvios.reduce((acc, d) => acc + d.desvio, 0) / desvios.length;

  console.log("[Berkeley] Tempos coletados:", tempos.map((t) => `Node ${t.nodeId}: ${t.time}`).join(", "));
  console.log(`[Berkeley] Média dos desvios: ${Math.round(media)}ms`);

  // envia ajuste para cada nó
  await Promise.allSettled(
    nodes.map(async (node) => {
      const desvio = desvios.find((d) => d.nodeId === node.id)?.desvio ?? 0;
      const adjustment = Math.round(media - desvio);
      try {
        await axios.post(
          `http://${node.host}:${node.port}/berkeley/adjust`,
          { adjustment },
          { timeout: 3000 }
        );
        console.log(`[Berkeley] Node ${node.id} ajustado: ${adjustment > 0 ? "+" : ""}${adjustment}ms`);
      } catch {
        console.warn(`[Berkeley] Node ${node.id} não respondeu ao ajuste.`);
      }
    })
  );

  console.log("[Berkeley] Sincronização concluída.");
}

module.exports = { getTime, applyAdjust, runSync };
