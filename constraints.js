"use strict";

// This is a view of a saved model and a Harness draft. IDs and source keys are
// used only for requests; they are never rendered as business descriptions.
window.TabulaConstraints = (() => {
  const isNumber = value => typeof value === "number" && Number.isFinite(value);
  const formatter = new Intl.NumberFormat("ru-RU", {maximumSignificantDigits: 15});
  const percentFormatter = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const text = value => {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return window.TabulaPresentation?.text?.(value) ?? String(value);
  };
  const number = value => isNumber(value) ? formatter.format(value) : "—";
  // Business labels for the existing workbook controls. These are display
  // aliases only: source titles, parameter IDs and numeric values stay intact.
  const parameterLabels = new Map([
    ["минимум объёма проекта к базе", {
      title: "Минимальный объём работ по проекту",
      description: "Ниже какого объёма нельзя опускаться по каждому проекту. Например, 90% — можно сократить работы не более чем на 10%."
    }],
    ["максимум объёма проекта к базе", {
      title: "Максимальный объём работ по проекту",
      description: "До какого объёма можно увеличить работы по каждому проекту. Например, 110% — рост не более чем на 10%."
    }],
    ["общая мощность к базовому объёму", {
      title: "Общий предел объёма работ",
      description: "Сколько работ можно запланировать по всем проектам вместе. Например, 105% — не более чем на 5% выше исходного плана."
    }],
    ["совокупный объём не ниже исходного", {
      title: "Минимальный объём работ компании",
      description: "Какой общий объём необходимо сохранить. Например, 100% — не меньше исходного плана по всем проектам вместе."
    }]
  ]);
  function parameterCopy(parameter) {
    const title = text(parameter.title) || "Параметр";
    return parameterLabels.get(title.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ")) || {title, description: ""};
  }
  function percent(value) {
    if (value > 0 && value < .005) return "<0,01";
    if (value > 100 && value < 100.005) return ">100";
    if (value < 100 && value > 99.995) return "<100";
    return percentFormatter.format(value);
  }
  const isChatId = value => typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
  function periodTitle(value) {
    const label = text(value);
    if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(label)) return label;
    const date = new Date(label + (label.length === 7 ? "-01" : "") + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, label.length) !== label) return label;
    return date.toLocaleDateString("ru-RU", {month: "long", year: "numeric", ...(label.length === 10 ? {day: "numeric"} : {}), timeZone: "UTC"});
  }
  function itemTitle(item) {
    const name = text(item.name) || "Ограничитель", period = text(item.period);
    if (period && name.endsWith(period)) {
      const shortened = name.slice(0, -period.length).replace(/[\s,·:—–-]+$/, "");
      if (shortened) return shortened;
    }
    return name;
  }
  const statuses = {
    ok: ["В пределах", "ok"], near_limit: ["Близко к пределу", "near"],
    violated: ["Нарушено", "violated"], unknown: ["Нет данных для оценки", "unknown"]
  };
  const statusOf = item => { const base = statuses[item?.status] || statuses.unknown; return [text(item?.status_label || base[0]), base[1]]; };
  function compareItems(a, b) {
    const priority = {violated: 0, near_limit: 1, unknown: 2, ok: 3};
    const status = (priority[a?.status] ?? 2) - (priority[b?.status] ?? 2);
    if (status) return status;
    const resource = (a?.kind === "bound" ? 1 : 0) - (b?.kind === "bound" ? 1 : 0);
    if (resource) return resource;
    return (isNumber(b?.utilization_pct) ? b.utilization_pct : -Infinity) - (isNumber(a?.utilization_pct) ? a.utilization_pct : -Infinity) || 0;
  }
  function make(tag, className = "", value) {
    const el = document.createElement(tag); if (className) el.className = className;
    if (value !== undefined) el.textContent = text(value); return el;
  }
  function button(label, className = "tc-button") {
    const el = make("button", className, label); el.type = "button"; return el;
  }
  function badge(item) {
    const [label, kind] = statusOf(item), el = make("span", `tc-status tc-${kind}`, label);
    return el;
  }
  function measure(value, unit) { return number(value) + (isNumber(value) && unit ? " " + text(unit) : ""); }
  const scaleFor = parameter => isNumber(parameter?.display_scale) && parameter.display_scale > 0 ? parameter.display_scale : 1;
  function displayParameter(parameter, value) {
    if (!isNumber(value)) return null;
    const scaled = value * scaleFor(parameter);
    return Number.isFinite(scaled) ? Number(scaled.toPrecision(15)) : null;
  }
  function rawParameter(parameter, value) {
    if (!parameter || value === "") return NaN;
    return Number(value) / scaleFor(parameter);
  }
  function mount(root, dashboardRoot, options) {
    const state = {chat: "", mode: "", basis: "source", data: null, loading: false, busy: false, error: "", unavailable: false, notice: "", search: "", filter: "all", edits: new Map(), threshold: null};
    let epoch = 0, modal = null;
    root.classList.add("tabula-constraints"); root.hidden = true; dashboardRoot.hidden = true;
    const endpoint = () => `/v1/chats/${encodeURIComponent(state.chat)}/constraints`;
    const canRequest = () => !!state.chat && ["constraints", "dashboard"].includes(state.mode);
    const current = (generation, id) => generation === epoch && id === state.chat;
    const dirty = () => state.edits.size > 0 || (state.threshold !== null && state.threshold !== state.data?.warning_threshold);
    function closeModal() { if (!modal) return; if (modal.open) modal.close(); modal.remove(); modal = null; }
    function allowDiscard() { return !dirty() || window.confirm("Есть несохранённые изменения. Продолжить без сохранения?"); }
    function setError(error) {
      state.error = error?.status === 409 ? text(error.message || "Данные изменились. Обновите ограничения и повторите запрос.") :
        error?.status === 422 ? text(error.message || "Проверьте параметры и повторите запрос.") :
        error?.status === 404 ? "Сервис ограничений пока недоступен. Попробуйте обновить страницу позже." :
        text(error?.message || "Не удалось получить ограничения. Попробуйте ещё раз.");
    }
    function validate(data) {
      if (!data || data.schema !== "tabula-constraints/v1" || !Array.isArray(data.parameters) || !Array.isArray(data.items))
        throw new Error("Сервис вернул неизвестный формат ограничений.");
      return data;
    }
    async function refresh({discard = false} = {}) {
      if (!canRequest() || state.busy || (discard && !allowDiscard())) return;
      const id = state.chat, revision = ++epoch; state.loading = true; state.error = ""; state.unavailable = false;
      if (discard) { state.edits.clear(); state.threshold = null; }
      render();
      try {
        const data = validate(await options.request(`${endpoint()}?basis=${encodeURIComponent(state.basis)}`));
        if (!current(revision, id)) return;
        state.data = data; state.edits.clear(); state.threshold = null;
      } catch (error) { if (current(revision, id)) { state.data = null; state.unavailable = error?.status === 409; setError(error); } }
      finally { if (current(revision, id)) { state.loading = false; render(); } }
    }
    function affectedNames(parameter) {
      const ids = new Set(Array.isArray(parameter.affected_constraint_ids) ? parameter.affected_constraint_ids : []);
      return state.data.items.filter(item => ids.has(item.id)).map(item => [text(item.name), periodTitle(item.period)].filter(Boolean).join(" · ")).filter(Boolean);
    }
    function makeSummary(data, compact = false) {
      const summary = data?.summary || {}, holder = make("div", "tc-summary" + (compact ? " tc-summary-compact" : ""));
      for (const [key, label, kind] of [["violated", "Нарушения", "violated"], ["bottlenecks", "Близко к пределу", "near"], ["ok", "В пределах", "ok"], ["unknown", "Нет данных", "unknown"]]) {
        if (!isNumber(summary[key])) continue;
        const box = make("div", "tc-summary-item"); box.append(make("span", `tc-dot tc-${kind}`), make("strong", "", number(summary[key])), make("span", "", label)); holder.append(box);
      }
      return holder;
    }
    function itemView(item, compact = false) {
      const card = make("article", compact ? "tc-dashboard-item" : "tc-card");
      const head = make("div", "tc-card-head"), title = make("h4", "", itemTitle(item));
      head.append(title, badge(item)); card.append(head);
      const meta = [periodTitle(item.period), text(state.data?.basis?.label), item.demo_assumption ? "Демонстрационное допущение" : ""].filter(Boolean).join(" · ");
      if (meta) card.append(make("p", "tc-card-meta", meta));
      const figures = make("div", "tc-measures");
      for (const [label, value] of [[item.kind === "capacity" ? "Нагрузка" : "Значение", item.usage], ["Предел", item.limit]]) {
        const box = make("div"); box.append(make("span", "", label), make("strong", "", measure(value, item.unit))); figures.append(box);
      }
      if (isNumber(item.utilization_pct)) {
        const box = make("div"), value = make("strong", "", percent(item.utilization_pct) + "%");
        value.title = "Точное значение: " + number(item.utilization_pct) + "%";
        box.append(make("span", "", "Использовано"), value); figures.append(box);
      }
      card.append(figures);
      if (isNumber(item.utilization_pct) && item.utilization_pct >= 0) {
        const progress = make("div", "tc-meter " + `tc-${statusOf(item)[1]}`); progress.setAttribute("role", "img");
        progress.setAttribute("aria-label", `Использовано ${number(item.utilization_pct)}%`);
        const bar = make("span"); bar.style.width = Math.min(item.utilization_pct, 100) + "%"; progress.append(bar); card.append(progress);
      }
      if (isNumber(item.excess) && item.excess > 0) card.append(make("p", "tc-overrun", `Отклонение: ${measure(item.excess, item.unit)}`));
      else if (isNumber(item.reserve) && item.reserve > 0 && item.status !== "unknown") card.append(make("p", "tc-reserve", `Запас: ${measure(item.reserve, item.unit)}`));
      if (!compact) {
        const parameterIds = new Set(Array.isArray(item.parameter_ids) ? item.parameter_ids : []);
        const parameterNames = state.data.parameters.filter(parameter => parameterIds.has(parameter.id)).map(parameter => parameterCopy(parameter).title).filter(Boolean);
        if (parameterNames.length > 3) {
          const details = make("details", "tc-affected"), summary = make("summary", "", `Связанные параметры и данные: ${parameterNames.length}`), list = make("ul");
          for (const name of parameterNames) list.append(make("li", "", name)); details.append(summary, list); card.append(details);
        } else if (parameterNames.length) card.append(make("p", "tc-affected", "Зависит от: " + parameterNames.join(", ")));
        const links = Array.isArray(item.links) ? item.links.filter(link => link && link.label) : [];
        if (links.length) {
          const group = make("div", "tc-links"); group.append(make("strong", "", "Связанные показатели"));
          const sharedRelation = text(links[0].relation);
          const oneRelation = sharedRelation && links.every(link => text(link.relation) === sharedRelation);
          if (oneRelation) group.append(make("p", "tc-link-relation", sharedRelation));
          const list = make("ul"); for (const link of links) list.append(make("li", "", text(link.label) + (!oneRelation && link.relation ? " · " + text(link.relation) : "")));
          group.append(list); const graph = button("Открыть граф", "tc-link"); graph.disabled = !options.canOpenGraph?.(); graph.addEventListener("click", () => options.onMode?.("graph")); group.append(graph); card.append(group);
        }
        const recommendations = Array.isArray(item.recommendations) ? item.recommendations : [];
        if (recommendations.length) {
          const group = make("div", "tc-recommendations"); group.append(make("strong", "", "Что можно проверить"));
          for (const recommendation of recommendations) {
            const row = make("div", "tc-recommendation");
            if (recommendation.title) row.append(make("p", "tc-recommendation-title", recommendation.title));
            if (recommendation.detail) row.append(make("p", "", recommendation.detail));
            if (recommendation.conditional) row.append(make("small", "", "При подтверждении условий"));
            group.append(row);
          }
          card.append(group);
        }
      }
      return card;
    }
    function renderDashboard() {
      dashboardRoot.hidden = state.mode !== "dashboard" || !state.chat;
      if (dashboardRoot.hidden) return;
      dashboardRoot.replaceChildren();
      const panel = make("div", "tc-dashboard-panel"), heading = make("div", "tc-section-head"), title = make("div");
      title.append(make("h3", "", "Ограничители и узкие места"), make("p", "", state.data?.basis?.label || "Данные выбранного плана"));
      const open = button("Все ограничители →", "tc-link"); open.addEventListener("click", () => options.onMode?.("constraints")); heading.append(title, open); panel.append(heading);
      if (state.loading) panel.append(make("p", "tc-muted", "Загружаем ограничения…"));
      else if (state.error && state.unavailable) panel.append(badge({status: "unknown"}), make("p", "tc-muted", state.error));
      else if (state.error) panel.append(make("p", "tc-muted", "Не удалось получить ограничения. Откройте раздел, чтобы повторить запрос."));
      else if (!state.data || state.data.status !== "ready") {
        panel.append(badge({status: "unknown"}), make("p", "tc-muted", state.data?.summary?.message || "Нет данных для оценки ограничений."));
      }
      else {
        panel.append(makeSummary(state.data, true));
        if (state.data.summary?.message) panel.append(make("p", "tc-dashboard-message", state.data.summary.message));
        if (dirty()) panel.append(make("p", "tc-notice", "Есть несохранённые изменения. Показаны последние сохранённые значения."));
        if (state.data.draft?.changed) panel.append(make("p", "tc-notice", "Предварительная оценка черновика по сохранённому плану, без пересчёта показателей."));
        const items = [...state.data.items].sort(compareItems).slice(0, 4);
        if (!items.length) panel.append(make("p", "tc-muted", "Ограничения не найдены."));
        else { const cards = make("div", "tc-dashboard-grid"); for (const item of items) cards.append(itemView(item, true)); panel.append(cards); }
      }
      dashboardRoot.append(panel);
    }
    function renderParameters(data) {
      const section = make("section", "tc-section tc-parameters"), header = make("div", "tc-section-head"), heading = make("div");
      const hasBusinessControls = data.parameters.some(parameter => parameter.editable && parameterCopy(parameter).description);
      heading.append(make("h3", "", "Параметры ограничителей"), make("p", "", hasBusinessControls ?
        "100% — объём исходного плана. Условия действуют в каждом месяце: по отдельным проектам и по компании в целом." :
        "Задайте допустимые пределы плана. Одно значение может действовать сразу для нескольких ограничителей."));
      header.append(heading); section.append(header);
      if (!data.parameters.length) { section.append(make("p", "tc-muted", "Параметры ограничений не найдены в модели.")); return section; }
      const form = make("form", "tc-form"); form.autocomplete = "off";
      const list = make("div", "tc-parameter-list"), readOnlyList = make("div", "tc-parameter-list"), readOnlyCount = data.parameters.filter(parameter => !parameter.editable).length;
      for (const parameter of data.parameters) {
        const copy = parameterCopy(parameter);
        const row = make("div", "tc-parameter"), info = make("div", "tc-parameter-info"), label = make("label", "", copy.title);
        const input = make("input"); input.type = "number"; input.step = "any"; input.inputMode = "decimal";
        const displayed = displayParameter(parameter, parameter.value);
        input.value = state.edits.has(parameter.id) ? state.edits.get(parameter.id) : isNumber(displayed) ? String(displayed) : "";
        input.disabled = !parameter.editable || state.loading || state.busy;
        input.setAttribute("aria-label", copy.title); label.append(input);
        info.append(label);
        if (copy.description) info.append(make("p", "tc-parameter-description", copy.description));
        const note = [parameter.unit, parameter.source_label, parameter.demo_assumption ? "Демонстрационное допущение" : ""].filter(Boolean).map(text).join(" · ");
        if (note) info.append(make("p", "tc-muted", note));
        const names = affectedNames(parameter);
        if (names.length > 3) {
          const details = make("details", "tc-affected"), summary = make("summary", "", `Влияет на ограничения: ${names.length}`), list = make("ul");
          for (const name of names) list.append(make("li", "", name)); details.append(summary, list); info.append(details);
        } else if (names.length) info.append(make("p", "tc-affected", "Влияет: " + names.join(", ")));
        if (parameter.changed && isNumber(parameter.original_value)) info.append(make("p", "tc-affected", "Исходное значение: " + measure(displayParameter(parameter, parameter.original_value), parameter.unit)));
        input.addEventListener("input", () => {
          const value = input.value; if (value !== "" && isNumber(displayed) && Number(value) === displayed) state.edits.delete(parameter.id); else state.edits.set(parameter.id, value);
          updateActions();
        });
        row.append(info); (parameter.editable ? list : readOnlyList).append(row);
      }
      if (!list.childElementCount) form.append(make("p", "tc-muted", "Параметров, доступных для изменения, нет."));
      else form.append(list);
      if (readOnlyCount) {
        const details = make("details", "tc-readonly"), summary = make("summary", "", `Нередактируемые параметры: ${readOnlyCount}`);
        details.append(summary, readOnlyList); form.append(details);
      }
      const threshold = make("label", "tc-threshold", "Предупреждать при загрузке от, %"), thresholdInput = make("input");
      thresholdInput.type = "number"; thresholdInput.min = "0"; thresholdInput.max = "100"; thresholdInput.step = "any";
      thresholdInput.value = isNumber(state.threshold) ? String(Number((state.threshold * 100).toPrecision(15))) : isNumber(data.warning_threshold) ? String(Number((data.warning_threshold * 100).toPrecision(15))) : "";
      thresholdInput.disabled = state.loading || state.busy; threshold.append(thresholdInput); form.append(threshold);
      thresholdInput.addEventListener("input", () => { state.threshold = thresholdInput.value === "" ? NaN : Number(thresholdInput.value) / 100; updateActions(); });
      const actions = make("div", "tc-actions"), save = make("button", "tc-button tc-primary", "Сохранить черновик"); save.type = "submit";
      const reset = button("Вернуть исходные значения"), publish = button("Создать копию в Табуле"); actions.append(save, reset, publish); form.append(actions);
      if (isChatId(data.writeback?.child_chat_id)) {
        const openCopy = button("Открыть копию"); openCopy.disabled = state.busy || state.loading;
        openCopy.addEventListener("click", async () => { try { await options.onOpenChild?.(data.writeback.child_chat_id); } catch (error) { setError(error); render(); } }); actions.append(openCopy);
      }
      const hint = make("p", "tc-form-hint"); hint.setAttribute("role", "status"); form.append(hint);
      if (data.writeback?.status && data.writeback.status !== "not_requested" && data.writeback.message) form.append(make("p", "tc-writeback", data.writeback.message));
      function updateActions() {
        const invalid = [...state.edits].some(([id, value]) => !Number.isFinite(rawParameter(data.parameters.find(parameter => parameter.id === id), value))) ||
          (state.threshold !== null && (!isNumber(state.threshold) || state.threshold <= 0 || state.threshold > 1));
        save.disabled = state.busy || state.loading || !dirty() || invalid || !data.source?.key;
        reset.disabled = state.busy || state.loading || (!data.draft?.changed && !dirty()) || !data.source?.key;
        publish.disabled = state.busy || state.loading || dirty() || data.writeback?.can_publish !== true;
        hint.textContent = invalid ? "Введите конечное число; порог должен быть больше 0 и не более 100%." : dirty() ? "Есть несохранённые изменения. Статусы показывают последний сохранённый черновик." :
          data.draft?.changed ? (isChatId(data.writeback?.child_chat_id) ? "Черновик сохранён. Откройте копию, чтобы проверить её состояние." : "Черновик сохранён в рабочем месте. Чтобы рассчитать план с этими параметрами, создайте отдельную копию модели.") : text(data.writeback?.message || "Исходные значения модели.");
      }
      form.addEventListener("submit", event => { event.preventDefault(); if (!save.disabled) saveDraft(); });
      reset.addEventListener("click", () => { if (window.confirm("Вернуть все параметры к исходным значениям модели? Черновик будет сброшен.")) resetDraft(); });
      publish.addEventListener("click", confirmPublish); updateActions(); section.append(form); return section;
    }
    function renderPage() {
      root.hidden = state.mode !== "constraints";
      if (root.hidden) return;
      root.replaceChildren();
      const header = make("header", "tc-header"), title = make("div");
      title.append(make("p", "tc-eyebrow", "Модель и план"), make("h2", "", "Ограничители"), make("p", "tc-subtitle", "Пределы, нагрузка и параметры, которые на них влияют."));
      const refreshButton = button("Обновить"); refreshButton.disabled = state.loading || state.busy || !state.chat;
      refreshButton.addEventListener("click", () => refresh({discard: true})); header.append(title, refreshButton); root.append(header);
      const basis = make("div", "tc-basis"); basis.setAttribute("aria-label", "План для оценки");
      for (const [kind, label] of [["source", "Исходный план"], ["optimized", "Оптимизированный план"]]) {
        const b = button(label, "tc-basis-button" + (state.basis === kind ? " selected" : "")); b.setAttribute("aria-pressed", String(state.basis === kind)); b.disabled = state.loading || state.busy;
        b.addEventListener("click", () => { if (kind === state.basis || !allowDiscard()) return; state.basis = kind; state.data = null; state.edits.clear(); state.threshold = null; state.notice = ""; refresh(); }); basis.append(b);
      }
      root.append(basis);
      if (state.loading) { root.append(make("p", "tc-empty", "Загружаем ограничения…")); return; }
      if (state.error && state.unavailable) { const empty = make("div", "tc-empty"); empty.append(badge({status: "unknown"}), make("p", "tc-muted", state.error)); root.append(empty); }
      else if (state.error) { const error = make("p", "tc-alert", state.error); error.setAttribute("role", "alert"); root.append(error); }
      if (state.notice) root.append(make("p", "tc-notice", state.notice));
      if (!state.data) { if (!state.error) root.append(make("p", "tc-empty", "Выберите модель, чтобы увидеть ограничения.")); return; }
      const data = state.data, sourceLabel = data.source?.label ? (window.TabulaPresentation?.title?.(data.source.label) ?? text(data.source.label)) : "";
      const source = make("p", "tc-source", [sourceLabel, data.basis?.label].filter(Boolean).map(text).join(" · "));
      root.append(source);
      if (data.status !== "ready") {
        const empty = make("div", "tc-empty"); empty.append(badge({status: "unknown"}), make("p", "tc-muted", data.summary?.message || "Для оценки ограничений пока не хватает данных модели.")); root.append(empty); return;
      }
      const summary = make("section", "tc-section tc-overview"), headline = make("div", "tc-section-head");
      headline.append(make("h3", "", "Состояние плана")); summary.append(headline, makeSummary(data));
      if (data.summary?.message) summary.append(make("p", "tc-summary-message", data.summary.message));
      if (data.draft?.changed) summary.append(make("p", "tc-notice", "Предварительная оценка черновика по сохранённому плану, без пересчёта показателей."));
      root.append(summary, renderParameters(data));
      const limits = make("section", "tc-section"), limitsHeading = make("div", "tc-section-head");
      limitsHeading.append(make("h3", "", "Ограничители по периодам")); limits.append(limitsHeading);
      if (data.impact_note) limits.append(make("p", "tc-impact-note", data.impact_note));
      const warnings = Array.isArray(data.warnings) ? data.warnings.map(warning => text(typeof warning === "string" ? warning : warning?.message)).filter(Boolean) : [];
      if (warnings.length) {
        const details = make("details", "tc-warnings"), list = make("ul"); details.append(make("summary", "", `Что нужно проверить: ${warnings.length}`));
        for (const warning of warnings) list.append(make("li", "", warning)); details.append(list); limits.append(details);
      }
      if (!data.items.length) limits.append(make("p", "tc-muted", "Ограничения не найдены."));
      else {
        const filters = make("div", "tc-filter-row"), search = make("input"), select = make("select");
        search.type = "search"; search.placeholder = "Найти ограничение или период"; search.setAttribute("aria-label", "Найти ограничение или период"); search.value = state.search;
        select.setAttribute("aria-label", "Состояние ограничения");
        for (const [value, label] of [["all", "Все состояния"], ["violated", "Нарушено"], ["near_limit", "Близко к пределу"], ["unknown", "Нет данных"], ["ok", "В пределах"]]) {
          const option = make("option", "", label); option.value = value; select.append(option);
        }
        select.value = state.filter; filters.append(search, select); limits.append(filters);
        const cards = make("div", "tc-card-grid"); limits.append(cards);
        const updateList = () => {
          const query = state.search.trim().toLocaleLowerCase("ru");
          const items = data.items.filter(item => (state.filter === "all" || item.status === state.filter) &&
            (!query || `${text(item.name)} ${periodTitle(item.period)}`.toLocaleLowerCase("ru").includes(query)))
            .sort(compareItems);
          cards.replaceChildren();
          if (!items.length) cards.append(make("p", "tc-muted", "По выбранным условиям ограничения не найдены."));
          else for (const item of items) cards.append(itemView(item));
        };
        search.addEventListener("input", () => { state.search = search.value; updateList(); });
        select.addEventListener("change", () => { state.filter = select.value; updateList(); }); updateList();
      }
      root.append(limits);
    }
    function render() { renderPage(); renderDashboard(); }
    async function change(action, payload) {
      if (state.busy || !state.chat || !state.data?.source?.key) return;
      const id = state.chat, revision = ++epoch; state.busy = true; state.error = ""; state.unavailable = false; state.notice = ""; render();
      try {
        const result = await options.request(`${endpoint()}/${action}`, {method: "POST", json: {source_key: state.data.source.key, expected_revision: state.data.revision, ...payload}});
        if (!current(revision, id)) return;
        state.busy = false;
        if (action === "publish") {
          if (!isChatId(result?.child_chat_id)) throw new Error("Сервис не вернул новую копию модели. Проверьте состояние публикации.");
          state.notice = "Создаётся отдельная копия модели в Табуле."; render(); await options.onOpenChild?.(result.child_chat_id); return;
        }
        state.edits.clear(); state.threshold = null; state.notice = action === "reset" ? "Исходные значения восстановлены в рабочем месте." : "Черновик сохранён в рабочем месте.";
        await refresh();
      } catch (error) { if (current(revision, id)) { state.busy = false; setError(error); render(); } }
    }
    function saveDraft() {
      const parameters = [...state.edits].map(([id, value]) => ({id, value: rawParameter(state.data.parameters.find(parameter => parameter.id === id), value)}));
      const payload = {parameters}; if (state.threshold !== null) payload.warning_threshold = state.threshold;
      change("draft", payload);
    }
    function resetDraft() { change("reset", {}); }
    function confirmPublish() {
      if (modal || state.busy || dirty() || state.data?.writeback?.can_publish !== true) return;
      const dialog = make("dialog", "tc-dialog"); modal = dialog;
      dialog.append(make("h2", "", "Создать копию модели?"), make("p", "", "Изменённые параметры будут переданы в новую отдельную копию модели в Табуле. Исходная модель останется без изменений."),
        make("p", "tc-muted", "После создания копии проверьте её расчёт и бизнес-условия плана."));
      const actions = make("div", "tc-actions"), cancel = button("Отмена"), accept = button("Создать копию", "tc-button tc-primary");
      cancel.addEventListener("click", closeModal); accept.addEventListener("click", () => { closeModal(); change("publish", {confirmed: true}); });
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeModal(); }); actions.append(cancel, accept); dialog.append(actions); document.body.append(dialog); dialog.showModal();
    }
    return {
      setChat(chat) {
        const id = typeof chat === "string" ? chat : chat?.id || ""; if (id === state.chat) return;
        epoch++; closeModal(); state.chat = id; state.data = null; state.loading = false; state.busy = false; state.error = ""; state.unavailable = false; state.notice = ""; state.basis = "source"; state.search = ""; state.filter = "all"; state.edits.clear(); state.threshold = null; render();
        if (canRequest()) refresh();
      },
      setMode(mode) {
        const before = state.mode; state.mode = mode; if (before !== mode) closeModal(); render();
        if (canRequest() && !state.loading && !state.busy && !dirty() && (before !== mode || (!state.data && !state.error))) refresh();
      },
      hasUnsavedChanges: dirty,
      refresh
    };
  }
  return {mount};
})();
