"use strict";

// Presentation only. Original messages and references remain in storage.
window.TabulaPresentation = (() => {
  const referenceColumn = /^(?:источник(?:и)?(?: данных)?|лист(?: модели)?|файл(?: результата)?|ячейка|ячейки|адрес(?: ячейки)?|диапазон|source|source_cell|sheet|cell|address|file|формула Excel)$/i;
  const cells = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(part => part.trim());
  // These substitutions are for displayed text only. Never use them as keys,
  // in requests, or to change the saved names and identifiers.
  function label(value) {
    return String(value ?? "")
      .replace(/(?<![\p{L}\p{N}])(?:TL[_\s-]+)?run[_\s-]+[a-f0-9]{12,64}?(?:[_\s-]*form[_\s-]*0*\d+)?(?![\p{L}\p{N}_])/giu,
        match => /form/i.test(match) ? "форма модели" : "модель")
      .replace(/(?<![\p{L}\p{N}])form[_\s-]*\d{1,3}(?![\p{L}\p{N}_])/giu, "форма модели")
      .replace(/(?<![\p{L}\p{N}])форма\s+форма\s+модели(?![\p{L}\p{N}])/giu, "форма модели")
      .replace(/искусственн(?:ый|ого|ому|ым|ом)\s+интеллект(?:а|у|ом|е)?/giu, "анализ данных")
      .replace(/(?<![\p{L}\p{N}])ИИ[-‑–—]\s*/giu, "")
      .replace(/\s+с\s+ИИ(?![\p{L}\p{N}])/giu, "")
      .replace(/(?<![\p{L}\p{N}])ИИ\s*:/giu, "Анализ:")
      .replace(/(?<![\p{L}\p{N}])ИИ(?![\p{L}\p{N}])/giu, "")
      .replace(/[ \t]{2,}/g, " ").replace(/\s+([,;:.!?])/g, "$1").trim();
  }
  function text(value) {
    let result = label(value).replace(/\r\n/g, "\n");
    result = result.replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, (_, label) =>
      /(?:\.(?:xlsx?|csv|json|xml|pdf|svg|png|md|txt)\b|скачать|файл результата)/i.test(label) ? "" : label);
    result = result.replace(/https?:\/\/[^\s<>]+/g, "")
      .replace(/[A-Za-z]:[\\/][^\n<>"']+/g, "")
      .replace(/\/(?:home|srv|app|opt|tmp|var|mnt)\/[^\s<>"']+/g, "");
    result = result.replace(/(?:['«"`][^\n'»"`]+['»"`]|[\p{L}\w.]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/gu, "")
      .replace(/\bR\d+C\d+(?::R\d+C\d+)?\b/g, "")
      .replace(/(?:на |из |по )?лист(?:е|а|у|ом)?\s*[«"'`][^\n»"'`]+[»"'`]/gi, "в модели")
      .replace(/(?:на|из|по)\s+лист(?:е|а|у)?\s+[\p{L}_][\p{L}\p{N}_.-]*/giu, "по данным модели")
      .replace(/(?:ячейк(?:а|и|е|у|ах|ой)|диапазон(?:е|а)?)\s*[:—-]?\s*`?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?`?/gi, "")
      .replace(/[«"'`]?[^\s«»"'`<>|]*\.(?:xlsx?|csv|json|xml|pdf|svg|png|md|txt)[»"'`]?/gi, "")
      .replace(/\[\d+:\d+[^\]]*\]/g, "");
    const lines = result.split("\n"), output = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:источник(?:и)?(?: данных)?|лист(?:ы)?|файл(?:ы)?(?: результата)?|диапазон|ячейк(?:а|и)|технические файлы|прочитанные данные)\s*[:：]/i.test(line)) continue;
      if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) {
        const headings = cells(line), keep = headings.map((heading, index) => referenceColumn.test(heading.replace(/[*`]/g, "")) ? -1 : index).filter(index => index >= 0);
        if (!keep.length) { i += 2; while (i < lines.length && /^\s*\|/.test(lines[i])) i++; i--; continue; }
        output.push("| " + keep.map(index => headings[index]).join(" | ") + " |");
        output.push("| " + keep.map(() => "---").join(" | ") + " |");
        i += 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          const values = cells(lines[i]); output.push("| " + keep.map(index => values[index] || "").join(" | ") + " |"); i++;
        }
        i--; continue;
      }
      output.push(line.replace(/\(\s*\)|\[\s*\]|`\s*`/g, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,;])/g, "$1"));
    }
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function title(value) {
    const result = text(String(value ?? "").replace(/\.(?:xlsx?|json|xml|csv)$/i, "")).replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!result || result.toLocaleLowerCase("ru") === "модель") return "Модель предприятия";
    if (result.toLocaleLowerCase("ru") === "форма модели") return "Форма модели";
    return result;
  }
  return Object.freeze({text, title, label});
})();
