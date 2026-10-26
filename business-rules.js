"use strict";

// Descriptive records only. This component never sends solver or writeback requests.
window.TabulaBusinessRules = (() => {
  const SCHEMA = "tabula-model-rules/v1";
  const categories = {meaning:"Смысл и состав показателя",operation:"Операции и ресурсы",change_policy:"Условия изменений",methodology:"Обязательные условия"};
  const statuses = {description:"Описание",proposal:"Предложение",confirmed:"Подтверждено"};
  const kinds = {metric:"Показатель",constraint:"Ограничитель",parameter:"Параметр модели"};
  const fields = [
    ["meaning","Что означает показатель"], ["included","Что входит в расчёт"], ["excluded","Что исключено из расчёта"],
    ["operations","Связанные бизнес-операции"], ["resources","Необходимые ресурсы"], ["allowed_changes","Что разрешено менять"],
    ["fixed","Что зафиксировано"], ["conditions","При каких условиях"], ["mandatory","Обязательные ограничения и условия"],
    ["explanation","Пояснение и основание"]
  ];
  const raw = value => typeof value === "string" || typeof value === "number" ? String(value) : "";
  function text(value) {
    const original = raw(value);
    const cleaned = window.TabulaPresentation?.text?.(original) ?? original;
    // The component also works on its own, without the shell's presentation helper.
    return cleaned.replace(/https?:\/\/[^\s<>]+/gi, "")
      .replace(/[A-Za-z]:[\\/][^\n<>"']+/g, "")
      .replace(/\/(?:home|srv|app|opt|tmp|var|mnt)\/[^\s<>"']+/g, "")
      .replace(/(?:['«"`][^\n'»"`]+['»"`]|[\p{L}\w.]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gu, "")
      .replace(/\b(?:R\d+C\d+|[a-f0-9]{32,64})\b/gi, "")
      .replace(/\b(?:source_key|node_id|metric_id|version_id)\s*[:=]\s*\S+/gi, "")
      .replace(/\b(?:tn|metric|constraint|parameter|bound|derived):[^\s.,;]+/gi, "")
      .replace(/\b(?:ИИ|AI|LLM)\b/gi, "")
      .replace(/\S+\.(?:xlsx?|csv|json|xml|py|pdf|md)(?:\b|$)/gi, "")
      .replace(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, "")
      .replace(/[ \t]{2,}/g, " ").trim();
  }
  function make(tag, className = "", value) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value); return node;
  }
  function button(label, handler, extra = "") {
    const node = make("button", `br-button ${extra}`.trim(), label); node.type = "button";
    if (handler) node.addEventListener("click", handler); return node;
  }
  function labelled(label, control, hint = "") {
    const node = make("label", "br-field"), caption = make("span", "br-label", label);
    control.setAttribute("aria-label", label); node.append(caption, control);
    if (hint) node.append(make("small", "br-muted", hint)); return node;
  }
  function select(values, value, change) {
    const node = make("select"); for (const [key,label] of values) { const option = make("option", "", label); option.value = key; node.append(option); }
    node.value = value; if (change) node.addEventListener("change", () => change(node.value)); return node;
  }
  function date(value) {
    if (!value) return ""; const result = new Date(value);
    return Number.isNaN(result.getTime()) ? "" : result.toLocaleString("ru-RU");
  }
  function validate(payload) {
    if (!payload || payload.schema !== SCHEMA || !payload.source?.key || !Number.isInteger(payload.revision) || !Array.isArray(payload.catalog) || !Array.isArray(payload.rules))
      throw new Error("Раздел правил получил неизвестный формат данных.");
    return payload;
  }
  function mount(root, options = {}) {
    if (!root || typeof options.request !== "function") throw new TypeError("Нужны контейнер раздела и функция запроса.");
    root.classList.add("tabula-business-rules");
    const state = {chat:"",data:null,loading:false,busy:false,error:"",notice:"",search:"",filter:"all",editor:null,history:null,importReview:null};
    let epoch = 0, destroyed = false, confirmDialog = null;
    const current = (generation, chat) => !destroyed && epoch === generation && state.chat === chat;
    const endpoint = () => `/v1/chats/${encodeURIComponent(state.chat)}/business-rules`;
    const dirty = () => !!state.editor?.dirty;
    const source = () => state.data?.source?.key;
    const target = binding => state.data?.catalog.find(item => item.kind === binding?.kind && item.id === binding?.id);
    function closeDialog() { if (confirmDialog) { confirmDialog.remove(); confirmDialog = null; } }
    function errorMessage(error) {
      if (error?.status === 409) return dirty() ? "Модель или правила изменились в другом окне. Введённый текст сохранён на экране. Скопируйте его перед обновлением данных." : text(error.message) || "Модель или правила изменились. Обновите данные и проверьте выбранную версию.";
      if (error?.status === 404) return "Правила для этой модели пока недоступны.";
      return text(error?.message) || "Не удалось выполнить действие. Попробуйте ещё раз.";
    }
    function report(error) { state.error = errorMessage(error); options.onError?.(error); }
    function allowDiscard() { return !dirty() || window.confirm("Есть несохранённое описание. Продолжить без сохранения?"); }
    async function load(chatId = state.chat, {discard = false} = {}) {
      if (destroyed || (dirty() && !allowDiscard())) return false;
      const generation = ++epoch, chat = raw(chatId); state.chat = chat; state.loading = !!chat;
      state.busy = false; state.error = ""; state.notice = ""; state.history = null; state.importReview = null; closeDialog();
      if (chatId !== state.data?.chat_id || discard) state.editor = null;
      // Never show records belonging to the previous chat while the request is pending.
      state.data = null; render(); if (!chat) return true;
      try { const result = validate(await options.request(endpoint())); if (!current(generation,chat)) return false; state.data = result; }
      catch (error) { if (current(generation,chat)) report(error); }
      finally { if (current(generation,chat)) { state.loading = false; render(); } }
      return !!state.data;
    }
    async function mutate(path, method, json, success) {
      if (state.busy || !state.data || destroyed) return false;
      const generation = epoch, chat = state.chat; state.busy = true; state.error = ""; state.notice = ""; render();
      try {
        const response = await options.request(`${endpoint()}${path}`, {method,json});
        if (!current(generation,chat)) return false;
        // Services may return the complete page or a small mutation receipt.
        const result = response?.schema === SCHEMA && Array.isArray(response.rules) ? response : await options.request(endpoint());
        if (!current(generation,chat)) return false;
        state.data = validate(result); state.editor = null; state.history = null; state.importReview = null; state.notice = success; closeDialog(); return true;
      } catch (error) { if (current(generation,chat)) report(error); return false; }
      finally { if (current(generation,chat)) { state.busy = false; render(); } }
    }
    function edit(rule = null) {
      if (state.busy || !state.data || !allowDiscard()) return;
      const first = state.data.catalog[0]; if (!first) return;
      const sourceRule = rule ? JSON.parse(JSON.stringify(rule)) : {title:"",category:"meaning",status:"description",binding:{source_key:source(),kind:first.kind,id:first.id},scope:{area:"",period:"",unit:first.unit || ""},content:{},provenance:{kind:"user",label:"",evidence:""}};
      // A changed confirmed record requires a new manual confirmation.
      if (sourceRule.status === "confirmed") sourceRule.status = "description";
      state.editor = {rule:sourceRule,original:rule,dirty:false}; state.history = null; state.error = ""; render();
      root.querySelector('.br-editor input')?.focus();
    }
    function update(section, key, value) {
      if (!state.editor || state.busy) return;
      if (section) (state.editor.rule[section] ||= {})[key] = value; else state.editor.rule[key] = value;
      state.editor.dirty = true;
    }
    function newField(section,key,label, multiline = true, required = false, hint = "") {
      const control = make(multiline ? "textarea" : "input"); if (!multiline) control.type = "text";
      // Keep the stored evidence untouched until the user edits this field;
      // addresses in imported records are not useful as business instructions.
      control.value = text(section ? state.editor.rule[section]?.[key] : state.editor.rule[key]);
      control.maxLength = key === "title" ? 200 : section === "scope" ? 500 : section === "provenance" && key === "label" ? 300 : 4000; control.required = required; control.disabled = state.busy;
      if (multiline) control.rows = key === "explanation" ? 3 : 2;
      control.addEventListener("input", () => update(section,key,control.value));
      return labelled(label,control,hint);
    }
    async function saveEditor(event) {
      event.preventDefault(); if (!state.editor || state.busy) return;
      const editor = state.editor, rule = Object.fromEntries(["title","category","status","binding","scope","content","provenance"].map(key=>[key,JSON.parse(JSON.stringify(editor.rule[key]))]));
      rule.binding.source_key = source();
      if (!rule.title?.trim() || !rule.scope?.area?.trim() || !rule.content?.explanation?.trim() || !rule.provenance?.label?.trim()) { state.error = "Заполните название, область применения, пояснение и происхождение правила."; render(); return; }
      const body = {source_key:source(),expected_revision:state.data.revision,rule}; delete rule.id; delete rule.revision; delete rule.confirmed_by; delete rule.confirmed_at;
      if (editor.original) body.expected_rule_revision = editor.original.revision;
      await mutate(editor.original ? `/${encodeURIComponent(editor.original.id)}` : "", editor.original ? "PUT" : "POST", body, "Описание сохранено. Действующие ограничения модели не изменились.");
    }
    function editorView() {
      const editor = state.editor, rule = editor.rule, form = make("form", "br-editor"); form.addEventListener("submit",saveEditor);
      form.append(make("h3", "", editor.original ? "Редактирование описания" : "Новое правило"));
      form.append(make("p", "br-muted", "Заполняйте только известные условия. Неизвестные ресурсы и полномочия можно оставить пустыми. Изменённое описание подтверждается заново."));
      const grid = make("div", "br-form-grid");
      grid.append(newField("","title","Название правила",false,true));
      const category = select(Object.entries(categories),rule.category,value=>update("","category",value)); category.disabled = state.busy; grid.append(labelled("Раздел правила",category));
      const catalog = state.data.catalog, activeIndex = catalog.findIndex(item=>item.kind===rule.binding.kind&&item.id===rule.binding.id);
      const binding = select(catalog.map((item,index)=>[String(index),`${kinds[item.kind] || "Показатель"}: ${text(item.label) || "Без названия"}`]),String(activeIndex),value=>{
        const item = catalog[Number(value)]; if (!item) return; update("binding","kind",item.kind); update("binding","id",item.id);if(item.fingerprint)update("binding","fingerprint",item.fingerprint);else delete rule.binding.fingerprint;update("scope","unit",item.unit || "");render();
      }); binding.required = true; binding.disabled = state.busy; grid.append(labelled("К чему относится",binding));
      const status = select([["description",statuses.description],["proposal",statuses.proposal]],rule.status,value=>update("","status",value)); status.disabled=state.busy; grid.append(labelled("Статус записи",status));
      grid.append(newField("scope","area","Область применения",false,true),newField("scope","period","Период действия",false),newField("scope","unit","Единицы измерения",false));
      form.append(grid);
      const explanation=newField("content","explanation","Пояснение и основание",true,true,"Опишите правило обычными словами: что требуется, зачем и при каких обстоятельствах.");explanation.classList.add("br-main-explanation");form.append(explanation);
      const provenance = make("fieldset", "br-origin"); provenance.append(make("legend","","Происхождение правила"));
      const origin = select([["user","Сведения пользователя"],["document","Подтверждающий документ"]],rule.provenance?.kind || "user",value=>update("provenance","kind",value)); origin.disabled=state.busy;
      provenance.append(labelled("Вид источника",origin),newField("provenance","label","Откуда известно правило",false,true,"Например: утверждённая методика расчёта или сведения владельца процесса."),newField("provenance","evidence","Основание и подтверждение",true,false,"Укажите понятное название, дату, раздел или пункт; технические адреса не нужны.")); form.append(provenance);
      for(const [title,keys] of [["Смысл и состав показателя",["meaning","included","excluded"]],["Операции и ресурсы",["operations","resources"]],["Изменения и обязательные условия",["allowed_changes","fixed","conditions","mandatory"]]]){
        const section=make("details","br-optional");section.open=keys.some(key=>!!rule.content?.[key]);section.append(make("summary","",title));const content=make("div","br-form-grid");for(const key of keys)content.append(newField("content",key,fields.find(field=>field[0]===key)[1]));section.append(content);form.append(section);
      }
      const actions = make("div","br-actions"), save = button(state.busy ? "Сохраняем…" : "Сохранить описание",null,"br-primary"); save.type="submit"; save.disabled=state.busy;
      const cancel = button("Отмена",()=>{if(allowDiscard()){state.editor=null;state.error="";render();}}); cancel.disabled=state.busy; actions.append(save,cancel); form.append(actions); return form;
    }
    function confirmRule(rule) {
      if (state.busy || !state.data) return; closeDialog();
      const dialog = make("dialog","br-dialog"), form = make("form"); confirmDialog=dialog;
      form.append(make("h2","","Подтвердить описание"),make("p","",rule.title),make("p","br-muted","Подтверждение означает, что сведения проверены человеком для текущей версии модели. Оно не изменяет значения, права редактирования и исполняемые ограничения."));
      const name=make("input");name.type="text";name.required=true;name.maxLength=200;form.append(labelled("Кто подтверждает",name));
      const checkbox=make("input");checkbox.type="checkbox";checkbox.required=true;form.append(labelled("Сведения и условия проверены",checkbox));
      const error=make("p","br-alert");error.hidden=true;error.setAttribute("role","alert");form.append(error);
      const actions=make("div","br-actions"),submit=button("Подтвердить",null,"br-primary"),cancel=button("Отмена",closeDialog);submit.type="submit";actions.append(submit,cancel);form.append(actions);dialog.append(form);root.append(dialog);
      document.body.append(dialog);
      form.addEventListener("submit",async event=>{
        event.preventDefault(); if(state.busy||!name.value.trim()||!checkbox.checked)return;
        submit.disabled=true;cancel.disabled=true;name.disabled=true;checkbox.disabled=true;
        const success=await mutate(`/${encodeURIComponent(rule.id)}/confirm`,"POST",{source_key:source(),expected_revision:state.data.revision,expected_rule_revision:rule.revision,confirmed:true,confirmed_by:name.value.trim()},"Описание подтверждено для текущей версии модели.");
        if(!success&&confirmDialog===dialog){error.textContent=state.error;error.hidden=false;submit.disabled=false;cancel.disabled=false;name.disabled=false;checkbox.disabled=false;}
      });
      dialog.addEventListener("cancel",event=>{if(state.busy)event.preventDefault();else closeDialog();});dialog.showModal();name.focus();
    }
    async function showHistory(rule) {
      if (state.busy) return; const generation=epoch,chat=state.chat;
      state.history={rule,loading:true,entries:[]};render();
      try { const result=await options.request(`${endpoint()}/${encodeURIComponent(rule.id)}/history`);if(current(generation,chat)&&state.history?.rule.id===rule.id){state.history.entries=result.history || result.items || [];state.history.loading=false;render();} }
      catch(error){if(current(generation,chat)){report(error);state.history=null;render();}}
    }
    function ruleView(rule, historical=false) {
      const card=make("article","br-rule"),heading=make("div","br-card-head");
      heading.append(make("h3","",rule.title || "Описание правила"),make("span",`br-status br-${rule.status}`,statuses[rule.status] || "Описание"));card.append(heading);
      const item=target(rule.binding),metadata=[categories[rule.category],item?text(item.label):"Связанный показатель недоступен",rule.scope?.area,rule.scope?.period,rule.scope?.unit].map(text).filter(Boolean);
      card.append(make("p","br-meta",metadata.join(" · ")));
      const details=make("dl","br-content");for(const [key,label] of fields){const value=text(rule.content?.[key]);if(value)details.append(make("dt","",label),make("dd","",value));}card.append(details);
      const origin=[rule.provenance?.label,rule.provenance?.evidence].map(text).filter(Boolean).join(". ");if(origin)card.append(make("p","br-provenance","Основание: "+origin));
      if(rule.status==="confirmed")card.append(make("p","br-confirmed-by",["Проверено",text(rule.confirmed_by),date(rule.confirmed_at)].filter(Boolean).join(" · ")));
      if(!historical){const actions=make("div","br-actions"),editButton=button("Редактировать",()=>edit(rule)),historyButton=button("История",()=>showHistory(rule));editButton.disabled=historyButton.disabled=state.busy;actions.append(editButton,historyButton);
        if(rule.status!=="confirmed"){const confirm=button("Подтвердить описание",()=>confirmRule(rule));confirm.disabled=state.busy||!item;actions.append(confirm);}card.append(actions);}
      return card;
    }
    function historyView() {
      const panel=make("section","br-history"),head=make("div","br-section-head");head.append(make("h3","","История описания"),button("Закрыть историю",()=>{state.history=null;render();}));panel.append(head);
      if(state.history.loading){panel.append(make("p","br-muted","Загружаем историю…"));return panel;}
      if(!state.history.entries.length)panel.append(make("p","br-muted","Предыдущих записей нет."));
      for(const entry of state.history.entries){const item=make("div","br-history-entry"),action={create:"Создано",edit:"Изменено",update:"Изменено",confirm:"Подтверждено",import:"Добавлено из переноса"}[entry.action]||"Сохранено";item.append(make("p","br-meta",[action,date(entry.created_at || entry.at)].filter(Boolean).join(" · ")));if(entry.rule)item.append(ruleView(entry.rule,true));panel.append(item);}return panel;
    }
    async function exportRules() {
      if(state.busy||!state.data)return;const generation=epoch,chat=state.chat;
      try {const payload=await options.request(`${endpoint()}/export`);if(!current(generation,chat))return;const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="правила-модели.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);state.notice="Правила выгружены вместе с привязкой к версии и историей.";render();}
      catch(error){if(current(generation,chat)){report(error);render();}}
    }
    async function importFile(file) {
      if(!file||state.busy||!state.data)return;
      const generation=epoch,chat=state.chat;state.error="";state.busy=true;render();
      try {
        if(file.size>32*1024*1024)throw new Error("Для переноса выберите документ правил объёмом до 32 МБ.");
        let document;try{document=JSON.parse(await file.text());}catch(_){throw new Error("Не удалось прочитать документ правил. Нужен формат, полученный при выгрузке.");}
        if(!document||typeof document!=="object"||Array.isArray(document))throw new Error("В документе отсутствуют правила выбранной модели.");
        // Audit history and observed mathematics are not imported as rules.
        // Send only the portable description payload to preview and apply.
        const canonical={schema:document.schema,source:document.source,rules:document.rules};
        if(new Blob([JSON.stringify(canonical)]).size>4*1024*1024)throw new Error("Объём переносимых описаний превышает 4 МБ. Перенесите меньше правил за один раз.");
        if(!current(generation,chat))return;
        const preview=await options.request(`${endpoint()}/import/preview`,{method:"POST",json:{source_key:source(),document:canonical}});
        if(!current(generation,chat))return;
        state.importReview={document:canonical,preview};
      }catch(error){if(current(generation,chat))report(error);}
      finally{if(current(generation,chat)){state.busy=false;render();}}
    }
    function importView() {
      const review=state.importReview,panel=make("section","br-import"),head=make("div","br-section-head");head.append(make("h3","","Проверка переноса правил"),button("Отменить перенос",()=>{state.importReview=null;render();}));panel.append(head);
      const rules=review.preview.rules || [];panel.append(make("p","br-muted",`К добавлению: ${rules.length}. После переноса сведения нужно проверить и подтвердить заново. Действующие формулы и ограничения не заменяются.`));
      for(const warning of review.preview.warnings || [])panel.append(make("p","br-muted",typeof warning==="string"?warning:warning.message));
      const list=make("div","br-import-list");for(const rule of rules)list.append(ruleView(rule,true));panel.append(list);
      const apply=button("Добавить проверенные описания",async()=>{
        if(!allowDiscard())return;
        await mutate("/import","POST",{source_key:source(),expected_revision:state.data.revision,document:review.document,confirmed:true},"Описания перенесены. Подтвердите каждое правило после проверки.");
      },"br-primary");apply.disabled=state.busy||review.preview.can_import===false||!rules.length;panel.append(apply);return panel;
    }
    function catalogView() {
      const block=make("details","br-model-facts"),summary=make("summary","","Связь с текущей моделью");block.append(summary,make("p","br-muted","Описания связаны с показателями и ограничителями выбранной версии. Наличие расчётной связи не подтверждает бизнес-условия и право изменения."));
      const list=make("div","br-facts-grid");for(const item of state.data.catalog){const card=make("article","br-fact");card.append(make("h4","",item.label || kinds[item.kind] || "Показатель"));const metadata=[kinds[item.kind],...(item.periods||[]),item.unit].map(text).filter(Boolean);card.append(make("p","br-meta",metadata.join(" · ")));
        if(typeof item.limit==="number"&&Number.isFinite(item.limit)){const relation={"<=":"не более",">=":"не менее","=":"равно"}[item.relation]||"значение";card.append(make("p","",`${relation} ${new Intl.NumberFormat("ru-RU",{maximumSignificantDigits:15}).format(item.limit)} ${text(item.unit)}`));}
        if(item.formula||item.has_formula)card.append(make("p","br-muted","Формула прочитана из текущей модели."));
        if(item.kind==="parameter")card.append(make("p","br-muted",item.editable?"Модель допускает редактирование параметра. Бизнес-условия изменения требуют отдельного подтверждения.":"Параметр зафиксирован в текущей модели."));list.append(card);}block.append(list);return block;
    }
    function render() {
      if(destroyed)return;
      root.replaceChildren();
      const head=make("div","br-header"),titles=make("div");titles.append(make("h2","","Правила модели"),make("p","br-subtitle","Смысл показателей, условия изменений и обязательная методология."));head.append(titles);root.append(head);
      if(state.error){const alert=make("p","br-alert",state.error);alert.setAttribute("role","alert");root.append(alert);}
      if(state.notice){const notice=make("p","br-notice",state.notice);notice.setAttribute("role","status");root.append(notice);}
      if(state.loading){root.append(make("p","br-empty","Загружаем правила текущей модели…"));return;}
      if(!state.data){root.append(make("p","br-empty",state.chat?"Не удалось загрузить правила модели.":"Откройте модель, чтобы увидеть её правила."));if(state.chat)root.append(button("Повторить загрузку",()=>load(state.chat)));return;}
      root.append(make("p","br-source",text(state.data.source.label)||"Текущая версия модели"));
      const actions=make("div","br-actions br-toolbar"),add=button("+ Добавить правило",()=>edit(),"br-primary"),refresh=button("Обновить данные",()=>load(state.chat,{discard:true})),download=button("Выгрузить правила",exportRules),upload=button("Загрузить правила",()=>picker.click()),picker=make("input");picker.type="file";picker.accept=".json,application/json";picker.hidden=true;picker.addEventListener("change",()=>{void importFile(picker.files?.[0]);});add.disabled=state.busy||!state.data.catalog.length;refresh.disabled=download.disabled=upload.disabled=state.busy;actions.append(add,refresh,download,upload,picker);root.append(actions,catalogView());
      if(state.editor)root.append(editorView());
      if(state.history)root.append(historyView());
      if(state.importReview)root.append(importView());
      const filters=make("div","br-filters"),search=make("input");search.type="search";search.placeholder="Найти правило или показатель";search.setAttribute("aria-label","Поиск правил");search.value=state.search;
      search.addEventListener("input",()=>{const start=search.selectionStart;state.search=search.value;render();const next=root.querySelector('input[type="search"]');next?.focus();if(start!==null)next?.setSelectionRange?.(start,start);});
      const filter=select([["all","Все статусы"],...Object.entries(statuses)],state.filter,value=>{state.filter=value;render();});filter.setAttribute("aria-label","Статус правил");filters.append(search,filter);root.append(filters);
      const found=state.data.rules.filter(rule=>(state.filter==="all"||rule.status===state.filter)&&text([rule.title,target(rule.binding)?.label,...Object.values(rule.content||{})].join(" ")).toLocaleLowerCase("ru").includes(state.search.toLocaleLowerCase("ru")));
      const count=make("p","br-count",`Правил: ${found.length}`);root.append(count);
      const list=make("div","br-rule-list");for(const rule of found)list.append(ruleView(rule));if(!found.length)list.append(make("p","br-empty",state.data.rules.length?"Подходящих правил нет. Измените поиск или статус.":"Описаний пока нет. Добавьте известные условия и подтвердите их после проверки."));root.append(list);
      root.append(make("p","br-footer","Подтверждение относится к описанию и текущей версии модели. Применение ограничений и запуск расчёта выполняются отдельно."));
    }
    render();if(options.chatId)void load(options.chatId);
    return Object.freeze({load,setChat:chat=>{const chatId=typeof chat==="object"?chat?.id || "":raw(chat);return chatId===state.chat&&state.data?Promise.resolve(true):load(chatId);},setMode(mode){root.hidden=mode!=="business-rules";},canLeave:allowDiscard,refresh:()=>load(state.chat,{discard:true}),hasUnsavedChanges:dirty,destroy(){destroyed=true;++epoch;closeDialog();root.replaceChildren();root.classList.remove("tabula-business-rules");}});
  }
  return Object.freeze({mount,schema:SCHEMA});
})();
