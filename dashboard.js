"use strict";

window.TabulaDashboard = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const format = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const exact = new Intl.NumberFormat("ru-RU", {maximumSignificantDigits: 17});
  const compact = new Intl.NumberFormat("ru-RU", {notation: "compact", maximumFractionDigits: 1});
  const text = value => typeof value === "string" ? value : value == null ? "" : String(value);
  const displayText = value => window.TabulaPresentation?.text?.(value) ?? text(value);
  const title = value => window.TabulaPresentation?.title?.(value) ?? text(value);
  const scenarioOf = series => text(series.scenario).trim();
  const scenarioTitle = value => value || "Сценарий не указан";
  const isTime = series => series.kind === "time";
  const countWord = (count, one, few, many) => count % 100 >= 11 && count % 100 <= 14 ? many : count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many;
  const periodTitle = value => {
    const label = text(value);
    if (!/^\d{4}-\d{2}(?:$|-\d{2}(?:T|$))/.test(label)) return label;
    const date = new Date(label.length === 7 ? label + "-01T00:00:00Z" : label.slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(date.getTime())) return label;
    return date.toLocaleDateString("ru-RU", {month: "long", year: "numeric", ...(label.length > 7 ? {day: "numeric"} : {}), timeZone: "UTC"});
  };
  function node(tag, className, value) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = displayText(value);
    return item;
  }
  function button(value, className = "td-button") {
    const item = node("button", className, value); item.type = "button"; return item;
  }
  function svgNode(tag, attributes = {}, value) {
    const item = document.createElementNS(NS, tag);
    for (const [key, entry] of Object.entries(attributes)) item.setAttribute(key, String(entry));
    if (value !== undefined) item.textContent = displayText(value);
    return item;
  }
  function validSeries(series) {
    return series && typeof series.id === "string" && Array.isArray(series.labels) && Array.isArray(series.values) &&
      series.labels.length === series.values.length && series.labels.length > 0 && series.labels.every(label => typeof label === "string") &&
      series.values.every(value => value == null || numeric(value));
  }
  function palette(id) {
    const hash = [...text(id)].reduce((sum, letter) => ((sum * 31) + letter.charCodeAt(0)) | 0, 0);
    return ["#1875c8", "#a78110", "#26834a", "#8060ad"][Math.abs(hash) % 4];
  }
  function chart(stage, series, type, color) {
    stage.replaceChildren();
    const width = Math.max(280, Math.round(stage.clientWidth || 560)), height = stage.closest("dialog") ? 320 : 245;
    const left = width < 420 ? 48 : 62, right = 18, top = 20, bottom = height - 42;
    const values = series.values.filter(numeric);
    if (!values.length) { stage.append(node("p", "td-chart-empty", "В выбранном срезе нет числовых значений.")); return; }
    let low = Math.min(0, ...values), high = Math.max(0, ...values);
    if (low === high) high = low + 1;
    const rough = (high - low) / 4, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(value => value * power).find(value => value >= rough) || power * 10;
    low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
    const x = index => left + (width - left - right) * (index + .5) / series.labels.length;
    const y = value => top + (high - value) / (high - low) * (bottom - top);
    const svg = svgNode("svg", {viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${displayText(series.label || "Показатель")}: ${series.labels.length} значений`});
    svg.append(svgNode("title", {}, series.label || "Значения показателя"));
    for (let value = low, index = 0; value <= high + step * .01 && index < 9; value += step, index++) {
      svg.append(svgNode("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: "#e8e8e8"}),
        svgNode("text", {x: left - 10, y: y(value) + 4, "text-anchor": "end", fill: "#72727a", "font-size": 12}, /тыс|млн|млрд/i.test(series.unit || "") ? format.format(value) : compact.format(value)));
    }
    const every = Math.max(1, Math.ceil(series.labels.length / Math.max(3, Math.floor((width - left - right) / 75))));
    const years = new Set(series.labels.map(label => label.slice(0, 4)));
    const monthly = new Set(series.labels.map(label => label.slice(0, 7))).size === series.labels.length;
    series.labels.forEach((label, index) => {
      if (index % every && index !== series.labels.length - 1) return;
      if (index === series.labels.length - 1 && index % every && index % every < every / 2) return;
      let display = label;
      if (isTime(series) && /^\d{4}-\d{2}(?:$|-\d{2}(?:T|$))/.test(label)) display = new Date(label.length === 7 ? label + "-01T00:00:00Z" : label.slice(0, 10) + "T00:00:00Z").toLocaleDateString("ru-RU", {month: "short", ...(!monthly ? {day: "2-digit"} : {}), ...(years.size > 1 ? {year: "2-digit"} : {}), timeZone: "UTC"});
      if (display.length > 17) display = display.slice(0, 15) + "…";
      svg.append(svgNode("text", {x: x(index), y: bottom + 25, "text-anchor": "middle", fill: "#72727a", "font-size": 11}, display));
    });
    if (type !== "bar") {
      const segments = []; let segment = [];
      series.values.forEach((value, index) => { if (numeric(value)) segment.push([x(index), y(value)]); else if (segment.length) { segments.push(segment); segment = []; } });
      if (segment.length) segments.push(segment);
      for (const points of segments) {
        const path = points.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
        if (type === "area") svg.append(svgNode("path", {d: `${path} L${points.at(-1)[0]},${y(0)} L${points[0][0]},${y(0)} Z`, fill: color, opacity: .1}));
        svg.append(svgNode("path", {d: path, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round"}));
      }
    }
    const tooltip = node("div", "td-tooltip"); tooltip.hidden = true;
    const points = [];
    series.values.forEach((value, index) => {
      if (!numeric(value)) return;
      const group = svgNode("g", {tabindex: points.length ? -1 : 0, role: "img", "aria-label": displayText(`${isTime(series) ? periodTitle(series.labels[index]) : series.labels[index]}: ${exact.format(value)}${series.unit ? " " + series.unit : ""}`)});
      group.append(svgNode("title", {}, `${series.labels[index]}: ${exact.format(value)}`));
      if (type === "bar") {
        const barWidth = Math.max(2, Math.min(40, (width - left - right) / series.labels.length * .6));
        group.append(svgNode("rect", {x: x(index) - barWidth / 2, y: Math.min(y(value), y(0)), width: barWidth, height: Math.max(1, Math.abs(y(value) - y(0))), rx: 2, fill: color, opacity: .85}));
      } else group.append(svgNode("circle", {cx: x(index), cy: y(value), r: 12, fill: "transparent"}), svgNode("circle", {cx: x(index), cy: y(value), r: series.labels.length > 50 ? 2.2 : 3.5, fill: color, stroke: "#fff", "stroke-width": 1.5}));
      function showTip() {
        tooltip.replaceChildren(node("strong", "", isTime(series) ? periodTitle(series.labels[index]) : series.labels[index]), node("span", "", `${exact.format(value)}${series.unit ? " " + series.unit : ""}`));
        tooltip.hidden = false;
        tooltip.style.left = Math.max(6, Math.min(width - (tooltip.offsetWidth || 180) - 6, x(index) - 70)) + "px";
        tooltip.style.top = Math.max(0, y(value) - (tooltip.offsetHeight || 68) - 12) + "px";
      }
      for (const event of ["mouseenter", "focus", "click"]) group.addEventListener(event, showTip);
      for (const event of ["mouseleave", "blur"]) group.addEventListener(event, () => { tooltip.hidden = true; });
      group.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = points.indexOf(group), next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
        group.tabIndex = -1; points[next].tabIndex = 0; points[next].focus();
      });
      points.push(group); svg.append(group);
    });
    stage.append(svg, tooltip);
  }

  function mount(root, options) {
    root.classList.add("tabula-dashboard"); root.hidden = true;
    const state = {chat: null, data: null, visible: false, loading: false, composing: false, error: "", snapshotError: "", search: "", scenario: null, period: "all", series: new Map(), types: new Map()};
    const drawers = new Map(), autoComposed = new Set(); let requestEpoch = 0, pollEpoch = 0, resizeFrame = 0, modal = null;
    let snapshotTimer = 0, snapshotEpoch = 0, snapshotAbort = null;
    const header = node("header", "td-header"), heading = node("div", "td-heading"), kicker = node("p", "td-kicker", "Пульт управления"), headingTitle = node("h2", "", "Показатели модели"), subtitle = node("p", "td-subtitle");
    heading.append(kicker, headingTitle, subtitle);
    const headerActions = node("div", "td-header-actions"), refreshButton = button("Обновить пульт"), composeButton = button("Подобрать вид", "td-button td-button-primary");
    refreshButton.title = "Прочитать актуальный сохранённый снимок. Выгрузка из 1С не запускается.";
    headerActions.append(refreshButton, composeButton); header.append(heading, headerActions);
    const snapshot = node("div", "td-snapshot"), status = node("span", "td-status"), sourceText = node("span", "td-source-text"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); snapshot.append(status, sourceText);
    const filters = node("div", "td-filters"), periodLabel = node("label", "", "Период"), scenarioLabel = node("label", "", "Сценарий"), searchLabel = node("label", "td-search-label", "Найти показатель");
    const periodSelect = node("select"), scenarioSelect = node("select"), searchInput = node("input");
    periodSelect.setAttribute("aria-label", "Период пульта"); scenarioSelect.setAttribute("aria-label", "Сценарий пульта");
    searchInput.type = "search"; searchInput.placeholder = "Выручка, затраты, денежный поток…"; searchInput.setAttribute("aria-label", "Найти показатель пульта");
    periodLabel.append(periodSelect); scenarioLabel.append(scenarioSelect); searchLabel.append(searchInput); filters.append(periodLabel, scenarioLabel, searchLabel);
    const alert = node("div", "td-alert"); alert.setAttribute("role", "status");
    const constraintPanel = node("section", "td-constraint-panel"); constraintPanel.hidden = true;
    const content = node("div", "td-content"), footer = node("p", "td-footer", "Пульт показывает сохранённые значения модели. Обновление пульта не запускает выгрузку из 1С или пересчёт.");
    root.replaceChildren(header, snapshot, constraintPanel, filters, alert, content, footer);

    const chatId = () => typeof state.chat === "string" ? state.chat : state.chat?.id;
    const snapshotIdentity = data => {
      if (typeof data?.freshness?.source_identity === "string" && data.freshness.source_identity) return data.freshness.source_identity;
      const source = data?.source || {};
      return JSON.stringify(["kind", "file_id", "sha256", "model_id", "version_id", "revision", "pipeline_id", "snapshot_sha256", "graph_sha256", "export_sha256"].map(key => source[key] ?? ""));
    };
    const metrics = () => Array.isArray(state.data?.metrics) ? state.data.metrics.filter(metric => metric && typeof metric.id === "string") : [];
    const seriesFor = metric => (Array.isArray(metric.series) ? metric.series : []).filter(validSeries).filter(series => scenarioOf(series) === state.scenario);
    function selectedSeries(metric) {
      const available = seriesFor(metric);
      return available.find(series => series.id === state.series.get(metric.id)) || available[0] || null;
    }
    function subset(series) {
      if (!series) return null;
      let indices = series.labels.map((_, index) => index);
      if (state.period !== "all") {
        const matches = value => state.period.startsWith("year:") ? text(value).slice(0, 4) === state.period.slice(5) : value === state.period.slice(7);
        if (isTime(series)) indices = indices.filter(index => matches(series.labels[index]));
        else if (!matches(series.dimensions?.period)) indices = [];
      }
      return {...series, labels: indices.map(index => series.labels[index]), values: indices.map(index => series.values[index]), provenance: indices.map(index => series.provenance?.[index])};
    }
    function point(series) {
      if (!series?.labels.length) return null;
      const index = series.labels.length - 1;
      return {label: series.labels[index], value: series.values[index]};
    }
    function addSelectOption(select, value, label) { const option = node("option", "", label); option.value = value; select.append(option); }
    function setFilters() {
      const all = metrics().flatMap(metric => (Array.isArray(metric.series) ? metric.series : []).filter(validSeries));
      const scenarios = [...new Set(all.map(scenarioOf))].sort((a, b) => a.localeCompare(b, "ru"));
      if (state.scenario === null) {
        const preferred = text(state.data?.layout?.default_scenario).trim();
        state.scenario = scenarios.includes(preferred) && state.data?.layout?.default_scenario != null ? preferred :
          scenarios.find(value => /^план(?:\s|[-:]|$)/i.test(value)) ?? scenarios[0] ?? "";
      }
      scenarioSelect.replaceChildren();
      for (const scenario of scenarios) addSelectOption(scenarioSelect, scenario, scenarioTitle(scenario));
      if (!scenarios.includes(state.scenario)) addSelectOption(scenarioSelect, state.scenario, `${scenarioTitle(state.scenario)} · нет в снимке`);
      scenarioSelect.value = state.scenario;
      const periods = [...new Set(all.filter(series => scenarioOf(series) === state.scenario && isTime(series)).flatMap(series => series.labels))].sort((a, b) => a.localeCompare(b, "ru", {numeric: true}));
      periodSelect.replaceChildren(); addSelectOption(periodSelect, "all", "Все доступные периоды");
      for (const year of [...new Set(periods.filter(value => /^\d{4}-\d{2}/.test(value)).map(value => value.slice(0, 4)))]) addSelectOption(periodSelect, "year:" + year, year + " год");
      for (const period of periods) addSelectOption(periodSelect, "period:" + period, periodTitle(period));
      if (![...periodSelect.options].some(option => option.value === state.period)) addSelectOption(periodSelect, state.period, "Выбранный период отсутствует");
      periodSelect.value = state.period;
    }
    function noValues(metric, selected) {
      if (!selected) return `Нет ряда для сценария «${scenarioTitle(state.scenario)}».`;
      if (!selected.labels.length) return "В выбранном периоде нет значений этого показателя.";
      return "В выбранном срезе нет числовых значений.";
    }
    function seriesControl(metric, onChange) {
      const available = seriesFor(metric);
      if (available.length < 2) return null;
      const select = node("select", "td-series-select"); select.setAttribute("aria-label", `Разрез: ${title(metric.label)}`);
      available.forEach((series, index) => addSelectOption(select, series.id, title(series.label) || `Разрез ${index + 1}`));
      select.value = selectedSeries(metric)?.id || "";
      select.addEventListener("change", () => { state.series.set(metric.id, select.value); onChange(); }); return select;
    }
    function addDrawing(stage, series, type, color) { drawers.set(stage, {series, type, color}); requestAnimationFrame(redraw); }
    function redraw() {
      for (const [stage, value] of drawers) {
        if (!stage.isConnected) { drawers.delete(stage); continue; }
        if (!root.hidden && stage.clientWidth) chart(stage, value.series, value.type, value.color);
      }
    }
    function sparkline(series, color) {
      const svg = svgNode("svg", {viewBox: "0 0 130 40", "aria-hidden": "true", class: "td-sparkline"});
      const observed = series?.values.filter(numeric) || [];
      if (!series || !isTime(series) || observed.length < 2) return svg;
      const low = Math.min(...observed), high = Math.max(...observed), span = high - low || 1;
      const parts = []; let segment = [];
      series.values.forEach((value, index) => {
        if (numeric(value)) segment.push(`${4 + index / Math.max(1, series.values.length - 1) * 122},${35 - (value - low) / span * 30}`);
        else if (segment.length) { parts.push(segment); segment = []; }
      });
      if (segment.length) parts.push(segment);
      parts.forEach(points => svg.append(svgNode("polyline", {points: points.join(" "), fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round"})));
      return svg;
    }
    function kpi(metric) {
      const selected = selectedSeries(metric), series = subset(selected), last = point(series), card = button("", "td-kpi");
      card.setAttribute("aria-label", `Открыть показатель ${title(metric.label)}`);
      card.style.setProperty("--td-accent", palette(metric.id));
      card.append(node("span", "td-kpi-label", title(metric.label)));
      const value = node("strong", "td-kpi-value", last && numeric(last.value) ? format.format(last.value) : "—");
      const unit = text(selected?.unit || metric.unit); if (unit) value.append(node("small", "", unit)); card.append(value);
      card.append(node("span", "td-kpi-caption", last ? `${isTime(series) ? periodTitle(last.label) : last.label} · ${scenarioTitle(state.scenario)}` : noValues(metric, series)), sparkline(series, palette(metric.id)));
      card.addEventListener("click", () => openMetric(metric.id, card)); return card;
    }
    function typeFor(metric, series, preferred) {
      const type = state.types.get(metric.id) || preferred || (isTime(series) ? "line" : "bar");
      return !isTime(series) ? "bar" : ["line", "area", "bar"].includes(type) ? type : "line";
    }
    function chartCard(metric, widget = {}) {
      const selected = selectedSeries(metric), series = subset(selected), last = point(series), card = node("section", "td-chart-card");
      const top = node("div", "td-card-heading"), heading = node("div"); heading.append(node("p", "td-card-group", title(metric.group)), node("h3", "", title(widget.title || metric.label)));
      const expand = button("Развернуть", "td-card-link"); expand.setAttribute("aria-label", `Развернуть показатель ${title(metric.label)}`); expand.addEventListener("click", () => openMetric(metric.id, expand)); top.append(heading, expand); card.append(top);
      const control = seriesControl(metric, renderContent); if (control) card.append(control);
      if (!series?.labels.length || !series.values.some(numeric)) { card.append(node("p", "td-chart-empty", noValues(metric, series))); return card; }
      const measure = node("div", "td-card-measure"); measure.append(node("strong", "", last && numeric(last.value) ? format.format(last.value) : "—"), node("span", "", text(selected.unit || metric.unit)));
      card.append(measure, node("p", "td-card-period", `${isTime(series) ? periodTitle(last.label) : last.label} · ${scenarioTitle(state.scenario)}`));
      const stage = node("div", "td-chart-stage"); card.append(stage); addDrawing(stage, {...series, label: title(metric.label), unit: text(selected.unit || metric.unit)}, typeFor(metric, series, widget.chart_type), palette(metric.id));
      const foot = node("div", "td-card-footer"); foot.append(node("span", "", `${series.labels.length} ${isTime(series) ? countWord(series.labels.length, "период", "периода", "периодов") : countWord(series.labels.length, "значение", "значения", "значений")}`));
      const discuss = button("Обсудить показатель", "td-card-link"); discuss.addEventListener("click", () => discussMetric(metric)); foot.append(discuss); card.append(foot); return card;
    }
    function renderContent() {
      content.replaceChildren();
      if (!chatId()) { content.append(empty("Выберите модель", "Откройте модель Табулы, чтобы увидеть её показатели и расчётные связи.")); return; }
      if (!state.data) { content.append(empty(state.loading ? "Загружаем показатели…" : "Пульт пока не загружен", state.loading ? "Читаем сохранённый снимок модели." : "Нажмите «Обновить пульт», чтобы получить доступные показатели.")); return; }
      const all = metrics();
      if (!all.length) { content.append(empty("Для пульта пока нет числовых рядов", "Обновите данные модели и постройте граф. Доступные значения появятся в пульте после обновления данных.")); return; }
      const available = all.filter(metric => subset(selectedSeries(metric))?.values.some(numeric));
      const availableIds = new Set(available.map(metric => metric.id));
      const query = state.search.trim().toLocaleLowerCase("ru"), matching = available.filter(metric => !query || `${metric.label || ""} ${metric.group || ""}`.toLocaleLowerCase("ru").includes(query));
      const byId = new Map(all.map(metric => [metric.id, metric]));
      const originalKpis = (state.data.layout?.kpis || []).map(id => byId.get(typeof id === "string" ? id : id.metric_id)).filter(Boolean).slice(0, 4);
      const originalWidgets = (state.data.layout?.widgets || []).filter(widget => byId.has(widget.metric_id)).slice(0, 6);
      const businessKey = metric => text(metric.label).replace(/\s+/g, " ").trim().toLocaleLowerCase("ru") + "|" + text(selectedSeries(metric)?.unit || metric.unit).trim().toLocaleLowerCase("ru");
      function fillMetrics(preferred, maximum) {
        const selected = [], seen = new Set();
        for (const metric of [...preferred, ...available]) {
          if (!availableIds.has(metric.id) || seen.has(businessKey(metric))) continue;
          seen.add(businessKey(metric)); selected.push(metric);
          if (selected.length >= maximum) break;
        }
        return selected;
      }
      const chosenKpis = fillMetrics(originalKpis, originalKpis.length || 4);
      const chosenWidgets = fillMetrics(originalWidgets.map(widget => byId.get(widget.metric_id)), originalWidgets.length || 6);
      const adapted = originalKpis.map(metric => metric.id).join("|") !== chosenKpis.map(metric => metric.id).join("|") ||
        originalWidgets.map(widget => widget.metric_id).join("|") !== chosenWidgets.map(metric => metric.id).join("|");
      if (!query && chosenKpis.length) { const cards = node("div", "td-kpis"); chosenKpis.forEach(metric => cards.append(kpi(metric))); content.append(cards); }
      const sectionHeader = node("div", "td-section-heading"), label = node("div"); label.append(node("h3", "", query ? "Найденные показатели" : "Показатели и динамика"), node("p", "", query ? `Найдено: ${matching.length}. Графики показывают выбранный сценарий и период.` : "Откройте карточку, чтобы увидеть точные значения и перейти к разбору показателя.")); sectionHeader.append(label);
      const mode = adapted || query ? "Показатели выбранного сценария" : state.data.layout?.selection_mode === "ai" ? "Подобранный вид" : "Базовый вид по данным модели";
      const modeLabel = node("span", "td-layout-mode", mode);
      if (state.data.selection?.status === "unavailable") modeLabel.title = displayText(state.data.selection.message || "Не удалось подобрать вид. Отображается базовый вид.");
      sectionHeader.append(modeLabel); content.append(sectionHeader);
      const grid = node("div", "td-chart-grid");
      const widgets = query ? matching.slice(0, 12).map(metric => ({metric_id: metric.id})) : chosenWidgets.map(metric =>
        originalWidgets.find(widget => widget.metric_id === metric.id) || {metric_id: metric.id});
      for (const widget of widgets) grid.append(chartCard(byId.get(widget.metric_id), widget));
      if (!widgets.length) grid.append(empty(query ? "Ничего не найдено" : "В этом виде нет графиков", query ? "Попробуйте другое название показателя или группы." : "Найдите показатель через поиск или нажмите «Подобрать вид»."));
      content.append(grid);
      if (query && matching.length > 12) content.append(node("p", "td-footer", "Показаны первые 12 показателей. Уточните название в поиске."));
      const warningTexts = (Array.isArray(state.data.warnings) ? state.data.warnings : []).map(warning => typeof warning === "string" ? warning : text(warning?.message || warning?.text)).filter(Boolean);
      if (state.data.layout?.note) {
        const note = text(state.data.layout.note).replace(
          /^Показатели и виды графиков подобраны языковой моделью по доступным данным\.$/i,
          "Показатели и виды графиков подобраны по доступным данным.");
        warningTexts.unshift(note);
      }
      if (warningTexts.length) {
        const details = node("details", "td-warnings"); details.append(node("summary", "", "Что учитывать при чтении показателей"));
        const list = node("ul"); warningTexts.forEach(warning => list.append(node("li", "", warning))); details.append(list); content.append(details);
      }
    }
    function empty(headingText, description) { const result = node("section", "td-empty"); result.append(node("span", "td-empty-mark", "▥"), node("h3", "", headingText), node("p", "", description)); return result; }
    function renderSnapshotMetadata() {
      status.textContent = state.loading ? "Обновляем данные пульта…" : state.composing ? "Подбираем вид…" : state.data?.freshness?.status === "older_than_daily_window" ? "Данные старше суток" : state.data ? "Сохранённые данные" : "Выберите модель";
      status.classList.toggle("td-status-pending", state.loading || state.composing);
      const updated = state.data?.freshness?.snapshot_received_at || state.data?.source?.snapshot_received_at || state.data?.source?.updated_at; let dateText = "";
      if (updated && Number.isFinite(new Date(updated).getTime())) dateText = new Date(updated).toLocaleString("ru-RU", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow"});
      sourceText.textContent = [title(state.data?.model?.title), dateText ? "Снимок получен " + dateText : ""].filter(Boolean).join(" · ");
      sourceText.title = displayText(state.data?.freshness?.message || "Обновление пульта читает сохранённые данные; выгрузка из 1С не запускается.");
      snapshot.hidden = !chatId(); alert.hidden = !state.error && !state.snapshotError; alert.textContent = displayText(state.error || state.snapshotError);
    }
    function render() {
      headingTitle.textContent = title(state.data?.layout?.title || state.data?.model?.title || "Показатели модели");
      subtitle.textContent = displayText(state.data?.layout?.subtitle || "Общие фильтры и точные значения показателей.");
      renderSnapshotMetadata();
      refreshButton.disabled = !chatId() || state.loading; composeButton.disabled = !metrics().length || state.loading || state.composing;
      composeButton.textContent = state.composing ? "Подбираем вид…" : "Подобрать вид";
      filters.hidden = !metrics().length;
      if (state.data) setFilters(); renderContent();
    }
    function adoptSnapshot(data) {
      const changed = snapshotIdentity(state.data) !== snapshotIdentity(data);
      if (changed) {
        pollEpoch++; state.composing = false; state.error = ""; state.series.clear(); state.types.clear(); closeModal(false);
        const all = (Array.isArray(data.metrics) ? data.metrics : []).flatMap(metric => (Array.isArray(metric.series) ? metric.series : []).filter(validSeries));
        if (state.scenario !== null && !all.some(series => scenarioOf(series) === state.scenario)) state.scenario = null;
        if (state.period !== "all") {
          const periods = all.filter(series => isTime(series) && (state.scenario === null || scenarioOf(series) === state.scenario)).flatMap(series => series.labels);
          const exists = state.period.startsWith("year:") ? periods.some(period => period.slice(0, 4) === state.period.slice(5)) : periods.includes(state.period.slice(7));
          if (!exists) state.period = "all";
        }
      }
      state.data = data; state.snapshotError = "";
      return changed;
    }
    function stopSnapshotPolling() {
      clearTimeout(snapshotTimer); snapshotTimer = 0; snapshotEpoch++;
      snapshotAbort?.abort(); snapshotAbort = null;
    }
    function scheduleSnapshotPoll(delay = 60_000) {
      clearTimeout(snapshotTimer); snapshotTimer = 0;
      if (!state.visible || document.hidden || !chatId()) return;
      snapshotTimer = setTimeout(() => { snapshotTimer = 0; pollSnapshot(); }, delay);
    }
    async function pollSnapshot() {
      if (!state.visible || document.hidden || !chatId()) return;
      if (state.loading) { scheduleSnapshotPoll(); return; }
      const id = chatId(), epoch = snapshotEpoch, requestedEpoch = requestEpoch, controller = new AbortController();
      snapshotAbort = controller;
      try {
        // This GET consumes the server's ready local snapshot. It never asks
        // Loader/RDP for a new export and does not force a catalog rebuild.
        const data = await options.request(`/v1/chats/${encodeURIComponent(id)}/dashboard`, {signal: controller.signal});
        if (epoch !== snapshotEpoch || requestedEpoch !== requestEpoch || id !== chatId() || !state.visible || document.hidden) return;
        if (!data || data.schema !== "tabula-dashboard/v1") throw new Error("Сервис вернул неизвестный формат пульта.");
        if (!state.data || snapshotIdentity(state.data) !== snapshotIdentity(data)) {
          adoptSnapshot(data); render(); maybeAutoCompose();
        } else {
          // A same-snapshot check should not reset focus, open detail tables or
          // charts. AI composition has its own guarded poll and state updates.
          state.data.freshness = data.freshness; state.data.source = data.source; state.snapshotError = "";
          renderSnapshotMetadata();
        }
      } catch (error) {
        if (error?.name !== "AbortError" && epoch === snapshotEpoch && requestedEpoch === requestEpoch && id === chatId() && state.visible) {
          state.snapshotError = "Не удалось проверить новый снимок. Показаны ранее полученные данные.";
          renderSnapshotMetadata();
        }
      } finally {
        if (snapshotAbort === controller) snapshotAbort = null;
        if (epoch === snapshotEpoch) scheduleSnapshotPoll();
      }
    }
    async function refresh() {
      const id = chatId(); if (!id) { render(); return; }
      stopSnapshotPolling();
      pollEpoch++; state.composing = false;
      const epoch = ++requestEpoch; state.loading = true; state.error = ""; state.snapshotError = ""; render();
      try {
        const data = await options.request(`/v1/chats/${encodeURIComponent(id)}/dashboard`);
        if (epoch !== requestEpoch || id !== chatId()) return;
        if (!data || data.schema !== "tabula-dashboard/v1") throw new Error("Сервис вернул неизвестный формат пульта.");
        adoptSnapshot(data);
      } catch (error) { if (epoch === requestEpoch) state.error = text(error.message || error); }
      finally { if (epoch === requestEpoch) { state.loading = false; render(); maybeAutoCompose(); scheduleSnapshotPoll(); } }
    }
    function maybeAutoCompose() {
      if (!state.visible || state.loading || state.composing || !metrics().length || !chatId()) return;
      if (!["idle", "queued", "running"].includes(state.data?.selection?.status)) return;
      const key = chatId() + ":" + snapshotIdentity(state.data);
      if (autoComposed.has(key) && state.data.selection.status === "idle") return;
      autoComposed.add(key);
      compose({existing: state.data.selection.status !== "idle"});
    }
    async function compose({existing = false} = {}) {
      const id = chatId(); if (!id || state.composing) return;
      const requestedSnapshot = snapshotIdentity(state.data);
      const epoch = ++pollEpoch; state.composing = true; state.error = ""; render();
      try {
        let data = existing ? state.data : await options.request(`/v1/chats/${encodeURIComponent(id)}/dashboard/compose`, {method: "POST"});
        for (let attempt = 0; attempt < 80; attempt++) {
          if (epoch !== pollEpoch || id !== chatId() || !state.visible) return;
          if (snapshotIdentity(state.data) !== requestedSnapshot) return;
          if (data?.schema === "tabula-dashboard/v1") {
            if (snapshotIdentity(data) !== requestedSnapshot) { state.error = "Снимок модели изменился. Нажмите «Обновить пульт», чтобы открыть актуальные показатели."; return; }
            state.data = data; render();
          }
          if (!["queued", "running"].includes(data?.selection?.status)) break;
          await new Promise(resolve => setTimeout(resolve, 1500));
          if (epoch !== pollEpoch || id !== chatId() || !state.visible) return;
          data = await options.request(`/v1/chats/${encodeURIComponent(id)}/dashboard`);
        }
        if (epoch !== pollEpoch || id !== chatId() || !state.visible) return;
        if (snapshotIdentity(state.data) !== requestedSnapshot) return;
        if (data?.schema === "tabula-dashboard/v1") {
          if (snapshotIdentity(data) !== requestedSnapshot) { state.error = "Снимок модели изменился. Нажмите «Обновить пульт», чтобы открыть актуальные показатели."; return; }
          state.data = data;
        }
        if (["queued", "running"].includes(data?.selection?.status)) state.error = "Подбор вида ещё выполняется. Нажмите «Обновить пульт» позже; базовый вид доступен сейчас.";
        else if (["failed", "error"].includes(data?.selection?.status)) state.error = text(data.selection.message || data.selection.error || "Не удалось подобрать вид. Базовый вид по данным модели сохранён.");
      } catch (error) { if (epoch === pollEpoch) state.error = text(error.message || error); }
      finally { if (epoch === pollEpoch) { state.composing = false; render(); } }
    }
    function closeModal(restoreFocus = true) {
      if (!modal) return;
      const closing = modal; modal = null;
      if (closing.dialog.open) closing.dialog.close(); closing.dialog.remove();
      if (restoreFocus && closing.returnFocus?.isConnected) closing.returnFocus.focus({preventScroll: true});
    }
    function dependencies(metric, series) {
      const section = node("section", "td-dependencies"); section.append(node("h3", "", "Расчётные связи"));
      const links = metric.dependencies || series?.dependencies;
      let count = 0;
      if (links && typeof links === "object") {
        for (const [key, headingText] of [["inputs", "Из чего складывается"], ["outputs", "На что влияет"]]) {
          const items = Array.isArray(links[key]) ? links[key] : [];
          const list = node("ul");
          for (const entry of items.slice(0, 20)) {
            const label = typeof entry === "string" ? entry : entry?.label;
            if (!label) continue;
            list.append(node("li", "", title(label))); count++;
          }
          if (list.children.length) { const group = node("div"); group.append(node("h4", "", headingText), list); section.append(group); }
        }
      }
      if (!count) section.append(node("p", "td-muted", "Расчётные связи не переданы в этот набор показателей. Их можно запросить у аналитика по графу выбранной модели."));
      const discuss = button("Разобрать связи с аналитиком"); discuss.addEventListener("click", () => discussMetric(metric)); section.append(discuss); return section;
    }
    function renderModal() {
      if (!modal) return;
      const metric = metrics().find(item => item.id === modal.metricId); if (!metric) { closeModal(false); return; }
      const body = modal.body; body.replaceChildren();
      if (metric.scope?.alternative_document_count > 0) body.append(node("p", "td-scope-note", "В модели есть несколько одноимённых форм. Этот показатель и его ряды относятся к одному выбранному документу; другие варианты в значения не включены."));
      const selected = selectedSeries(metric), series = subset(selected), controls = node("div", "td-detail-controls");
      controls.append(node("span", "td-scenario-tag", scenarioTitle(state.scenario)));
      const selection = seriesControl(metric, () => { renderContent(); renderModal(); }); if (selection) controls.append(selection);
      if (series) {
        const typeSelect = node("select"); typeSelect.setAttribute("aria-label", "Вид графика показателя");
        for (const [value, label] of (isTime(series) ? [["line", "Линия"], ["bar", "Столбцы"], ["area", "Область"]] : [["bar", "Столбцы"]])) addSelectOption(typeSelect, value, label);
        typeSelect.value = typeFor(metric, series);
        typeSelect.addEventListener("change", () => { state.types.set(metric.id, typeSelect.value); renderContent(); renderModal(); }); controls.append(typeSelect);
      }
      body.append(controls);
      if (!series?.labels.length) body.append(node("p", "td-chart-empty", noValues(metric, series)));
      else {
        const stage = node("div", "td-chart-stage td-detail-chart"); body.append(stage); addDrawing(stage, {...series, label: title(metric.label), unit: text(selected.unit || metric.unit)}, typeFor(metric, series), palette(metric.id));
        const heading = node("div", "td-table-heading"); heading.append(node("h3", "", "Точные значения"), node("p", "", "Сохранённые значения без суммирования. Пропуски не заменены нулями.")); body.append(heading);
        const wrap = node("div", "td-table-wrap"), table = node("table", "td-values"), head = node("thead"), row = node("tr"), tableBody = node("tbody");
        const unit = text(selected.unit || metric.unit);
        [isTime(series) ? "Период" : "Категория", unit ? `Значение, ${unit}` : "Значение"].forEach(value => { const cell = node("th", "", value); cell.scope = "col"; row.append(cell); }); head.append(row);
        series.labels.forEach((label, index) => { const row = node("tr"); row.append(node("td", "", isTime(series) ? periodTitle(label) : label), node("td", "", numeric(series.values[index]) ? exact.format(series.values[index]) : "Нет значения")); tableBody.append(row); });
        table.append(head, tableBody); wrap.append(table); body.append(wrap);
      }
      body.append(dependencies(metric, selected));
    }
    function openMetric(id, returnFocus) {
      closeModal(false);
      const metric = metrics().find(item => item.id === id); if (!metric) return;
      const dialog = node("dialog", "td-detail-dialog"), header = node("header", "td-detail-header"), info = node("div"), heading = node("h2", "", title(metric.label));
      heading.id = "td-detail-title"; info.append(node("p", "td-kicker", title(metric.group) || "Показатель модели"), heading);
      dialog.setAttribute("aria-labelledby", heading.id);
      const actions = node("div", "td-detail-actions"), discuss = button("Обсудить показатель", "td-button td-button-primary"), close = button("Закрыть");
      discuss.addEventListener("click", () => discussMetric(metric)); close.addEventListener("click", () => closeModal()); actions.append(discuss, close); header.append(info, actions);
      const body = node("div", "td-detail-body"); dialog.append(header, body); root.append(dialog); modal = {dialog, body, metricId: id, returnFocus};
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeModal(); }); dialog.addEventListener("close", () => { if (modal?.dialog === dialog) closeModal(); });
      dialog.showModal(); renderModal(); close.focus({preventScroll: true});
    }
    async function discussMetric(metric) {
      const series = selectedSeries(metric), selected = subset(series), last = point(selected);
      const context = [`Разбери показатель «${text(metric.label)}» модели «${text(state.data?.model?.title || "выбранная модель")}»`, `сценарий: ${scenarioTitle(state.scenario)}`];
      if (series?.label && series.label !== metric.label) context.push(`разрез: ${text(series.label)}`);
      if (last && isTime(selected)) context.push(`период: ${periodTitle(last.label)}`);
      const question = context.join(". ") + ". Объясни значения, динамику и расчётные связи по данным выбранной версии модели.";
      closeModal(false);
      try { options.onMode?.("analysis"); await options.ask?.(question, {
        metric_id: metric.id, series_id: series?.id || "", source_sha256: state.data?.source?.sha256 || "", label: text(metric.label),
        period: last && isTime(selected) ? last.label : ""
      }); }
      catch (error) { state.error = text(error.message || error); render(); }
    }
    refreshButton.addEventListener("click", refresh); composeButton.addEventListener("click", () => compose());
    scenarioSelect.addEventListener("change", () => { state.scenario = scenarioSelect.value; state.series.clear(); setFilters(); renderContent(); });
    periodSelect.addEventListener("change", () => { state.period = periodSelect.value; renderContent(); });
    searchInput.addEventListener("input", () => { state.search = searchInput.value; renderContent(); });
    window.addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(redraw); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopSnapshotPolling();
      else if (state.visible) scheduleSnapshotPoll(0);
    });
    render();
    return {
      constraintPanel,
      setChat(chat) {
        const before = chatId(); state.chat = chat;
        if (before === chatId()) return;
        stopSnapshotPolling();
        requestEpoch++; pollEpoch++; state.data = null; state.loading = false; state.composing = false; state.error = ""; state.snapshotError = ""; state.scenario = null; state.period = "all"; state.search = ""; state.series.clear(); state.types.clear(); searchInput.value = ""; closeModal(false); render();
        if (state.visible && chatId()) refresh();
      },
      show() {
        const wasVisible = state.visible; state.visible = true; root.hidden = false;
        if (!state.data && !state.loading && chatId()) refresh();
        else {
          render(); requestAnimationFrame(redraw); maybeAutoCompose();
          if (!wasVisible) scheduleSnapshotPoll(0);
          else if (!snapshotTimer && !snapshotAbort) scheduleSnapshotPoll();
        }
      },
      hide() { state.visible = false; root.hidden = true; stopSnapshotPolling(); pollEpoch++; state.composing = false; closeModal(false); },
      refresh,
    };
  }
  return {mount, renderChart: chart};
})();
