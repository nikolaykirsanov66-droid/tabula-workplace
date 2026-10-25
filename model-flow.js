"use strict";

// Confirmed model deployment starts graph preparation; solving stays explicit.
window.TabulaModelFlow = (() => {
  const active = new Set(["queued", "running", "in_progress"]);
  const polling = new Set([...active, "waiting_dependencies", "waiting_export", "needs_reconciliation"]);
  const completed = new Set(["completed", "ready", "done", "succeeded"]);
  const publicationLabels = {
    queued: "Отдельная копия с новым планом ожидает создания.", running: "Создаём и пересчитываем отдельную копию с новым планом в Табуле…",
    awaiting_connections: "Для создания копии ожидаем подключение сервера Табулы.",
    waiting_dependencies: "Для создания копии ожидаем подключение сервера Табулы.",
    needs_reconciliation: "Проверяем, была ли создана копия с новым планом. Повторная отправка пока недоступна.",
    completed: "Отдельная копия с новым планом создана в Табуле.", ready: "Отдельная копия с новым планом создана в Табуле.", applied: "Отдельная копия с новым планом создана в Табуле.",
    failed: "Новая версия не создана. Можно повторить отправку после проверки подключения."
  };
  const make = (tag, cls, text) => {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (text != null) item.textContent = String(text);
    return item;
  };
  const text = value => window.TabulaPresentation?.text(value) || "";

  function mount(root, options) {
    let chatId = null, flow = null, loading = false, error = "", requestBusy = false;
    let timer = null, generation = 0, pollFailures = 0, graphView = null, graphPending = false, graphWanted = false, graphRevision = 0;
    let optimizationDialog = null, optimizationCheckRevision = 0;
    const presentedGraphs = new Set();
    const automaticGraphs = new Set();
    let detailsExpanded = false;
    let publishDialog = null;
    let availability = {connected: false, busy: false, analysis: false, optimization: false};
    const graphRoot = options.graphContainer;
    const path = id => `/v1/chats/${encodeURIComponent(id)}/model-flow`;
    const emit = () => { render(); options.onChange?.({flow, loading, error}); };
    const inProgress = () => (graphWanted && !flow) || (flow && (polling.has(flow.status) || polling.has(flow.publication?.status) ||
      (flow.status === "prepared" && flow.can_load_model !== true)));
    const disabled = () => !availability.connected || availability.busy || loading || requestBusy;
    const graphIdentity = () => `${chatId}/${flow?.id}/${flow?.model?.model_id}/${flow?.model?.version_id}/${flow?.model?.revision}`;
    function presentReadyGraph() {
      if (disabled() || graphView || graphPending || !graphRoot || flow?.status !== "ready" || !flow.graph?.ready) return;
      if (graphWanted) showGraph();
    }
    function schedule() {
      clearTimeout(timer); timer = null;
      if (availability.connected && chatId && inProgress()) timer = setTimeout(() => refresh(true), Math.min(60000, 2500 * 2 ** Math.min(pollFailures, 5)));
    }
    function closeGraph() {
      graphRevision++;
      graphWanted = false;
      graphPending = false;
      graphView?.destroy?.(); graphView = null;
      if (graphRoot) { graphRoot.replaceChildren(); graphRoot.hidden = true; graphRoot.closest(".main")?.classList.remove("graph-is-open"); }
    }
    function closeOptimizationCheck() {
      optimizationCheckRevision++;
      if (optimizationDialog) {
        const dialog = optimizationDialog;
        optimizationDialog = null;
        if (dialog.open) dialog.close();
        dialog.remove();
      }
    }
    function closePublishDialog() {
      if (!publishDialog) return;
      if (publishDialog.open) publishDialog.close();
      publishDialog.remove(); publishDialog = null;
    }
    async function prepareGraphAutomatically() {
      if (disabled() || fromTabula() || flow?.status !== "model_loaded" || !flow.can_request_graph) return;
      const identity = graphIdentity();
      if (automaticGraphs.has(identity)) return;
      automaticGraphs.add(identity);
      await command("/graph");
    }
    function confirmPublish(task) {
      if (disabled() || publishDialog) return;
      const selectedId = chatId, currentGeneration = generation, identity = graphIdentity();
      const dialog = make("dialog", "optimization-check-dialog"); publishDialog = dialog;
      const header = make("header", "optimization-check-header");
      header.append(make("h2", "", "Создать новую версию плана?"));
      const body = make("div", "optimization-check-content");
      body.append(make("p", "", "Оптимизированный план будет записан отдельной моделью в Табуле. Исходный план сохранится."),
        make("strong", "", text(flow.model?.label) || "Выбранная модель"));
      const footer = make("footer", "optimization-check-footer");
      const cancel = make("button", "model-flow-button", "Отмена"), accept = make("button", "model-flow-button primary", "Создать копию плана");
      cancel.type = accept.type = "button";
      cancel.addEventListener("click", closePublishDialog);
      accept.addEventListener("click", async () => {
        accept.disabled = true;
        await refresh(true);
        if (selectedId !== chatId || currentGeneration !== generation || identity !== graphIdentity() || disabled()) {
          closePublishDialog(); options.onNotice?.("Модель изменилась. Проверьте результат перед отправкой ещё раз.", true); return;
        }
        closePublishDialog();
        await command("/publish", {optimization_task_id: task.id, confirmed: true});
      });
      footer.append(cancel, accept); dialog.append(header, body, footer);
      dialog.addEventListener("cancel", event => {event.preventDefault(); closePublishDialog();});
      document.body.append(dialog); dialog.showModal();
    }
    async function openOptimizationCheck() {
      if (disabled() || flow?.status !== "ready" || !flow.graph?.ready || !availability.optimization) return;
      if (optimizationDialog) { optimizationDialog.focus(); return; }
      closeGraph();
      const selectedId = chatId, currentGeneration = generation, revision = ++optimizationCheckRevision;
      const sourceModel = {...flow.model};
      const dialog = make("dialog", "optimization-check-dialog");
      optimizationDialog = dialog;
      dialog.setAttribute("aria-labelledby", "optimization-check-title");
      const header = make("header", "optimization-check-header"), heading = make("div");
      const title = make("h2", "", "Оптимизация плана"); title.id = "optimization-check-title";
      heading.append(title, make("p", "", "Проверяем данные и условия выбранной модели."));
      const close = make("button", "model-flow-button", "Закрыть"); close.type = "button";
      close.addEventListener("click", closeOptimizationCheck);
      header.append(heading, close);
      const content = make("div", "optimization-check-content"), footer = make("footer", "optimization-check-footer");
      content.setAttribute("aria-live", "polite");
      content.append(make("p", "optimization-check-loading", "Проверяем граф, цель, управляемые показатели и ограничения…"));
      dialog.append(header, content, footer); document.body.append(dialog);
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeOptimizationCheck(); });
      dialog.showModal();
      const current = () => optimizationDialog === dialog && revision === optimizationCheckRevision &&
        currentGeneration === generation && selectedId === chatId;
      const addButton = (label, callback, primary = false) => {
        const button = make("button", "model-flow-button" + (primary ? " primary" : ""), label);
        button.type = "button"; button.addEventListener("click", callback); footer.append(button); return button;
      };
      const list = (items, className = "") => {
        const ul = make("ul", className);
        for (const item of items) {
          const value = text(typeof item === "string" ? item : item?.message || item?.title || item?.label || "");
          if (value) ul.append(make("li", "", value));
        }
        return ul;
      };
      try {
        const value = await options.request(path(selectedId) + "/optimization/check", {method: "POST"});
        if (!current()) return;
        if (value?.schema !== "tabula-optimization-check/v1" || !["ready", "blocked"].includes(value.status) ||
            !value.source || ["model_id", "version_id", "revision"].some(key => sourceModel[key] != null &&
              String(value.source[key]) !== String(sourceModel[key]))) {
          throw new Error("Не удалось подтвердить проверку выбранной версии модели. Повторите проверку.");
        }
        content.replaceChildren();
        const canRun = value.status === "ready" && value.can_run === true;
        const source = make("section", "optimization-check-source");
        source.append(make("span", "optimization-check-eyebrow", "Модель из Табулы"),
          make("h3", "", text(value.source.label || sourceModel.label) || "Выбранная модель"));
        const count = Number(value.counts?.indicators), links = Number(value.counts?.links);
        if (Number.isFinite(count) && Number.isFinite(links)) source.append(make("p", "", `${count.toLocaleString("ru-RU")} показателей · ${links.toLocaleString("ru-RU")} связей`));
        content.append(source);
        const result = make("section", "optimization-check-result " + (canRun ? "ready" : "blocked"));
        result.append(make("strong", "", canRun ? "Расчёт доступен" : "Для расчёта нужны дополнительные условия"));
        result.append(make("p", "", text(value.message) || (canRun ? "Данные и правила для запуска подтверждены." : "Проверка показала, какие условия необходимо добавить к модели.")));
        content.append(result);
        if (value.objective?.title || !canRun) {
          const objective = make("section", "optimization-check-objective");
          objective.append(make("h3", "", "Цель расчёта"));
          objective.append(make("p", "", text(value.objective?.title) || "Нужно указать показатель и направление расчёта."));
          if (value.objective?.origin === "requested_not_declared") objective.append(make("p", "optimization-check-footnote", "Для этой цели нужно подтвердить связь с показателями и условиями модели."));
          content.append(objective);
        }
        const contours = Array.isArray(value.contours) ? value.contours.filter(contour =>
          contour.status !== "not_applicable" || (Array.isArray(contour.roles) && contour.roles.some(role => role.status === "matched"))) : [];
        if (contours.length) {
          const section = make("section", "optimization-check-contours");
          section.append(make("h3", "", "Что найдено в модели"));
          const grid = make("div", "optimization-check-grid");
          for (const contour of contours) {
            const card = make("article", "optimization-check-contour");
            const ready = ["ready", "confirmed", "complete", "available", "covered"].includes(contour.status);
            const status = ready ? "Данные найдены" : ({partial: "Частично", detected: "Есть в модели",
              needs_policy: "Нужны правила", ambiguous: "Нужно уточнить", not_applicable: "Недостаточно данных",
              invalid_graph: "Нужна проверка графа"}[contour.status] || "Нужны условия");
            const top = make("div", "optimization-check-contour-heading");
            top.append(make("strong", "", text(contour.title) || "Область расчёта"), make("span", "badge " + (ready ? "success" : "warning"), status));
            card.append(top);
            const matchedRoles = Array.isArray(contour.roles) ? contour.roles.filter(role =>
              typeof role === "string" || role.status === "matched") : [];
            if (matchedRoles.length) card.append(make("p", "optimization-check-footnote", "Есть в модели:"), list(matchedRoles, "optimization-check-roles"));
            if (Array.isArray(contour.missing) && contour.missing.length) card.append(
              make("p", "optimization-check-footnote", "Нужно добавить или уточнить:"), list(contour.missing, "optimization-check-missing"));
            if (contour.solver_adapter_available === false) card.append(make("p", "optimization-check-footnote", "Для этого направления ещё не подключён расчётный модуль."));
            grid.append(card);
          }
          section.append(grid); content.append(section);
        }
        const blockers = Array.isArray(value.blockers) ? value.blockers : [];
        if (blockers.length) {
          const section = make("section", "optimization-check-blockers");
          section.append(make("h3", "", "Что нужно определить"), list(blockers)); content.append(section);
        }
        if (Array.isArray(value.warnings) && value.warnings.length) {
          const section = make("section", "optimization-check-warnings");
          section.append(make("h3", "", "Что учесть"), list(value.warnings)); content.append(section);
        }
        if (canRun) {
          const run = addButton("К расчёту", async () => {
            if (!current() || availability.busy) return;
            run.disabled = true;
            await refresh(true);
            if (!current()) return;
            if (flow?.status !== "ready" || flow.optimization_ready !== true) {
              content.append(make("p", "optimization-check-error", "Готовность модели изменилась. Закройте окно и повторите проверку."));
              return;
            }
            closeOptimizationCheck(); options.onMode?.("optimization");
          }, true);
        } else {
          const discuss = addButton("Обсудить условия", () => {
            if (!current() || availability.busy || !availability.analysis) return;
            const reasons = blockers.map(item => text(item?.message)).filter(Boolean).slice(0, 5);
            const prompt = "Помоги определить условия оптимизации для выбранной модели. Какие управляемые показатели, ограничения и правила нужно задать по имеющимся данным?" +
              (reasons.length ? "\nПроверка модели выявила:\n" + reasons.map(reason => "- " + reason).join("\n") : "");
            closeOptimizationCheck(); options.onMode?.("analysis", {prompt});
          }, true);
          discuss.disabled = !availability.analysis;
          if (!availability.analysis) footer.append(make("span", "optimization-check-footnote", "Обсуждение условий пока недоступно. Проверьте подключение аналитики."));
        }
      } catch (failure) {
        if (!current()) return;
        content.replaceChildren(make("p", "optimization-check-error", text(failure.message) || "Не удалось проверить условия расчёта. Повторите проверку."));
        addButton("Повторить проверку", () => { closeOptimizationCheck(); openOptimizationCheck(); }, true);
      }
    }
    function mountGraphHtml(html, blob, label) {
      const returnFocus = document.activeElement;
      const dialog = make("section", "graph-html-dialog graph-html-inline"), header = make("header", "graph-html-header");
      const heading = make("div", "graph-html-heading"), actions = make("div", "graph-html-actions");
      heading.append(make("strong", "", "3D-граф зависимостей"), make("span", "", label));
      const frame = make("iframe", "graph-html-frame");
      frame.title = "Трёхмерный граф зависимостей модели «" + label + "»";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("allow", "fullscreen");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.srcdoc = html;
      const downloadUrl = URL.createObjectURL(blob);
      const filename = "Граф_" + (label.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").replace(/[.\s]+$/g, "").slice(0, 90) || "модель") + ".html";
      const button = (title, callback, extraClass = "") => {
        const value = make("button", "graph-html-button " + extraClass, title); value.type = "button";
        value.addEventListener("click", callback); actions.append(value); return value;
      };
      button("В отдельном окне", () => {
        const popup = window.open("about:blank", "_blank", "popup,width=1440,height=900");
        if (!popup) { options.onNotice?.("Браузер заблокировал новое окно. Разрешите всплывающие окна для Harness или скачайте HTML.", true); return; }
        try {
          popup.opener = null;
          popup.document.open();
          popup.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>3D-граф зависимостей</title></head><body style="margin:0;background:#071019;overflow:hidden"></body></html>');
          popup.document.close();
          popup.document.title = label + " · 3D-граф";
          const detached = popup.document.createElement("iframe");
          detached.title = frame.title; detached.setAttribute("sandbox", "allow-scripts");
          detached.setAttribute("allow", "fullscreen"); detached.setAttribute("referrerpolicy", "no-referrer");
          detached.style.cssText = "display:block;width:100vw;height:100dvh;border:0";
          detached.srcdoc = html; popup.document.body.append(detached); popup.focus();
        } catch (_) {
          try { popup.close(); } catch (_) {}
          options.onNotice?.("Не удалось открыть отдельное окно. Граф можно посмотреть здесь или скачать как HTML.", true);
        }
      });
      button("Скачать HTML", () => {
        const link = make("a"); link.href = downloadUrl; link.download = filename;
        document.body.append(link); link.click(); link.remove();
      });
      const leaveGraph = () => { closeGraph(); options.onMode?.("analysis"); };
      const closeButton = button("Закрыть", leaveGraph, "graph-html-close");
      const cancel = event => { event.preventDefault(); leaveGraph(); };
      dialog.addEventListener("cancel", cancel);
      dialog.setAttribute("aria-label", "3D-граф модели «" + label + "»");
      header.append(heading, actions); dialog.append(header, frame);
      try {
        graphRoot.replaceChildren(dialog); graphRoot.hidden = false;
        dialog.setAttribute("open", ""); dialog.setAttribute("role", "region");
        graphRoot.closest(".main")?.classList.add("graph-is-open");
        closeButton.focus();
      } catch (failure) {
        frame.srcdoc = ""; dialog.remove(); URL.revokeObjectURL(downloadUrl); graphRoot.hidden = true;
        throw failure;
      }
      return {
        focus() { closeButton.focus(); },
        destroy() {
          dialog.removeEventListener("cancel", cancel);
          if (typeof dialog.close === "function" && dialog.open) dialog.close();
          frame.srcdoc = ""; dialog.remove(); URL.revokeObjectURL(downloadUrl);
          if (returnFocus?.isConnected) returnFocus.focus();
        }
      };
    }
    async function selectChat(id) {
      generation++; clearTimeout(timer); closeGraph(); closeOptimizationCheck(); closePublishDialog(); detailsExpanded = false;
      chatId = id; flow = null; error = ""; loading = !!id; requestBusy = false; pollFailures = 0; emit();
      if (id) await refresh();
    }
    async function refresh(quiet = false) {
      if (!chatId || !availability.connected) return;
      const selectedId = chatId, currentGeneration = generation;
      try {
        const value = await options.request(path(selectedId));
        if (currentGeneration !== generation || selectedId !== chatId) return;
        flow = value; error = ""; pollFailures = 0;
      } catch (_) {
        if (currentGeneration !== generation || selectedId !== chatId) return;
        pollFailures++;
        error = "Не удалось обновить состояние модели. Проверьте подключение и повторите запрос.";
        if (!quiet) options.onNotice?.(error, true);
      } finally {
        if (currentGeneration === generation && selectedId === chatId) {
          loading = false;
          if (["failed", "needs_input", "cancelled"].includes(flow?.status)) graphWanted = false;
          emit(); schedule();
          presentReadyGraph();
          queueMicrotask(prepareGraphAutomatically);
        }
      }
    }
    async function command(suffix = "", body, allowBusy = false) {
      if (!chatId || !availability.connected || loading || requestBusy || (availability.busy && !allowBusy)) return;
      const selectedId = chatId, currentGeneration = generation;
      requestBusy = true; error = ""; emit();
      try {
        const value = await options.request(path(selectedId) + suffix, {method: "POST", ...(body ? {json: body} : {})});
        if (currentGeneration !== generation || selectedId !== chatId) return;
        flow = value; error = ""; pollFailures = 0;
        return value;
      } catch (failure) {
        if (currentGeneration !== generation || selectedId !== chatId) return;
        const message = text(failure.message) || "Не удалось выполнить действие. Повторите запрос.";
        error = suffix === "/publish" ? "" : message;
        options.onNotice?.(message, true);
      } finally {
        if (currentGeneration === generation && selectedId === chatId) { requestBusy = false; emit(); schedule(); presentReadyGraph(); queueMicrotask(prepareGraphAutomatically); }
      }
    }
    async function start(value = {}) {
      if (value.chatId && value.chatId !== chatId) return;
      return command("", undefined, value.allowBusy === true);
    }
    async function openGraph() {
      if (disabled() || !graphRoot || graphPending) return;
      if (flow?.status === "ready" && flow.graph?.ready) return showGraph();
      if (!flow?.can_request_graph) return;
      const selectedId = chatId, currentGeneration = generation;
      graphWanted = true;
      const value = await command("/graph");
      if (selectedId !== chatId || currentGeneration !== generation) return;
      if (!value) { graphWanted = false; render(); return; }
      if (flow?.status === "ready" && flow.graph?.ready) return showGraph();
      if (["failed", "needs_input", "cancelled"].includes(flow?.status)) graphWanted = false;
      render(); schedule();
    }
    async function showGraph() {
      if (flow?.status !== "ready" || !flow.graph?.ready || !graphRoot || graphPending) return;
      if (graphView) { graphView.focus?.(); return; }
      const selectedId = chatId, currentGeneration = generation, requestedRevision = ++graphRevision;
      graphWanted = false; graphPending = true; render();
      try {
        const blob = await options.request(path(selectedId) + "/graph/html", {blob: true});
        const html = await blob.text();
        if (selectedId !== chatId || currentGeneration !== generation || requestedRevision !== graphRevision) return;
        if (!/<(?:!doctype\s+html|html\b)/i.test(html)) throw new Error("Сервис не вернул HTML графа. Повторите открытие.");
        graphView = mountGraphHtml(html, blob, text(flow.model?.label) || "Модель Табулы");
        presentedGraphs.add(graphIdentity());
      } catch (failure) {
        if (selectedId === chatId && currentGeneration === generation && requestedRevision === graphRevision) options.onNotice?.(text(failure.message) || "Не удалось открыть 3D-граф. Повторите открытие.", true);
      } finally { if (currentGeneration === generation && requestedRevision === graphRevision) { graphPending = false; render(); } }
    }
    const stage = id => (flow?.stages || []).find(item => item.id === id);
    const fromTabula = () => flow?.source === "tabula";
    const compileReady = () => flow?.compilation?.ready === true || completed.has(stage("compile")?.status);
    const needsInput = () => flow?.stage === "compile" && (flow?.status === "needs_input" || (!["ready", "failed"].includes(flow?.status) && flow?.compilation?.status === "needs_input"));
    function flowMessage() {
      if (error) return error;
      if (loading) return "Проверяем состояние модели…";
      if (!flow) return "Эта модель пока открыта как отдельный расчёт. Её можно подключить к единому контуру Табулы.";
      if (fromTabula()) {
        if (["failed", "needs_input", "needs_reconciliation"].includes(flow.status)) return text(flow.message) || "Не удалось получить актуальную модель из Табулы. Проверьте состояние подключения.";
        if (flow.status === "ready") return "Актуальная модель получена из Табулы. Граф её зависимостей готов к просмотру.";
        if (["awaiting_connections", "waiting_dependencies"].includes(flow.status)) return text(flow.message) || "Ожидаем подключение Табулы для получения модели.";
        return flow.stage === "graph" ? "Модель получена из Табулы. Строим 3D-граф зависимостей…" : "Получаем выбранную модель из Табулы с движениями…";
      }
      if (needsInput()) return "Нужно уточнить модель.";
      if (flow.status === "prepared") return flow.can_load_model === true ?
        "Excel подготовлен. Нажмите «Загрузить в Табулу», чтобы создать модель." :
        "Excel подготовлен. Приём новых моделей Табулой пока не подтверждён. Загрузка станет доступна после проверки подключения.";
      if (flow.status === "model_loaded") return "Отдельная копия модели создана в Табуле. Граф зависимостей будет подготовлен автоматически.";
      if (flow.status === "waiting_export" || flow.status === "needs_input") return text(flow.message) || "Ожидаем XML модели с движениями из Табулы.";
      if (["awaiting_connections", "waiting_dependencies"].includes(flow.status)) {
        if (flow.stage === "compile") return "Компилятор Excel не подключён.";
        if (flow.stage === "deploy") return compileReady() ? "Excel подготовлен. Ожидаем подключение к Табуле." : "Ожидаем подключение к Табуле.";
        if (flow.stage === "export") return "Ожидаем получение данных модели из Табулы для графа связей.";
        if (flow.stage === "graph") return "Модель в Табуле. Ожидаем подключение для построения графа связей.";
        return compileReady() ? "Excel подготовлен. Ожидаем подключение к Табуле." : "Компилятор Excel не подключён.";
      }
      if (flow.status === "needs_reconciliation") return "Уточняем состояние модели в Табуле. Повторная загрузка временно недоступна.";
      if (flow.status === "failed") return text(flow.message) || "Подготовка модели не завершена. Можно повторить после проверки подключения.";
      if (flow.status === "ready" && flow.graph?.unresolved_reference_count) return "Граф построен. В исходной модели есть ссылки на отсутствующие справочные объекты: " + flow.graph.unresolved_reference_count + ". Их значения не восстановлены; для оптимизации нужно дополнить исходную модель.";
      if (flow.status === "ready") return flow.optimization_ready ?
        "Модель в Табуле и граф связей готовы. Можно исследовать показатели и рассчитать новый план." :
        "Модель в Табуле и граф связей готовы. Для оптимизации ещё требуется подтвердить данные и правила расчёта.";
      if (flow.stage === "compile") return "Подготавливаем таблицы, формулы и связи модели из Excel…";
      if (flow.stage === "deploy") return compileReady() ? "Excel подготовлен. Создаём отдельную копию модели в Табуле…" : "Создаём отдельную копию модели в Табуле…";
      if (flow.stage === "export") return "Модель создана в Табуле. Получаем её данные для графа связей…";
      if (flow.stage === "graph") return "Модель в Табуле. Строим граф связей…";
      return text(flow.message) || "Готовим модель в Табуле и формируем граф связей…";
    }
    function stageStatus(value) {
      if (completed.has(value)) return "completed";
      if (active.has(value) || value === "waiting_export") return "running";
      if (["awaiting_connections", "waiting_dependencies"].includes(value)) return "blocked";
      if (value === "needs_input") return "needs-input";
      if (value === "needs_reconciliation") return "reconciling";
      if (value === "failed") return "failed";
      return "waiting";
    }
    function stageState(index) {
      if (!flow) return "waiting";
      if (fromTabula()) {
        if (index === 0) return "completed";
        if (index === 1) return flow.stage === "graph" || flow.status === "ready" || completed.has(stage("export")?.status) ? "completed" : stageStatus(flow.status);
        return flow.status === "ready" && flow.graph?.ready ? "completed" : flow.stage === "graph" ? stageStatus(flow.status) : "waiting";
      }
      if (index === 0) return "completed";
      if (index === 1) {
        if (compileReady()) return "completed";
        if (needsInput()) return "needs-input";
        if (flow.compilation?.status === "failed") return "failed";
        return stageStatus(stage("compile")?.status || (flow.stage === "compile" ? flow.status : null));
      }
      if (index === 2) {
        const deployment = stage("deploy");
        if (completed.has(deployment?.status)) return "completed";
        return stageStatus(deployment?.status || (flow.stage === "deploy" ? flow.status : null));
      }
      if (index === 3) {
        if (flow.graph?.ready) return "completed";
        if (flow.status === "model_loaded") return "waiting";
        return stageStatus(["export", "graph"].includes(flow.stage) ? flow.status : stage("graph")?.status);
      }
      return flow.status === "ready" ? "completed" : "waiting";
    }
    function renderCompilation() {
      const compilation = flow?.compilation;
      if (!compilation) return;
      const summary = compilation.summary || {}, facts = make("dl", "model-flow-summary");
      [["form_count", "Таблиц"], ["formula_count", "Формул"]].forEach(([key, label]) => {
        const value = summary[key];
        if (value == null || (typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return;
        const count = Number(value);
        if (!Number.isSafeInteger(count) || count < 0) return;
        const fact = make("div", "model-flow-fact");
        fact.append(make("dt", "", label), make("dd", "", count.toLocaleString("ru-RU"))); facts.append(fact);
      });
      if (facts.childNodes.length) root.append(facts);
      if (!needsInput() && flow.status !== "failed" && compilation.status !== "failed") return;
      const issues = [], seen = new Set();
      for (const issue of Array.isArray(compilation.issues) ? compilation.issues : []) {
        if (typeof issue?.message !== "string") continue;
        const message = text(issue.message).replace(/\s+/g, " ").trim();
        if (!message || seen.has(message)) continue;
        seen.add(message); issues.push(message.length > 300 ? message.slice(0, 297).trimEnd() + "…" : message);
        if (issues.length === 5) break;
      }
      if (!issues.length && needsInput()) issues.push("Уточните данные и правила расчёта, чтобы продолжить подготовку модели.");
      if (!issues.length) return;
      const box = make("div", "model-flow-issues");
      box.append(make("strong", "", needsInput() ? "Что нужно уточнить" : "Что мешает подготовке"));
      const list = make("ul"); issues.forEach(message => list.append(make("li", "", message))); box.append(list); root.append(box);
    }
    function render() {
      root.hidden = !chatId;
      if (!chatId) return;
      root.closest(".main")?.querySelectorAll("[data-publish-plan]").forEach(button => {
        button.disabled = disabled() || flow?.status !== "ready" || active.has(flow?.publication?.status) || flow?.publication?.status === "needs_reconciliation";
      });
      root.replaceChildren();
      const ready = flow?.status === "ready" && flow.graph?.ready && !error && !loading;
      root.classList.toggle("model-flow-compact", ready && !detailsExpanded);
      if (ready && !detailsExpanded) {
        const strip = make("div", "model-flow-ready-strip"), copy = make("div", "model-flow-ready-copy");
        const incomplete = !!flow.graph.unresolved_reference_count;
        copy.append(make("span", "model-flow-ready-mark" + (incomplete ? " warning" : ""), incomplete ? "!" : "✓"),
          make("strong", "", incomplete ? "Модель готова с замечаниями" : "Модель готова"),
          make("span", "model-flow-ready-count", `${Number(flow.graph.active_node_count ?? flow.graph.node_count ?? 0).toLocaleString("ru-RU")} показателей · ${Number(flow.graph.edge_count || 0).toLocaleString("ru-RU")} связей`));
        const controls = make("div", "model-flow-ready-controls");
        if (flow.publication) {
          const publication = flow.publication;
          controls.append(make("span", "model-flow-ready-publication", ["applied", "ready", "completed"].includes(publication.status) ? "Новый план записан" : text(publication.message) || "Передаём новый план…"));
          if (["needs_input", "failed", "needs_reconciliation", "waiting_dependencies"].includes(publication.status)) {
            const retry = make("button", "model-flow-button", "Проверить передачу"); retry.type = "button";
            retry.disabled = disabled(); retry.addEventListener("click", () => command("/resume")); controls.append(retry);
          }
        }
        const details = make("button", "model-flow-details-toggle", "Подробнее"); details.type = "button";
        details.setAttribute("aria-expanded", "false"); details.addEventListener("click", () => { detailsExpanded = true; render(); });
        controls.append(details); strip.append(copy, controls); root.append(strip); return;
      }
      const heading = make("div", "model-flow-heading"), title = make("div");
      title.append(make("strong", "", fromTabula() ? "Граф модели из Табулы" : flow ? "Загрузка модели в Табулу" : "Загрузка модели"), make("p", "model-flow-message", flowMessage()));
      heading.append(title);
      const graphIncomplete = flow?.status === "ready" && !!flow.graph?.unresolved_reference_count;
      const status = loading ? "Проверяем" : needsInput() ? "Нужно уточнить модель" : graphIncomplete ? "Граф с ограничениями" : flow?.status === "ready" ? "Готово" : ["failed", "needs_input", "needs_reconciliation"].includes(flow?.status) ? "Нужна проверка" : ["awaiting_connections", "waiting_dependencies"].includes(flow?.status) ? "Ждём подключение" : fromTabula() ? flow.stage === "graph" ? "Строим граф" : "Получаем модель" : flow?.status === "prepared" ? "Excel подготовлен" : flow?.status === "model_loaded" ? "Модель загружена" : flow ? "Подготовка" : "Не подключено";
      heading.append(make("span", "badge " + (graphIncomplete ? "warning" : ["ready", "model_loaded"].includes(flow?.status) ? "success" : error || needsInput() || ["failed", "needs_input"].includes(flow?.status) ? "warning" : "neutral"), status));
      root.append(heading);
      if (ready) {
        const collapse = make("button", "model-flow-details-toggle", "Свернуть"); collapse.type = "button";
        collapse.setAttribute("aria-expanded", "true"); collapse.addEventListener("click", () => { detailsExpanded = false; render(); }); heading.append(collapse);
      }
      if (flow) {
        const steps = make("ol", "model-flow-stages");
        const stateLabels = {waiting: "Ожидает", completed: "Готово", running: "В работе", blocked: "Ждём подключения", "needs-input": "Нужны уточнения", reconciling: "Проверяем состояние", failed: "Нужна проверка"};
        const labels = fromTabula() ? ["Модель выбрана", "Получение из Табулы", "Граф зависимостей"] : ["Excel принят", "Подготовка Excel", "Модель в Табуле"];
        labels.forEach((label, index) => {
          const state = stageState(index), item = make("li", "model-flow-stage " + state), copy = make("span", "model-flow-stage-copy");
          if (["running", "blocked", "needs-input", "reconciling", "failed"].includes(state)) item.setAttribute("aria-current", "step");
          copy.append(make("span", "model-flow-stage-label", label), make("span", "model-flow-stage-status", state === "completed" && index === 0 ? fromTabula() ? "Выбрана" : "Получен" : stateLabels[state]));
          item.append(make("span", "model-flow-stage-mark", state === "completed" ? "✓" : state === "needs-input" || state === "failed" ? "!" : index + 1), copy); steps.append(item);
        });
        root.append(steps);
        renderCompilation();
      }
      const actions = make("div", "model-flow-actions");
      function action(label, fn, blocked = false, primary = false) {
        const button = make("button", "model-flow-button" + (primary ? " primary" : ""), label); button.type = "button";
        button.disabled = disabled() || blocked; button.addEventListener("click", fn); actions.append(button); return button;
      }
      if (!flow && !loading) action(error ? "Проверить состояние" : "Подключить к Табуле", () => error ? refresh() : start(), false, !error);
      if (flow?.can_resume === true && !fromTabula()) {
        const label = flow.stage === "deploy" ? flow.status === "needs_reconciliation" ? "Проверить загрузку" : "Загрузить в Табулу" : "Продолжить подготовку";
        action(label, () => command("/resume"), flow.stage === "deploy" && flow.status === "prepared" && flow.can_load_model !== true, true);
      }
      if (flow) {
        const graphWorking = flow.graph_requested && ["export", "graph"].includes(flow.stage) && polling.has(flow.status);
        const graphLabel = graphPending ? "Открываем граф…" : graphWorking ? flow.stage === "export" ? "Получаем модель…" : "Строим граф…" : ["failed", "needs_input"].includes(flow.status) && flow.can_request_graph ? "Повторить получение графа" : flow.status === "ready" && flow.graph?.ready ? "Открыть 3D-граф" : "Граф зависимостей";
        if (!ready) action(graphLabel, openGraph, (!flow.can_request_graph && !(flow.status === "ready" && flow.graph?.ready)) || graphWorking || graphPending);
        if (flow.status === "ready" && flow.graph?.ready) actions.append(make("span", "model-flow-count", `${Number(flow.graph.active_node_count ?? flow.graph.node_count ?? 0).toLocaleString("ru-RU")} показателей${flow.graph.context_node_count ? ` · ${Number(flow.graph.context_node_count).toLocaleString("ru-RU")} узлов шаблонов` : ""} · ${Number(flow.graph.edge_count || 0).toLocaleString("ru-RU")} связей`));
        if (error || ["awaiting_connections", "waiting_dependencies"].includes(flow.status) || (flow.status === "prepared" && flow.can_load_model !== true)) action("Обновить состояние", () => refresh());
      }
      if (actions.childNodes.length) root.append(actions);
      if (flow?.publication) {
        const publication = flow.publication;
        root.append(make("p", "model-flow-publication " + (["completed", "ready", "applied"].includes(publication.status) ? "complete" : ""), publicationLabels[publication.status] || text(publication.message) || "Уточняем состояние новой версии плана."));
      }
    }
    function buildPublish(task) {
      const context = task.tabula_context, model = flow?.model;
      if (!flow || flow.status !== "ready" || !model || !context || context.pipeline_id !== flow.id ||
          ["model_id", "version_id", "revision"].some(key => context[key] == null || String(context[key]) !== String(model[key])) ||
          task.kind !== "optimization" || !["completed", "needs_review"].includes(task.status) || !task.result?.verification?.passed) return null;
      const publication = flow.publication;
      const box = make("div", "model-flow-plan-action");
      const copy = make("div"); copy.append(make("strong", "", "Новый план в Табуле"), make("p", "", "Записать оптимизированный план отдельной моделью и проверить результаты пересчёта.")); box.append(copy);
      const publishedTask = publication?.task_id || publication?.optimization_task_id;
      if (publishedTask === task.id && ["completed", "ready", "applied"].includes(publication.status)) { box.append(make("span", "badge success", "Копия создана")); return box; }
      const button = make("button", "model-flow-button primary", "Подгрузить новый план в Табулу"); button.type = "button";
      button.dataset.publishPlan = task.id;
      button.disabled = disabled() || active.has(publication?.status) || publication?.status === "needs_reconciliation";
      button.addEventListener("click", () => confirmPublish(task)); box.append(button); return box;
    }
    return Object.freeze({selectChat, refresh, start, buildPublish, closeGraph, openGraph, openOptimizationCheck,
      watchGraph() { graphWanted = true; presentReadyGraph(); schedule(); },
      setAvailability(value) { availability = {...availability, ...value}; if (!availability.connected) { clearTimeout(timer); closeOptimizationCheck(); closePublishDialog(); } render(); if (!availability.busy) { queueMicrotask(presentReadyGraph); queueMicrotask(prepareGraphAutomatically); } },
      current() { return {flow, loading, error}; }
    });
  }
  return Object.freeze({mount});
})();
