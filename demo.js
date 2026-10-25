"use strict";

(() => {
  const $ = id => document.getElementById(id), NS = "http://www.w3.org/2000/svg";
  const number = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const compact = new Intl.NumberFormat("ru-RU", {notation: "compact", maximumFractionDigits: 1});
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const clean = value => window.TabulaPresentation?.text?.(value) ?? String(value ?? "");
  const modelTitle = value => window.TabulaPresentation?.title?.(value) ?? clean(value);
  const state = {token: window.TabulaConnection.getToken(), manifest: null, session: null, view: "start", connected: false,
    busy: false, stage: -1, uploadedName: "", answers: [], asking: false, optimizing: false, publishing: false, generation: 0, graphHtml: "", graphChat: ""};
  const views = {overview: ["Обзор модели", "Клининговая компания · план 2025"], graph: ["3D-граф", "Показатели и расчётные связи"],
    analytics: ["Аналитика", "Подготовленные вопросы по показателям модели"], optimization: ["Оптимизация плана", "Расчёт и сравнение плана продаж"], dashboard: ["Пульт управления", "Показатели и динамика исходного плана"]};
  const content = $("dm-content"), fileInput = $("dm-file"), dashboardRoot = document.createElement("section");
  let dashboard = null, returningFocus = null, graphExpanded = false, dashboardNavigationObserver = null;

  function node(tag, className = "", value) {
    const item = document.createElement(tag); if (className) item.className = className;
    if (value !== undefined) item.textContent = clean(value); return item;
  }
  function button(label, callback, className = "dm-button") {
    const item = node("button", className, label); item.type = "button";
    if (callback) item.addEventListener("click", callback); return item;
  }
  function svg(tag, attrs = {}, value) {
    const item = document.createElementNS(NS, tag); for (const [key, entry] of Object.entries(attrs)) item.setAttribute(key, String(entry));
    if (value !== undefined) item.textContent = clean(value); return item;
  }
  function notice(message = "", error = false) { $("dm-notice").textContent = clean(message); $("dm-notice").hidden = !message; $("dm-notice").classList.toggle("error", error); }
  function scrollContentTo(target) {
    if (!target?.isConnected) return;
    const top = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 14;
    content.scrollTo({top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  }
  async function request(path, options = {}) {
    const response = await window.TabulaConnection.request(path, state.token, options);
    if (!response.ok) {
      let message = "Не удалось выполнить запрос. Повторите действие.";
      try { const body = await response.json(); if (typeof body.detail === "string") message = body.detail; } catch (_) {}
      if (response.status === 401) { state.connected = false; window.TabulaConnection.clearToken(); openAccess(); }
      throw new Error(message);
    }
    return options.blob ? response.blob() : response.json();
  }
  function applyManifest(response) {
    const value = response?.manifest || response;
    if (!value || typeof value !== "object") throw new Error("Демонстрационная модель пока недоступна.");
    state.manifest = value;
    state.session = response?.session || value.session || state.session;
    if (/^[0-9a-f]{32}$/i.test(state.session?.id || '')) {
      const url = new URL(window.location.href); url.searchParams.set("session", state.session.id);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    return value;
  }
  const modelLabel = () => modelTitle(state.manifest?.model?.label || "Клининговая компания");
  const sessionPath = () => "/v1/demo/sessions/" + encodeURIComponent(state.session?.id || "");
  const optimized = () => state.session?.optimized === true || ["optimized", "published"].includes(state.session?.status);
  const published = () => state.session?.published === true || state.session?.status === "published";
  const num = value => numeric(value) ? number.format(value) : "—";

  function header() {
    const ready = !!state.session && state.stage >= 4;
    const view = views[state.view];
    $("dm-breadcrumb").textContent = ready ? "Модель / " + (view?.[0] || "Обзор") : "Рабочее пространство";
    $("dm-title").textContent = ready ? modelLabel() : state.stage >= 0 ? "Подготавливаем модель" : "Демонстрация на примере";
    $("dm-caption").textContent = ready ? view?.[1] || views.overview[1] : "Контрольный Excel · граф и показатели Табулы";
    $("dm-model-status").hidden = !ready;
    $("dm-model-status").textContent = published() ? "Результат сохранён в демосессии" : "Снимок модели готов";
    $("dm-new").disabled = state.busy || state.asking || state.optimizing || state.publishing;
    $("dm-connection-label").textContent = state.connected ? "Подключено" : "Нет подключения";
    const list = $("dm-model-list"); list.replaceChildren();
    if (ready) {
      const item = button("", () => show("overview"), "dm-model-button"), copy = node("span");
      copy.append(node("strong", "", modelLabel()), node("small", "", published() ? "Результат · демо" : "Модель · демо"));
      item.append(node("span", "dm-model-icon", "▦"), copy); list.append(item);
    } else list.append(node("p", "dm-sidebar-empty", state.stage >= 0 ? "Подготовка демопримера…" : "Загрузите контрольный Excel, чтобы открыть пример."));
    document.querySelectorAll("[data-view]").forEach(item => {
      item.disabled = !ready; item.classList.toggle("selected", ready && item.dataset.view === state.view);
      item.setAttribute("aria-current", ready && item.dataset.view === state.view ? "page" : "false");
    });
  }
  function show(view) {
    if (state.stage < 4 && view !== "start") return;
    dashboard?.hide(); graphExpanded = false;
    state.view = views[view] ? view : "start"; notice(); render();
    if (state.session) { const url = new URL(window.location.href); url.searchParams.set("view", state.view); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
  }
  function render() {
    dashboardNavigationObserver?.disconnect(); dashboardNavigationObserver = null;
    header(); content.replaceChildren();
    content.classList.toggle("dm-content-graph", state.view === "graph" && state.stage >= 4);
    content.classList.toggle("dm-content-dashboard", state.view === "dashboard" && state.stage >= 4);
    if (state.stage >= 0 && state.stage < 4) return renderPreparation();
    if (!state.session || state.view === "start") return renderStart();
    if (state.view === "graph") return renderGraph();
    if (state.view === "analytics") return renderAnalytics();
    if (state.view === "optimization") return renderOptimization();
    if (state.view === "dashboard") return renderDashboard();
    renderOverview();
  }
  function renderStart() {
    const root = node("div", "dm-start"), intro = node("div", "dm-start-intro");
    intro.append(node("p", "dm-eyebrow", "Демонстрация на модели клининговой компании"), node("h2", "", "План продаж: показатели, связи и расчёт"),
      node("p", "", "Загрузите контрольный Excel, чтобы открыть подготовленный пример с графом, аналитикой и расчётом плана."));
    const drop = button("", () => { if (!state.connected) openAccess(); else fileInput.click(); }, "dm-drop");
    drop.append(node("span", "dm-drop-symbol", "+"), node("strong", "", "Загрузить Excel"), node("small", "", "Выберите контрольный файл клининговой компании"));
    for (const name of ["dragenter", "dragover"]) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add("dragging"); });
    for (const name of ["dragleave", "drop"]) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove("dragging"); });
    drop.addEventListener("drop", event => { const file = event.dataTransfer?.files?.[0]; if (file) upload(file); });
    const flow = node("div", "dm-start-flow");
    for (const [index, title, description] of [["01", "Модель", "Показатели и формулы сохранённого примера."], ["02", "Граф связей", "Показатели и связи между расчётами."], ["03", "Аналитика и план", "Подготовленные ответы и расчёт по заданным условиям."], ["04", "Пульт управления", "Показатели и динамика исходного плана."]]) {
      const card = node("article"); card.append(node("span", "", index), node("h3", "", title), node("p", "", description)); flow.append(card);
    }
    root.append(intro, drop, node("p", "dm-start-footnote", "Файл сохраняется в Harness. Загрузка в Табулу и создание копии показаны без записи; граф и пульт используют подготовленный снимок Табулы."), flow); content.append(root);
  }
  function renderPreparation() {
    const root = node("div", "dm-preparation"); root.append(node("p", "dm-eyebrow", "Демонстрация загрузки в Табулу"), node("h2", "", "Из Excel — в связанную модель"), node("p", "", state.uploadedName || "Контрольная финансовая модель"));
    const list = node("ol", "dm-progress-steps");
    const steps = [["Excel принят", "Контрольный файл сохранён в Harness"], ["Модель подготовлена", "Показаны структура и формулы примера"], ["Модель в Табуле", "Демонстрация этапа без записи в Табулу"], ["Граф зависимостей", "Открывается сохранённый граф Табулы"]];
    steps.forEach(([label, description], index) => {
      const done = index < state.stage, active = index === state.stage, item = node("li", "dm-progress-step " + (done ? "done" : active ? "active" : "waiting"));
      if (active) item.setAttribute("aria-current", "step");
      const copy = node("div"); copy.append(node("strong", "", label), node("small", "", description)); item.append(node("span", "dm-progress-number", done ? "✓" : index + 1), copy); list.append(item);
    });
    root.append(list, node("p", "dm-demo-footnote", "Запись в Табулу в этом показе не выполняется. Открывается заранее подготовленный снимок модели.")); content.append(root);
  }
  async function upload(file) {
    if (state.busy) return;
    if (!state.connected) { notice("Сначала подключитесь к Harness."); openAccess(); return; }
    if (!/\.xlsx$/i.test(file.name)) { notice("Выберите контрольный файл Excel в формате .xlsx.", true); return; }
    state.busy = true; state.uploadedName = file.name; notice(); header();
    const generation = ++state.generation;
    try {
      const saved = await request("/v1/files?filename=" + encodeURIComponent(file.name), {method: "POST", headers: {"Content-Type": "application/octet-stream"}, body: file});
      if (generation !== state.generation) return;
      state.stage = 0; render();
      const response = await request("/v1/demo/sessions", {method: "POST", json: {file_id: saved.id}});
      if (generation !== state.generation) return;
      applyManifest(response);
      if (!state.session?.id) throw new Error("Не удалось создать демонстрационную сессию.");
      state.view = "overview"; state.stage = 0; state.answers = []; render();
      for (const [index, delay] of [[1, 1100], [2, 1400], [3, 1300], [4, 1050]]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (generation !== state.generation) return;
        state.stage = index; render();
      }
    } catch (error) { state.stage = -1; state.session = null; state.view = "start"; render(); notice(error.message, true); }
    finally { state.busy = false; fileInput.value = ""; header(); }
  }
  function readyMessage(label) { const box = node("div", "dm-ready"); box.append(node("span", "dm-ready-mark", "✓"), node("span", "", label)); return box; }
  function stat(label, value, footnote) { const box = node("div", "dm-stat"); box.append(node("span", "", label), node("strong", "", value)); if (footnote) box.append(node("small", "", footnote)); return box; }
  function renderOverview() {
    const root = node("div", "dm-overview"); root.append(readyMessage(published() ? "Результат сохранён в демосессии. Пульт показывает исходный снимок Табулы." : "Открыт подготовленный снимок модели Табулы."));
    const hero = node("div", "dm-overview-hero"), intro = node("div"); intro.append(node("p", "dm-eyebrow", "Модель и план компании"), node("h2", "", "Показатели и расчётный план"), node("p", "", "Посмотрите показатели, их связи и сравнение плана продаж."));
    hero.append(intro, button("Открыть 3D-граф →", () => show("graph"), "dm-button dm-primary")); root.append(hero);
    const stats = node("div", "dm-overview-stats"), model = state.manifest.model || {};
    stats.append(stat("Узлы графа", num(model.graph_nodes), "По сохранённому графу Табулы"), stat("Расчётные связи", num(model.graph_edges), "От входов к финансовому результату"), stat("Рабочее пространство", "5 разделов", "Граф · аналитика · план · показатели")); root.append(stats);
    const links = node("div", "dm-overview-links");
    for (const [view, icon, label, description, link] of [["analytics", "⌁", "Разобраться в показателях", "Выберите подготовленный вопрос о прибыли, поступлениях или связях показателей.", "Открыть аналитику →"], ["optimization", "◇", "Улучшить план", "Запустите расчёт и посмотрите, какие решения меняют результат.", "Перейти к оптимизации →"], ["dashboard", "▥", "Показатели и динамика", "Показатели, динамика и точные значения в едином пульте.", "Открыть пульт →"]]) {
      const card = button("", () => show(view), "dm-feature"); card.append(node("span", "dm-feature-icon", icon), node("strong", "", label), node("p", "", description), node("small", "", link)); links.append(card);
    }
    root.append(links, node("p", "dm-demo-footnote", "Перенос Excel и создание копии показаны без записи в Табулу.")); content.append(root);
  }
  async function renderGraph() {
    const shell = node("div", "dm-graph-shell"), toolbar = node("div", "dm-graph-toolbar");
    let frame = null;
    const quick = node("div", "dm-graph-quick"); quick.setAttribute("role", "group"); quick.setAttribute("aria-label", "Быстрая навигация по графу");
    const profit = {query: "Прибыль после налогов", document_id: "7d3bae77-d9a4-11f0-b331-5ce931f99381"};
    const controls = [];
    for (const [label, command] of [["Вся модель", {action: "overview"}], ["Продажи", {action: "route", query: "Продажи"}], ["Прибыль", {action: "focus", ...profit}], ["Таблица показателя", {action: "table", ...profit}]]) {
      const control = button(label, () => frame?.contentWindow?.postMessage({schema: "tabula-space-control/v1", ...command}, "*"), "");
      control.disabled = true; controls.push(control); quick.append(control);
    }
    const expand = button("На весь экран", () => { graphExpanded = !graphExpanded; shell.classList.toggle("expanded", graphExpanded); expand.textContent = graphExpanded ? "Вернуть размер" : "На весь экран"; }, "dm-graph-expand");
    toolbar.append(quick, expand); shell.append(toolbar);
    const loading = node("div", "dm-graph-loading", "Открываем пространство модели…"); shell.append(loading); content.append(shell);
    const chat = state.manifest?.model?.source_chat_id, generation = state.generation;
    if (!chat) { loading.textContent = "Для этой модели ещё не задан снимок графа."; return; }
    try {
      const blob = await request(`/v1/chats/${encodeURIComponent(chat)}/model-flow/graph/html`, {blob: true});
      const html = await blob.text();
      if (generation !== state.generation || state.view !== "graph" || !shell.isConnected) return;
      frame = node("iframe"); frame.title = "3D-граф модели «" + modelLabel() + "»"; frame.setAttribute("sandbox", "allow-scripts"); frame.setAttribute("allow", "fullscreen"); frame.setAttribute("referrerpolicy", "no-referrer");
      frame.addEventListener("load", () => controls.forEach(control => { control.disabled = false; })); frame.srcdoc = html;
      loading.remove(); shell.append(frame);
    } catch (error) { if (shell.isConnected) loading.textContent = clean(error.message); }
  }
  function miniChart(payload, comparison = false) {
    const wrap = node("div", "dm-mini-chart");
    const labels = Array.isArray(payload?.labels) ? payload.labels : [];
    const series = comparison ? [{label: "Исходный план", values: payload.before, color: "#6b7a8d"}, {label: "Новый план", values: payload.after, color: "#39765a"}] : [{label: payload?.title || payload?.label || "Показатель", values: payload?.values, color: "#287cb7"}];
    const valid = series.filter(item => Array.isArray(item.values) && item.values.length === labels.length && item.values.some(numeric));
    if (!labels.length || !valid.length) return wrap;
    const width = 800, height = 230, left = 64, right = 20, top = 20, bottom = 190, values = valid.flatMap(item => item.values.filter(numeric));
    let low = Math.min(0, ...values), high = Math.max(0, ...values); if (low === high) high = low + 1;
    const x = index => left + (width - left - right) * (index + .5) / labels.length, y = value => top + (high - value) / (high - low) * (bottom - top);
    const image = svg("svg", {viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": clean(payload.title || "Динамика показателя")});
    image.append(svg("title", {}, payload.title || "Динамика показателя"));
    for (let index = 0; index < 5; index++) { const value = low + (high - low) * index / 4; image.append(svg("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: "#ededed"}), svg("text", {x: left - 12, y: y(value) + 4, "text-anchor": "end", fill: "#9c9ca4", "font-size": 11}, compact.format(value))); }
    const every = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((label, index) => {
      if (index % every && index !== labels.length - 1) return;
      let value = String(label);
      if (/^\d{4}-\d{2}$/.test(value)) value = new Date(value + "-01T00:00:00Z").toLocaleDateString("ru-RU", {month: "short", timeZone: "UTC"});
      image.append(svg("text", {x: x(index), y: bottom + 26, "text-anchor": "middle", fill: "#9c9ca4", "font-size": 11}, value.slice(0, 17)));
    });
    valid.forEach(item => {
      if (!comparison && payload.type === "bar") {
        const barWidth = Math.max(3, Math.min(42, (width - left - right) / labels.length * .6));
        item.values.forEach((value, index) => {
          if (!numeric(value)) return;
          const bar = svg("rect", {x: x(index) - barWidth / 2, y: Math.min(y(value), y(0)), width: barWidth, height: Math.max(1, Math.abs(y(value) - y(0))), rx: 2, fill: item.color, opacity: .85, tabindex: 0});
          bar.append(svg("title", {}, `${labels[index]}: ${num(value)}${payload.unit ? " " + payload.unit : ""}`)); image.append(bar);
        });
        return;
      }
      let segment = [];
      const flush = () => { if (segment.length) image.append(svg("polyline", {points: segment.join(" "), fill: "none", stroke: item.color, "stroke-width": comparison ? 3 : 2.5, "stroke-linecap": "round", "stroke-linejoin": "round"})); segment = []; };
      item.values.forEach((value, index) => { if (numeric(value)) segment.push(x(index) + "," + y(value)); else flush(); }); flush();
      item.values.forEach((value, index) => { if (numeric(value)) { const point = svg("circle", {cx: x(index), cy: y(value), r: labels.length < 40 ? 3 : 1.7, fill: item.color, stroke: "#fff", "stroke-width": 1.2, tabindex: 0}); point.append(svg("title", {}, `${labels[index]}: ${num(value)}${payload.unit ? " " + payload.unit : ""}`)); image.append(point); } });
    });
    if (payload.unit) wrap.append(node("p", "dm-chart-unit", payload.unit));
    wrap.append(image);
    const legend = node("div", "dm-chart-legend");
    valid.forEach(item => { const label = node("span"), mark = node("i"); mark.style.background = item.color; label.append(mark, document.createTextNode(clean(item.label))); legend.append(label); }); wrap.append(legend); return wrap;
  }
  function renderAnalytics() {
    const root = node("div", "dm-analytics"), heading = node("div", "dm-section-heading"), intro = node("div"); intro.append(node("h2", "", "Вопросы по модели"), node("p", "", "В демопримере подготовлены ответы о прибыли, поступлениях и связях показателей.")); heading.append(intro, node("span", "dm-source-pill", "По графу модели")); root.append(heading);
    const form = node("form", "dm-question-box"), input = node("textarea"); input.rows = 2; input.maxLength = 4000; input.placeholder = "Например: что влияет на прибыль после налогов?"; input.setAttribute("aria-label", "Вопрос по модели"); input.disabled = state.asking;
    const footer = node("div", "dm-question-footer"), send = button(state.asking ? "Готовим ответ…" : "Спросить →", null, "dm-button dm-primary"); send.type = "submit"; send.disabled = state.asking; footer.append(node("small", "", "Демопример: клининговая компания"), send); form.append(input, footer);
    form.addEventListener("submit", event => { event.preventDefault(); if (input.value.trim()) ask(input.value.trim()); });
    input.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); form.requestSubmit(); } }); root.append(form);
    const samples = node("div", "dm-question-samples");
    for (const entry of (Array.isArray(state.manifest.analytics) ? state.manifest.analytics : []).slice(0, 3)) {
      if (!entry.question) continue; const item = button(entry.question, () => ask(entry.question), ""); item.disabled = state.asking; samples.append(item);
    }
    root.append(samples);
    if (state.asking) { const pending = node("div", "dm-loading-inline"); pending.setAttribute("role", "status"); pending.append(node("span", "dm-spinner"), node("span", "", "Готовим ответ по показателям модели…")); root.append(pending); }
    if (!state.answers.length && !state.asking) {
      const blank = node("div", "dm-panel"); blank.append(node("h3", "", "Подготовленные вопросы"), node("p", "dm-muted", "Выберите вопрос выше или задайте вопрос о прибыли, поступлениях или связях показателей.")); root.append(blank);
    }
    for (const entry of [...state.answers].reverse()) {
      const solverAnswer = entry.answer_mode === "local_demo_solver";
      const answer = node("article", "dm-answer"); answer.append(node("span", "dm-answer-label", solverAnswer ? "РАЗБОР НОВОГО ПЛАНА" : "АНАЛИЗ МОДЕЛИ"), node("h3", "dm-answer-question", entry.question));
      for (const paragraph of clean(entry.answer).split(/\n\s*\n/).filter(Boolean)) answer.append(node("p", "", paragraph));
      if (entry.chart) answer.append(miniChart(entry.chart));
      const foot = node("div", "dm-answer-footer"); foot.append(node("span", "", solverAnswer ? "Ответ по результату локального демонстрационного расчёта" : "Подготовленный ответ по сохранённому снимку модели"), button("Перейти к оптимизации →", () => show("optimization"), "dm-quiet-button")); answer.append(foot); root.append(answer);
    }
    content.append(root);
  }
  async function ask(question) {
    if (state.asking || !state.session?.id) return;
    const generation = state.generation; state.asking = true; state.view = "analytics"; notice(); render();
    try {
      const answer = await request(sessionPath() + "/ask", {method: "POST", json: {question}});
      if (generation !== state.generation) return;
      state.answers.push({question: answer.question || question, answer: answer.answer || "Ответ по этому вопросу пока не подготовлен.", chart: answer.chart, answer_mode: answer.answer_mode});
    } catch (error) { notice(error.message, true); }
    finally {
      if (generation === state.generation) {
        state.asking = false;
        if (state.view === "analytics") {
          render();
          requestAnimationFrame(() => {
            if (generation !== state.generation || state.view !== "analytics") return;
            const answer = content.querySelector(".dm-answer");
            if (!answer) return;
            const top = answer.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 14;
            content.scrollTo({top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
          });
        } else header();
      }
    }
  }
  function optimizationResult() { return state.manifest.optimization || {}; }
  function renderOptimization() {
    const root = node("div", "dm-optimizer"), data = optimizationResult(), heading = node("div", "dm-section-heading"), intro = node("div");
    intro.append(node("h2", "", "Расчёт плана продаж"), node("p", "", "Рассчитайте демонстрационный сценарий и посмотрите, за счёт каких решений меняется результат.")); heading.append(intro, node("span", "dm-source-pill", "Демонстрационные условия")); root.append(heading);
    if (!optimized()) {
      const setup = node("section", "dm-optimization-setup"), description = node("div");
      description.append(node("p", "dm-eyebrow", "Цель расчёта"), node("h3", "", "Максимизировать маржинальный доход"), node("p", "", "Расчёт начнётся после нажатия кнопки. Допустимые изменения и ограничения заданы в демонстрационном сценарии."));
      const run = button(state.optimizing ? "Расчёт выполняется…" : "Запустить оптимизацию →", optimize, "dm-button dm-primary"); run.disabled = state.optimizing; setup.append(description, run); root.append(setup);
      if (state.optimizing) { const loading = node("div", "dm-loading-inline"); loading.setAttribute("role", "status"); loading.append(node("span", "dm-spinner"), node("span", "", "Выполняется расчёт демонстрационного сценария. Готовим новый план и сравнение.")); root.append(loading); }
      else { const panel = node("div", "dm-panel"); panel.append(node("h3", "", "Что получите после расчёта"), node("p", "dm-muted", "Сравнение финансового результата, конкретные изменения в плане и последовательность действий для его реализации.")); root.append(panel); }
    } else {
      root.append(readyMessage("Расчёт по демоусловиям завершён. Сравните результаты с исходным планом."));
      const navigation = node("nav", "dm-result-navigation"); navigation.setAttribute("aria-label", "Разделы результата оптимизации");
      navigation.append(node("span", "", "Перейти к разделу:"), button("Результат", () => scrollContentTo($("dm-result-summary")), "dm-result-anchor"),
        button("Сравнение по месяцам", () => scrollContentTo($("dm-monthly-comparison")), "dm-result-anchor"),
        button("Изменения и действия", () => scrollContentTo($("dm-plan-actions")), "dm-result-anchor")); root.append(navigation);
      const kpis = node("div", "dm-result-kpis"), unit = clean(data.unit);
      kpis.id = "dm-result-summary";
      const delta = numeric(data.delta) ? data.delta : numeric(data.before) && numeric(data.after) ? data.after - data.before : null;
      kpis.append(stat("Маржинальный доход · исходный план", num(data.before), unit ? unit + " за год" : "За год"), stat("Маржинальный доход · новый план", num(data.after), unit ? unit + " за год" : "За год"), stat("Изменение", (numeric(delta) && delta > 0 ? "+" : "") + num(delta), numeric(data.percent) ? (data.percent > 0 ? "+" : "") + num(data.percent) + "%" : unit)); root.append(kpis);
      if (data.series) { const panel = node("section", "dm-panel dm-result-chart"); panel.id = "dm-monthly-comparison"; panel.append(node("h3", "", "Маржинальный доход по месяцам"), miniChart({...data.series, unit, title: "Маржинальный доход по месяцам"}, true)); root.append(panel); }
      const grid = node("div", "dm-result-grid"), changes = node("section", "dm-panel"), actions = node("section", "dm-panel"); changes.append(node("h3", "", "Что изменилось в плане")); actions.append(node("h3", "", "Что нужно сделать"));
      grid.id = "dm-plan-actions";
      (Array.isArray(data.changes) ? data.changes : []).forEach((change, index) => changes.append(changeItem(change, index, true)));
      (Array.isArray(data.actions) ? data.actions : []).forEach((action, index) => actions.append(changeItem(action, index)));
      grid.append(changes, actions); root.append(grid);
      const discussion = node("div", "dm-result-discuss"); discussion.append(button("Обсудить изменения плана →", () => {
        show("analytics"); ask("Какие изменения дал расчёт оптимизации и что нужно сделать для реализации нового плана?");
      }, "dm-quiet-button")); root.append(discussion);
      const publish = node("div", "dm-publish-callout"), copy = node("div");
      copy.append(node("strong", "", published() ? "Результат сохранён в демосессии" : "Сохранить результат в демосессии"), node("p", "", published() ? "Расчёт сохранён в этой сессии. Исходный снимок Табулы доступен в пульте." : "Результат сохранится только в демосессии. Новая модель в Табуле не создаётся."));
      publish.append(copy, button(published() ? "Перейти в пульт →" : "Сохранить результат", () => published() ? show("dashboard") : confirmPublish(), "dm-button dm-primary")); root.append(publish);
    }
    const basisLabel = data.basis_label || state.manifest.optimization_basis;
    if (basisLabel) { const basis = node("details", "dm-optimization-basis"); basis.append(node("summary", "", "Основа демонстрационного расчёта"), node("p", "", basisLabel)); root.append(basis); }
    root.append(node("p", "dm-demo-footnote", "Оптимизация выполняется в рамках явно заданных демоусловий. Создание копии показано демонстрационным этапом и не записывает план на сервер Табулы.")); content.append(root);
  }
  function changeItem(item, index, project = false) {
    const value = typeof item === "string" ? {title: item} : item || {}, row = node("div", "dm-change"), body = node("div");
    body.append(node("strong", "", value.title || value.label || "Изменение плана"));
    const direction = numeric(value.percent) ? value.percent : numeric(value.before) && numeric(value.after) ? value.after - value.before : null;
    const description = project && numeric(direction) ? direction > 0 ? "Увеличить объём услуг" : direction < 0 ? "Сократить объём услуг" : "Сохранить объём услуг" : value.description;
    if (description) body.append(node("p", "", description));
    if (numeric(value.percent)) body.append(node("p", "dm-change-value", `К исходному плану: ${value.percent > 0 ? "+" : ""}${num(value.percent)}%`));
    else if (numeric(value.before) && numeric(value.after)) body.append(node("p", "dm-change-value", `${num(value.before)} → ${num(value.after)}${value.unit ? " " + value.unit : ""}`));
    row.append(node("span", "dm-change-number", index + 1), body); return row;
  }
  async function optimize() {
    if (state.optimizing || !state.session?.id) return;
    const generation = state.generation; state.optimizing = true; notice(); render();
    try { const response = await request(sessionPath() + "/optimize", {method: "POST"}); if (generation === state.generation) applyManifest(response); }
    catch (error) { notice(error.message, true); }
    finally { if (generation === state.generation) { state.optimizing = false; render(); } }
  }
  function transientDialog(titleText, paragraphs, className = "dm-info-dialog") {
    const dialog = node("dialog", className), heading = node("header"), title = node("h2", "", titleText), close = button("Закрыть", () => dialog.close(), "dm-quiet-button");
    title.id = "dm-transient-title"; dialog.setAttribute("aria-labelledby", title.id); heading.append(title, close); dialog.append(heading);
    paragraphs.forEach(value => dialog.append(node("p", "", value)));
    const previous = document.activeElement;
    dialog.addEventListener("close", () => { dialog.remove(); if (previous?.isConnected) previous.focus({preventScroll: true}); }); document.body.append(dialog); dialog.showModal(); close.focus(); return dialog;
  }
  function confirmPublish() {
    if (state.publishing || published()) return;
    const dialog = transientDialog("Сохранить результат расчёта?", ["Результат оптимизации сохранится в демонстрационной сессии.", "Новая модель в Табуле не создаётся; исходный план не меняется."], "dm-confirm-dialog");
    const actions = node("div", "dm-dialog-actions"), cancel = button("Отмена", () => dialog.close()), confirm = button("Сохранить результат", async () => {
      confirm.disabled = cancel.disabled = true; state.publishing = true; header();
      try {
        const response = await request(sessionPath() + "/publish", {method: "POST", json: {confirmed: true}}); applyManifest(response); dialog.close();
        notice("Результат сохранён в демосессии. Можно перейти к показателям.");
      } catch (error) { notice(error.message, true); confirm.disabled = cancel.disabled = false; }
      finally { state.publishing = false; render(); }
    }, "dm-button dm-primary"); actions.append(cancel, confirm); dialog.append(actions); confirm.focus();
  }
  function renderDashboard() {
    const wrap = node("div", "dm-dashboard-wrap");
    const note = published() ? "Пульт показывает исходный сохранённый снимок Табулы. Результат расчёта по демоусловиям доступен в разделе «Оптимизация»." : "Показатели из реального сохранённого снимка Табулы.";
    const navigation = node("nav", "dm-result-navigation dm-dashboard-navigation"); navigation.setAttribute("aria-label", "Разделы пульта управления");
    const cards = button("Карточки показателей", () => scrollContentTo(dashboardRoot.querySelector(".td-kpis")), "dm-result-anchor");
    const charts = button("Графики", () => scrollContentTo(dashboardRoot.querySelector(".td-section-heading")), "dm-result-anchor");
    cards.disabled = charts.disabled = true; navigation.append(cards, charts);
    wrap.append(node("div", "dm-dashboard-note", note), navigation, dashboardRoot); content.append(wrap);
    const syncNavigation = () => {
      cards.disabled = !dashboardRoot.querySelector(".td-kpis");
      charts.disabled = !dashboardRoot.querySelector(".td-section-heading") || !dashboardRoot.querySelector(".td-chart-card");
    };
    dashboardNavigationObserver = new MutationObserver(syncNavigation);
    dashboardNavigationObserver.observe(dashboardRoot, {childList: true, subtree: true});
    if (!dashboard && window.TabulaDashboard) dashboard = window.TabulaDashboard.mount(dashboardRoot, {
      request: async (path, options = {}) => {
        const result = await request(path, options);
        if (result?.schema === "tabula-dashboard/v1") state.manifest.dashboard = result;
        return result;
      },
      ask: async prompt => { show("analytics"); await ask(prompt); },
      onMode: kind => { if (kind === "graph") show("graph"); else if (kind === "optimization") show("optimization"); },
    });
    if (dashboard) { dashboard.setChat({id: state.manifest.model?.source_chat_id}); dashboard.show(); }
    else dashboardRoot.append(node("p", "dm-muted", "Пульт управления пока недоступен."));
    syncNavigation();
  }
  async function connect() {
    const input = $("dm-token"); state.token = input.value.trim() || state.token;
    if (!state.token) { openAccess(); return; }
    const message = $("dm-access-message"); message.textContent = "Проверяем подключение…";
    try {
      const manifest = await request("/v1/demo/manifest");
      if (!state.session) { applyManifest(manifest); state.session = null; }
      const url = new URL(window.location.href), sessionId = url.searchParams.get("session");
      if (!state.session && /^[0-9a-f]{32}$/i.test(sessionId || "")) {
        applyManifest(await request("/v1/demo/sessions/" + encodeURIComponent(sessionId)));
        state.stage = 4; state.view = views[url.searchParams.get("view")] ? url.searchParams.get("view") : "overview";
        state.uploadedName = state.manifest.upload?.file_name || "";
      }
      state.connected = true; window.TabulaConnection.saveToken(state.token); message.textContent = "";
      if ($("dm-access-dialog").open) $("dm-access-dialog").close(); render(); notice();
    } catch (error) { state.connected = false; message.textContent = clean(error.message); header(); if (!$("dm-access-dialog").open) notice(error.message, true); }
  }
  function openAccess() { returningFocus = document.activeElement; $("dm-token").value = state.token; if (!$("dm-access-dialog").open) $("dm-access-dialog").showModal(); $("dm-token").focus(); }
  function reset() {
    if (state.busy || state.asking || state.optimizing || state.publishing) return;
    state.generation++; state.session = null; state.stage = -1; state.view = "start"; state.answers = []; state.uploadedName = ""; dashboard?.hide(); notice(); render();
    const url = new URL(window.location.href); url.searchParams.delete("session"); url.searchParams.delete("view"); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  $("dm-new").addEventListener("click", reset);
  $("dm-access").addEventListener("click", openAccess);
  $("dm-access-form").addEventListener("submit", event => { event.preventDefault(); connect(); });
  $("dm-access-close").addEventListener("click", () => $("dm-access-dialog").close());
  $("dm-access-dialog").addEventListener("close", () => { if (returningFocus?.isConnected) returningFocus.focus({preventScroll: true}); });
  $("dm-about").addEventListener("click", () => transientDialog("О демонстрационном режиме", ["Excel сохраняется в Harness. Этап загрузки в Табулу показан демонстрационным сценарием.", "Граф, аналитика и пульт используют реальный сохранённый снимок подготовленной модели Табулы.", "Оптимизация рассчитывает сценарий по заданным демоусловиям. Результат сохраняется только в демосессии, без создания новой модели в Табуле."]));
  document.querySelectorAll("[data-view]").forEach(item => item.addEventListener("click", () => show(item.dataset.view)));
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) upload(fileInput.files[0]); });
  window.addEventListener("keydown", event => { if (event.key === "Escape" && graphExpanded) { graphExpanded = false; const shell = document.querySelector(".dm-graph-shell.expanded"); shell?.classList.remove("expanded"); const button = shell?.querySelector(".dm-graph-expand"); if (button) { button.textContent = "На весь экран"; button.focus(); } } });
  render(); if (state.token) connect();
})();
