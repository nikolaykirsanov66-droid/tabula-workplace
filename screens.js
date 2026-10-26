"use strict";

// Manual layouts refer only to observed catalog rows. Values are never summed
// or inferred here; the server owns model identity and calculated metrics.
window.TabulaScreens = (() => {
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const format = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const exact = new Intl.NumberFormat("ru-RU", {maximumSignificantDigits: 17});
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => typeof value === "string" ? (window.TabulaPresentation?.text?.(value) ?? value) : value == null ? "" : String(value);
  const title = value => window.TabulaPresentation?.title?.(value) ?? text(value);
  const uid = () => crypto.randomUUID().replaceAll("-", "");
  const types = [["line", "Линия"], ["bar", "Столбцы"], ["area", "Область"], ["kpi", "Показатель"], ["table", "Таблица"]];
  const mime = "application/x-tabula-screen-item";
  const technicalDimensions = new Set(["period", "period_granularity", "column_scenario", "source", "sheet", "row", "column", "cell", "document_id", "indicator_id", "series_id"]);
  const dimensionTitles = {project: "Проект", organization: "Организация", company: "Компания", customer: "Клиент", product: "Продукт", warehouse: "Склад", department: "Подразделение", segment: "Сегмент", region: "Регион", channel: "Канал"};
  const countWord = (count, one, few, many) => count % 100 >= 11 && count % 100 <= 14 ? many : count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many;
  const validSeries = series => series && typeof series.id === "string" && Array.isArray(series.labels) && Array.isArray(series.values) && series.labels.length === series.values.length && series.labels.every(label => typeof label === "string") && series.values.every(value => value == null || finite(value));
  function node(tag, cls = "", value) { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = text(value); return el; }
  function button(label, cls = "ts-button") { const el = node("button", cls, label); el.type = "button"; return el; }
  function option(value, label) { const el = node("option", "", label); el.value = value; return el; }
  function periodLabel(value) {
    if (!/^\d{4}-\d{2}(?:-\d{2}(?:T[^\s]+)?)?$/.test(value || "")) return text(value);
    const d = new Date(value.length === 7 ? value + "-01T00:00:00Z" : value.slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString("ru-RU", {month: "short", year: "numeric", ...(value.length > 7 ? {day: "numeric"} : {}), timeZone: "UTC"}) : text(value);
  }
  function lastPoint(series) { if (!series) return null; for (let index = series.values.length - 1; index >= 0; index--) if (finite(series.values[index])) return {label: series.labels[index], value: series.values[index], index}; return null; }
  function subset(series, widget) {
    if (series.kind !== "time") return {...series, labels: [...series.labels], values: [...series.values]};
    const first = widget.period_from ? series.labels.indexOf(widget.period_from) : 0, last = widget.period_to ? series.labels.indexOf(widget.period_to) : series.labels.length - 1;
    const indices = series.labels.map((label, index) => ({label, index})).filter(({index}) => index >= first && index <= last);
    return {...series, labels: indices.map(({label}) => label), values: indices.map(({index}) => series.values[index]),
      provenance: Array.isArray(series.provenance) ? indices.map(({index}) => series.provenance[index]) : []};
  }
  function seriesLabel(series, index = 0) {
    const values = Object.entries(series.dimensions || {}).filter(([key, value]) => !technicalDimensions.has(key) && typeof value === "string" && !/^[a-f0-9-]{32,36}$/i.test(value)).map(([, value]) => text(value));
    return [text(series.label), text(series.scenario), ...values].filter(Boolean).filter((value, i, all) => all.indexOf(value) === i).join(" · ") || `Разрез ${index + 1}`;
  }
  function seriesChoices(rows) {
    const labels = rows.map(seriesLabel), counts = new Map(); labels.forEach(label => counts.set(label, (counts.get(label) || 0) + 1));
    return rows.map((row, index) => {
      const ambiguous = counts.get(labels[index]) > 1, point = lastPoint(row);
      const label = ambiguous ? [`Неподписанный ряд ${index + 1}`, point ? format.format(point.value) + (row.unit ? " " + text(row.unit) : "") : "Нет числовых значений", point ? periodLabel(point.label) : ""].filter(Boolean).join(" · ") : labels[index];
      return {row, label, ambiguous};
    });
  }
  function dataWarnings(metric, series) {
    return [...new Set([...(Array.isArray(metric?.warnings) ? metric.warnings : []), ...(Array.isArray(series?.warnings) ? series.warnings : [])]
      .map(value => text(typeof value === "string" ? value : value?.message)).filter(Boolean))].slice(0, 5);
  }
  function appendWarnings(parent, metric, series) { const warnings = dataWarnings(metric, series); if (!warnings.length) return; const list = node("ul", "ts-data-warnings"); for (const warning of warnings) list.append(node("li", "", warning)); parent.append(list); }
  function mount(root, options) {
    const state = {chat: "", mode: "", data: null, screens: [], derived: [], active: "", dirty: false, loading: false, saving: false, error: "", notice: "", search: "", drag: null};
    let epoch = 0, editCounter = 0, modal = null, timer = null, resizeFrame = null;
    root.classList.add("tabula-screens"); root.hidden = true;
    const endpoint = () => `/v1/chats/${encodeURIComponent(state.chat)}/screens`;
    const visible = () => state.mode === "screens" && !!state.chat;
    const metrics = () => Array.isArray(state.data?.catalog?.metrics) ? state.data.catalog.metrics : [];
    const screen = () => state.screens.find(item => item.id === state.active) || state.screens[0];
    const metricFor = widget => metrics().find(item => item.id === widget.metric_id);
    const seriesFor = (metric, id) => (metric?.series || []).find(item => item.id === id && validSeries(item));
    function stopPolling() { clearTimeout(timer); timer = null; }
    function schedulePoll() { stopPolling(); if (visible()) timer = setTimeout(() => { if (!state.dirty && !state.saving && !modal) refresh({background: true}); else schedulePoll(); }, 60000); }
    function closeModal() { if (!modal) return; if (modal.open) modal.close(); modal.remove(); modal = null; }
    function errorText(error) { return text(error?.message || "Не удалось сохранить экран. Попробуйте ещё раз."); }
    function markChanged() { editCounter++; state.dirty = true; state.notice = ""; state.error = ""; }
    function allowLeave() {
      if (state.saving) { state.notice = "Дождитесь завершения сохранения экранов."; render(); return false; }
      if (!state.dirty) return true;
      if (!window.confirm("На экранах есть несохранённые изменения. Продолжить без сохранения?")) return false;
      if (state.data) adopt(state.data); else state.dirty = false;
      return true;
    }
    function validate(data) {
      if (data?.schema !== "tabula-screens/v1" || !Array.isArray(data.screens) || !Array.isArray(data.catalog?.metrics) || typeof data.source_key !== "string" || !Number.isInteger(data.revision)) throw Error("Не удалось прочитать сохранённые экраны.");
      return data;
    }
    function adopt(data) {
      state.data = validate(data); state.screens = copy(data.screens); state.derived = copy(data.derived_metrics || []);
      if (!state.screens.some(item => item.id === state.active)) state.active = state.screens[0]?.id || "";
      state.dirty = false;
    }
    async function refresh({background = false} = {}) {
      if (!visible() || state.loading || state.saving) return;
      if (!background && state.dirty && !allowLeave()) return;
      const generation = ++epoch, editsAtRequest = editCounter, chat = state.chat; state.loading = !background; state.error = ""; if (!background) render();
      try {
        const data = validate(await options.request(endpoint()));
        if (generation !== epoch || chat !== state.chat) return;
        if (editCounter !== editsAtRequest || state.dirty) { state.notice = "Во время обновления появились правки. Они остались на экране; сохраните их перед следующим обновлением."; return; }
        adopt(data); state.notice = background && data.catalog_changed ? "Данные модели обновились. Проверьте доступность выбранных показателей." : "";
      } catch (error) { if (generation === epoch && chat === state.chat) state.error = errorText(error); }
      finally { if (generation === epoch && chat === state.chat) { state.loading = false; render(); schedulePoll(); } }
    }
    function widgetProblem(widget) {
      if (widget.availability?.available === false) return text(widget.availability.reason) || "Показатель изменился. Выберите его заново.";
      const metric = metricFor(widget), series = seriesFor(metric, widget.series_id);
      if (!metric) return "Показателя больше нет в выбранном снимке. Выберите его заново.";
      if (!series) return "Выберите один разрез показателя в настройках карточки.";
      if (series.kind !== "time" && ["line", "area", "kpi"].includes(widget.chart_type)) return "Для категорий выберите столбцы или таблицу. Итог по разным категориям не рассчитывается.";
      if (widget.period_from && !series.labels.includes(widget.period_from) || widget.period_to && !series.labels.includes(widget.period_to)) return "Выбранный период больше не найден. Проверьте настройки карточки.";
      if (widget.period_from && widget.period_to && series.labels.indexOf(widget.period_from) > series.labels.indexOf(widget.period_to)) return "Начало периода должно быть раньше окончания.";
      return "";
    }
    function canSave() { return state.dirty && state.data && !state.loading && !state.saving && !state.screens.some(item => !item.title.trim() || item.widgets.some(widget => !widget.series_id)); }
    function cleanedScreens() { return state.screens.map(item => ({id: item.id, title: item.title.trim(), widgets: item.widgets.map(widget => {
      const clean = {...widget}; delete clean.availability; return clean;
    })})); }
    async function save() {
      if (!canSave()) return false;
      const generation = ++epoch, chat = state.chat; state.saving = true; state.error = ""; state.notice = ""; render();
      try {
        const data = await options.request(endpoint(), {method: "POST", json: {expected_revision: state.data.revision, source_key: state.data.source_key, screens: cleanedScreens(), derived_metrics: copy(state.derived)}});
        if (generation !== epoch || chat !== state.chat) return false;
        adopt(data?.schema === "tabula-screens/v1" ? data : await options.request(endpoint())); state.notice = "Экраны сохранены."; return true;
      } catch (error) {
        if (generation === epoch && chat === state.chat) state.error = error?.status === 409 ? "Сохранённая версия или данные модели уже изменились. Ваши правки остались на экране. Обновите данные и повторите настройку." : errorText(error);
        return false;
      } finally { if (generation === epoch && chat === state.chat) { state.saving = false; render(); schedulePoll(); } }
    }
    function newScreen() {
      if (state.saving) return;
      if (state.screens.length >= 20) { state.error = "Можно создать до 20 экранов."; render(); return; }
      let index = 1; while (state.screens.some(item => item.title === `Экран ${index}`)) index++;
      const item = {id: uid(), title: `Экран ${index}`, widgets: []}; state.screens.push(item); state.active = item.id; markChanged(); render();
    }
    function dialogBase(name) {
      closeModal(); const dialog = node("dialog", "ts-dialog"), header = node("header", "ts-dialog-header"), heading = node("h2", "", name), close = button("×", "ts-close");
      heading.id = "ts-dialog-title"; dialog.setAttribute("aria-labelledby", heading.id); close.setAttribute("aria-label", "Закрыть настройки"); close.addEventListener("click", closeModal);
      header.append(heading, close); dialog.append(header); dialog.addEventListener("cancel", event => { event.preventDefault(); closeModal(); }); document.body.append(dialog); modal = dialog; return dialog;
    }
    function renameScreen(item) {
      if (state.saving) return;
      const dialog = dialogBase("Название экрана"), form = node("form", "ts-rename-form"), label = node("label", "ts-field", "Название"), input = node("input"); input.value = item.title; input.maxLength = 100; input.required = true; label.append(input);
      const actions = node("div", "ts-dialog-actions"), cancel = button("Отмена"), accept = button("Переименовать", "ts-button ts-primary"); accept.type = "submit"; actions.append(cancel, accept); form.append(label, actions); dialog.append(form); cancel.addEventListener("click", closeModal);
      form.addEventListener("submit", event => { event.preventDefault(); if (!input.value.trim()) return; item.title = input.value.trim(); markChanged(); closeModal(); render(); }); dialog.showModal(); input.select();
    }
    function deleteScreen(item) { if (state.saving || !window.confirm(`Удалить экран «${item.title}»?`)) return; state.screens = state.screens.filter(value => value.id !== item.id); if (state.active === item.id) state.active = state.screens[0]?.id || ""; markChanged(); render(); }
    function addMetric(metricId, target = screen(), at = null) {
      if (state.saving) return;
      const metric = metrics().find(item => item.id === metricId); if (!metric || !target) return;
      if (target.widgets.length >= 24 || state.screens.reduce((sum, item) => sum + item.widgets.length, 0) >= 200) { state.error = "На одном экране доступно до 24 карточек."; render(); return; }
      const available = (metric.series || []).filter(validSeries), selected = available.length === 1 ? available[0] : null;
      const widget = {id: uid(), metric_id: metric.id, series_id: selected?.id || "", title: "", chart_type: selected?.kind === "time" ? "line" : "bar", width: "half", period_from: "", period_to: ""};
      target.widgets.splice(at === null ? target.widgets.length : at, 0, widget); state.active = target.id; markChanged(); render(); if (!selected) editWidget(widget);
    }
    function moveWidget(widgetId, fromId, target, at) {
      if (state.saving) return;
      const origin = state.screens.find(item => item.id === fromId), index = origin?.widgets.findIndex(item => item.id === widgetId);
      if (!origin || index < 0 || !target || origin !== target && target.widgets.length >= 24) return;
      const [widget] = origin.widgets.splice(index, 1); if (origin === target && index < at) at--; target.widgets.splice(Math.max(0, Math.min(at, target.widgets.length)), 0, widget); state.active = target.id; markChanged(); render();
    }
    function setDrag(event, payload) { if (state.saving || !event.dataTransfer) { event.preventDefault(); return; } const data = {...payload, chat: state.chat, source_key: state.data.source_key}; event.dataTransfer.setData(mime, JSON.stringify(data)); event.dataTransfer.effectAllowed = payload.kind === "metric" ? "copy" : "move"; state.drag = data; root.classList.add("ts-dragging"); }
    function clearDrag() { state.drag = null; root.classList.remove("ts-dragging"); root.querySelectorAll(".ts-drop-over").forEach(item => item.classList.remove("ts-drop-over")); }
    function receiveDrop(event, target, at) {
      event.preventDefault(); event.stopPropagation(); let data;
      try { data = JSON.parse(event.dataTransfer?.getData(mime) || "null"); } catch (_) { clearDrag(); return; }
      if (!data || data.chat !== state.chat || data.source_key !== state.data?.source_key || !target) { clearDrag(); return; }
      if (data.kind === "metric") addMetric(data.metric_id, target, at);
      else if (data.kind === "widget") moveWidget(data.widget_id, data.screen_id, target, at);
      clearDrag();
    }
    function dropTarget(el, target, at) {
      el.addEventListener("dragover", event => { if (!event.dataTransfer?.types.includes(mime)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = state.drag?.kind === "metric" ? "copy" : "move"; el.classList.add("ts-drop-over"); });
      el.addEventListener("dragleave", event => { if (!el.contains(event.relatedTarget)) el.classList.remove("ts-drop-over"); });
      el.addEventListener("drop", event => receiveDrop(event, target, at));
    }
    function editWidget(widget) {
      if (state.saving) return;
      const draft = copy(widget), dialog = dialogBase("Настройка карточки"), form = node("form", "ts-editor"), body = node("div", "ts-editor-body");
      let transientDimensions = {};
      function field(name, control) { const label = node("label", "ts-field", name); label.append(control); return label; }
      function redraw() {
        body.replaceChildren(); const metric = metricFor(draft), allSeries = (metric?.series || []).filter(validSeries), selected = seriesFor(metric, draft.series_id);
        const labelInput = node("input"); labelInput.maxLength = 100; labelInput.value = draft.title || ""; labelInput.placeholder = title(metric?.label) || "Название карточки"; labelInput.addEventListener("input", () => { draft.title = labelInput.value; }); body.append(field("Название карточки", labelInput));
        const metricSelect = node("select"); metricSelect.setAttribute("aria-label", "Метрика карточки"); metricSelect.append(option("", "Выберите метрику")); for (const item of metrics()) metricSelect.append(option(item.id, title(item.label))); metricSelect.value = draft.metric_id;
        metricSelect.addEventListener("change", () => { draft.metric_id = metricSelect.value; const found = metricFor(draft), choices = (found?.series || []).filter(validSeries); draft.series_id = choices.length === 1 ? choices[0].id : ""; draft.period_from = draft.period_to = ""; delete draft.availability; transientDimensions = {}; redraw(); }); body.append(field("Метрика", metricSelect));
        const dimensions = new Map();
        for (const row of allSeries) for (const [key, value] of Object.entries(row.dimensions || {})) {
          if (technicalDimensions.has(key) || typeof value !== "string" || !value || /^[a-f0-9-]{32,36}$/i.test(value)) continue;
          if (!dimensions.has(key)) dimensions.set(key, new Set()); dimensions.get(key).add(value);
        }
        const filterBox = node("div", "ts-dimension-fields");
        const scenarios = [...new Set(allSeries.map(item => item.scenario || ""))];
        if (scenarios.length > 1) {
          const scenario = node("select"); scenario.setAttribute("aria-label", "Сценарий карточки"); scenario.append(option("", "Все сценарии")); for (const value of scenarios.filter(Boolean)) scenario.append(option(value, value)); scenario.value = transientDimensions.__scenario ?? selected?.scenario ?? "";
          scenario.addEventListener("change", () => { transientDimensions.__scenario = scenario.value; const choices = matchingSeries(); if (!choices.some(item => item.id === draft.series_id)) draft.series_id = choices.length === 1 ? choices[0].id : ""; redraw(); }); filterBox.append(field("Сценарий", scenario));
        }
        for (const [key, values] of dimensions) {
          if (values.size < 2) continue; const input = node("select"); input.setAttribute("aria-label", dimensionTitles[key] || text(key)); input.append(option("", "Все значения")); for (const value of [...values].sort((a, b) => a.localeCompare(b, "ru"))) input.append(option(value, value)); input.value = transientDimensions[key] ?? selected?.dimensions?.[key] ?? "";
          input.addEventListener("change", () => { transientDimensions[key] = input.value; const choices = matchingSeries(); if (!choices.some(item => item.id === draft.series_id)) draft.series_id = choices.length === 1 ? choices[0].id : ""; redraw(); }); filterBox.append(field(dimensionTitles[key] || text(key), input));
        }
        function matchingSeries() { return allSeries.filter(row => Object.entries(transientDimensions).every(([key, value]) => !value || (key === "__scenario" ? row.scenario || "" : row.dimensions?.[key]) === value)); }
        if (filterBox.childElementCount) { body.append(node("h3", "ts-editor-section", "Измерения"), filterBox); }
        else body.append(node("p", "ts-help", "Дополнительные разрезы для этой метрики не заданы."));
        const choices = matchingSeries(), seriesSelect = node("select"); seriesSelect.setAttribute("aria-label", "Разрез карточки"); seriesSelect.append(option("", choices.length ? "Выберите один разрез" : "Нет подходящего разреза"));
        const labeledChoices = seriesChoices(choices); labeledChoices.forEach(({row, label}) => seriesSelect.append(option(row.id, label))); seriesSelect.value = draft.series_id;
        seriesSelect.addEventListener("change", () => { draft.series_id = seriesSelect.value; draft.period_from = draft.period_to = ""; delete draft.availability; if (seriesFor(metric, draft.series_id)?.kind !== "time" && ["line", "area", "kpi"].includes(draft.chart_type)) draft.chart_type = "bar"; redraw(); }); body.append(field("Ряд данных", seriesSelect));
        if (labeledChoices.some(item => item.ambiguous)) body.append(node("p", "ts-help", "Названия разрезов в модели не заданы; проверьте значения перед выбором."));
        const controls = node("div", "ts-config-row"), type = node("select"); type.setAttribute("aria-label", "Вид карточки");
        for (const [value, label] of types) { const el = option(value, label); el.disabled = selected && selected.kind !== "time" && ["line", "area", "kpi"].includes(value); type.append(el); } type.value = draft.chart_type; type.addEventListener("change", () => { draft.chart_type = type.value; }); controls.append(field("Вид", type));
        const width = node("select"); width.setAttribute("aria-label", "Ширина карточки"); width.append(option("half", "Половина экрана"), option("full", "На всю ширину")); width.value = draft.width; width.addEventListener("change", () => { draft.width = width.value; }); controls.append(field("Ширина", width)); body.append(controls);
        if (selected?.kind === "time") {
          const periods = node("div", "ts-config-row");
          for (const [key, name] of [["period_from", "Период с"], ["period_to", "Период по"]]) { const input = node("select"); input.setAttribute("aria-label", name); input.append(option("", key === "period_from" ? "С начала ряда" : "До конца ряда")); for (const value of selected.labels) input.append(option(value, periodLabel(value))); input.value = draft[key] || ""; input.addEventListener("change", () => { draft[key] = input.value; }); periods.append(field(name, input)); } body.append(periods);
        }
        if (!selected) body.append(node("p", "ts-inline-error", "Выберите один ряд данных. Разные проекты и сценарии не суммируются."));
      }
      const footer = node("div", "ts-dialog-actions"), cancel = button("Отмена"), apply = button("Применить", "ts-button ts-primary"); apply.type = "submit"; footer.append(cancel, apply); form.append(body, footer); dialog.append(form); cancel.addEventListener("click", closeModal);
      form.addEventListener("submit", event => { event.preventDefault(); const issue = widgetProblem({...draft, availability: undefined}); if (issue) { const old = body.querySelector(".ts-save-error"); old?.remove(); body.append(node("p", "ts-inline-error ts-save-error", issue)); return; } Object.assign(widget, draft); delete widget.availability; markChanged(); closeModal(); render(); });
      redraw(); dialog.showModal(); dialog.querySelector("input")?.focus();
    }
    function renderPalette() {
      const panel = node("aside", "ts-palette"), details = node("details", "ts-palette-details"); details.open = window.innerWidth > 760;
      const summary = node("summary", "ts-palette-heading", "Метрики и измерения"); details.append(summary);
      const content = node("div", "ts-palette-content"), helper = node("p", "ts-help", "Перетащите метрику на экран или нажмите +."), search = node("input", "ts-palette-search"); search.type = "search"; search.placeholder = "Найти метрику"; search.setAttribute("aria-label", "Найти метрику"); search.value = state.search;
      const create = button("+ Создать метрику", "ts-button ts-create-metric"); create.addEventListener("click", () => editDerived()); create.disabled = !state.data || state.saving;
      const list = node("div", "ts-palette-list");
      function listMetrics() {
        list.replaceChildren(); const query = state.search.trim().toLocaleLowerCase("ru"), found = metrics().filter(metric => !query || `${title(metric.label)} ${title(metric.group)}`.toLocaleLowerCase("ru").includes(query));
        for (const metric of found) {
          const row = node("div", "ts-metric-item"); row.draggable = true; row.dataset.metricId = metric.id; row.addEventListener("dragstart", event => setDrag(event, {kind: "metric", metric_id: metric.id})); row.addEventListener("dragend", clearDrag);
          const info = node("div", "ts-metric-info"), name = node("strong", "", title(metric.label)); info.append(name);
          const choices = (metric.series || []).filter(validSeries); info.append(node("span", "", `${choices.length} ${countWord(choices.length, "ряд", "ряда", "рядов")}${metric.unit ? " · " + metric.unit : ""}`));
          const add = button("+", "ts-icon-button"); add.setAttribute("aria-label", `Добавить метрику ${title(metric.label)}`); add.disabled = !screen() || state.saving; add.addEventListener("click", () => addMetric(metric.id)); row.append(info, add);
          const definition = state.derived.find(item => "cm:" + item.id === metric.id);
          if (definition) { const edit = button("⋯", "ts-icon-button"); edit.setAttribute("aria-label", `Изменить метрику ${title(metric.label)}`); edit.addEventListener("click", () => editDerived(definition)); row.append(edit); info.append(node("span", "ts-calculated-label", "Своя метрика")); }
          list.append(row);
        }
        if (!found.length) list.append(node("p", "ts-help", "По этому запросу метрик нет."));
      }
      search.addEventListener("input", () => { state.search = search.value; listMetrics(); }); listMetrics(); content.append(helper, search, create, list); details.append(content); panel.append(details); return panel;
    }
    function drawWidget(widget, stage, series) {
      const unit = text(series.unit || metricFor(widget)?.unit), selected = subset(series, widget), point = lastPoint(selected);
      if (widget.chart_type === "table") {
        const wrap = node("div", "ts-table-wrap"), table = node("table", "ts-data-table"), thead = node("thead"), head = node("tr"); head.append(node("th", "", series.kind === "time" ? "Период" : "Категория"), node("th", "", unit ? `Значение, ${unit}` : "Значение")); thead.append(head); const body = node("tbody"); selected.labels.forEach((label, index) => { const row = node("tr"); row.append(node("td", "", series.kind === "time" ? periodLabel(label) : label), node("td", "", finite(selected.values[index]) ? format.format(selected.values[index]) : "Нет значения")); body.append(row); }); table.append(thead, body); wrap.append(table); stage.append(wrap); return;
      }
      const measure = node("div", "ts-value"), value = node("strong", "", point ? format.format(point.value) : "—"); if (point) value.title = exact.format(point.value); measure.append(value); if (unit) measure.append(node("span", "", unit)); stage.append(measure);
      stage.append(node("p", "ts-value-period", point ? `${series.kind === "time" ? "Последнее значение · " + periodLabel(point.label) : point.label}${series.scenario ? " · " + text(series.scenario) : ""}` : "В выбранном срезе нет числовых значений."));
      if (widget.chart_type !== "kpi") { const chart = node("div", "ts-chart-stage td-chart-stage"); stage.append(chart); requestAnimationFrame(() => { if (!chart.isConnected) return; if (typeof window.TabulaDashboard?.renderChart === "function") window.TabulaDashboard.renderChart(chart, {...selected, unit, label: title(metricFor(widget)?.label)}, widget.chart_type, "#1875c8"); else chart.append(node("p", "ts-help", "График временно недоступен. Значение показателя показано выше.")); }); }
    }
    function widgetView(widget, item, index) {
      const metric = metricFor(widget), series = seriesFor(metric, widget.series_id), issue = widgetProblem(widget), card = node("article", "ts-widget" + (widget.width === "full" ? " ts-widget-full" : "")); card.dataset.widgetId = widget.id;
      const header = node("header", "ts-widget-header"), label = node("h3", "", widget.title || title(metric?.label) || "Показатель недоступен"), controls = node("div", "ts-widget-actions"), drag = button("⠿", "ts-drag-handle"); drag.draggable = true; drag.title = "Перетащить карточку"; drag.setAttribute("aria-label", `Перетащить карточку ${text(label.textContent)}`); drag.addEventListener("dragstart", event => { event.stopPropagation(); setDrag(event, {kind: "widget", widget_id: widget.id, screen_id: item.id}); }); drag.addEventListener("dragend", clearDrag);
      const up = button("↑", "ts-icon-button"), down = button("↓", "ts-icon-button"), edit = button("Настроить", "ts-link"), remove = button("×", "ts-icon-button ts-delete");
      up.setAttribute("aria-label", `Переместить выше: ${text(label.textContent)}`); down.setAttribute("aria-label", `Переместить ниже: ${text(label.textContent)}`); up.disabled = index === 0; down.disabled = index === item.widgets.length - 1;
      up.addEventListener("click", () => moveWidget(widget.id, item.id, item, index - 1)); down.addEventListener("click", () => moveWidget(widget.id, item.id, item, index + 2)); edit.setAttribute("aria-label", `Настроить карточку ${text(label.textContent)}`); edit.addEventListener("click", () => editWidget(widget)); remove.setAttribute("aria-label", `Удалить карточку ${text(label.textContent)}`); remove.addEventListener("click", () => { item.widgets = item.widgets.filter(value => value.id !== widget.id); markChanged(); render(); }); controls.append(up, down, edit, remove); header.append(drag, label, controls); card.append(header);
      const body = node("div", "ts-widget-body");
      if (issue) { body.append(node("p", "ts-widget-unavailable", issue)); const fix = button("Выбрать показатель", "ts-button"); fix.addEventListener("click", () => editWidget(widget)); body.append(fix); }
      else { drawWidget(widget, body, series); appendWarnings(body, metric, series); }
      card.append(body); dropTarget(card, item, index); return card;
    }
    function render() {
      root.hidden = state.mode !== "screens"; if (root.hidden) return; root.replaceChildren();
      const header = node("header", "ts-header"), heading = node("div"); heading.append(node("h2", "", "Сборка экранов"), node("p", "ts-subtitle", "Ваши показатели, разрезы и порядок карточек."));
      const actions = node("div", "ts-header-actions"), status = node("span", "ts-save-status" + (state.dirty ? " ts-unsaved" : ""), state.saving ? "Сохраняем…" : state.dirty ? "Есть изменения" : state.data?.updated_at ? "Сохранено" : ""), refreshButton = button("Обновить данные"), saveButton = button("Сохранить", "ts-button ts-primary"); refreshButton.disabled = state.loading || state.saving || !state.chat; saveButton.disabled = !canSave(); refreshButton.addEventListener("click", () => refresh()); saveButton.addEventListener("click", save); actions.append(status, refreshButton, saveButton); header.append(heading, actions); root.append(header);
      if (state.error) { const error = node("p", "ts-alert", state.error); error.setAttribute("role", "alert"); root.append(error); }
      if (state.notice) { const note = node("p", "ts-notice", state.notice); note.setAttribute("role", "status"); root.append(note); }
      if (state.loading) { root.append(node("div", "ts-loading", "Загружаем метрики и сохранённые экраны…")); return; }
      if (!state.chat) { root.append(node("div", "ts-empty", "Выберите модель, чтобы собрать свой экран.")); return; }
      if (!state.data) { if (!state.error) root.append(node("div", "ts-empty", "Данные экранов пока не получены.")); return; }
      const tabs = node("nav", "ts-tabs"); tabs.setAttribute("aria-label", "Мои экраны");
      for (const item of state.screens) { const tab = button(item.title, "ts-screen-tab" + (item.id === screen()?.id ? " selected" : "")); tab.dataset.screenId = item.id; tab.setAttribute("aria-pressed", String(item.id === screen()?.id)); tab.addEventListener("click", () => { state.active = item.id; render(); }); tab.addEventListener("dblclick", () => renameScreen(item)); dropTarget(tab, item, item.widgets.length); tabs.append(tab); }
      const addScreen = button("+ Экран", "ts-button ts-add-screen"); addScreen.disabled = state.screens.length >= 20 || state.saving; addScreen.addEventListener("click", newScreen); tabs.append(addScreen); root.append(tabs);
      const workspace = node("div", "ts-workspace"), palette = renderPalette(), canvas = node("section", "ts-canvas"), item = screen();
      if (!item) { const empty = node("div", "ts-empty ts-start"), create = button("Создать первый экран", "ts-button ts-primary"); create.addEventListener("click", newScreen); empty.append(node("div", "ts-empty-symbol", "+"), node("h3", "", "Соберите свой рабочий экран"), node("p", "", "Добавьте экран, затем перенесите на него нужные метрики."), create); canvas.append(empty); }
      else {
        const screenHeader = node("div", "ts-canvas-header"), info = node("div"); info.append(node("h3", "", item.title), node("p", "ts-help", `${item.widgets.length} ${countWord(item.widgets.length, "карточка", "карточки", "карточек")} · перетаскивайте за ⠿, чтобы менять порядок`)); const tools = node("div", "ts-canvas-actions"), rename = button("Переименовать", "ts-link"), remove = button("Удалить экран", "ts-link ts-danger"); rename.addEventListener("click", () => renameScreen(item)); remove.addEventListener("click", () => deleteScreen(item)); tools.append(rename, remove); screenHeader.append(info, tools); canvas.append(screenHeader);
        const grid = node("div", "ts-widget-grid"); grid.dataset.canvas = item.id;
        if (!item.widgets.length) { const empty = node("div", "ts-canvas-empty"); empty.append(node("span", "ts-empty-symbol", "+"), node("h4", "", "Перетащите сюда метрику"), node("p", "", "Или нажмите + рядом с её названием слева.")); dropTarget(empty, item, 0); grid.append(empty); }
        item.widgets.forEach((widget, index) => { const cell = node("div", "ts-widget-cell" + (widget.width === "full" ? " ts-widget-cell-full" : "")), slot = node("div", "ts-drop-slot"); slot.dataset.dropIndex = String(index); dropTarget(slot, item, index); cell.append(slot, widgetView(widget, item, index)); grid.append(cell); });
        if (item.widgets.length) { const last = node("div", "ts-drop-slot ts-drop-last", "Перетащите, чтобы добавить в конец"); last.dataset.dropIndex = String(item.widgets.length); dropTarget(last, item, item.widgets.length); grid.append(last); }
        canvas.append(grid);
      }
      workspace.append(palette, canvas); root.append(workspace);
      if (state.saving) root.querySelectorAll("button,input,select").forEach(item => { item.disabled = true; });
    }
    function editDerived(definition = null) {
      if (state.saving) return;
      const beforeDefinitions = copy(state.derived), wasDirty = state.dirty, draft = definition ? copy(definition) : {id: uid(), title: "", expression: "A / B * 100", format: "percent", operands: [{alias: "A", metric_id: "", series_id: ""}, {alias: "B", metric_id: "", series_id: ""}]};
      const dialog = dialogBase(definition ? "Изменить метрику" : "Создать метрику"), form = node("form", "ts-derived-form"), body = node("div", "ts-editor-body");
      let busy = false, feedback = null;
      function field(name, control) { const label = node("label", "ts-field", name); label.append(control); return label; }
      function candidates() { return metrics().filter(item => item.id !== "cm:" + draft.id); }
      function candidateDefinitions() { return [...state.derived.filter(item => item.id !== draft.id), copy(draft)]; }
      function updateFeedback(message, error = false) { if (feedback) { feedback.replaceChildren(); feedback.append(node("p", error ? "ts-inline-error" : "ts-help", message)); } }
      function redraw() {
        body.replaceChildren();
        const name = node("input"); name.maxLength = 100; name.required = true; name.value = draft.title; name.placeholder = "Например, маржинальность"; name.setAttribute("aria-label", "Название новой метрики"); name.addEventListener("input", () => { draft.title = name.value; }); body.append(field("Название метрики", name));
        body.append(node("h3", "ts-editor-section", "Из каких показателей считаем"), node("p", "ts-help", "Для каждой буквы выберите метрику и один её разрез."));
        const operandList = node("div", "ts-operands");
        draft.operands.forEach((operand, index) => {
          const row = node("section", "ts-operand"), badge = node("strong", "ts-operand-alias", operand.alias), controls = node("div", "ts-operand-controls"), metricSelect = node("select"); metricSelect.setAttribute("aria-label", `Метрика ${operand.alias}`); metricSelect.append(option("", "Выберите метрику")); for (const item of candidates()) metricSelect.append(option(item.id, title(item.label))); metricSelect.value = operand.metric_id;
          const selectedMetric = metrics().find(item => item.id === operand.metric_id), rows = (selectedMetric?.series || []).filter(validSeries), seriesSelect = node("select"); seriesSelect.setAttribute("aria-label", `Разрез ${operand.alias}`); seriesSelect.append(option("", "Выберите разрез")); const labeledRows = seriesChoices(rows); labeledRows.forEach(({row, label}) => seriesSelect.append(option(row.id, label))); seriesSelect.value = operand.series_id;
          metricSelect.addEventListener("change", () => { operand.metric_id = metricSelect.value; const found = metrics().find(item => item.id === operand.metric_id), choices = (found?.series || []).filter(validSeries); operand.series_id = choices.length === 1 ? choices[0].id : ""; delete operand.binding; redraw(); }); seriesSelect.addEventListener("change", () => { operand.series_id = seriesSelect.value; delete operand.binding; }); controls.append(field("Метрика", metricSelect), field("Разрез", seriesSelect)); if (labeledRows.some(item => item.ambiguous)) controls.append(node("p", "ts-help", "Названия разрезов в модели не заданы; проверьте значения перед выбором.")); row.append(badge, controls);
          if (draft.operands.length > 1 && index === draft.operands.length - 1) { const remove = button("×", "ts-icon-button"); remove.setAttribute("aria-label", `Удалить показатель ${operand.alias}`); remove.addEventListener("click", () => { draft.operands.pop(); redraw(); }); row.append(remove); }
          operandList.append(row);
        }); body.append(operandList);
        const add = button("+ Добавить показатель", "ts-link"); add.disabled = draft.operands.length >= 8; add.addEventListener("click", () => { draft.operands.push({alias: String.fromCharCode(65 + draft.operands.length), metric_id: "", series_id: ""}); redraw(); }); body.append(add);
        const templates = node("div", "ts-formula-templates");
        for (const [label, expression, mode] of [["Разница A − B", "A - B", "number"], ["Доля A / B × 100", "A / B * 100", "percent"], ["На единицу A / B", "A / B", "number"], ["Сумма A + B", "A + B", "number"]]) { const select = button(label, "ts-template"); select.addEventListener("click", () => { draft.expression = expression; draft.format = mode; redraw(); }); templates.append(select); }
        body.append(node("h3", "ts-editor-section", "Как считаем"), templates);
        const expression = node("input", "ts-expression"); expression.maxLength = 400; expression.required = true; expression.value = draft.expression; expression.setAttribute("aria-label", "Формула новой метрики"); expression.addEventListener("input", () => { draft.expression = expression.value; }); body.append(field("Формула", expression), node("p", "ts-help", "Используйте буквы выбранных показателей, +, −, *, / и скобки. Для доли в процентах укажите умножение на 100."));
        const formatSelect = node("select"); formatSelect.setAttribute("aria-label", "Формат новой метрики"); formatSelect.append(option("number", "Число"), option("percent", "Проценты")); formatSelect.value = draft.format; formatSelect.addEventListener("change", () => { draft.format = formatSelect.value; }); body.append(field("Формат результата", formatSelect));
        const preview = button("Проверить расчёт", "ts-button"); preview.disabled = busy; preview.addEventListener("click", previewMetric); feedback = node("div", "ts-preview"); feedback.setAttribute("role", "status"); body.append(preview, feedback);
      }
      function validateDefinition() { if (!draft.title.trim() || !draft.expression.trim() || draft.operands.some(item => !item.metric_id || !item.series_id)) { updateFeedback("Введите название, формулу и выберите ряд для каждого показателя.", true); return false; } return true; }
      async function previewMetric() {
        if (busy || !validateDefinition()) return; busy = true; updateFeedback("Проверяем формулу по выбранным данным…");
        const requestedDraft = JSON.stringify(draft);
        try {
          const data = await options.request(endpoint() + "/preview", {method: "POST", json: {expected_revision: state.data.revision, source_key: state.data.source_key, screens: cleanedScreens(), derived_metrics: candidateDefinitions()}});
          if (modal !== dialog) return;
          if (JSON.stringify(draft) !== requestedDraft) { updateFeedback("Формула или выбранные показатели изменились. Проверьте расчёт ещё раз."); return; }
          const failure = (data.calculation_errors || []).find(item => item.id === draft.id); if (failure) throw Error(failure.message || "Расчёт метрики не подтверждён.");
          const metric = data.catalog?.metrics?.find(item => item.id === "cm:" + draft.id), series = (metric?.series || []).find(validSeries); if (!series) throw Error("Для выбранных рядов нет сопоставимых значений. Проверьте периоды и разрезы.");
          feedback.replaceChildren(); const hasValues = series.values.some(finite); feedback.append(node("p", hasValues ? "ts-preview-success" : "ts-help", hasValues ? "Расчёт проверен. Предпросмотр:" : "Для этих исходных данных нет результата.")); const table = node("table", "ts-data-table"), head = node("tr"); head.append(node("th", "", series.kind === "time" ? "Период" : "Категория"), node("th", "", metric.unit ? `Значение, ${metric.unit}` : "Значение")); table.append(head); const start = Math.max(0, series.labels.length - 4); for (let i = start; i < series.labels.length; i++) { const row = node("tr"); row.append(node("td", "", series.kind === "time" ? periodLabel(series.labels[i]) : series.labels[i]), node("td", "", finite(series.values[i]) ? format.format(series.values[i]) : "Нет значения")); table.append(row); } feedback.append(table); appendWarnings(feedback, metric, series);
        } catch (error) { if (modal === dialog) updateFeedback(JSON.stringify(draft) !== requestedDraft ? "Формула или выбранные показатели изменились. Проверьте расчёт ещё раз." : errorText(error), JSON.stringify(draft) === requestedDraft); }
        finally { busy = false; }
      }
      const footer = node("div", "ts-dialog-actions"), cancel = button("Отмена"), accept = button(definition ? "Сохранить метрику" : "Создать и сохранить", "ts-button ts-primary"); accept.type = "submit"; footer.append(cancel, accept); form.append(body, node("p", "ts-derived-save-note", "Сохранятся метрика и текущие экраны этой модели."), footer); dialog.append(form); cancel.addEventListener("click", closeModal);
      if (definition) { const remove = button("Удалить метрику", "ts-link ts-danger"); remove.addEventListener("click", async () => { if (busy || !window.confirm(`Удалить метрику «${draft.title}»?`)) return; busy = true; state.derived = state.derived.filter(item => item.id !== draft.id); markChanged(); const ok = await save(); if (ok) closeModal(); else { state.derived = beforeDefinitions; state.dirty = wasDirty; updateFeedback(state.error || "Не удалось удалить метрику.", true); } busy = false; }); footer.prepend(remove); }
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (busy || !validateDefinition()) return; busy = true;
        const enabled = [...form.querySelectorAll("button,input,select")].filter(item => !item.disabled); enabled.forEach(item => { item.disabled = true; });
        state.derived = candidateDefinitions(); markChanged(); const ok = await save();
        if (ok) closeModal(); else { state.derived = beforeDefinitions; state.dirty = wasDirty; updateFeedback(state.error || "Не удалось сохранить метрику.", true); enabled.forEach(item => { item.disabled = false; }); }
        busy = false;
      });
      redraw(); dialog.showModal(); dialog.querySelector("input")?.focus();
    }
    window.addEventListener("resize", () => { if (!visible()) return; cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });
    window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
    return {
      setChat(chat) { const id = typeof chat === "string" ? chat : chat?.id || ""; if (id === state.chat) return true; if (!allowLeave()) return false; epoch++; stopPolling(); closeModal(); state.chat = id; state.data = null; state.screens = []; state.derived = []; state.active = ""; state.dirty = false; state.loading = false; state.saving = false; state.error = ""; state.notice = ""; state.search = ""; render(); if (visible()) refresh(); return true; },
      setMode(mode) { state.mode = mode; root.hidden = mode !== "screens"; if (mode !== "screens") { stopPolling(); closeModal(); return; } render(); if (!state.data && !state.loading && state.chat) refresh(); else schedulePoll(); },
      refresh, hasUnsavedChanges: () => state.dirty, canLeave: allowLeave,
    };
  }
  return {mount};
})();
