"use strict";

// The card presents evidence supplied by the analysis task; it does not infer
// targets, business norms or whether a movement is good or bad.
window.TabulaMetricInsights = (() => {
  const number = new Intl.NumberFormat("ru-RU", {maximumSignificantDigits: 15});
  const shortPercent = new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 2});
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const present = value => {
    if (typeof value !== "string" && typeof value !== "number") return "";
    return window.TabulaPresentation?.text?.(value) ?? String(value);
  };
  function node(tag, className = "", value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = present(value);
    return element;
  }
  function amount(value, unit, signed = false) {
    if (!finite(value)) return "—";
    return (signed && value > 0 ? "+" : "") + number.format(value) + (unit ? " " + present(unit) : "");
  }
  function percentage(value) {
    if (value !== 0 && Math.abs(value) < .005) return "≈ 0 %";
    return (value > 0 ? "+" : "") + shortPercent.format(value) + " %";
  }
  function question(item, action) {
    const title = present(item.title) || "показатель", variant = present(action.title);
    const pieces = [`Разбери вариант «${variant}» для показателя «${title}».`];
    if (action.detail && present(action.detail) !== variant) pieces.push(present(action.detail));
    if (action.condition) pieces.push("Условие: " + present(action.condition));
    if (action.expected_outcome) pieces.push("Ожидаемый результат: " + present(action.expected_outcome));
    pieces.push("Какие данные модели подтверждают этот вариант и что нужно проверить перед решением?");
    return pieces.join(" ").slice(0, 6000);
  }
  function fact(label, value, cls = "") {
    const item = node("div", "metric-insight-fact " + cls);
    item.append(node("span", "metric-insight-fact-label", label), node("strong", "metric-insight-fact-value", value));
    return item;
  }
  function factLabel(prefix, label) {
    const value = present(label).trim();
    return !value || value.toLocaleLowerCase("ru") === prefix.toLocaleLowerCase("ru") ? prefix : prefix + " · " + value;
  }
  function card(item, options) {
    const root = node("section", "metric-insight"), heading = node("div", "metric-insight-heading"), title = node("div");
    title.append(node("p", "metric-insight-eyebrow", "Разбор показателя"), node("h3", "metric-insight-title", item.title || "Показатель"));
    if (item.analysis_scope?.label) title.append(node("p", "metric-insight-scope", item.analysis_scope.label));
    heading.append(title);
    if (item.assessment?.label) heading.append(node("span", "metric-insight-assessment", item.assessment.label));
    root.append(heading);
    if (item.assessment?.conclusion) root.append(node("p", "metric-insight-conclusion", item.assessment.conclusion));

    const current = item.current || {}, comparison = item.comparison || {}, basis = item.basis || {};
    const facts = node("div", "metric-insight-facts");
    const comparisonKind = comparison.available === true ? comparison.kind : "";
    const currentLabel = comparisonKind === "period_span" ? present(current.label || comparison.current_label || "Конец периода") :
      comparisonKind === "plan" ? factLabel("Факт", current.label || comparison.current_label) :
      comparisonKind === "previous_observation" ? factLabel("Последнее значение", current.label || comparison.current_label) :
      factLabel("Значение", current.label);
    if (comparison.available === true && comparison.label) root.append(node("p", "metric-insight-note", comparison.label));
    if (finite(current.value)) facts.append(fact(currentLabel, amount(current.value, item.unit)));
    if (comparison.available === true && finite(comparison.reference_value)) {
      const referenceLabel = comparisonKind === "period_span" ? present(comparison.reference_label || "Начало периода") :
        comparisonKind === "plan" ? factLabel("План", comparison.reference_label) :
        comparisonKind === "previous_observation" ? factLabel("Предыдущее значение", comparison.reference_label) :
        present(comparison.reference_label || basis.label || "База сравнения");
      facts.append(fact(referenceLabel, amount(comparison.reference_value, item.unit)));
    }
    if (comparison.available === true && finite(comparison.delta_absolute)) {
      const diff = amount(comparison.delta_absolute, comparison.delta_unit || item.unit, true);
      const hasRate = finite(comparison.delta_pct), rate = hasRate ? " · " + percentage(comparison.delta_pct) : "";
      const change = fact("Изменение", diff + rate);
      if (hasRate) {
        const exact = (comparison.delta_pct > 0 ? "+" : "") + String(comparison.delta_pct).replace(".", ",") + " %", value = change.querySelector(".metric-insight-fact-value");
        value.title = "Без округления: " + exact;
        value.setAttribute("aria-label", diff + "; процент без округления: " + exact);
      }
      facts.append(change);
    }
    if (facts.childElementCount) root.append(facts);
    if (comparison.available !== true) {
      root.append(node("p", "metric-insight-note", basis.label || "Нет подходящей базы для сравнения."));
    } else if (comparison.pct_unavailable_reason) {
      root.append(node("p", "metric-insight-note", comparison.pct_unavailable_reason));
    }
    const observations = Array.isArray(item.observations) ? item.observations.filter(value => value && (value.title || value.detail)).slice(0, 6) : [];
    if (observations.length) {
      const list = node("ul", "metric-insight-observations");
      for (const value of observations) {
        const li = node("li");
        if (value.title) li.append(node("strong", "", value.title));
        if (value.detail && present(value.detail) !== present(value.title)) li.append(node("span", "", value.detail));
        list.append(li);
      }
      root.append(list);
    }
    const quality = item.data_quality || {};
    if (finite(quality.missing_count) && quality.missing_count > 0) {
      root.append(node("p", "metric-insight-note", `В данных есть пропуски: ${number.format(quality.missing_count)}${finite(quality.point_count) ? " из " + number.format(quality.point_count) : ""}.`));
    }
    const actions = Array.isArray(item.actions) ? item.actions.filter(value => value && value.title && value.conditional === true && value.executed === false).slice(0, 3) : [];
    if (actions.length) {
      const section = node("div", "metric-insight-actions");
      section.append(node("h4", "", "Варианты действий"));
      const list = node("div", "metric-insight-action-list");
      for (const action of actions) {
        const row = node("article", "metric-insight-action"); row.append(node("h5", "", action.title));
        if (action.detail && present(action.detail) !== present(action.title)) row.append(node("p", "", action.detail));
        if (action.condition) row.append(node("p", "metric-insight-action-context", "Условие: " + present(action.condition)));
        if (action.expected_outcome) row.append(node("p", "metric-insight-action-context", "Ожидаемый результат: " + present(action.expected_outcome)));
        if (typeof options.onQuestion === "function") {
          const discuss = node("button", "metric-insight-discuss", "Разобрать этот вариант");
          discuss.type = "button"; discuss.dataset.metricInsightQuestion = "";
          discuss.disabled = typeof options.canQuestion === "function" && !options.canQuestion();
          discuss.setAttribute("aria-label", `Разобрать вариант: ${present(action.title)}`);
          discuss.addEventListener("click", () => options.onQuestion(question(item, action)));
          row.append(discuss);
        }
        list.append(row);
      }
      section.append(list); root.append(section);
    }
    return root;
  }
  function build(task, options = {}) {
    if (!task || task.kind !== "analysis" || task.optimization_task_id || task.chart_only) return null;
    const values = Array.isArray(task.result?.metric_interpretations) ? task.result.metric_interpretations : [];
    const sourcePinned = task.source_sha256 !== undefined && task.source_sha256 !== null;
    const usable = values.filter(item => item && item.schema === "tabula.metric-interpretation/v1" && item.current && item.assessment &&
      (!sourcePinned || (typeof task.source_sha256 === "string" && task.source_sha256.length > 0 && item.source?.sha256 === task.source_sha256)));
    if (!usable.length) return null;
    const container = node("div", "metric-insights");
    for (const item of usable) container.append(card(item, options));
    return container;
  }
  return {build};
})();
