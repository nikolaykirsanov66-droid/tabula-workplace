(function () {
  'use strict';

  // The graph is supplied by the server. Layout coordinates never create model
  // relations, and the viewer neither changes values nor infers business rules.
  const PALETTE = ['#186dc9', '#258065', '#8a64bb', '#b7771d', '#b55c81', '#398594', '#687e39', '#7276ba', '#a36b4d', '#4c7b9d'];
  const KINDS = { input:'Ввод', manual:'Ввод', parameter:'Параметр', calculated:'Расчётный показатель', formula:'Расчётный показатель', indicator:'Показатель', objective:'Целевой показатель', goal:'Целевой показатель', constraint:'Ограничение', fact:'Факт', decision:'Управляемое решение', dimension:'Измерение' };
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 });
  const count = new Intl.NumberFormat('ru-RU');
  const display = value => window.TabulaPresentation?.label?.(value) ?? String(value ?? '');
  let serial = 0;

  function el(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = display(text);
    return item;
  }
  function button(label, className) {
    const item = el('button', 'tg-btn' + (className ? ' ' + className : ''), label);
    item.type = 'button';
    return item;
  }
  function hash(value) {
    let result = 2166136261;
    for (const character of String(value)) { result ^= character.codePointAt(0); result = Math.imul(result, 16777619); }
    return result >>> 0;
  }
  function valueText(node) {
    if (node.active_plan === false) return 'Вне текущего плана';
    const value = node.value;
    if (value === null || value === undefined || value === '') return 'Не передано';
    if (typeof value === 'number') return Number.isFinite(value) ? number.format(value) : 'Не передано';
    if (typeof value === 'string' || typeof value === 'boolean') return String(value);
    return 'Составное значение';
  }
  function kindText(node) { return node.active_plan === false ? 'Шаблон · только чтение' : Object.prototype.hasOwnProperty.call(KINDS, node.kind) ? KINDS[node.kind] : String(node.kind || 'Показатель'); }
  function dot(color) { const item = el('i', 'tg-dot'); item.style.setProperty('--tg-color', color); item.setAttribute('aria-hidden', 'true'); return item; }
  function normalized(text) { return String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е'); }
  function short(text, maximum) { return text.length <= maximum ? text : text.slice(0, maximum - 1) + '…'; }

  function open(container, graph, options) {
    if (!(container instanceof Element)) throw new TypeError('Для графа нужен контейнер страницы.');
    const config = options || {};
    const root = el('section', 'tg-view');
    root.setAttribute('aria-label', 'Граф зависимостей модели');
    const head = el('header', 'tg-head');
    const heading = el('div', 'tg-heading');
    heading.append(el('h2', '', 'Граф зависимостей'));
    const counts = el('p', 'tg-counts');
    heading.append(counts);
    const actions = el('div', 'tg-actions');
    const resetButton = button('Общий вид');
    const closeButton = button('Закрыть');
    actions.append(resetButton);
    if (typeof config.onClose === 'function') actions.append(closeButton);
    head.append(heading, actions);
    root.append(head);
    container.append(root);
    let destroyed = false;
    const cleanup = [];
    let frame = 0;
    let resizeObserver = null;
    function listen(target, name, callback, settings) {
      target.addEventListener(name, callback, settings);
      cleanup.push(() => target.removeEventListener(name, callback, settings));
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      if (resizeObserver) resizeObserver.disconnect();
      cleanup.forEach(remove => remove());
      root.remove();
    }
    function close() { destroy(); if (typeof config.onClose === 'function') config.onClose(); }
    listen(closeButton, 'click', close);
    const controller = { destroy, select: () => false, reset: () => {} };
    function empty(title, description) {
      counts.textContent = 'Связи появятся после получения графа из Табулы';
      resetButton.disabled = true;
      const block = el('div', 'tg-empty');
      const copy = el('div'); copy.append(el('h3', '', title), el('p', '', description)); block.append(copy); root.append(block);
      return controller;
    }
    if (!graph || graph.schema_version !== 'tabula-graph/v1' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return empty('Граф пока недоступен', 'Для этой модели ещё не получен граф зависимостей из Табулы. После подключения сервера здесь появятся показатели и связи модели.');
    }
    if (!graph.nodes.length) return empty('В графе пока нет показателей', 'Табула вернула пустой граф. Открой заполненную модель и обнови её граф.');

    const byId = new Map();
    const nodes = [];
    let duplicateCount = 0;
    graph.nodes.forEach(raw => {
      if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || byId.has(raw.id)) { duplicateCount++; return; }
      const node = { ...raw, id:raw.id, label:String(raw.label || raw.id), group:String(raw.group || 'Без группы'), index:nodes.length, incoming:[], outgoing:[], x:0, y:0, z:0 };
      nodes.push(node); byId.set(node.id, node);
    });
    if (!nodes.length) return empty('Не удалось прочитать показатели', 'Узлам графа нужны неповторяющиеся строковые идентификаторы. Проверь экспорт модели.');
    const edges = [];
    let invalidEdges = 0;
    graph.edges.forEach(raw => {
      const source = raw && byId.get(raw.source), target = raw && byId.get(raw.target);
      if (!source || !target) { invalidEdges++; return; }
      const edge = { source:source.index, target:target.index, kind:String(raw.kind || '') };
      source.outgoing.push(edge); target.incoming.push(edge); edges.push(edge);
    });
    const contextCount = nodes.filter(node => node.active_plan === false).length;
    const unexpandedWorkflowCount = Array.isArray(graph.source?.unexpanded_context_references) ? graph.source.unexpanded_context_references.length : 0;
    const unresolvedReferenceCount = Array.isArray(graph.source?.unresolved_references) ? graph.source.unresolved_references.length : 0;
    counts.textContent = count.format(nodes.length - contextCount) + ' показателей' + (contextCount ? ' · ' + count.format(contextCount) + ' узлов шаблонов' : '') + ' · ' + count.format(edges.length) + ' связей' + (unresolvedReferenceCount ? ' · ' + count.format(unresolvedReferenceCount) + ' отсутствующих справочных ссылок' : '') + ' · 3D';
    const groups = new Map();
    nodes.forEach(node => {
      if (!groups.has(node.group)) groups.set(node.group, { name:node.group, nodes:[], color:PALETTE[hash(node.group) % PALETTE.length] });
      const group = groups.get(node.group); group.nodes.push(node); node.color = group.color;
      node.degree = node.incoming.length + node.outgoing.length;
      node.search = normalized(node.label + ' ' + node.group + ' ' + display(node.label) + ' ' + display(node.group) + ' ' + kindText(node));
    });
    const orderedGroups = Array.from(groups.values()).sort((a, b) => b.nodes.length - a.nodes.length || a.name.localeCompare(b.name, 'ru'));
    const ranked = nodes.slice().sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));

    // O(V + E) traversal gives each group a local dependency depth. There is no
    // force simulation: large graphs remain still until the camera moves.
    let extent = 1;
    orderedGroups.forEach((group, groupIndex) => {
      group.nodes.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
      const depth = new Map();
      let maxDepth = 1;
      group.nodes.forEach(seed => {
        if (depth.has(seed.index)) return;
        depth.set(seed.index, 0);
        const queue = [seed];
        for (let headIndex = 0; headIndex < queue.length; headIndex++) {
          const current = queue[headIndex];
          const nextDepth = depth.get(current.index) + 1;
          function visit(edge) {
            const nextIndex = edge.source === current.index ? edge.target : edge.source;
            const next = nodes[nextIndex];
            if (next.group !== group.name || depth.has(nextIndex)) return;
            depth.set(nextIndex, nextDepth); maxDepth = Math.max(maxDepth, nextDepth); queue.push(next);
          }
          current.incoming.forEach(visit); current.outgoing.forEach(visit);
        }
      });
      const sectorRadius = orderedGroups.length === 1 ? 0 : 70 + Math.sqrt(nodes.length) * 1.4;
      const sphereY = 1 - 2 * (groupIndex + 0.5) / orderedGroups.length;
      const sectorAngle = groupIndex * Math.PI * (3 - Math.sqrt(5));
      const sphereR = Math.sqrt(1 - sphereY * sphereY);
      const center = [Math.cos(sectorAngle) * sphereR * sectorRadius, sphereY * sectorRadius * 0.65, Math.sin(sectorAngle) * sphereR * sectorRadius];
      const spread = Math.min(160, 22 + Math.sqrt(group.nodes.length) * 2.3);
      group.nodes.forEach((node, index) => {
        const nodeY = 1 - 2 * (index + 0.5) / group.nodes.length;
        const nodeAngle = index * Math.PI * (3 - Math.sqrt(5)) + (hash(node.id) % 100) * 0.002;
        const nodeR = Math.sqrt(1 - nodeY * nodeY);
        const importance = index === 0 ? 0.22 : 0.75 + (hash(node.id) % 100) / 400;
        node.x = center[0] + Math.cos(nodeAngle) * nodeR * spread * importance;
        node.y = center[1] + nodeY * spread * 0.6 + (0.5 - depth.get(node.index) / maxDepth) * spread * 0.55;
        node.z = center[2] + Math.sin(nodeAngle) * nodeR * spread * importance;
        extent = Math.max(extent, Math.hypot(node.x, node.y, node.z) + 12);
      });
    });

    const uid = 'tg-search-' + (++serial);
    const searchWrap = el('div', 'tg-search-wrap');
    const searchRow = el('div', 'tg-search-row');
    const searchLabel = el('label', 'tg-search-label', 'Найти показатель'); searchLabel.htmlFor = uid;
    const search = el('input', 'tg-search'); search.id = uid; search.type = 'search'; search.placeholder = 'Например, выручка или страховые взносы'; search.autocomplete = 'off'; search.setAttribute('aria-label', 'Найти показатель в графе');
    const results = el('div', 'tg-results'); results.hidden = true; results.id = uid + '-results'; search.setAttribute('aria-controls', results.id); search.setAttribute('aria-expanded', 'false');
    searchRow.append(searchLabel, search); searchWrap.append(searchRow, results); root.append(searchWrap);
    const body = el('div', 'tg-body');
    const scene = el('div', 'tg-scene');
    const canvas = el('canvas', 'tg-canvas'); canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Трёхмерный граф. Стрелки — поворот, плюс и минус — масштаб. Найти показатель можно в поиске.');
    const context = canvas.getContext('2d', { alpha:true });
    if (!context) { body.remove(); return empty('Браузер не поддерживает визуализацию', 'Открой Harness в современном браузере с поддержкой Canvas.'); }
    const tooltip = el('div', 'tg-tooltip'); tooltip.hidden = true;
    const zoom = el('div', 'tg-zoom'); const zoomIn = button('+'), zoomOut = button('−'); zoomIn.setAttribute('aria-label', 'Приблизить'); zoomOut.setAttribute('aria-label', 'Отдалить'); zoom.append(zoomIn, zoomOut);
    const hint = el('div', 'tg-scene-hint'); hint.append(el('span', '', 'Тяни — вращение · Колесо — масштаб · Shift + тяни — сдвиг · Двойной клик — таблица'));
    scene.append(canvas, zoom, tooltip, hint);
    const inspector = el('aside', 'tg-inspector'); inspector.setAttribute('aria-label', 'Показатель и его связи');
    body.append(scene, inspector); root.append(body);
    const legend = el('div', 'tg-legend'); legend.setAttribute('aria-label', 'Группы показателей из модели'); root.append(legend);
    const status = el('p', 'tg-status'); status.setAttribute('role', 'status'); root.append(status);
    const warnings = [];
    if (duplicateCount) warnings.push('Не отображены узлы с пустым или повторяющимся ID: ' + count.format(duplicateCount) + '.');
    if (invalidEdges) warnings.push('Не отображены связи с отсутствующими узлами: ' + count.format(invalidEdges) + '.');
    if (warnings.length) counts.textContent += ' · есть ошибки экспорта';

    const table = el('section', 'tg-table'); table.hidden = true; table.setAttribute('role', 'region'); table.setAttribute('aria-label', 'Таблица зависимых показателей'); root.append(table);
    const camera = { yaw:-0.28, pitch:0.16, distance:extent * 3.25, target:[0, 0, 0] };
    const projected = new Float32Array(nodes.length * 4);
    const drawOrder = nodes.map(node => node.index);
    const sprites = new Map();
    const groupButtons = new Map();
    let width = 1, height = 1, selected = null, hovered = null, groupFocus = null;
    let neighborhood = new Set(), highlightedEdges = new Set();
    let pointer = null, lastHoverAt = 0;
    let tableReturnFocus = null;

    function announce(message) { status.textContent = display([message || '', ...warnings].filter(Boolean).join(' ')); }
    function requestDraw() {
      if (!destroyed && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    }
    function sprite(color) {
      if (sprites.has(color)) return sprites.get(color);
      const image = document.createElement('canvas'); image.width = image.height = 48;
      const ctx = image.getContext('2d');
      const gradient = ctx.createRadialGradient(17, 15, 1, 24, 24, 20); gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(0.24, color); gradient.addColorStop(1, color);
      ctx.beginPath(); ctx.arc(24, 24, 19, 0, Math.PI * 2); ctx.fillStyle = gradient; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); sprites.set(color, image); return image;
    }
    function screenProject() {
      const cosY = Math.cos(camera.yaw), sinY = Math.sin(camera.yaw), cosP = Math.cos(camera.pitch), sinP = Math.sin(camera.pitch);
      const focal = Math.min(width, height) * 1.05;
      nodes.forEach(node => {
        const x = node.x - camera.target[0], y = node.y - camera.target[1], z = node.z - camera.target[2];
        const rx = cosY * x + sinY * z, rz = -sinY * x + cosY * z;
        const ry = cosP * y - sinP * rz, depth = sinP * y + cosP * rz;
        const denominator = camera.distance - depth;
        const offset = node.index * 4;
        projected[offset + 2] = depth;
        if (denominator < 3) { projected[offset + 3] = 0; return; }
        const scale = focal / denominator;
        projected[offset] = width / 2 + rx * scale;
        projected[offset + 1] = height / 2 - ry * scale;
        projected[offset + 3] = Math.min(13, Math.max(1.2, (2.7 + Math.log2(1 + node.degree) * 0.6) * scale));
      });
    }
    function visible(index) {
      const offset = index * 4;
      return projected[offset + 3] > 0 && projected[offset] > -24 && projected[offset] < width + 24 && projected[offset + 1] > -24 && projected[offset + 1] < height + 24;
    }
    function linePath(edge) {
      const a = edge.source * 4, b = edge.target * 4;
      if (!projected[a + 3] || !projected[b + 3]) return;
      if (edge.source === edge.target) { context.moveTo(projected[a] + 7, projected[a + 1]); context.arc(projected[a], projected[a + 1] - 7, 7, 0, Math.PI * 2); }
      else { context.moveTo(projected[a], projected[a + 1]); context.lineTo(projected[b], projected[b + 1]); }
    }
    function draw() {
      context.clearRect(0, 0, width, height);
      screenProject();
      const hasFocus = selected !== null || groupFocus !== null;
      context.beginPath(); edges.forEach(linePath); context.strokeStyle = hasFocus ? '#cfd7e329' : (edges.length > 30000 ? '#879eb53b' : '#839cb54d'); context.lineWidth = 0.65; context.stroke();
      if (highlightedEdges.size) {
        context.beginPath(); highlightedEdges.forEach(linePath); context.strokeStyle = '#186dc9a3'; context.lineWidth = 1.45; context.stroke();
        if (highlightedEdges.size < 160) highlightedEdges.forEach(edge => {
          const a = edge.source * 4, b = edge.target * 4;
          if (!projected[a + 3] || !projected[b + 3] || edge.source === edge.target) return;
          const dx = projected[b] - projected[a], dy = projected[b + 1] - projected[a + 1], length = Math.hypot(dx, dy);
          if (length < 20) return;
          const ux = dx / length, uy = dy / length, x = projected[b] - ux * (projected[b + 3] + 5), y = projected[b + 1] - uy * (projected[b + 3] + 5);
          context.beginPath(); context.moveTo(x, y); context.lineTo(x - ux * 6 - uy * 3, y - uy * 6 + ux * 3); context.lineTo(x - ux * 6 + uy * 3, y - uy * 6 - ux * 3); context.closePath(); context.fillStyle = '#186dc9'; context.fill();
        });
      }
      drawOrder.sort((a, b) => projected[a * 4 + 2] - projected[b * 4 + 2]);
      drawOrder.forEach(index => {
        if (!visible(index)) return;
        const node = nodes[index], offset = index * 4;
        const active = !hasFocus || neighborhood.has(index) || node.group === groupFocus;
        context.globalAlpha = active ? 0.94 : 0.17;
        const radius = projected[offset + 3] * (selected === index ? 1.45 : 1);
        context.drawImage(sprite(node.color), projected[offset] - radius * 1.24, projected[offset + 1] - radius * 1.24, radius * 2.48, radius * 2.48);
        if (selected === index || hovered === index) { context.beginPath(); context.arc(projected[offset], projected[offset + 1], radius + 4, 0, Math.PI * 2); context.strokeStyle = selected === index ? '#cfac00' : '#186dc9'; context.lineWidth = selected === index ? 2 : 1; context.stroke(); }
      });
      context.globalAlpha = 1;
      drawLabels(hasFocus);
    }
    function drawLabels(hasFocus) {
      const candidates = [];
      const seen = new Set();
      function add(index) { if (index !== null && !seen.has(index) && visible(index)) { seen.add(index); candidates.push(index); } }
      add(selected); add(hovered);
      ranked.forEach(node => { if (candidates.length < 38 && (!hasFocus || neighborhood.has(node.index) || node.group === groupFocus)) add(node.index); });
      const boxes = [];
      context.font = '500 12px Roboto, Arial, sans-serif';
      candidates.forEach(index => {
        const offset = index * 4, text = short(display(nodes[index].label), 37);
        const labelWidth = context.measureText(text).width + 13, labelHeight = 24, radius = projected[offset + 3] + 7;
        const x = projected[offset], y = projected[offset + 1];
        const locations = [[x + radius, y - 12], [x - radius - labelWidth, y - 12], [x - labelWidth / 2, y - radius - labelHeight], [x - labelWidth / 2, y + radius]];
        const spot = locations.find(([left, top]) => left > 8 && top > 8 && left + labelWidth < width - 8 && top + labelHeight < height - 51 && !boxes.some(box => left < box[0] + box[2] + 4 && left + labelWidth + 4 > box[0] && top < box[1] + box[3] + 3 && top + labelHeight + 3 > box[1]));
        if (!spot) return;
        boxes.push([spot[0], spot[1], labelWidth, labelHeight]);
        context.fillStyle = selected === index ? '#fff5bceF' : '#fffffff0'; context.fillRect(spot[0], spot[1], labelWidth, labelHeight);
        context.strokeStyle = selected === index ? '#d1b239' : '#dfe5ed'; context.lineWidth = 0.7; context.strokeRect(spot[0], spot[1], labelWidth, labelHeight);
        context.fillStyle = '#283b51'; context.fillText(text, spot[0] + 6, spot[1] + 16);
      });
    }
    function resize() {
      const rect = scene.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); requestDraw();
    }
    function inspectorRow(label, value) { const row = el('div', 'tg-detail-row'); row.append(el('span', '', label), el('strong', '', value)); inspector.append(row); }
    function relatedList(title, list) {
      if (!list.length) return;
      inspector.append(el('h4', 'tg-related-title', title));
      const block = el('div', 'tg-related');
      list.slice(0, 7).forEach(node => { const item = button(node.label); item.className = ''; item.addEventListener('click', () => select(node.id, true)); block.append(item); });
      inspector.append(block);
      if (list.length > 7) inspector.append(el('p', '', 'Ещё ' + count.format(list.length - 7) + ' — в таблице показателей.'));
    }
    function defaultInspector() {
      inspector.replaceChildren(el('p', 'tg-eyebrow', 'Общая модель'), el('h3', '', 'Как связаны показатели'), el('p', '', 'Выбери узел: увидишь его значение, исходные показатели и то, на что он влияет. Двойной клик откроет таблицу до трёх уровней вглубь.'));
      relatedList('Показатели с наибольшим числом связей', ranked.slice(0, 7));
      inspector.append(el('p', '', 'Цвета обозначают группы из модели. Стрелки на выделенных связях направлены от исходного показателя к зависимому.'));
      if (contextCount) inspector.append(el('p', '', 'Шаблоны выделены отдельными группами и доступны только для чтения. Их значения не входят в текущий план. Связь документа с шаблоном хранится отдельно от расчётных связей ячеек.'));
      if (unexpandedWorkflowCount) inspector.append(el('p', '', 'Внешние связи задач согласования не развёрнуты: ' + count.format(unexpandedWorkflowCount) + '. Они сохранены в исходной модели и не показаны как расчётные связи. Другие модели по ним не загружались.'));
      if (unresolvedReferenceCount) inspector.append(el('p', '', 'Ссылки на отсутствующие справочные объекты: ' + count.format(unresolvedReferenceCount) + '. Исходные ссылки сохранены. Отсутствующие узлы и значения не восстановлены; полнота модели и готовность к оптимизации не подтверждены.'));
    }
    function updateFocus() {
      neighborhood = new Set(); highlightedEdges = new Set();
      if (selected !== null) {
        neighborhood.add(selected); const node = nodes[selected];
        node.incoming.concat(node.outgoing).forEach(edge => { highlightedEdges.add(edge); neighborhood.add(edge.source); neighborhood.add(edge.target); });
      } else if (groupFocus !== null) {
        groups.get(groupFocus).nodes.forEach(node => neighborhood.add(node.index));
        edges.forEach(edge => { if (neighborhood.has(edge.source) && neighborhood.has(edge.target)) highlightedEdges.add(edge); });
      }
      groupButtons.forEach((item, name) => item.setAttribute('aria-pressed', String(name === groupFocus)));
      requestDraw();
    }
    function select(id, focus) {
      const node = byId.get(String(id)); if (!node || destroyed) return false;
      selected = node.index; groupFocus = null; updateFocus();
      inspector.replaceChildren(el('p', 'tg-eyebrow', node.group), el('h3', '', node.label));
      const value = el('div', 'tg-node-value'); value.append(el('small', '', node.active_plan === false ? 'Контекст структуры модели' : 'Значение в модели'), el('strong', '', valueText(node) + (node.active_plan !== false && node.unit && node.value !== null && node.value !== undefined && node.value !== '' ? ' ' + node.unit : ''))); inspector.append(value);
      inspectorRow('Тип', kindText(node)); inspectorRow('Входящих связей', count.format(node.incoming.length)); inspectorRow('Исходящих связей', count.format(node.outgoing.length));
      if (node.description) inspector.append(el('p', '', String(node.description)));
      const showTable = button('Показатели · до 3 уровней', 'tg-btn-primary'); showTable.addEventListener('click', () => showDependencies(node)); inspector.append(showTable);
      const upstream = [...new Set(node.incoming.map(edge => edge.source))].map(index => nodes[index]);
      const downstream = [...new Set(node.outgoing.map(edge => edge.target))].map(index => nodes[index]);
      relatedList('От чего зависит', upstream);
      relatedList('На какие показатели влияет', downstream);
      if (!node.incoming.length && !node.outgoing.length) inspector.append(el('p', '', 'В переданном графе у этого показателя пока нет связей.'));
      if (focus) { camera.target = [node.x, node.y, node.z]; camera.distance = Math.max(35, extent * 1.1); }
      announce('Выбран показатель: ' + node.label + '. ' + count.format(node.incoming.length) + ' входящих и ' + count.format(node.outgoing.length) + ' исходящих связей.');
      requestDraw(); return true;
    }
    function reset() {
      camera.yaw = -0.28; camera.pitch = 0.16; camera.distance = extent * 3.25; camera.target = [0, 0, 0];
      selected = null; hovered = null; groupFocus = null; tooltip.hidden = true; search.value = ''; hideResults();
      table.hidden = true; updateFocus(); defaultInspector(); announce('Показан весь граф. Все показатели и связи сохранены.');
    }
    function hideResults() { results.hidden = true; search.setAttribute('aria-expanded', 'false'); }
    function findResults() {
      results.replaceChildren(); const query = normalized(search.value.trim()); if (!query) { hideResults(); return; }
      const matches = ranked.filter(node => node.search.includes(query));
      matches.slice(0, 12).forEach(node => {
        const item = el('button', 'tg-result'); item.type = 'button';
        const copy = el('span', '', node.label); copy.append(el('small', '', node.group + ' · ' + kindText(node))); item.append(dot(node.color), copy);
        item.addEventListener('click', () => { select(node.id, true); hideResults(); search.value = display(node.label); canvas.focus(); }); results.append(item);
      });
      if (!matches.length) results.append(el('p', 'tg-result-note', 'Показатель не найден. Попробуй другое название.'));
      else if (matches.length > 12) results.append(el('p', 'tg-result-note', 'Найдено ' + count.format(matches.length) + '. Уточни запрос, чтобы сократить список.'));
      results.hidden = false; search.setAttribute('aria-expanded', 'true');
    }
    function closeTable() { table.hidden = true; if (tableReturnFocus && tableReturnFocus.isConnected) tableReturnFocus.focus(); }
    function showDependencies(node) {
      tableReturnFocus = document.activeElement; table.replaceChildren(); table.hidden = false;
      const tableHead = el('header', 'tg-table-head');
      const copy = el('div'); copy.append(el('h3', '', node.label), el('p', '', 'Исходные показатели до 3 уровней. Источник → зависимый показатель; повторные узлы раскрыты один раз.'));
      const back = button('К графу'); back.addEventListener('click', closeTable); tableHead.append(copy, back); table.append(tableHead);
      const scroll = el('div', 'tg-table-scroll'), grid = el('table');
      const thead = el('thead'), tr = el('tr'); ['Показатель', 'Через показатель', 'Тип', 'Значение', 'Единица', 'Группа'].forEach(title => { const th = el('th', '', title); th.scope = 'col'; tr.append(th); }); thead.append(tr); const tbody = el('tbody'); grid.append(thead, tbody); scroll.append(grid); table.append(scroll);
      // Breadth-first traversal gives every reachable node its shortest depth.
      // A visited set bounds cycles and wide repeated paths by O(V + E).
      const queue = [{ node, depth:0, parent:null }], visited = new Set([node.index]);
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index]; if (current.depth >= 3) continue;
        current.node.incoming.forEach(edge => { if (!visited.has(edge.source)) { visited.add(edge.source); queue.push({ node:nodes[edge.source], depth:current.depth + 1, parent:current.node }); } });
      }
      let cursor = 0;
      const more = button('Показать следующие показатели', 'tg-table-more');
      function appendPage() {
        const pageEnd = Math.min(queue.length, cursor + 200);
        const fragment = document.createDocumentFragment();
        for (; cursor < pageEnd; cursor++) {
          const entry = queue[cursor], row = el('tr'), labelCell = el('td'), label = el('div', 'tg-table-label'); label.style.setProperty('--tg-indent', entry.depth * 15 + 'px');
          label.append(el('small', '', entry.depth === 0 ? '0' : '−' + entry.depth));
          const item = el('button', '', entry.node.label); item.type = 'button'; item.addEventListener('click', () => { closeTable(); select(entry.node.id, true); }); label.append(item); labelCell.append(label); row.append(labelCell);
          [entry.parent ? entry.parent.label : '—', kindText(entry.node), valueText(entry.node), String(entry.node.unit || '—'), entry.node.group].forEach(text => row.append(el('td', '', text))); fragment.append(row);
        }
        tbody.append(fragment); more.hidden = cursor >= queue.length;
        more.textContent = 'Ещё показатели (' + count.format(queue.length - cursor) + ')';
      }
      more.addEventListener('click', appendPage); table.append(more); appendPage();
      table.append(el('div', 'tg-table-note', count.format(queue.length) + ' уникальных показателей в пределах 3 уровней. Значения показаны как получены из модели; пересчёт здесь не выполняется.'));
      back.focus();
    }
    orderedGroups.forEach(group => {
      const item = el('button'); item.type = 'button'; item.setAttribute('aria-pressed', 'false'); item.append(dot(group.color), el('span', '', group.name + ' · ' + count.format(group.nodes.length))); legend.append(item); groupButtons.set(group.name, item);
      listen(item, 'click', () => {
        const activate = groupFocus !== group.name; selected = null; groupFocus = activate ? group.name : null; updateFocus();
        if (!activate) { defaultInspector(); announce('Показан весь граф.'); return; }
        inspector.replaceChildren(el('p', 'tg-eyebrow', 'Группа из модели'), el('h3', '', group.name), el('p', '', count.format(group.nodes.length) + ' показателей. Остальные группы остаются на сцене.'));
        relatedList('Показатели группы', group.nodes.slice(0, 7)); announce('Выделена группа: ' + group.name + '.');
      });
    });
    function hit(x, y) {
      let found = null, best = Infinity;
      for (let index = 0; index < nodes.length; index++) {
        const offset = index * 4; if (!projected[offset + 3]) continue;
        const distance = Math.hypot(x - projected[offset], y - projected[offset + 1]);
        if (distance < Math.max(7, projected[offset + 3] + 3) && distance < best) { found = index; best = distance; }
      }
      return found;
    }
    function pointerPosition(event) { const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; }
    function scaleCamera(factor) { camera.distance = Math.min(extent * 18, Math.max(12, camera.distance * factor)); requestDraw(); }
    listen(resetButton, 'click', reset);
    listen(zoomIn, 'click', () => scaleCamera(0.8)); listen(zoomOut, 'click', () => scaleCamera(1.25));
    listen(search, 'input', findResults);
    listen(search, 'keydown', event => {
      if (event.key === 'Escape') hideResults();
      if (event.key === 'ArrowDown') { const first = results.querySelector('button'); if (first) { event.preventDefault(); first.focus(); } }
      if (event.key === 'Enter') { const first = results.querySelector('button'); if (first) { event.preventDefault(); first.click(); } }
    });
    listen(results, 'keydown', event => {
      const items = Array.from(results.querySelectorAll('button')), current = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))); if (items[next]) items[next].focus(); }
      if (event.key === 'Escape') { hideResults(); search.focus(); }
    });
    listen(root, 'pointerdown', event => { if (!searchWrap.contains(event.target)) hideResults(); });
    listen(canvas, 'contextmenu', event => event.preventDefault());
    listen(canvas, 'wheel', event => { event.preventDefault(); scaleCamera(Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.002)); }, { passive:false });
    listen(canvas, 'pointerdown', event => {
      if (event.button !== 0 && event.button !== 2 && event.button !== 1) return;
      event.preventDefault(); canvas.focus({ preventScroll:true }); canvas.setPointerCapture(event.pointerId);
      pointer = { id:event.pointerId, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:false, pan:event.shiftKey || event.button !== 0 };
      tooltip.hidden = true; canvas.classList.add('is-dragging');
    });
    listen(canvas, 'pointermove', event => {
      const [x, y] = pointerPosition(event);
      if (pointer && pointer.id === event.pointerId) {
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 4) pointer.moved = true;
        if (pointer.pan) {
          const unit = camera.distance / (Math.min(width, height) * 1.05);
          camera.target[0] -= Math.cos(camera.yaw) * dx * unit; camera.target[2] -= Math.sin(camera.yaw) * dx * unit;
          camera.target[1] += dy * unit;
        } else { camera.yaw += dx * 0.005; camera.pitch = Math.max(-1.48, Math.min(1.48, camera.pitch + dy * 0.005)); }
        pointer.x = event.clientX; pointer.y = event.clientY; requestDraw(); return;
      }
      if (performance.now() - lastHoverAt < 35) return;
      lastHoverAt = performance.now(); const next = hit(x, y);
      if (next !== hovered) { hovered = next; requestDraw(); }
      tooltip.hidden = next === null; canvas.style.cursor = next === null ? 'grab' : 'pointer';
      if (next !== null) { tooltip.textContent = display(nodes[next].label); tooltip.style.left = Math.max(8, Math.min(width - 270, x + 15)) + 'px'; tooltip.style.top = Math.max(8, Math.min(height - 75, y + 16)) + 'px'; }
    });
    listen(canvas, 'pointerup', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const clicked = !pointer.moved && !pointer.pan; pointer = null; canvas.classList.remove('is-dragging');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (clicked) { const [x, y] = pointerPosition(event), index = hit(x, y); if (index !== null) select(nodes[index].id, false); }
    });
    listen(canvas, 'pointercancel', () => { pointer = null; canvas.classList.remove('is-dragging'); });
    listen(canvas, 'pointerleave', () => { if (!pointer) { hovered = null; tooltip.hidden = true; requestDraw(); } });
    listen(canvas, 'dblclick', event => { const [x, y] = pointerPosition(event), index = hit(x, y); if (index !== null) { event.preventDefault(); select(nodes[index].id, false); showDependencies(nodes[index]); } });
    listen(canvas, 'keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home', 'Enter', 'Escape'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') camera.yaw -= 0.12;
      if (event.key === 'ArrowRight') camera.yaw += 0.12;
      if (event.key === 'ArrowUp') camera.pitch = Math.max(-1.48, camera.pitch - 0.12);
      if (event.key === 'ArrowDown') camera.pitch = Math.min(1.48, camera.pitch + 0.12);
      if (event.key === '+' || event.key === '=') scaleCamera(0.8);
      if (event.key === '-') scaleCamera(1.25);
      if (event.key === 'Home' || event.key === 'Escape') reset();
      if (event.key === 'Enter' && selected !== null) showDependencies(nodes[selected]);
      requestDraw();
    });
    listen(table, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeTable(); } });
    if (typeof ResizeObserver === 'function') { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(scene); }
    else listen(window, 'resize', resize);
    controller.select = id => select(id, true); controller.reset = reset;
    defaultInspector(); announce('Выбери показатель или найди его по названию, чтобы раскрыть связи.'); resize();
    return controller;
  }
  window.TabulaGraph = Object.freeze({ open });
}());
