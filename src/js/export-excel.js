/*
 * Excel 내보내기 (SheetJS, 클라이언트 사이드).
 *   exportDocument(doc, preset)        : 단일 문서를 한 행으로 내보내기
 *   exportAll(docs, preset, fileName)  : 같은 프리셋의 여러 문서를 여러 행으로 내보내기
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  function cellValue(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.join("\n");
    return value;
  }

  function rowFor(doc, fields) {
    return fields.map((f) => cellValue(doc.content[f.key]));
  }

  function buildSheet(rows, fields) {
    const headers = fields.map((f) => f.label);
    const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    // 열 너비 적당히
    ws["!cols"] = fields.map((f) => ({ wch: Math.max(12, Math.min(40, f.label.length + 8)) }));
    return ws;
  }

  function download(ws, sheetName, fileName) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  }

  function safeName(name) {
    return (name || "qadoc").replace(/[\\/:*?"<>|]/g, "_");
  }

  QADOC.exportExcel = {
    exportDocument(doc, preset) {
      const ws = buildSheet([rowFor(doc, preset.fields)], preset.fields);
      const sheetName = doc.type === "testcase" ? "TestCase" : "Spec";
      download(ws, sheetName, safeName(doc.title || doc.id) + ".xlsx");
    },

    exportAll(docs, preset, fileName) {
      const rows = docs.map((d) => rowFor(d, preset.fields));
      const ws = buildSheet(rows, preset.fields);
      const sheetName = preset.type === "testcase" ? "TestCases" : "Specs";
      download(ws, sheetName, safeName(fileName || "qadoc-export") + ".xlsx");
    }
  };
})();
