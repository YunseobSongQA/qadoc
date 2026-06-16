/*
 * PPT 내보내기 (PptxGenJS, 클라이언트 사이드).
 *   exportDocument(doc, preset)        : 단일 문서 → 슬라이드 1장
 *   exportAll(docs, preset, fileName)  : 문서마다 슬라이드 1장
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  function cell(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.join("\n");
    return String(value);
  }
  function safeName(name) {
    return (name || "qadoc").replace(/[\\/:*?"<>|]/g, "_");
  }

  function addDocSlide(pptx, doc, preset) {
    const slide = pptx.addSlide();
    slide.addText(doc.title || "(제목 없음)", {
      x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: "1F2430"
    });
    const rows = preset.fields.map((f) => [
      { text: f.label, options: { bold: true, fill: "F1F3F5", color: "495057", valign: "top" } },
      { text: cell(doc.content[f.key]), options: { valign: "top" } }
    ]);
    slide.addTable(rows, {
      x: 0.5, y: 1.1, w: 9, colW: [2.5, 6.5],
      border: { pt: 0.5, color: "DDDDDD" },
      fontSize: 12, autoPage: true, autoPageRepeatHeader: false
    });
  }

  function newPptx() {
    // PptxGenJS는 CDN 전역. 일부 번들은 window.PptxGenJS, 일부는 default export 형태.
    const Ctor = window.PptxGenJS || (window.pptxgen && window.pptxgen.default) || window.pptxgen;
    if (!Ctor) throw new Error("PptxGenJS 로드 실패");
    return new Ctor();
  }

  QADOC.exportPpt = {
    exportDocument(doc, preset) {
      const pptx = newPptx();
      addDocSlide(pptx, doc, preset);
      pptx.writeFile({ fileName: safeName(doc.title || doc.id) + ".pptx" });
    },
    exportAll(docs, preset, fileName) {
      const pptx = newPptx();
      docs.forEach((d) => addDocSlide(pptx, d, preset));
      pptx.writeFile({ fileName: safeName(fileName || "qadoc-export") + ".pptx" });
    }
  };
})();
