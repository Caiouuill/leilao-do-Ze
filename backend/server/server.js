const express = require("express");
const path = require("path");

const pool = require("../db");
const startHeartbeat = require("../utils/heartbeat");
const bullyService = require("../services/bullyService");
const leaderMiddleware = require("../middleware/leaderMiddleware");
const { connectEventBus, closeEventBus } = require("../services/eventBus");
const berkeleyService = require("../services/berkeleyService");
const { startConsumers } = require("../services/eventConsumers");

const nodeId = parseInt(process.env.ID) || 1;
const PORT = Number(process.env.PORT) || 3000;
const host = "0.0.0.0";

const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "../../frontend")));

// ─── helpers ──────────────────────────────────────────────────────────────────

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireFields(body, fields) {
  return fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
}

function normalizeUser(row) {
  if (!row) return row;
  const { senha, ...safe } = row;
  return safe;
}

function isAdmin(u) {
  return ["ADMIN", "SUPERADMIN"].includes(u?.tipo_usuario);
}

function canCreateAuction(u) {
  return ["VENDEDOR", "ADMIN", "SUPERADMIN"].includes(u?.tipo_usuario);
}

async function findUser(id) {
  if (!id) return null;
  const r = await pool.query(
    "SELECT id, nome_usuario, email, tipo_usuario, creditos, data_cadastro FROM usuarios WHERE id = $1",
    [id]
  );
  return r.rows[0] || null;
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ─── internal routes (Bully) ─────────────────────────────────────────────────

app.get("/ping", (req, res) => res.end("ok"));

app.get("/health", wrap(async (req, res) => {
  const r = await pool.query("SELECT NOW() AS agora");
  res.json({ status: "ok", node: nodeId, banco: "conectado", agora: r.rows[0].agora });
}));

app.post("/election", (req, res) => {
  const { from } = req.body;
  console.log(`[Node ${nodeId}] Recebi eleição de ${from}`);
  if (nodeId > from) bullyService.startElection();
  res.end("ok");
});

app.post("/coordinator", (req, res) => {
  bullyService.setCoordinator(req.body.id);
  console.log(`[Node ${nodeId}] Novo coordenador: ${req.body.id}`);
  res.end("ok");
});

// --- berkeley ---

app.get("/berkeley/time", (req, res) => {
  res.json({ nodeId, time: berkeleyService.getTime() });
});

app.post("/berkeley/adjust", (req, res) => {
  const adjustment = Number(req.body.adjustment) || 0;
  berkeleyService.applyAdjust(adjustment);
  res.json({ nodeId, offset: adjustment, newTime: berkeleyService.getTime() });
});

app.post("/berkeley/sync", async (req, res) => {
  const coordinator = bullyService.getCoordinator();
  if (coordinator !== nodeId) {
    return res.status(403).json({ erro: "Apenas o coordenador pode iniciar a sincronizacao" });
  }
  try {
    await berkeleyService.runSync(nodeId);
    res.json({ mensagem: "Sincronizacao concluida", coordinator: nodeId });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ─── leader middleware para rotas de negócio ──────────────────────────────────

const INTERNAL = ["/ping", "/health", "/election", "/coordinator", "/berkeley", "/api"];

app.use((req, res, next) => {
  if (INTERNAL.some((p) => req.path.startsWith(p))) return next();
  if (req.method === "GET") return next(); // leituras passam em qualquer nó
  const proceed = leaderMiddleware(req, res, nodeId);
  if (!proceed) return;
  next();
});

// ─── api info ─────────────────────────────────────────────────────────────────

app.get("/api", (req, res) => {
  res.json({
    nome: "Leilão do Zé",
    node: nodeId,
    coordinator: bullyService.getCoordinator(),
    status: "online",
  });
});

// ─── usuários ─────────────────────────────────────────────────────────────────

app.get("/usuarios", wrap(async (req, res) => {
  const r = await pool.query(
    "SELECT id, nome_usuario, email, tipo_usuario, creditos, data_cadastro FROM usuarios ORDER BY id"
  );
  res.json(r.rows);
}));

app.post("/usuarios", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["nome_usuario", "email", "senha"]);
  if (missing.length) return res.status(400).json({ erro: "Nome de usuário, email e senha são obrigatórios" });

  const { nome_usuario, email, senha } = req.body;
  let tipo_usuario = "COMUM";

  if (req.body.tipo_usuario && req.body.admin_id) {
    const admin = await findUser(req.body.admin_id);
    if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem definir tipo de usuário" });
    tipo_usuario = req.body.tipo_usuario;
  }

  const r = await pool.query(
    `INSERT INTO usuarios (nome_usuario, email, senha, tipo_usuario)
     VALUES ($1,$2,$3,$4)
     RETURNING id, nome_usuario, email, tipo_usuario, creditos, data_cadastro`,
    [nome_usuario.trim(), email.trim().toLowerCase(), senha, tipo_usuario]
  );
  res.status(201).json(r.rows[0]);
}));

app.get("/usuarios/:id", wrap(async (req, res) => {
  const r = await pool.query(
    "SELECT id, nome_usuario, email, tipo_usuario, creditos, data_cadastro FROM usuarios WHERE id = $1",
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });
  res.json(r.rows[0]);
}));

app.put("/usuarios/:id", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["nome_usuario", "email", "tipo_usuario"]);
  if (missing.length) return res.status(400).json({ erro: "Nome de usuário, email e tipo são obrigatórios" });

  const admin = await findUser(req.body.admin_id);
  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem alterar usuários" });

  const r = await pool.query(
    `UPDATE usuarios SET nome_usuario=$1, email=$2, tipo_usuario=$3 WHERE id=$4
     RETURNING id, nome_usuario, email, tipo_usuario, creditos, data_cadastro`,
    [req.body.nome_usuario.trim(), req.body.email.trim().toLowerCase(), req.body.tipo_usuario, req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });
  res.json(r.rows[0]);
}));

app.delete("/usuarios/:id", wrap(async (req, res) => {
  const admin = await findUser(req.body.admin_id || req.query.admin_id);
  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem remover usuários" });

  const r = await pool.query("DELETE FROM usuarios WHERE id=$1 RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });
  res.json({ mensagem: "Usuário removido com sucesso" });
}));

app.post("/login", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["email", "senha"]);
  if (missing.length) return res.status(400).json({ erro: "Email e senha são obrigatórios" });

  const r = await pool.query("SELECT * FROM usuarios WHERE email=$1", [req.body.email.trim().toLowerCase()]);
  if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });

  const usuario = r.rows[0];
  if (usuario.senha !== req.body.senha) return res.status(401).json({ erro: "Senha incorreta" });

  res.json({ mensagem: "Login realizado com sucesso", usuario: normalizeUser(usuario) });
}));

app.get("/usuarios/:id/creditos", wrap(async (req, res) => {
  const r = await pool.query("SELECT id, nome_usuario, creditos FROM usuarios WHERE id=$1", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ erro: "Usuário não encontrado" });
  res.json(r.rows[0]);
}));

app.put("/usuarios/:id/creditos", wrap(async (req, res) => {
  const quantidade = toNumber(req.body.quantidade);
  const descricao = req.body.descricao || "Movimentação administrativa";
  const admin = await findUser(req.body.admin_id);

  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem alterar créditos" });
  if (!quantidade || quantidade === 0) return res.status(400).json({ erro: "Informe uma quantidade válida" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE usuarios SET creditos = creditos + $1 WHERE id=$2 AND creditos + $1 >= 0
       RETURNING id, nome_usuario, email, tipo_usuario, creditos, data_cadastro`,
      [quantidade, req.params.id]
    );
    if (!r.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Usuário não encontrado ou saldo insuficiente" });
    }
    await client.query(
      "INSERT INTO historico_creditos (usuario_id, quantidade, tipo_movimentacao, descricao) VALUES ($1,$2,$3,$4)",
      [req.params.id, Math.abs(quantidade), quantidade > 0 ? "ADICAO" : "REMOCAO", descricao]
    );
    await client.query("COMMIT");
    res.json(r.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

app.get("/usuarios/:id/historico", wrap(async (req, res) => {
  const r = await pool.query(
    "SELECT quantidade, tipo_movimentacao, descricao, data_movimentacao FROM historico_creditos WHERE usuario_id=$1 ORDER BY data_movimentacao DESC",
    [req.params.id]
  );
  res.json(r.rows);
}));

// ─── leilões ──────────────────────────────────────────────────────────────────

app.get("/leiloes", wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT l.id, l.titulo, l.descricao, l.categoria, l.lance_minimo, l.status,
           l.max_participantes, l.data_criacao, l.data_inicio, l.data_fim,
           u.nome_usuario AS criador,
           COALESCE(MAX(la.valor), 0) AS maior_lance,
           COUNT(DISTINCT p.id) AS participantes
    FROM leiloes l
    JOIN usuarios u ON l.criador_id = u.id
    LEFT JOIN lances la ON la.leilao_id = l.id
    LEFT JOIN participantes_leilao p ON p.leilao_id = l.id
    GROUP BY l.id, u.nome_usuario
    ORDER BY l.id DESC
  `);
  res.json(r.rows);
}));

app.post("/leiloes", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["titulo", "categoria", "descricao", "lance_minimo", "criador_id", "data_inicio", "data_fim"]);
  if (missing.length) return res.status(400).json({ erro: "Preencha título, categoria, descrição, lance mínimo, criador e datas" });

  const { titulo, descricao, categoria, lance_minimo, criador_id, data_inicio, data_fim, max_participantes = 10, status = "AGENDADO" } = req.body;

  const criador = await findUser(criador_id);
  if (!canCreateAuction(criador)) return res.status(403).json({ erro: "Apenas vendedores verificados e administradores podem criar leilões" });

  const lanceMinimo = toNumber(lance_minimo);
  const maxP = toNumber(max_participantes);
  const inicio = new Date(data_inicio);
  const fim = new Date(data_fim);
  const duracaoDias = (fim - inicio) / (1000 * 60 * 60 * 24);

  if (!lanceMinimo || lanceMinimo <= 0) return res.status(400).json({ erro: "O lance mínimo deve ser maior que zero" });
  if (!maxP || maxP < 10 || maxP > 50) return res.status(400).json({ erro: "O limite de participantes deve estar entre 10 e 50" });
  if (isNaN(inicio) || isNaN(fim) || fim <= inicio) return res.status(400).json({ erro: "As datas do leilão são inválidas" });
  if (duracaoDias < 3 || duracaoDias > 30) return res.status(400).json({ erro: "O leilão deve durar entre 3 e 30 dias" });

  if (!isAdmin(criador)) {
    const ultimo = await pool.query(
      "SELECT data_criacao FROM leiloes WHERE criador_id=$1 ORDER BY data_criacao DESC LIMIT 1",
      [criador_id]
    );
    if (ultimo.rows.length && Date.now() - new Date(ultimo.rows[0].data_criacao) < 8 * 3600 * 1000) {
      return res.status(400).json({ erro: "Vendedores só podem criar um leilão a cada 8 horas" });
    }
  }

  const statusInicial = isAdmin(criador) ? status : "AGENDADO";
  const r = await pool.query(
    `INSERT INTO leiloes (titulo, descricao, categoria, lance_minimo, criador_id, data_inicio, data_fim, max_participantes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [titulo.trim(), descricao.trim(), categoria.trim(), lanceMinimo, criador_id, data_inicio, data_fim, maxP, statusInicial]
  );

  // publica evento no RabbitMQ
  try {
    const { publishEvent } = require("../services/eventBus");
    const { randomUUID } = require("crypto");
    await publishEvent("auction.created", {
      eventId: randomUUID(), eventType: "auction.created", occurredAt: new Date().toISOString(),
      producer: `node-${nodeId}`, data: r.rows[0],
    });
  } catch (_) {}

  res.status(201).json(r.rows[0]);
}));

app.get("/leiloes/:id", wrap(async (req, res) => {
  const r = await pool.query("SELECT * FROM leiloes WHERE id=$1", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ erro: "Leilão não encontrado" });
  res.json(r.rows[0]);
}));

app.put("/leiloes/:id", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["titulo", "descricao", "categoria", "lance_minimo", "status", "data_inicio", "data_fim", "max_participantes"]);
  if (missing.length) return res.status(400).json({ erro: "Preencha todos os dados do leilão" });

  const admin = await findUser(req.body.admin_id);
  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem editar leilões" });

  const r = await pool.query(
    `UPDATE leiloes SET titulo=$1, descricao=$2, categoria=$3, lance_minimo=$4,
     status=$5, data_inicio=$6, data_fim=$7, max_participantes=$8 WHERE id=$9 RETURNING *`,
    [req.body.titulo, req.body.descricao, req.body.categoria, req.body.lance_minimo,
     req.body.status, req.body.data_inicio, req.body.data_fim, req.body.max_participantes, req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ erro: "Leilão não encontrado" });
  res.json(r.rows[0]);
}));

app.patch("/leiloes/:id/status", wrap(async (req, res) => {
  const allowed = ["AGENDADO", "ATIVO", "ENCERRADO", "CANCELADO"];
  const admin = await findUser(req.body.admin_id);
  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem alterar status" });
  if (!allowed.includes(req.body.status)) return res.status(400).json({ erro: "Status inválido" });

  const r = await pool.query("UPDATE leiloes SET status=$1 WHERE id=$2 RETURNING *", [req.body.status, req.params.id]);
  if (!r.rows.length) return res.status(404).json({ erro: "Leilão não encontrado" });
  res.json(r.rows[0]);
}));

app.delete("/leiloes/:id", wrap(async (req, res) => {
  const admin = await findUser(req.body.admin_id || req.query.admin_id);
  if (!isAdmin(admin)) return res.status(403).json({ erro: "Apenas administradores podem remover leilões" });

  const r = await pool.query("DELETE FROM leiloes WHERE id=$1 RETURNING id", [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ erro: "Leilão não encontrado" });
  res.json({ mensagem: "Leilão removido com sucesso" });
}));

// ─── participantes ────────────────────────────────────────────────────────────

app.post("/participar", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["usuario_id", "leilao_id"]);
  if (missing.length) return res.status(400).json({ erro: "Informe usuário e leilão" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const u = await client.query("SELECT id FROM usuarios WHERE id=$1", [req.body.usuario_id]);
    if (!u.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ erro: "Usuário não encontrado" }); }

    const l = await client.query("SELECT * FROM leiloes WHERE id=$1 FOR UPDATE", [req.body.leilao_id]);
    if (!l.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ erro: "Leilão não encontrado" }); }

    const leilao = l.rows[0];
    if (new Date() > new Date(leilao.data_fim)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Este leilão já foi encerrado" });
    }

    const qtd = await client.query("SELECT COUNT(*) AS total FROM participantes_leilao WHERE leilao_id=$1", [req.body.leilao_id]);
    if (Number(qtd.rows[0].total) >= Number(leilao.max_participantes)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Limite de participantes atingido" });
    }

    const r = await client.query(
      "INSERT INTO participantes_leilao (usuario_id, leilao_id) VALUES ($1,$2) ON CONFLICT (usuario_id, leilao_id) DO NOTHING RETURNING *",
      [req.body.usuario_id, req.body.leilao_id]
    );
    if (!r.rows.length) { await client.query("ROLLBACK"); return res.status(400).json({ erro: "Usuário já participa deste leilão" }); }

    await client.query("COMMIT");
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

app.get("/participantes", wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT p.id, p.usuario_id, p.leilao_id, u.nome_usuario, l.titulo, p.data_entrada
    FROM participantes_leilao p
    JOIN usuarios u ON p.usuario_id = u.id
    JOIN leiloes l ON p.leilao_id = l.id
    ORDER BY p.data_entrada DESC
  `);
  res.json(r.rows);
}));

app.get("/leiloes/:id/participantes", wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, u.id AS usuario_id, u.nome_usuario, p.data_entrada
     FROM participantes_leilao p
     JOIN usuarios u ON p.usuario_id = u.id
     WHERE p.leilao_id=$1 ORDER BY p.data_entrada ASC`,
    [req.params.id]
  );
  res.json(r.rows);
}));

// ─── lances ───────────────────────────────────────────────────────────────────

app.post("/lances", wrap(async (req, res) => {
  const missing = requireFields(req.body, ["leilao_id", "usuario_id", "valor"]);
  if (missing.length) return res.status(400).json({ erro: "Informe leilão, usuário e valor do lance" });

  const valor = toNumber(req.body.valor);
  if (!valor || valor <= 0) return res.status(400).json({ erro: "O valor do lance deve ser maior que zero" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const l = await client.query("SELECT * FROM leiloes WHERE id=$1 FOR UPDATE", [req.body.leilao_id]);
    if (!l.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ erro: "Leilão não encontrado" }); }

    const leilao = l.rows[0];
    const agora = new Date();

    if (leilao.status !== "ATIVO") { await client.query("ROLLBACK"); return res.status(400).json({ erro: "Leilão não está ativo" }); }
    if (agora < new Date(leilao.data_inicio) || agora > new Date(leilao.data_fim)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Leilão fora do período permitido" });
    }

    const part = await client.query(
      "SELECT id FROM participantes_leilao WHERE usuario_id=$1 AND leilao_id=$2",
      [req.body.usuario_id, req.body.leilao_id]
    );
    if (!part.rows.length) { await client.query("ROLLBACK"); return res.status(400).json({ erro: "Usuário não participa deste leilão" }); }

    const u = await client.query("SELECT * FROM usuarios WHERE id=$1 FOR UPDATE", [req.body.usuario_id]);
    if (!u.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ erro: "Usuário não encontrado" }); }
    if (Number(u.rows[0].creditos) < valor) { await client.query("ROLLBACK"); return res.status(400).json({ erro: "Créditos insuficientes" }); }

    const maior = await client.query("SELECT MAX(valor) AS maior FROM lances WHERE leilao_id=$1", [req.body.leilao_id]);
    const valorAtual = Number(maior.rows[0].maior || leilao.lance_minimo);
    if (valor <= valorAtual) { await client.query("ROLLBACK"); return res.status(400).json({ erro: `O lance deve ser maior que ${valorAtual}` }); }

    const r = await client.query(
      "INSERT INTO lances (leilao_id, usuario_id, valor) VALUES ($1,$2,$3) RETURNING *",
      [req.body.leilao_id, req.body.usuario_id, valor]
    );

    await client.query(
      "INSERT INTO historico_creditos (usuario_id, quantidade, tipo_movimentacao, descricao) VALUES ($1,$2,'LANCE',$3)",
      [req.body.usuario_id, valor, `Lance no leilão #${req.body.leilao_id}`]
    );

    await client.query("COMMIT");

    // publica evento no RabbitMQ
    try {
      const { publishEvent } = require("../services/eventBus");
      const { randomUUID } = require("crypto");
      await publishEvent("bid.placed", {
        eventId: randomUUID(), eventType: "bid.placed", occurredAt: new Date().toISOString(),
        producer: `node-${nodeId}`, data: r.rows[0],
      });
    } catch (_) {}

    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

app.get("/lances", wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT l.id, l.leilao_id, l.usuario_id, u.nome_usuario, le.titulo, l.valor, l.data_lance
    FROM lances l
    JOIN usuarios u ON l.usuario_id = u.id
    JOIN leiloes le ON l.leilao_id = le.id
    ORDER BY l.data_lance DESC
  `);
  res.json(r.rows);
}));

app.get("/leiloes/:id/lances", wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT l.id, l.valor, l.data_lance, u.id AS usuario_id, u.nome_usuario
     FROM lances l JOIN usuarios u ON l.usuario_id = u.id
     WHERE l.leilao_id=$1 ORDER BY l.valor DESC`,
    [req.params.id]
  );
  res.json(r.rows);
}));

app.get("/leiloes/:id/maior-lance", wrap(async (req, res) => {
  const r = await pool.query(
    `SELECT l.valor, u.nome_usuario FROM lances l JOIN usuarios u ON l.usuario_id = u.id
     WHERE l.leilao_id=$1 ORDER BY l.valor DESC LIMIT 1`,
    [req.params.id]
  );
  if (!r.rows.length) return res.json({ mensagem: "Nenhum lance encontrado" });
  res.json(r.rows[0]);
}));


// --- notificacoes ---

app.get("/notificacoes", wrap(async (req, res) => {
  const { leilao_id, usuario_id, limit = 50 } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (leilao_id) { params.push(leilao_id); where += ` AND leilao_id = $${params.length}`; }
  if (usuario_id) { params.push(usuario_id); where += ` AND usuario_id = $${params.length}`; }
  params.push(Math.min(Number(limit) || 50, 200));
  const r = await pool.query(
    `SELECT * FROM notificacoes ${where} ORDER BY criado_em DESC LIMIT $${params.length}`,
    params
  );
  res.json(r.rows);
}));
// ─── admin ────────────────────────────────────────────────────────────────────

app.get("/admin/resumo", wrap(async (req, res) => {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM usuarios) AS usuarios,
      (SELECT COUNT(*) FROM leiloes WHERE status = 'ATIVO') AS leiloes_ativos,
      (SELECT COUNT(*) FROM leiloes WHERE status = 'ENCERRADO') AS leiloes_encerrados,
      (SELECT COALESCE(SUM(creditos), 0) FROM usuarios) AS creditos_em_circulacao,
      (SELECT COUNT(*) FROM lances) AS total_lances
  `);
  res.json(r.rows[0]);
}));

// ─── frontend SPA fallback ────────────────────────────────────────────────────

app.get(["/", "/login", "/cadastro", "/criacao", "/admin"], (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});

// ─── error handlers ───────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ erro: "Rota não encontrada" }));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "23505") return res.status(400).json({ erro: "Registro duplicado" });
  if (err.code === "23503") return res.status(400).json({ erro: "Registro relacionado não encontrado" });
  res.status(500).json({ erro: "Erro interno do servidor" });
});

// ─── startup ──────────────────────────────────────────────────────────────────

app.listen(PORT, host, async () => {
  console.log(`[Node ${nodeId}] rodando na porta ${PORT}`);

  startHeartbeat(nodeId);
  setTimeout(() => bullyService.startElection(), 1000);

  // Berkeley: sincroniza a cada 5 minutos se este no for o coordenador
  setInterval(async () => {
    if (bullyService.getCoordinator() === nodeId) {
      await berkeleyService.runSync(nodeId).catch(e =>
        console.error("[Berkeley] Erro no sync automatico:", e.message)
      );
    }
  }, 5 * 60 * 1000);

  // primeira sincronizacao 10s apos startup (da tempo da eleicao terminar)
  setTimeout(async () => {
    if (bullyService.getCoordinator() === nodeId) {
      await berkeleyService.runSync(nodeId).catch(e =>
        console.error("[Berkeley] Erro no sync inicial:", e.message)
      );
    }
  }, 10000);

  try {
    await connectEventBus();
    await startConsumers();
    console.log(`[Node ${nodeId}] RabbitMQ conectado`);
  } catch (e) {
    console.error(`[Node ${nodeId}] RabbitMQ falhou:`, e.message);
  }
});

process.on("SIGINT", async () => {
  await closeEventBus();
  process.exit(0);
});