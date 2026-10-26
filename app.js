"use strict";

const el = id => document.getElementById(id);
const state = {token: window.TabulaConnection.getToken(), capabilities: null,
  chats: [], chat: null, tasks: new Map(), kind: "analysis", busy: false, polling: false, connected: false,
  showArchived: false, chatListRevision: 0, chatListLoading: false,
  modelFlow: null, flowLoading: false, flowError: "", selectionRevision: 0, dashboardFocus: null,
  tabulaModels: [], tabulaModelsLoading: false, tabulaCatalogRevision: 0, tabulaPullRequest: null,
  workspaceMode: ["dialog", "graph", "optimization", "constraints", "dashboard", "screens"].includes(new URL(window.location.href).searchParams.get("view") || sessionStorage.getItem("tabula_harness_workspace_mode")) ? (new URL(window.location.href).searchParams.get("view") || sessionStorage.getItem("tabula_harness_workspace_mode")) : "dialog"};
let dashboard = null, constraints = null, screens = null;
const terminal = new Set(["completed", "needs_review", "needs_input", "failed", "blocked", "cancelled", "interrupted"]);
const statuses = {queued: ["В очереди", "neutral"], running: ["Выполняется", "running"], completed: ["Готово", "success"],
  needs_review: ["Нужна проверка", "warning"], needs_input: ["Нужно уточнение", "warning"], failed: ["Ошибка", "danger"], blocked: ["Расчёт заблокирован", "warning"],
  cancelled: ["Остановлено", "neutral"], interrupted: ["Прервано", "warning"]};


function node(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined && text !== null) value.textContent = String(text);
  return value;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon"); svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`); svg.append(use);
  return svg;
}
function cleanText(value) { return window.TabulaPresentation.text(value); }
function modelTitle(value) { return window.TabulaPresentation.title(value); }
function taskError(error) {
  const value = String(error || "");
  if (/infeasib|недопустим|несовместим|нет допустим/i.test(value)) return "Не удалось найти план, который выполняет все ограничения. Проверьте условия расчёта.";
  if (/capacity|rate.limit|429|перегруж|лимит запрос/i.test(value)) return "Сервис ответов сейчас перегружен. Попробуйте повторить запрос чуть позже.";
  if (/timeout|timed.out|время ожидания/i.test(value)) return "Сервис не ответил вовремя. Повторите запрос.";
  if (/insufficient|недостаточ|missing|не хватает/i.test(value)) return "Для ответа не хватает данных. Уточните показатель, период или условия задачи.";
  return "Не удалось завершить запрос. Повторите его или уточните условия задачи.";
}

function renderAnswer(text) {
  const root = node("div", "message-text formatted-message");
  const lines = String(text).split("\n");
  function inline(parent, value) {
    for (const part of value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)) {
      if (part.startsWith("**") && part.endsWith("**")) parent.append(node("strong", "", part.slice(2, -2)));
      else if (part.startsWith("`") && part.endsWith("`")) parent.append(node("code", "", part.slice(1, -1)));
      else parent.append(document.createTextNode(part));
    }
  }
  const tableCells = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
  const isTable = index => lines[index]?.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[index + 1] || "");
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (isTable(i)) {
      const wrap = node("div", "answer-table-wrap"), table = node("table", "answer-table"), head = node("thead"), body = node("tbody"), row = node("tr");
      const headers = tableCells(lines[i]);
      headers.forEach(value => { const cell = node("th"); cell.scope = "col"; inline(cell, value); row.append(cell); }); head.append(row); i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = node("tr"), values = tableCells(lines[i]);
        headers.forEach((_, index) => { const cell = node("td"); inline(cell, values[index] || ""); row.append(cell); }); body.append(row); i++;
      }
      headers.forEach((_, index) => {
        const cells = [...body.rows].map(row => row.cells[index]);
        if (cells.length && cells.every(cell => /^(?:[+−–-]?\s*\d|—$)/.test(cell.textContent.trim()))) {
          row.cells[index].classList.add("numeric"); cells.forEach(cell => cell.classList.add("numeric"));
        }
      });
      table.append(head, body); wrap.append(table); root.append(wrap); continue;
    }
    if (/^#{1,3}\s/.test(line) || /^\*\*[^*]+\*\*$/.test(line)) {
      const heading = node("h3"); inline(heading, line.replace(/^#{1,3}\s+/, "")); root.append(heading); i++; continue;
    }
    const bullet = line.match(/^(?:[-*]\s+|\d+[.)]\s+)/);
    if (bullet) {
      const ordered = /^\d/.test(bullet[0]), list = node(ordered ? "ol" : "ul");
      if (ordered) list.start = parseInt(bullet[0], 10);
      while (i < lines.length) {
        const match = lines[i].trim().match(ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) break;
        const item = node("li"); inline(item, match[1]); list.append(item); i++;
      }
      root.append(list); continue;
    }
    const paragraph = node("p"), values = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:[-*]\s|\d+[.)]\s|#{1,3}\s|\*\*)/.test(lines[i].trim()) && !isTable(i)) values.push(lines[i++].trim());
    inline(paragraph, values.join(" ")); root.append(paragraph);
  }
  return root;
}

function notice(text = "", error = false) {
  el("global-notice").textContent = cleanText(text);
  el("global-notice").className = "notice" + (error ? " error" : "");
  el("global-notice").hidden = !text;
}
async function api(path, options = {}) {
  const response = await window.TabulaConnection.request(path, state.token, options);
  if (!response.ok) {
    let message = `Ошибка запроса (${response.status}).`;
    try { const data = await response.json(); message = typeof data.detail === "string" ? data.detail : "Проверьте параметры запроса и попробуйте ещё раз."; } catch (_) {}
    if (response.status === 401) {
      state.connected = false; state.capabilities = null; window.TabulaConnection.clearToken();
      updateControls();
      el("connection-state").className = "badge danger"; el("connection-state").textContent = "Нет доступа";
    }
    const failure = new Error(cleanText(message)); failure.status = response.status; throw failure;
  }
  return options.blob ? response.blob() : response.json();
}
function setBusy(value) { state.busy = value; updateControls(); }
function tabulaModelStatus(message, error = false) {
  el("tabula-model-status").textContent = cleanText(message);
  el("tabula-model-status").className = "tabula-model-status" + (error ? " error" : "");
}
async function refreshTabulaModels() {
  if (!state.connected || state.busy) return;
  const revision = ++state.tabulaCatalogRevision;
  state.tabulaModelsLoading = true; state.tabulaModels = [];
  el("tabula-model-select").replaceChildren(new Option("Получаем список моделей…", ""));
  tabulaModelStatus("Получаем список моделей…"); updateControls();
  try {
    const response = await api("/v1/tabula/models");
    if (revision !== state.tabulaCatalogRevision) return;
    if (response.available !== true || !Array.isArray(response.models)) throw new Error(response.message || "Список моделей Табулы пока недоступен. Проверьте подключение.");
    const models = response.models.filter(model => model && typeof model.model_id === "string" && model.model_id.trim());
    state.tabulaModels = models;
    const select = el("tabula-model-select"); select.replaceChildren(new Option("Выберите модель", ""));
    for (const [index, model] of models.entries()) select.append(new Option(modelTitle(model.label) + (models.filter(item => modelTitle(item.label) === modelTitle(model.label)).length > 1 ? ` · ${index + 1}` : ""), model.model_id));
    tabulaModelStatus(models.length ? response.catalog_live === false || response.source === "known_native_models" ?
      "Выберите модель и нажмите «Получить граф из Табулы»." :
      "Выберите модель и нажмите «Получить граф из Табулы»." : "Доступных моделей пока нет.");
  } catch (error) {
    if (revision !== state.tabulaCatalogRevision) return;
    state.tabulaModels = []; el("tabula-model-select").replaceChildren(new Option("Список недоступен", ""));
    tabulaModelStatus(error.message || "Не удалось получить список моделей из Табулы.", true);
  } finally {
    if (revision === state.tabulaCatalogRevision) { state.tabulaModelsLoading = false; updateControls(); }
  }
}
async function pullTabulaModel() {
  if (!state.connected || state.busy || state.tabulaModelsLoading) return;
  const modelId = el("tabula-model-select").value;
  if (!state.tabulaModels.some(model => model.model_id === modelId)) return;
  if (state.tabulaPullRequest?.model_id !== modelId) {
    const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().replace(/-/g, "") :
      Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join("");
    state.tabulaPullRequest = {model_id: modelId, request_id: id};
  }
  setBusy(true); notice(); tabulaModelStatus("Запрашиваем актуальную модель из Табулы…");
  try {
    const result = await api("/v1/chats/from-tabula", {method: "POST", json: state.tabulaPullRequest});
    if (!result || !/^[a-f0-9]{32}$/.test(result.chat_id || "")) throw new Error("Сервис не подтвердил диалог выбранной модели.");
    state.showArchived = false;
    await loadChats(); await selectChat(result.chat_id);
    if (state.chat?.id !== result.chat_id) throw new Error("Запрос модели сохранён, но диалог пока не удалось открыть. Повторите открытие.");
    modelFlow.watchGraph();
    state.tabulaPullRequest = null;
    el("tabula-model-picker").hidden = true;
  } catch (error) { tabulaModelStatus(error.message || "Не удалось запросить модель из Табулы.", true); }
  finally { setBusy(false); }
}
function updateControls() {
  const connected = state.connected, selected = !!state.chat;
  const reviewing = !!state.chat?.optimization_context && state.kind === "analysis";
  const modelLoaded = state.modelFlow?.model_loaded === true;
  const fromTabula = state.modelFlow?.source === "tabula";
  const pullStopped = fromTabula && ["failed", "needs_input", "needs_reconciliation"].includes(state.modelFlow.status);
  const preparing = state.flowLoading || !!state.flowError || (state.modelFlow && state.modelFlow.status !== "ready");
  const flowAllowsKind = !preparing && (!state.modelFlow || (state.kind === "analysis" ? state.modelFlow.analysis_ready : state.modelFlow.optimization_ready));
  document.body.classList.toggle("is-connected", connected);
  if (!connected) el("connection-panel").open = true;
  el("workspace-status").className = "workspace-status" + (connected && selected && (modelLoaded || !preparing) ? reviewing ? " reviewing" : " ready" : "");
  el("workspace-status-label").textContent = !connected ? "Нет подключения" : !selected ? "Модель не выбрана" : pullStopped ? "Граф требует проверки" : fromTabula && state.modelFlow.status !== "ready" ? "Получение графа" : modelLoaded ? "Модель в Табуле" : preparing ? "Подготовка модели" : reviewing ? "Оптимизированный план" : state.modelFlow ? "Модель в Табуле" : "Исходная модель";
  el("open-tabula-models").disabled = !connected || state.busy;
  el("refresh-tabula-models").disabled = !connected || state.busy || state.tabulaModelsLoading;
  el("tabula-model-select").disabled = !connected || state.busy || state.tabulaModelsLoading || !state.tabulaModels.length;
  el("pull-tabula-model").disabled = !connected || state.busy || state.tabulaModelsLoading || !el("tabula-model-select").value;
  el("jump-latest").disabled = !selected;
  document.querySelectorAll("[data-workspace-mode]").forEach(button => {
    const mode = button.dataset.workspaceMode;
    button.disabled = !connected || !selected || ((mode === "graph" || mode === "optimization") &&
      (state.busy || !state.modelFlow?.graph?.ready)) || (mode === "optimization" && !state.capabilities?.solver_configured);
  });
  el("workspace-graph").disabled = !connected || !selected || state.busy || !state.modelFlow?.graph?.ready;
  el("plan-context").hidden = el("plan-questions").hidden = !reviewing;
  el("dashboard-focus-context").hidden = !state.dashboardFocus || state.kind !== "analysis" || reviewing;
  el("dashboard-focus-label").textContent = state.dashboardFocus ? "Обсуждаем: " + state.dashboardFocus.label : "";
  if (reviewing) el("plan-context-title").textContent = "Обсуждаем оптимизированный план · " + dateLabel(state.chat.optimization_context.created_at, true);
  el("leave-plan-context").disabled = state.busy;
  document.querySelectorAll("[data-plan-question]").forEach(button => { button.disabled = state.busy || !connected; });
  document.querySelectorAll("[data-discuss-plan]").forEach(button => { button.disabled = state.busy || !connected || !state.capabilities?.agent_configured || preparing || (state.modelFlow && !state.modelFlow.analysis_ready); });
  el("model-file").disabled = !connected || state.busy;
  el("upload-label").classList.toggle("disabled", !connected || state.busy);
  el("upload-label").setAttribute("aria-disabled", String(!connected || state.busy));
  el("refresh-chats").disabled = !connected || state.busy || state.chatListLoading;
  el("toggle-chat-archive").disabled = !connected || state.busy || state.chatListLoading;
  document.querySelectorAll("[data-restore-chat],[data-delete-chat]").forEach(button => { button.disabled = !connected || state.busy; });
  el("connect-button").disabled = state.busy;
  el("message-input").disabled = !connected || !selected || state.busy || !flowAllowsKind;
  el("mode-label").hidden = state.kind !== "optimization";
  const configured = !!state.capabilities?.agent_configured;
  const mode = state.kind === "analysis" ? "agent" : el("execution-mode").value;
  const allowed = connected && selected && flowAllowsKind && (configured || mode === "workflow") &&
    (state.kind !== "optimization" || state.capabilities?.solver_configured);
  el("send-button").disabled = !allowed || state.busy;
  document.querySelectorAll("[data-metric-insight-question]").forEach(button => { button.disabled = !canDiscussMetric(); });
  el("send-button-label").textContent = state.busy ? "Отправляю" : state.kind === "optimization" ? "Запустить" : "Отправить";
  el("execution-mode").querySelector('[value="agent"]').disabled = !configured;
  let hint = "Сначала подключись и выбери модель.";
  if (connected && selected) {
    if (pullStopped) hint = "Получение графа приостановлено. Проверьте сообщение о состоянии модели выше.";
    else if (fromTabula && state.modelFlow.status !== "ready") hint = "Получаем актуальную модель из Табулы и строим граф её зависимостей. Состояние показано выше.";
    else if (modelLoaded && state.modelFlow.status !== "ready") hint = "Загрузка завершена. Откройте созданную модель в Табуле. Граф, аналитика и оптимизация — отдельный следующий шаг.";
    else if (preparing) hint = state.flowError ? "Проверьте состояние модели в панели выше." : "Дождитесь подготовки Excel и нажмите «Загрузить в Табулу».";
    else if (state.modelFlow && !flowAllowsKind) hint = state.kind === "optimization" ? "Для этой модели пока не подтверждены правила и данные, необходимые для оптимизации." : "Данные модели для аналитики пока не подтверждены.";
    else if (state.kind === "analysis") hint = configured ? reviewing ? "Вопросы по изменениям и выполнению нового плана." : "Задайте вопрос по показателям модели." : "Ответы по данным пока недоступны. Проверьте подключение в настройках.";
    else if (!state.capabilities?.solver_configured) hint = "Оптимизация пока недоступна. Проверьте подключение в настройках.";
    else hint = mode === "workflow" ? "Расчёт по цели и правилам выбранной модели." : "Рассчитаем план и объясним, за счёт каких решений изменится результат.";
  }
  el("composer-hint").textContent = hint;
  el("message-input").placeholder = reviewing ? "Например: что поменять в производстве и закупках для выполнения этого плана?" : state.kind === "analysis" ? "Например: какие ограничения есть в этой модели?" : "Например: рассчитай оптимизированный план по цели модели.";
  document.querySelectorAll("[data-kind]").forEach(button => {
    const selected = button.dataset.kind === state.kind;
    button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
    const optimizationEntry = button.dataset.kind === "optimization" && state.modelFlow?.status === "ready" && state.modelFlow.graph?.ready && state.capabilities?.solver_configured;
    button.disabled = !!preparing || !!(state.modelFlow && !optimizationEntry && !(button.dataset.kind === "analysis" ? state.modelFlow.analysis_ready : state.modelFlow.optimization_ready));
  });
  modelFlow.setAvailability({connected, busy: state.busy, analysis: configured,
    optimization: !!state.capabilities?.solver_configured});
}
async function connect(event) {
  event?.preventDefault();
  state.token = el("access-token").value.trim();
  if (!state.token) return;
  setBusy(true); notice();
  try {
    state.capabilities = await api("/v1/capabilities"); state.connected = true; updateControls();
    window.TabulaConnection.saveToken(state.token);
    el("connection-state").className = "badge success"; el("connection-state").textContent = "Подключено";
    el("capabilities").textContent = `Аналитика: ${state.capabilities.agent_configured ? "подключена" : "недоступна"}. Расчёт: ${state.capabilities.solver_configured ? "подключён" : "недоступен"}.`;
    el("runtime-label").textContent = "Сервис подключён";
    el("connection-panel").open = false;
    if (!state.capabilities.agent_configured) {
      el("execution-mode").value = "workflow";
      notice("Ответы по данным пока недоступны. Загрузка моделей и прямой расчёт доступны.");
    }
    await loadChats();
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
}
async function loadChats() {
  const revision = ++state.chatListRevision, archived = state.showArchived;
  state.chatListLoading = true; renderChats(); updateControls();
  try {
    const chats = await api("/v1/chats" + (archived ? "?archived=true" : ""));
    if (revision !== state.chatListRevision || archived !== state.showArchived) return;
    state.chats = chats.filter(chat => archived ? !!chat.archived_at : !chat.archived_at);
    if (archived) {
      if (state.chat && state.chats.some(chat => chat.id === state.chat.id)) await clearSelectedChat();
      return;
    }
    const requested = new URL(window.location.href).searchParams.get("chat");
    const remembered = sessionStorage.getItem("tabula_harness_chat_id");
    const selected = [requested, remembered, state.chats[0]?.id]
      .find(id => id && state.chats.some(chat => chat.id === id));
    if (selected && state.chat?.id !== selected) await selectChat(selected);
    else if (selected) await modelFlow.refresh();
    else await clearSelectedChat();
  } finally {
    if (revision === state.chatListRevision) { state.chatListLoading = false; renderChats(); updateControls(); }
  }
}
async function clearSelectedChat() {
  state.selectionRevision++; state.chat = null; state.dashboardFocus = null; state.renderSignature = null;
  state.modelFlow = null; state.flowLoading = false; state.flowError = ""; state.kind = "analysis";
  sessionStorage.removeItem("tabula_harness_chat_id");
  const url = new URL(window.location.href); url.searchParams.delete("chat");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  dashboard?.setChat(null);
  constraints?.setChat(null);
  screens?.setChat(null);
  el("chat-title").textContent = "Аналитика и планирование";
  el("model-caption").textContent = "Выберите модель, чтобы начать работу.";
  el("message-input").value = "";
  const welcome = node("div", "welcome");
  welcome.append(node("h2", "", "Начните с модели"), node("p", "", "Загрузите Excel, получите граф из Табулы или верните сохранённую модель из архива."));
  el("conversation").replaceChildren(welcome);
  await modelFlow.selectChat(null); setWorkspaceMode("dialog"); updateControls();
}
async function restoreArchivedChat(id) {
  if (state.busy || !state.connected) return;
  setBusy(true); notice();
  try {
    await api(`/v1/chats/${encodeURIComponent(id)}/archive`, {method: "POST", json: {archived: false}});
    state.showArchived = false;
    await loadChats(); await selectChat(id);
    notice("Модель возвращена в рабочий список. Данные и история сохранены.");
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
}
function dateLabel(value, withTime = false) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", withTime ? {hour: "2-digit", minute: "2-digit"} : {day: "numeric", month: "short"}).format(date);
}
function renderChats() {
  const list = el("chat-list"); list.replaceChildren();
  el("chat-list-title").textContent = state.showArchived ? "Архив моделей" : "Мои модели";
  el("toggle-chat-archive").textContent = state.showArchived ? "К моделям" : "Архив";
  el("toggle-chat-archive").setAttribute("aria-pressed", String(state.showArchived));
  el("chat-count").textContent = String(state.chats.length);
  if (state.chatListLoading) { list.append(node("p", "muted empty-list", "Загружаем список…")); return; }
  if (!state.chats.length) { list.append(node("p", "muted empty-list", state.showArchived ? "В архиве пока нет моделей" : "Загрузите первую модель или откройте архив")); return; }
  for (const chat of state.chats) {
    if (state.showArchived) {
      const row = node("div", "archived-chat"), copy = node("div", "chat-copy");
      copy.append(node("strong", "", modelTitle(chat.title)), node("small", "", "В архиве · " + dateLabel(chat.archived_at)));
      const restore = node("button", "archive-restore-button", "Вернуть"); restore.type = "button";
      restore.dataset.restoreChat = chat.id; restore.disabled = state.busy || !state.connected;
      restore.setAttribute("aria-label", "Вернуть модель «" + modelTitle(chat.title) + "»");
      restore.addEventListener("click", () => restoreArchivedChat(chat.id)); row.append(copy, restore); list.append(row); continue;
    }
    const button = node("button", "chat-button" + (state.chat?.id === chat.id ? " active" : ""));
    button.type = "button";
    button.setAttribute("aria-current", state.chat?.id === chat.id ? "true" : "false");
    const copy = node("span", "chat-copy");
    copy.append(node("strong", "", modelTitle(chat.title)), node("small", "", "Модель · " + dateLabel(chat.created_at)));
    button.append(icon("chat"), copy);
    button.addEventListener("click", () => {
      if (state.busy) return;
      if (constraints?.hasUnsavedChanges() && !window.confirm("Есть несохранённые изменения ограничений. Перейти без сохранения?")) return;
      selectChat(chat.id);
    });
    const row = node("div", "model-list-row"), remove = node("button", "model-delete-button");
    remove.type = "button"; remove.dataset.deleteChat = chat.id;
    remove.title = "Удалить из моих моделей"; remove.setAttribute("aria-label", "Удалить модель «" + modelTitle(chat.title) + "»");
    remove.disabled = state.busy || !state.connected; remove.append(icon("trash"));
    remove.addEventListener("click", () => confirmRemoveChat(chat)); row.append(button, remove); list.append(row);
  }
}

function confirmRemoveChat(chat) {
  if (!state.connected || state.busy || document.getElementById("remove-model-dialog")) return;
  const dialog = node("dialog", "remove-model-dialog"); dialog.id = "remove-model-dialog";
  const title = node("h2", "", "Удалить модель из списка?"); title.id = "remove-model-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const copy = node("p", "", "«" + modelTitle(chat.title) + "» будет убрана из «Моих моделей». Вернуть её вместе с историей можно из архива.");
  const status = node("p", "remove-model-status"); status.setAttribute("role", "status");
  const footer = node("div", "remove-model-actions"), cancel = node("button", "model-flow-button", "Отмена"), accept = node("button", "model-flow-button remove-model-confirm", "Удалить");
  cancel.type = accept.type = "button"; cancel.addEventListener("click", close);
  accept.addEventListener("click", async () => {
    accept.disabled = cancel.disabled = true; status.textContent = "Удаляем из списка…";
    try {
      const result = await api(`/v1/chats/${chat.id}`, {method: "DELETE"});
      if (result?.removed !== true) throw new Error("Удаление не подтверждено. Обновите список моделей.");
      if (state.chat?.id === chat.id) await clearSelectedChat();
      close(); await loadChats(); notice("Модель удалена из списка. Она доступна в архиве.");
    } catch (error) { status.textContent = cleanText(error.message); accept.disabled = cancel.disabled = false; }
  });
  footer.append(cancel, accept); dialog.append(title, copy, status, footer);
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!accept.disabled) close(); });
  document.body.append(dialog); dialog.showModal(); cancel.focus();
}
async function selectChat(id) {
  if (screens?.hasUnsavedChanges() && !screens.canLeave()) return;
  const selectionRevision = ++state.selectionRevision;
  state.dashboardFocus = null;
  dashboard?.setChat(null);
  constraints?.setChat(null);
  screens?.setChat(null);
  try {
    const chat = await api(`/v1/chats/${id}`);
    if (selectionRevision !== state.selectionRevision) return;
    if (chat.archived_at) {
      await clearSelectedChat(); notice("Модель находится в архиве. Нажмите «Архив» и «Вернуть», чтобы продолжить работу."); return;
    }
    state.chat = chat;
    dashboard?.setChat(chat);
    constraints?.setChat(chat);
    screens?.setChat(chat);
    sessionStorage.setItem("tabula_harness_chat_id", state.chat.id);
    const url = new URL(window.location.href);
    url.searchParams.set("chat", state.chat.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    el("chat-title").textContent = modelTitle(state.chat.title);
    el("model-caption").textContent = "Показатели, объяснения и решения по выбранной модели";
    state.modelFlow = null; state.flowLoading = true; state.flowError = "";
    renderChats(); updateControls(); renderConversation();
    await modelFlow.selectChat(state.chat.id); await poll();
    if (selectionRevision === state.selectionRevision) setWorkspaceMode(state.workspaceMode);
  } catch (error) { notice(error.message, true); }
}
async function upload() {
  const file = el("model-file").files[0];
  if (!file) return;
  if (!/\.(xlsx|json)$/i.test(file.name)) { notice("Выбери файл .xlsx или .json.", true); return; }
  if (file.size > (state.capabilities?.max_upload_bytes || 134217728)) { notice("Файл превышает допустимый размер.", true); return; }
  setBusy(true); notice(); el("upload-status").textContent = "Загружаю модель…";
  try {
    const saved = await api(`/v1/files?filename=${encodeURIComponent(file.name)}`, {method: "POST", headers: {"Content-Type": "application/octet-stream"}, body: file});
    const chat = await api("/v1/chats", {method: "POST", json: {model_file_id: saved.id, title: file.name.replace(/\.(xlsx|json)$/i, "").slice(0, 120)}});
    state.showArchived = false;
    await loadChats(); await selectChat(chat.id);
    if (/\.xlsx$/i.test(file.name)) {
      await modelFlow.start({allowBusy: true, chatId: chat.id});
      el("upload-status").textContent = state.modelFlow?.model_loaded ? "Отдельная копия модели создана в Табуле." : "Excel принят. Состояние подготовки — в рабочей области.";
    } else el("upload-status").textContent = "Модель загружена. Можно начать работу.";
  } catch (error) { notice(error.message, true); el("upload-status").textContent = "Загрузка не завершена. Попробуй ещё раз."; }
  finally { el("model-file").value = ""; setBusy(false); }
}
function badge(status) {
  const [text, color] = statuses[status] || [status || "Ожидание", "neutral"];
  return node("span", "badge " + color, text);
}
function renderConversation() {
  if (!state.chat) return;
  const signature = JSON.stringify([state.chat.id, state.chat.messages, state.modelFlow, state.flowLoading, state.flowError, [...state.tasks.values()].filter(task => task.chat_id === state.chat.id)
    .map(task => [task.id, task.status, task.updated_at, task.cancel_requested, task.detailsLoaded, task.steps, task.artifacts, task.result?.metric_interpretations])]);
  if (state.renderSignature === signature) return;
  state.renderSignature = signature;
  const container = el("conversation");
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
  const expanded = new Set([...container.querySelectorAll("details[open][data-detail]")].map(item => item.dataset.detail));
  container.replaceChildren();
  const messages = (state.chat.messages || []).filter(message => message.role !== "system");
  if (!messages.length) {
    const intro = node("div", "message"); intro.append(node("div", "avatar", "Т"));
    const content = node("div", "message-content");
    let heading = "Модель готова к работе";
    let introText = state.capabilities?.agent_configured ?
      "Задай вопрос по данным или выбери «Оптимизация», чтобы запустить расчёт. Все обращения будут относиться к этой модели." :
      "Модель загружена. Расчёт доступен в разделе «Оптимизация». Ответы на вопросы пока недоступны.";
    if (state.flowLoading) { heading = "Проверяем состояние модели"; introText = "Загружаем состояние модели в Табуле и доступные действия."; }
    else if (state.flowError) { heading = "Нужно проверить подключение"; introText = "Обновите состояние модели в панели выше, чтобы продолжить работу."; }
    else if (state.modelFlow?.source === "tabula") {
      const stopped = ["failed", "needs_input", "needs_reconciliation"].includes(state.modelFlow.status);
      heading = state.modelFlow.status === "ready" ? "Граф модели из Табулы готов" : stopped ? "Граф пока не получен" : "Получение модели из Табулы";
      introText = state.modelFlow.status === "ready" ? "Модель готова. Выберите раздел сверху или задайте вопрос по показателям." : stopped ? "Не удалось получить модель. Причина указана в сообщении выше." : "Получаем данные модели и строим граф связей.";
    } else if (state.modelFlow?.model_loaded && state.modelFlow.status !== "ready") {
      heading = "Модель загружена в Табулу";
      introText = "Модель загружена. Получаем данные и строим граф связей.";
    } else if (state.modelFlow && state.modelFlow.status !== "ready") {
      heading = "Excel принят";
      introText = ["awaiting_connections", "waiting_dependencies"].includes(state.modelFlow.status) ?
        "Ждём подключения к Табуле. Состояние загрузки показано выше." :
        "После подготовки нажмите «Загрузить в Табулу».";
    } else if (state.modelFlow) { heading = "Модель в Табуле"; introText = "Откройте граф связей, чтобы изучить зависимости показателей. Доступные виды анализа и расчёта плана показаны в панели выше."; }
    content.append(node("div", "message-heading", heading), node("div", "message-text", introText));
    intro.append(content); container.append(intro);
  }
  const assistantTasks = new Set(messages.filter(m => m.role === "assistant").map(m => m.task_id));
  for (const message of messages) {
    const item = node("article", "message " + (message.role === "user" ? "user" : "assistant"));
    item.append(node("div", "avatar", message.role === "user" ? "Вы" : "Т"));
    const content = node("div", "message-content"); const heading = node("div", "message-heading");
    heading.append(node("strong", "", message.role === "user" ? "Вы" : "Табула"));
    if (message.role === "assistant") {
      const task = state.tasks.get(message.task_id);
      heading.append(node("span", "message-kind", task?.optimization_task_id ? "Разбор плана" : task?.kind === "optimization" ? "Результат расчёта" : "Анализ модели"));
    }
    const time = node("time", "", dateLabel(message.created_at, true));
    if (message.created_at) time.dateTime = message.created_at;
    heading.append(time);
    if (message.role === "assistant") {
      const copy = node("button", "icon-button subtle message-copy"); copy.type = "button";
      copy.title = "Скопировать ответ"; copy.setAttribute("aria-label", "Скопировать ответ"); copy.append(icon("copy"));
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(cleanText(message.content));
          copy.replaceChildren(icon("check")); copy.title = "Скопировано"; copy.setAttribute("aria-label", "Ответ скопирован");
          setTimeout(() => { copy.replaceChildren(icon("copy")); copy.title = "Скопировать ответ"; copy.setAttribute("aria-label", "Скопировать ответ"); }, 1800);
        } catch (_) { notice("Не удалось скопировать ответ. Выделите нужный текст и нажмите Ctrl+C.", true); }
      });
      heading.append(copy);
    }
    content.append(heading, message.role === "assistant" ? renderAnswer(cleanText(message.content)) : node("div", "message-text", cleanText(message.content)));
    if (message.role === "assistant" && message.task_id) {
      const task = state.tasks.get(message.task_id);
      if (task?.optimization_task_id) content.append(node("p", "review-result-label", "Разбор выбранного результата оптимизации"));
      const insights = window.TabulaMetricInsights?.build(task, {
        canQuestion: () => task?.chat_id === state.chat?.id && canDiscussMetric(),
        onQuestion: question => askMetricQuestion(question, task?.chat_id),
      });
      if (insights) content.append(insights);
      const charts = task && !task.optimization_task_id && window.TabulaCharts?.build(task, {request: api});
      if (charts) content.append(charts);
    }
    if (message.role === "user" && message.task_id) {
      const task = state.tasks.get(message.task_id);
      if (task) content.append(renderTask(task, assistantTasks.has(message.task_id)));
      else content.append(node("p", "muted micro", "Загружаю состояние задачи…"));
    }
    item.append(content); container.append(item);
  }
  for (const details of container.querySelectorAll("details[data-detail]")) if (expanded.has(details.dataset.detail)) details.open = true;
  if (nearBottom) container.scrollTop = container.scrollHeight;
}
function taskPublicationIsApplied(task, chat, flow) {
  const context = task?.tabula_context, model = flow?.model, publication = flow?.publication, copy = publication?.new_version;
  const valid = value => typeof value === "string" && value.length > 0;
  if (task?.kind !== "optimization" || task.result?.verification?.passed !== true ||
      flow?.status !== "ready" || !valid(chat?.id) || task.chat_id !== chat.id || flow.chat_id !== chat.id ||
      !valid(task.id) || publication?.status !== "applied" || publication.task_id !== task.id ||
      !valid(flow.id) || context?.pipeline_id !== flow.id || !valid(task.source_sha256) ||
      task.source_sha256 !== context.snapshot_sha256) return false;
  if (["model_id", "version_id", "revision"].some(key => !valid(model?.[key]) || context[key] !== model[key] || !valid(copy?.[key]))) return false;
  return copy.model_id !== model.model_id;
}
function renderTask(task, hasAssistant) {
  const card = node("div", "task-card"); const top = node("div", "task-top");
  card.dataset.status = task.status;
  const symbol = node("span", "task-symbol"); symbol.append(icon(task.kind === "optimization" ? "layers" : "chart"));
  top.append(symbol, node("strong", "", task.kind === "optimization" ? "Оптимизация плана" : "Анализ данных"), badge(task.status));
  if (!terminal.has(task.status)) {
    const cancel = node("button", "text-button", task.cancel_requested ? "Останавливается…" : "Остановить"); cancel.type = "button"; cancel.disabled = !!task.cancel_requested;
    cancel.addEventListener("click", () => cancelTask(task.id)); top.append(cancel);
  } else if (task.status === "failed" || task.status === "interrupted") {
    const resume = node("button", "text-button", "Возобновить"); resume.type = "button";
    resume.addEventListener("click", () => resumeTask(task.id, resume)); top.append(resume);
  }
  card.append(top);
  if (task.error) card.append(node("div", "task-error", taskError(task.error)));
  if (task.status === "needs_review") {
    const note = taskPublicationIsApplied(task, state.chat, state.modelFlow) ?
      "Отдельная копия создана в Табуле, пересчитана и сверена. Бизнес-условия плана требуют проверки." :
      "Оптимизированный план рассчитан. Пересчёт полной модели ещё не подтверждён; перед применением нужна проверка.";
    card.append(node("div", "task-note", note));
  }
  if (task.kind === "optimization" && ["completed", "needs_review"].includes(task.status) && task.result?.verification?.passed) {
    const review = node("div", "plan-review-callout");
    const symbol = node("span", "review-callout-icon"); symbol.append(icon("chat"));
    const text = node("div");
    text.append(node("strong", "", "Что изменилось и как выполнить план"), node("p", "", "Причины эффекта, изменения в работе и конкретные действия для выполнения плана."));
    const button = node("button", "plan-review-button", "Разобрать план"); button.type = "button";
    button.append(icon("arrow-right"));
    button.dataset.discussPlan = task.id;
    button.disabled = state.busy || !state.capabilities?.agent_configured || state.flowLoading || !!state.flowError ||
      !!(state.modelFlow && (state.modelFlow.status !== "ready" || !state.modelFlow.analysis_ready));
    button.addEventListener("click", () => discussPlan(task.id, button)); review.append(symbol, text, button); card.append(review);
  }
  const publication = modelFlow.buildPublish(task);
  if (publication) card.append(publication);
  if (terminal.has(task.status) && !hasAssistant && task.result?.summary) card.append(node("div", "task-note", cleanText(task.result.summary)));
  if (!terminal.has(task.status)) {
    const solving = task.steps?.some(step => step.tool === "solve_optimization" && step.status === "running");
    const verifying = task.steps?.some(step => step.tool === "verify_optimization" && step.status === "running");
    const phase = task.status === "queued" ? "Запрос ожидает выполнения." : verifying ? "Проверяем ограничения и результат расчёта." : solving ? "Ищем оптимизированный план." : task.kind === "optimization" ? "Готовим расчёт по условиям модели." : "Готовим ответ по показателям модели.";
    card.append(node("p", "task-note", phase));
  }
  return card;
}
async function cancelTask(id) {
  try { const task = await api(`/v1/tasks/${id}/cancel`, {method: "POST"}); state.tasks.set(id, {...state.tasks.get(id), ...task}); renderConversation(); }
  catch (error) { notice(error.message, true); }
}
async function resumeTask(id, button) {
  button.disabled = true;
  try {
    const task = await api(`/v1/tasks/${id}/resume`, {method: "POST"});
    state.tasks.set(id, {...state.tasks.get(id), ...task, detailsLoaded: false});
    notice(); renderConversation(); await poll();
  } catch (error) { notice(error.message, true); button.disabled = false; }
}
async function discussPlan(id, button) {
  state.dashboardFocus = null;
  if (!state.chat || state.busy || state.flowLoading || state.flowError ||
      (state.modelFlow && (state.modelFlow.status !== "ready" || !state.modelFlow.analysis_ready))) return;
  const chatId = state.chat.id; button.disabled = true; setBusy(true); notice();
  try {
    const task = await api(`/v1/tasks/${id}/discuss`, {method: "POST", json: {chat_id: chatId}});
    state.tasks.set(task.id, {...state.tasks.get(task.id), ...task});
    if (state.chat?.id !== chatId) return;
    state.chat = await api(`/v1/chats/${chatId}`); state.kind = "analysis"; setWorkspaceMode("dialog");
    state.renderSignature = null; updateControls(); renderConversation(); await poll();
    el("conversation").scrollTop = el("conversation").scrollHeight;
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); button.disabled = false; }
}
async function leavePlanContext() {
  if (!state.chat || state.busy) return;
  const chatId = state.chat.id;
  setBusy(true);
  try {
    const chat = await api(`/v1/chats/${chatId}/optimization-context`, {method: "POST", json: {optimization_task_id: null}});
    if (state.chat?.id !== chatId) return;
    state.chat = chat;
    notice(); updateControls();
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); }
}
async function poll() {
  if (!state.connected || !state.chat || state.polling) return;
  const messages = state.chat.messages || [];
  const taskIds = [...new Set([
    ...messages.filter(message => message.task_id).map(message => message.task_id),
    ...[...state.tasks.values()].filter(task => task.chat_id === state.chat.id).map(task => task.id),
  ])];
  const hasPendingTask = taskIds.some(id => {
    const task = state.tasks.get(id);
    return !task || !terminal.has(task.status) || !task.detailsLoaded ||
      !messages.some(message => message.task_id === id && message.role === "assistant");
  });
  if (!hasPendingTask) return;
  state.polling = true; const chatId = state.chat.id;
  let optimizationFinished = false;
  try {
    const chat = await api(`/v1/chats/${chatId}`);
    if (state.chat?.id !== chatId) return;
    const ids = [...new Set((chat.messages || []).filter(m => m.task_id).map(m => m.task_id))];
    for (const id of ids) {
      const saved = state.tasks.get(id);
      if (saved && terminal.has(saved.status) && saved.detailsLoaded) continue;
      const [task, steps] = await Promise.all([api(`/v1/tasks/${id}`), api(`/v1/tasks/${id}/steps`)]);
      if (saved && !terminal.has(saved.status) && task.kind === "optimization" && ["completed", "needs_review"].includes(task.status) && task.result?.verification?.passed) optimizationFinished = true;
      state.tasks.set(id, {...task, steps, detailsLoaded: true});
    }
    if (state.chat?.id !== chatId) return;
    state.chat = chat;
    if (optimizationFinished) { state.kind = "analysis"; state.chat = await api(`/v1/chats/${chatId}`); }
    updateControls(); renderConversation();
  } catch (error) { notice(error.message, true); }
  finally { state.polling = false; }
}
async function send(event) {
  event.preventDefault();
  const content = el("message-input").value.trim();
  if (!content || !state.chat || state.busy || el("send-button").disabled) return;
  const chatId = state.chat.id; setBusy(true); notice();
  try {
    const task = await api(`/v1/chats/${chatId}/messages`, {method: "POST", headers: {"Idempotency-Key": requestId()},
      json: {content, kind: state.kind, mode: state.kind === "analysis" ? "agent" : el("execution-mode").value,
        objective_id: null, sense: null, ...(state.dashboardFocus && state.kind === "analysis" ? {dashboard_focus: {
          metric_id: state.dashboardFocus.metric_id, series_id: state.dashboardFocus.series_id,
          source_sha256: state.dashboardFocus.source_sha256, period: state.dashboardFocus.period || ""}} : {})}});
    state.tasks.set(task.id, task); el("message-input").value = ""; state.dashboardFocus = null; updateControls();
    await poll(); el("conversation").scrollTop = el("conversation").scrollHeight;
  } catch (error) { notice(error.message, true); }
  finally { setBusy(false); el("message-input").focus(); }
}

function canDiscussMetric() {
  return !!state.chat && state.connected && !state.busy && state.workspaceMode === "dialog" &&
    state.kind === "analysis" && !state.chat.optimization_context && !el("send-button").disabled;
}
function askMetricQuestion(question, chatId) {
  if (chatId !== state.chat?.id || !canDiscussMetric()) return;
  const input = el("message-input");
  if (input.value.trim()) {
    notice("Сначала отправьте или очистите уже набранный вопрос, чтобы разобрать выбранный вариант.");
    input.focus(); return;
  }
  state.dashboardFocus = null; updateControls(); input.value = question;
  el("message-form").requestSubmit();
}

function requestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) return [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setWorkspaceMode(mode) {
  state.workspaceMode = ["dialog", "graph", "optimization", "constraints", "dashboard", "screens"].includes(mode) ? mode : "dialog";
  if (state.workspaceMode === "dialog") state.kind = "analysis";
  if (state.workspaceMode === "optimization") state.kind = "optimization";
  sessionStorage.setItem("tabula_harness_workspace_mode", state.workspaceMode);
  const workspaceUrl = new URL(window.location.href);
  workspaceUrl.searchParams.set("view", state.workspaceMode);
  window.history.replaceState(null, "", `${workspaceUrl.pathname}${workspaceUrl.search}${workspaceUrl.hash}`);
  modelFlow.closeGraph();
  document.body.classList.toggle("dashboard-mode", state.workspaceMode === "dashboard");
  document.body.classList.toggle("constraints-mode", state.workspaceMode === "constraints");
  document.body.classList.toggle("screens-mode", state.workspaceMode === "screens");
  document.body.classList.toggle("graph-mode", state.workspaceMode === "graph");
  document.body.classList.toggle("optimization-mode", state.workspaceMode === "optimization");
  document.querySelectorAll("[data-workspace-mode]").forEach(button => {
    const selected = button.dataset.workspaceMode === state.workspaceMode;
    button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
  });
  el("jump-latest").hidden = ["dashboard", "graph", "constraints", "screens"].includes(state.workspaceMode);
  el("workspace-breadcrumb-label").textContent = {dialog: "Аналитика", graph: "3D-граф", optimization: "Оптимизация", constraints: "Ограничители", dashboard: "Пульт управления", screens: "Сборка экранов"}[state.workspaceMode];
  if (state.chat) el("model-caption").textContent = {dialog: "Вопросы и ответы по показателям модели", graph: "Связи показателей и расчётов", optimization: "Расчёт и сравнение нового плана", constraints: "Пределы, нагрузка и связанные показатели", dashboard: "Показатели, динамика и детализация", screens: "Ваши метрики, разрезы и расположение карточек"}[state.workspaceMode];
  if (state.workspaceMode === "dashboard") dashboard?.show(); else dashboard?.hide();
  constraints?.setMode(state.workspaceMode);
  screens?.setMode(state.workspaceMode);
  updateControls();
  if (state.workspaceMode === "graph") modelFlow.openGraph();
}

const modelFlow = window.TabulaModelFlow.mount(el("model-flow"), {
  request: api, graphContainer: el("graph-workspace"), onNotice: notice,
  onChange(value) {
    const previousStatus = state.modelFlow?.status;
    state.modelFlow = value.flow; state.flowLoading = value.loading; state.flowError = value.error;
    updateControls(); renderConversation();
    if (state.workspaceMode === "dashboard" && previousStatus && value.flow?.status !== previousStatus) dashboard?.refresh();
    if (state.workspaceMode === "graph" && value.flow?.graph?.ready && !value.loading) queueMicrotask(() => modelFlow.openGraph());
  },
  onMode(kind, value = {}) {
    state.dashboardFocus = null;
    setWorkspaceMode(kind === "optimization" ? "optimization" : "dialog");
    modelFlow.closeGraph(); state.kind = kind; updateControls();
    if (value.prompt) el("message-input").value = value.prompt;
    el("message-input").focus();
  }
});
dashboard = window.TabulaDashboard.mount(el("dashboard-workspace"), {
  request: api,
  async ask(prompt, focus) {
    if (state.chat?.optimization_context) {
      await leavePlanContext();
      if (state.chat?.optimization_context) throw new Error("Не удалось перейти к данным исходной модели.");
    }
    state.dashboardFocus = focus?.series_id ? focus : null;
    setWorkspaceMode("dialog"); state.kind = "analysis"; updateControls();
    el("message-input").value = prompt; el("message-input").focus();
  },
  onMode(kind) {
    setWorkspaceMode(kind === "graph" ? "graph" : kind === "optimization" ? "optimization" : "dialog");
    if (kind === "optimization") modelFlow.openOptimizationCheck();
  }
});
constraints = window.TabulaConstraints.mount(el("constraints-workspace"), dashboard.constraintPanel, {
  request: api,
  onMode: mode => setWorkspaceMode(mode),
  canOpenGraph: () => !!state.modelFlow?.graph?.ready,
  async onOpenChild(id) { setWorkspaceMode("dialog"); await selectChat(id); await loadChats(); }
});
screens = window.TabulaScreens.mount(el("screens-workspace"), {request: api});
document.querySelectorAll("[data-workspace-mode]").forEach(button => button.addEventListener("click", () => {
  setWorkspaceMode(button.dataset.workspaceMode);
  if (button.dataset.workspaceMode === "optimization") modelFlow.openOptimizationCheck();
}));
el("clear-dashboard-focus").addEventListener("click", () => { state.dashboardFocus = null; updateControls(); el("message-input").focus(); });

el("access-token").value = state.token;
el("connect-form").addEventListener("submit", connect);
el("open-tabula-models").addEventListener("click", () => {
  el("tabula-model-picker").hidden = false;
  refreshTabulaModels();
});
el("close-tabula-models").addEventListener("click", () => { el("tabula-model-picker").hidden = true; });
el("refresh-tabula-models").addEventListener("click", refreshTabulaModels);
el("tabula-model-select").addEventListener("change", updateControls);
el("pull-tabula-model").addEventListener("click", pullTabulaModel);
el("model-file").addEventListener("change", upload);
el("upload-label").addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && !el("model-file").disabled) { event.preventDefault(); el("model-file").click(); } });
el("refresh-chats").addEventListener("click", () => loadChats().catch(error => notice(error.message, true)));
el("toggle-chat-archive").addEventListener("click", () => {
  if (state.busy || !state.connected || state.chatListLoading) return;
  state.showArchived = !state.showArchived;
  loadChats().catch(error => notice(error.message, true));
});
el("jump-latest").addEventListener("click", () => {
  const messages = el("conversation").querySelectorAll(".message");
  messages[messages.length - 1]?.scrollIntoView({block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
});
el("message-form").addEventListener("submit", send);
el("leave-plan-context").addEventListener("click", leavePlanContext);
document.querySelectorAll("[data-plan-question]").forEach(button => button.addEventListener("click", () => {
  el("message-input").value = button.dataset.planQuestion; el("message-input").focus();
}));
el("execution-mode").addEventListener("change", updateControls);
document.querySelectorAll("[data-kind]").forEach(button => button.addEventListener("click", () => {
  state.dashboardFocus = null;
  setWorkspaceMode("dialog");
  if (button.dataset.kind === "optimization" && state.modelFlow) { modelFlow.openOptimizationCheck(); return; }
  state.kind = button.dataset.kind; updateControls();
}));
el("message-input").addEventListener("keydown", event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el("message-form").requestSubmit(); } });
updateControls();
if (state.token) connect();
setInterval(poll, 2000);
