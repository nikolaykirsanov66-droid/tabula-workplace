"use strict";

window.TabulaCharts = (() => {
  const NS = "http://www.w3.org/2000/svg", memory = new Map();
  const number = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const compact = new Intl.NumberFormat("ru-RU", {notation: "compact", maximumFractionDigits: 1});
  const theme = {primary: "var(--chart-primary, var(--blue, #186dc9))", text: "var(--ink, #1c1c1f)",
    muted: "var(--muted, #66666e)", line: "var(--line, #e8e8e8)", surface: "var(--surface, #ffffff)"};
  const colors = [theme.primary, "#cfb300", "#26834a", "#9553b3", "#c64845", "#308c9e", "#b66a26", "#6d759c", "#c35f8a", "#527c33", "#4d4f57", "#a98362"];
  const presentText = value => window.TabulaPresentation?.text?.(value) ?? String(value ?? "");
  const presentTitle = value => window.TabulaPresentation?.title?.(value) ?? presentText(value);
  function displayLabels(series) {
    if (series.kind !== "time" || !series.labels.every(label => /^\d{4}-\d{2}(?:$|-\d{2}(?:T|$))/.test(label))) return series.labels.map(presentText);
    const dates = series.labels.map(label => new Date(/^\d{4}-\d{2}$/.test(label) ? label + "-01T00:00:00Z" : label));
    if (dates.some(date => !Number.isFinite(date.getTime()))) return series.labels.map(presentText);
    const months = new Set(series.labels.map(label => label.slice(0, 7)));
    const years = new Set(series.labels.map(label => label.slice(0, 4)));
    const options = months.size === series.labels.length ? {month: "short", ...(years.size > 1 ? {year: "2-digit"} : {})} : {day: "2-digit", month: "short", ...(years.size > 1 ? {year: "2-digit"} : {})};
    return dates.map(date => date.toLocaleDateString("ru-RU", {...options, timeZone: "UTC"}));
  }
  function node(tag, cls, text) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text != null) item.textContent = presentText(text);
    return item;
  }
  function sv(tag, attrs = {}, text) {
    const item = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
    if (text != null) item.textContent = presentText(text);
    return item;
  }
  function domainFor(values) {
    let low = Math.min(0, ...values), high = Math.max(0, ...values);
    if (low === high) high = low + 1;
    const rough = (high - low) / 4, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(value => value * power).find(value => value >= rough) || power * 10;
    low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
    const ticks = [];
    for (let i = 0; i < 9 && low + i * step <= high + step * 0.01; i++) ticks.push(low + i * step);
    return {low, high, ticks};
  }
  function draw(stage, series, type) {
    stage.replaceChildren();
    const width = Math.max(300, Math.round(stage.clientWidth || 760));
    const height = type === "donut" && width < 520 ? Math.max(340, 220 + series.labels.length * 20) : width < 440 ? 310 : 340;
    const labels = displayLabels(series);
    const title = presentTitle(series.title), unit = presentText(series.unit);
    const svg = sv("svg", {viewBox: `0 0 ${width} ${height}`, width: "100%", height, role: "img",
      "aria-label": `${title}: ${series.labels.length} значений`, "font-family": "Arial, sans-serif"});
    svg.append(sv("title", {}, title), sv("desc", {}, `${series.kind === "time" ? "Динамика показателя по периодам" : "Сравнение значений по категориям"}${unit ? ". Единица: " + unit : ""}.`), sv("rect", {width, height, fill: theme.surface}));
    const tooltip = node("div", "chart-tooltip"); tooltip.hidden = true; tooltip.setAttribute("role", "status");
    function tip(index, x, y) {
      tooltip.replaceChildren(node("strong", "", labels[index]), node("span", "", `${number.format(series.values[index])}${unit ? " " + unit : ""}`));
      tooltip.hidden = false;
      tooltip.style.left = Math.min(Math.max(8, width - (tooltip.offsetWidth || 180) - 8), Math.max(8, x - 75)) + "px";
      tooltip.style.top = Math.max(4, y - (tooltip.offsetHeight || 80) - 12) + "px";
    }
    function interactive(group, index, x, y) {
      group.setAttribute("tabindex", "0"); group.setAttribute("role", "img");
      group.setAttribute("aria-label", `${labels[index]}: ${number.format(series.values[index])} ${unit}`);
      group.append(sv("title", {}, `${labels[index]}: ${number.format(series.values[index])} ${unit}`));
      for (const event of ["mouseenter", "focus", "click"]) group.addEventListener(event, () => tip(index, x, y));
      for (const event of ["mouseleave", "blur"]) group.addEventListener(event, () => { tooltip.hidden = true; });
      group.addEventListener("keydown", event => { if (event.key === "Escape") tooltip.hidden = true; });
    }
    if (type === "donut") {
      const total = series.values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
      const cx = width < 520 ? width / 2 : width * 0.3, cy = width < 520 ? 100 : height / 2, radius = width < 520 ? 78 : Math.min(112, width / 4), inner = radius * 0.66;
      let angle = -Math.PI / 2;
      series.values.forEach((value, index) => {
        if (!Number.isFinite(value) || value <= 0) return;
        const end = angle + value / total * Math.PI * 2;
        const point = (r, a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        const group = sv("g");
        if (value === total) group.append(sv("circle", {cx, cy, r: (radius + inner) / 2, fill: "none", stroke: colors[index % colors.length], "stroke-width": radius - inner}));
        else group.append(sv("path", {d: `M${point(radius, angle)} A${radius},${radius} 0 ${end - angle > Math.PI ? 1 : 0} 1 ${point(radius, end)} L${point(inner, end)} A${inner},${inner} 0 ${end - angle > Math.PI ? 1 : 0} 0 ${point(inner, angle)} Z`, fill: colors[index % colors.length], stroke: theme.surface, "stroke-width": 2}));
        interactive(group, index, cx, cy); svg.append(group); angle = end;
      });
      svg.append(sv("text", {x: cx, y: cy - 5, "text-anchor": "middle", fill: theme.text, "font-size": 22, "font-weight": 650}, compact.format(total)), sv("text", {x: cx, y: cy + 19, "text-anchor": "middle", fill: theme.muted, "font-size": 12}, unit || "Всего"));
      labels.forEach((label, index) => {
        const yy = width < 520 ? 218 + index * 20 : 34 + index * Math.min(25, (height - 60) / series.labels.length);
        const xx = width < 520 ? 20 : width * 0.57;
        svg.append(sv("rect", {x: xx, y: yy - 9, width: 9, height: 9, rx: 2, fill: colors[index % colors.length]}), sv("text", {x: xx + 17, y: yy, fill: theme.muted, "font-size": 12}, String(label).slice(0, width < 520 ? 20 : 25) + " · " + number.format(series.values[index] / total * 100) + "%"));
      });
    } else {
      const left = width < 440 ? 54 : 70, right = 20, top = 24, bottom = height - 46;
      const pw = width - left - right, ph = bottom - top;
      const domain = domainFor(series.values.filter(value => Number.isFinite(value)));
      const x = index => left + pw * (index + 0.5) / series.labels.length;
      const y = value => top + (domain.high - value) / (domain.high - domain.low) * ph;
      domain.ticks.forEach(value => svg.append(sv("line", {x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: theme.line, "stroke-width": 1, class: "chart-grid"}), sv("text", {x: left - 12, y: y(value) + 4, "text-anchor": "end", fill: theme.muted, "font-size": 12, class: "chart-axis-label"}, compact.format(value))));
      svg.append(sv("line", {x1: left, x2: width - right, y1: y(0), y2: y(0), stroke: theme.line, "stroke-width": 1}));
      const every = Math.max(1, Math.ceil(series.labels.length / Math.max(3, Math.floor(pw / 72))));
      labels.forEach((label, index) => {
        if (index % every !== 0 && index !== series.labels.length - 1) return;
        if (index === series.labels.length - 1 && index % every !== 0 && index % every < every / 2) return;
        svg.append(sv("text", {x: x(index), y: bottom + 25, "text-anchor": "middle", fill: theme.muted, "font-size": 12, class: "chart-axis-label"}, String(label).length > 16 ? String(label).slice(0, 14) + "…" : label));
      });
      if (type === "line" || type === "area") {
        const segments = []; let segment = [];
        series.values.forEach((value, index) => { if (Number.isFinite(value)) segment.push([x(index), y(value)]); else if (segment.length) { segments.push(segment); segment = []; } });
        if (segment.length) segments.push(segment);
        segments.forEach(points => {
          const d = points.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
          svg.append(sv("path", {d: `${d} L${points.at(-1)[0]},${y(0)} L${points[0][0]},${y(0)} Z`, fill: theme.primary, opacity: type === "area" ? 0.18 : 0.045, class: "chart-area"}), sv("path", {d, fill: "none", stroke: theme.primary, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round", class: "chart-line"}));
        });
      }
      series.values.forEach((value, index) => {
        if (!Number.isFinite(value)) return;
        const group = sv("g");
        if (type === "bar") {
          const w = Math.max(2, Math.min(46, pw / series.labels.length * 0.62));
          group.append(sv("rect", {x: x(index) - w / 2, y: Math.min(y(value), y(0)), width: w, height: Math.max(1, Math.abs(y(value) - y(0))), rx: 3, fill: theme.primary, opacity: 0.86, class: "chart-bar"}));
        } else group.append(sv("circle", {cx: x(index), cy: y(value), r: 14, fill: "transparent"}), sv("circle", {cx: x(index), cy: y(value), r: 4.5, fill: theme.primary, stroke: theme.surface, "stroke-width": 2, class: "chart-dot"}));
        interactive(group, index, x(index), y(value)); svg.append(group);
      });
    }
    stage.append(svg, tooltip); return svg;
  }
  const hasNumbers = task => (task.steps || []).some(step => step.status === "completed" &&
    ((Array.isArray(step.data?.cells) && step.data.cells.filter(cell => typeof cell.value === "number" && Number.isFinite(cell.value)).length >= 2) ||
      (Array.isArray(step.data?.graph_series?.datasets) && step.data.graph_series.datasets.some(series =>
        Array.isArray(series.records) && series.records.filter(point => typeof point.value === "number" && Number.isFinite(point.value)).length >= 2))));
  const nativeChartAvailable = task => task.kind === "analysis" && !task.chart_only && !!task.tabula_context;
  const validCharts = list => Array.isArray(list) ? list.filter(series => series && Array.isArray(series.labels) && Array.isArray(series.values) && series.labels.length === series.values.length && series.values.filter(value => typeof value === "number" && Number.isFinite(value)).length >= 2 && series.source &&
    (Array.isArray(series.value_cells) || (series.source.kind === "tabula_graph" && Array.isArray(series.provenance) && series.provenance.length === series.values.length &&
      series.provenance.every(point => Array.isArray(point.source_node_ids) && point.source_node_ids.length > 0)))) : [];
  function build(task, options) {
    if (!["completed", "needs_review"].includes(task.status)) return null;
    const existing = validCharts(task.result?.visualizations);
    if (!existing.length && !hasNumbers(task) && !nativeChartAvailable(task)) return null;
    let saved = memory.get(task.id);
    if (!saved) { saved = {open: false, charts: existing, selected: null, override: null, tableOpen: false, loading: false, error: ""}; memory.set(task.id, saved); }
    saved.closeExpanded?.(false);
    if (existing.length) saved.charts = existing;
    const root = node("div", "message-charts"), actions = node("div", "message-actions");
    saved.root = root;
    const graph = node("button", "chart-toggle text-button", "График"), tableButton = node("button", "chart-toggle text-button", "Таблица");
    graph.type = tableButton.type = "button";
    const expand = node("button", "chart-expand text-button", "Развернуть график"); expand.type = "button";
    expand.setAttribute("aria-haspopup", "dialog"); expand.setAttribute("aria-expanded", "false");
    const panel = node("section", "chart-panel"); panel.id = `chart-${task.id}`; panel.hidden = !saved.open; panel.setAttribute("aria-label", "Визуализация данных");
    graph.setAttribute("aria-controls", panel.id); graph.setAttribute("aria-expanded", String(saved.open));
    actions.append(graph, tableButton, expand); root.append(actions, panel);
    let dialog = null;
    function closeExpanded(restoreFocus = true) {
      if (!dialog) return;
      const closing = dialog; dialog = null;
      if (closing.open) closing.close();
      root.append(panel); closing.remove(); saved.closeExpanded = null;
      expand.setAttribute("aria-expanded", "false");
      if (root.isConnected) {
        refresh();
        if (restoreFocus) expand.focus({preventScroll: true});
      }
    }
    function openExpanded() {
      if (dialog || !saved.charts.length) return;
      saved.open = true;
      dialog = node("dialog", "chart-fullscreen-dialog");
      const heading = node("h2", "", "График и данные"); heading.id = `chart-dialog-title-${task.id}`;
      dialog.setAttribute("aria-labelledby", heading.id);
      const toolbar = node("header", "chart-fullscreen-toolbar"), buttons = node("div", "chart-fullscreen-actions");
      const toChart = node("button", "text-button", "К графику"), toTable = node("button", "text-button", "Таблица"), close = node("button", "text-button", "Закрыть");
      for (const button of [toChart, toTable, close]) button.type = "button";
      toChart.addEventListener("click", () => panel.querySelector(".chart-stage")?.scrollIntoView({block: "start"}));
      toTable.addEventListener("click", () => {
        saved.tableOpen = true;
        const table = panel.querySelector(".chart-data");
        if (table) { table.open = true; table.scrollIntoView({block: "start"}); }
      });
      close.addEventListener("click", () => closeExpanded());
      buttons.append(toChart, toTable, close); toolbar.append(heading, buttons);
      const body = node("div", "chart-fullscreen-body"); body.append(panel);
      dialog.append(toolbar, body); root.append(dialog);
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeExpanded(); });
      dialog.addEventListener("close", event => { if (dialog === event.currentTarget) closeExpanded(); });
      saved.closeExpanded = closeExpanded;
      expand.setAttribute("aria-expanded", "true");
      dialog.showModal(); refresh(); close.focus({preventScroll: true});
    }
    expand.addEventListener("click", openExpanded);
    function refresh() {
      if (!root.isConnected && saved.refresh !== refresh) return;
      graph.textContent = saved.loading ? "Подбираю график…" : "График";
      graph.disabled = tableButton.disabled = saved.loading;
      expand.hidden = !saved.charts.length; expand.disabled = saved.loading;
      panel.hidden = !saved.open; graph.setAttribute("aria-expanded", String(saved.open));
      panel.replaceChildren();
      if (saved.loading) { const msg = node("p", "chart-empty", "Готовим график по вашему запросу…"); msg.setAttribute("role", "status"); panel.append(msg); return; }
      if (saved.error) { panel.append(node("p", "chart-empty", presentText(saved.error))); return; }
      if (!saved.charts.length) return;
      const series = saved.charts.find(item => item.id === saved.selected) || saved.charts[0]; saved.selected = series.id;
      const type = saved.override || series.chart_type;
      const heading = node("div", "chart-heading"); heading.append(node("h3", "", presentTitle(series.title)), node("p", "", presentText(series.explanation || "Показатель выбранной модели")));
      const controls = node("div", "chart-controls"), label = node("label", "", "Показатель"), select = node("select", "chart-series-select");
      select.setAttribute("aria-label", "Показатель для графика");
      saved.charts.forEach(item => { const option = node("option", "", presentTitle(item.title)); option.value = item.id; select.append(option); }); select.value = series.id;
      select.addEventListener("change", () => { saved.selected = select.value; saved.override = null; refresh(); }); label.append(select); controls.append(label);
      const types = node("div", "chart-type-group"); types.setAttribute("role", "group"); types.setAttribute("aria-label", "Вид графика");
      for (const [key, title] of [["line", "Линия"], ["bar", "Столбцы"], ["area", "Область"], ["donut", "Доли"]]) {
        if ((key === "line" || key === "area") && series.kind !== "time") continue;
        if (key === "donut" && (series.kind === "time" || series.values.length > 12 || series.values.some(value => !Number.isFinite(value) || value < 0) || series.values.reduce((sum, value) => sum + value, 0) <= 0)) continue;
        const button = node("button", key === type ? "selected" : "", title); button.type = "button"; button.setAttribute("aria-pressed", String(key === type)); button.addEventListener("click", () => { saved.override = key; refresh(); }); types.append(button);
      }
      controls.append(types);
      const labels = displayLabels(series);
      const summary = node("div", "chart-summary"), valid = series.values.map((value, index) => ({value, label: labels[index]})).filter(item => Number.isFinite(item.value));
      const first = valid[0], last = valid.at(-1), change = first.value === 0 ? null : (last.value - first.value) / Math.abs(first.value) * 100;
      const kpis = series.kind === "time" ? [[first.label, number.format(first.value)], [last.label, number.format(last.value)], ["Изменение за период", change === null ? "—" : `${change > 0 ? "+" : ""}${number.format(change)}%`]] : [["Категорий", String(series.labels.length)], ["Минимум", number.format(Math.min(...valid.map(item => item.value)))], ["Максимум", number.format(Math.max(...valid.map(item => item.value)))]];
      kpis.forEach(([caption, value]) => { const kpi = node("div", "chart-kpi"); kpi.append(node("small", "", caption), node("strong", "", value)); summary.append(kpi); });
      const unitText = presentText(series.unit), unit = node("p", "chart-source", unitText ? `Единица: ${unitText}` : ""); unit.hidden = !unitText;
      const stage = node("div", "chart-stage");
      const data = node("details", "chart-data"); data.open = saved.tableOpen; data.append(node("summary", "", "Таблица значений")); data.addEventListener("toggle", () => { saved.tableOpen = data.open; });
      const wrap = node("div", "chart-table-wrap"), table = node("table", "chart-values-table"), thead = node("thead"), tbody = node("tbody"), tr = node("tr");
      [series.kind === "time" ? "Период" : "Категория", unitText ? `Значение, ${unitText}` : "Значение"].forEach(text => { const th = node("th", "", text); th.scope = "col"; tr.append(th); }); thead.append(tr);
      labels.forEach((text, index) => { const row = node("tr"); row.append(node("td", "", text), node("td", "", Number.isFinite(series.values[index]) ? number.format(series.values[index]) : "Нет значения")); tbody.append(row); }); table.append(thead, tbody); wrap.append(table); data.append(wrap);
      panel.append(heading, controls, summary, unit, stage, data);
      if (!panel.hidden) requestAnimationFrame(() => { if (stage.isConnected) draw(stage, series, type); });
    }
    saved.refresh = refresh;
    async function ensure() {
      saved.open = true;
      if (saved.charts.length) { saved.refresh(); return; }
      saved.loading = true; saved.error = ""; saved.refresh();
      try {
        let job = await options.request(`/v1/tasks/${task.id}/chart`, {method: "POST"});
        while (["queued", "running"].includes(job.status)) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          job = await options.request(`/v1/tasks/${job.id}`);
        }
        saved.charts = validCharts(job.result?.visualizations);
        if (!saved.charts.length) throw new Error(job.result?.summary || job.error || "Для графика не хватает сопоставимых числовых значений.");
      } catch (error) { saved.error = String(error.message || error); }
      finally { saved.loading = false; saved.refresh(); }
    }
    graph.addEventListener("click", () => { if (saved.open && saved.charts.length) { saved.open = false; saved.refresh(); } else ensure(); });
    tableButton.addEventListener("click", () => { saved.tableOpen = true; ensure(); });
    refresh();
    return root;
  }
  let resizeFrame;
  window.addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { for (const saved of memory.values()) if (saved.root?.isConnected && saved.open) saved.refresh(); }); });
  return {build};
})();
