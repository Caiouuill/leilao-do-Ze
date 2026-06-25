const state = {
  usuario: JSON.parse(localStorage.getItem("leilao_usuario") || "null"),
  usuarios: [],
  leiloes: [],
  lances: [],
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const sessionLabel = document.querySelector("#sessionLabel");
const logoutButton = document.querySelector("#logoutButton");

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.erro || "Não foi possível concluir a operação");
    }

    return data;
  },
  get(path) {
    return this.request(path);
  },
  post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  put(path, body) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  },
  patch(path, body) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  },
};

function isAdmin(user = state.usuario) {
  return ["ADMIN", "SUPERADMIN"].includes(user?.tipo_usuario);
}

function isSeller(user = state.usuario) {
  return ["VENDEDOR", "ADMIN", "SUPERADMIN"].includes(user?.tipo_usuario);
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.add("hidden"), 3600);
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.dataset.originalText ||= button.textContent;
  button.textContent = loading ? "Aguarde..." : button.dataset.originalText;
}

function navigate(path) {
  history.pushState({}, "", path);
  renderRoute();
}

function template(id) {
  return document.querySelector(id).content.cloneNode(true);
}

function setDefaultAuctionDates(form) {
  const now = new Date();
  now.setHours(now.getHours() + 1);
  const end = new Date(now);
  end.setDate(end.getDate() + 3);

  const format = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  form.elements.data_inicio.value = format(now);
  form.elements.data_fim.value = format(end);
}

function updateSession() {
  if (state.usuario) {
    sessionLabel.textContent = `${state.usuario.nome_usuario} | ${state.usuario.tipo_usuario} | ${money(state.usuario.creditos)}`;
    logoutButton.classList.remove("hidden");
  } else {
    sessionLabel.textContent = "Visitante";
    logoutButton.classList.add("hidden");
  }

  document.querySelectorAll("[data-guest]").forEach((item) => item.classList.toggle("hidden", Boolean(state.usuario)));
  document.querySelectorAll("[data-role='seller']").forEach((item) => item.classList.toggle("hidden", !isSeller()));
  document.querySelectorAll("[data-role='admin']").forEach((item) => item.classList.toggle("hidden", !isAdmin()));
}

async function loadData() {
  const [usuarios, leiloes, lances] = await Promise.all([
    api.get("/usuarios"),
    api.get("/leiloes"),
    api.get("/lances"),
  ]);

  state.usuarios = usuarios;
  state.leiloes = leiloes;
  state.lances = lances;

  if (state.usuario) {
    const updated = usuarios.find((user) => Number(user.id) === Number(state.usuario.id));
    if (updated) {
      state.usuario = updated;
      localStorage.setItem("leilao_usuario", JSON.stringify(updated));
    }
  }

  updateSession();
}

function requireLogin() {
  if (!state.usuario) {
    navigate("/login");
    showToast("Faça login para continuar");
    return false;
  }
  return true;
}

function renderBlocked(title, message) {
  app.innerHTML = `
    <section class="auth-page">
      <div class="panel auth-card">
        <p class="eyebrow">Acesso restrito</p>
        <h1>${title}</h1>
        <p>${message}</p>
        <a class="button-link" href="/" data-link>Voltar aos leilões</a>
      </div>
    </section>
  `;
}

function renderLogin() {
  app.replaceChildren(template("#loginTemplate"));
  const form = document.querySelector("#loginForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);

    try {
      const data = await api.post("/login", formData(form));
      state.usuario = data.usuario;
      localStorage.setItem("leilao_usuario", JSON.stringify(data.usuario));
      await loadData();
      showToast("Login realizado com sucesso");
      navigate("/");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

function renderRegister() {
  app.replaceChildren(template("#registerTemplate"));
  const form = document.querySelector("#registerForm");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    setLoading(button, true);

    try {
      await api.post("/usuarios", formData(form));
      showToast("Conta criada. Agora faça login.");
      navigate("/login");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

function renderProfile() {
  const panel = document.querySelector("#profilePanel");
  if (!state.usuario) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div>
      <strong>${state.usuario.nome_usuario}</strong>
      <span>${state.usuario.email}</span>
    </div>
    <div>
      <span>Tipo</span>
      <strong>${state.usuario.tipo_usuario}</strong>
    </div>
    <div>
      <span>Créditos</span>
      <strong>${money(state.usuario.creditos)}</strong>
    </div>
    <div>
      <span>Cadastro</span>
      <strong>${dateTime(state.usuario.data_cadastro)}</strong>
    </div>
  `;
}

function auctionCard(auction) {
  const currentBid = Number(auction.maior_lance || 0) > 0 ? auction.maior_lance : auction.lance_minimo;
  const adminControls = isAdmin()
    ? `
      <div class="card-actions">
        <button type="button" data-status="${auction.id}" data-value="ATIVO">Ativar</button>
        <button type="button" data-status="${auction.id}" data-value="ENCERRADO" class="ghost">Encerrar</button>
        <button type="button" data-status="${auction.id}" data-value="CANCELADO" class="danger">Cancelar</button>
      </div>
    `
    : "";

  const bidControls = state.usuario
    ? `
      <div class="card-actions">
        <button type="button" data-join="${auction.id}" class="ghost">Participar</button>
      </div>
      <form class="bid-form" data-bid-form="${auction.id}">
        <input name="valor" type="number" min="1" step="0.01" placeholder="Valor do lance" required />
        <button type="submit">Dar lance</button>
      </form>
    `
    : `<a class="button-link" href="/login" data-link>Entrar para participar</a>`;

  return `
    <article class="auction-card">
      <header>
        <div>
          <h3>${auction.titulo}</h3>
          <p>${auction.categoria || "Sem categoria"} | Criado por ${auction.criador || "-"}</p>
        </div>
        <span class="status ${String(auction.status || "").toLowerCase()}">${auction.status}</span>
      </header>
      <p>${auction.descricao || ""}</p>
      <div class="meta-grid">
        <div class="meta"><span>Lance atual</span><strong>${money(currentBid)}</strong></div>
        <div class="meta"><span>Participantes</span><strong>${auction.participantes || 0}/${auction.max_participantes}</strong></div>
        <div class="meta"><span>Início</span><strong>${dateTime(auction.data_inicio)}</strong></div>
        <div class="meta"><span>Fim</span><strong>${dateTime(auction.data_fim)}</strong></div>
      </div>
      ${bidControls}
      ${adminControls}
    </article>
  `;
}

async function renderAuctions() {
  await loadData();
  app.replaceChildren(template("#auctionsTemplate"));
  renderProfile();

  const list = document.querySelector("#auctionList");
  list.innerHTML = state.leiloes.length
    ? state.leiloes.map(auctionCard).join("")
    : "<div class='empty'>Nenhum leilão cadastrado ainda.</div>";

  document.querySelector("#refreshButton").addEventListener("click", async () => {
    await renderAuctions();
    showToast("Dados atualizados");
  });

  list.addEventListener("click", async (event) => {
    const joinId = event.target.dataset.join;
    const statusId = event.target.dataset.status;

    try {
      if (joinId) {
        if (!requireLogin()) return;
        await api.post("/participar", { usuario_id: state.usuario.id, leilao_id: Number(joinId) });
        await renderAuctions();
        showToast("Participação confirmada");
      }

      if (statusId) {
        if (!isAdmin()) return showToast("Apenas administradores podem alterar status");
        await api.patch(`/leiloes/${statusId}/status`, {
          status: event.target.dataset.value,
          admin_id: state.usuario.id,
        });
        await renderAuctions();
        showToast("Status atualizado");
      }
    } catch (error) {
      showToast(error.message);
    }
  });

  list.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-bid-form]");
    if (!form) return;

    event.preventDefault();
    if (!requireLogin()) return;

    const button = event.submitter;
    setLoading(button, true);

    try {
      await api.post("/lances", {
        leilao_id: Number(form.dataset.bidForm),
        usuario_id: state.usuario.id,
        valor: Number(formData(form).valor),
      });
      await renderAuctions();
      showToast("Lance registrado");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

async function renderCreate() {
  if (!requireLogin()) return;
  if (!isSeller()) {
    return renderBlocked("Criação indisponível", "Somente vendedores verificados, administradores e superadministradores podem criar leilões.");
  }

  await loadData();
  app.replaceChildren(template("#createTemplate"));
  const form = document.querySelector("#auctionForm");
  setDefaultAuctionDates(form);

  document.querySelectorAll("[data-admin-only]").forEach((item) => item.classList.toggle("hidden", !isAdmin()));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = formData(form);
    setLoading(button, true);

    try {
      await api.post("/leiloes", {
        ...data,
        criador_id: state.usuario.id,
        lance_minimo: Number(data.lance_minimo),
        max_participantes: Number(data.max_participantes),
        status: isAdmin() ? data.status : "AGENDADO",
      });
      showToast("Leilão criado");
      navigate("/");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

function fillUserSelect(select) {
  select.innerHTML = state.usuarios
    .map((user) => `<option value="${user.id}">${user.nome_usuario} (${user.tipo_usuario})</option>`)
    .join("");
}

function renderUsersTable() {
  const table = document.querySelector("#usersTable");
  table.innerHTML = state.usuarios.map((user) => `
    <tr>
      <td>${user.id}</td>
      <td>${user.nome_usuario}</td>
      <td>${user.email}</td>
      <td>${user.tipo_usuario}</td>
      <td>${money(user.creditos)}</td>
    </tr>
  `).join("");
}

function renderBids() {
  const list = document.querySelector("#bidList");
  list.innerHTML = state.lances.length
    ? state.lances.slice(0, 20).map((bid) => `
      <article class="timeline-item">
        <strong>${money(bid.valor)}</strong> por ${bid.nome_usuario} em ${bid.titulo}
        <p>${dateTime(bid.data_lance)}</p>
      </article>
    `).join("")
    : "<div class='empty'>Nenhum lance registrado.</div>";
}

async function renderSummary() {
  const resumo = await api.get("/admin/resumo");
  document.querySelector("#metricUsers").textContent = resumo.usuarios || 0;
  document.querySelector("#metricActiveAuctions").textContent = resumo.leiloes_ativos || 0;
  document.querySelector("#metricCredits").textContent = money(resumo.creditos_em_circulacao || 0);
  document.querySelector("#metricBids").textContent = resumo.total_lances || 0;
}

async function renderAdmin() {
  if (!requireLogin()) return;
  if (!isAdmin()) {
    return renderBlocked("Painel bloqueado", "Somente administradores e superadministradores podem acessar o painel administrativo.");
  }

  await loadData();
  app.replaceChildren(template("#adminTemplate"));
  renderUsersTable();
  renderBids();
  renderSummary().catch(() => {});

  fillUserSelect(document.querySelector("#creditUserSelect"));
  fillUserSelect(document.querySelector("#adminUserSelect"));

  document.querySelector("#creditForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = formData(event.currentTarget);
    setLoading(button, true);

    try {
      await api.put(`/usuarios/${data.usuario_id}/creditos`, {
        quantidade: Number(data.quantidade),
        descricao: data.descricao,
        admin_id: state.usuario.id,
      });
      await renderAdmin();
      showToast("Créditos atualizados");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });

  document.querySelector("#adminUserForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const data = formData(event.currentTarget);
    const user = state.usuarios.find((item) => Number(item.id) === Number(data.usuario_id));
    setLoading(button, true);

    try {
      await api.put(`/usuarios/${data.usuario_id}`, {
        nome_usuario: user.nome_usuario,
        email: user.email,
        tipo_usuario: data.tipo_usuario,
        admin_id: state.usuario.id,
      });
      await renderAdmin();
      showToast("Usuário atualizado");
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(button, false);
    }
  });
}

async function renderRoute() {
  updateSession();

  const path = window.location.pathname;
  if (path === "/login") return renderLogin();
  if (path === "/cadastro") return renderRegister();
  if (path === "/criacao") return renderCreate();
  if (path === "/admin") return renderAdmin();
  return renderAuctions();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (!link) return;

  event.preventDefault();
  navigate(new URL(link.href).pathname);
});

logoutButton.addEventListener("click", () => {
  state.usuario = null;
  localStorage.removeItem("leilao_usuario");
  updateSession();
  showToast("Você saiu da conta");
  navigate("/login");
});

window.addEventListener("popstate", renderRoute);

renderRoute().catch((error) => showToast(error.message));
