/*
 * 저장소 추상화.
 * 지금은 localStorage 구현. 향후 Supabase 로 교체할 때 이 인터페이스만 동일하게 유지하면
 * app.js 등 호출부는 수정할 필요가 없다. (provider 교체 가능 구조)
 *
 * 인터페이스:
 *   listDocuments()        -> Document[]
 *   getDocument(id)        -> Document | null
 *   saveDocument(doc)      -> Document   (신규는 생성, 기존은 새 버전 적립)
 *   deleteDocument(id)     -> void
 *   listUserPresets()      -> Preset[]
 *   addUserPreset(preset)  -> void
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  const DOC_KEY = "qadoc.documents.v1";
  const PRESET_KEY = "qadoc.userPresets.v1";

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
      return [];
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uid() {
    return "doc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  QADOC.storage = {
    listDocuments() {
      return read(DOC_KEY).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    },

    getDocument(id) {
      return read(DOC_KEY).find((d) => d.id === id) || null;
    },

    saveDocument(doc) {
      const docs = read(DOC_KEY);
      const now = new Date().toISOString();
      const idx = docs.findIndex((d) => d.id === doc.id);

      if (idx >= 0) {
        // 기존 문서: 직전 내용을 버전 이력으로 적립한 뒤 갱신
        const existing = docs[idx];
        existing.versions = existing.versions || [];
        existing.versions.push({
          version: existing.currentVersion || 1,
          content: existing.content,
          savedAt: existing.updatedAt
        });
        existing.title = doc.title;
        existing.content = doc.content;
        existing.presetId = doc.presetId;
        existing.currentVersion = (existing.currentVersion || 1) + 1;
        existing.updatedAt = now;
        docs[idx] = existing;
        write(DOC_KEY, docs);
        return existing;
      }

      // 신규 문서
      doc.id = doc.id || uid();
      doc.createdAt = now;
      doc.updatedAt = now;
      doc.currentVersion = 1;
      doc.versions = [];
      docs.push(doc);
      write(DOC_KEY, docs);
      return doc;
    },

    deleteDocument(id) {
      write(DOC_KEY, read(DOC_KEY).filter((d) => d.id !== id));
    },

    listUserPresets() {
      return read(PRESET_KEY);
    },

    addUserPreset(preset) {
      const presets = read(PRESET_KEY);
      presets.push(preset);
      write(PRESET_KEY, presets);
    }
  };
})();
