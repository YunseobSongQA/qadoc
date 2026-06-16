/*
 * QADOC 앱 진입점 — 상태 관리 + 렌더링 + 이벤트.
 * 의존: storage.js, review-engine.js, export-excel.js, DATA(presets/rulesets)
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  const state = {
    presets: [],
    current: null // { id?, type, presetId, title, content }
  };

  // ---------- 유틸 ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function presetById(id) {
    return state.presets.find((p) => p.id === id) || null;
  }
  function presetsByType(type) {
    return state.presets.filter((p) => p.type === type);
  }
  function fieldLabel(preset, key) {
    if (key === "*") return "전체";
    const f = preset.fields.find((x) => x.key === key);
    return f ? f.label : key;
  }

  // 저장소 선택: 설정되어 있으면 Supabase, 아니면 localStorage.
  // 모든 호출부는 await 로 통일 → 동기(localStorage)/비동기(Supabase) 모두 동작.
  function store() {
    return QADOC.storageSupabase || QADOC.storage;
  }
  function usingSupabase() {
    return !!QADOC.storageSupabase;
  }

  // ---------- 부트(1회) + 렌더 ----------
  function boot() {
    bindEvents();
    if (usingSupabase() && store().client) {
      // 로그인/로그아웃 시 화면 갱신
      store().client.auth.onAuthStateChange(function () {
        render();
      });
    }
    render();
  }

  async function render() {
    // Supabase 사용 + 미로그인 → 로그인 화면
    if (usingSupabase()) {
      let user = null;
      try {
        user = await store().currentUser();
      } catch (e) {
        /* ignore */
      }
      if (!user) {
        renderAuthScreen();
        $("#doc-list").innerHTML = '<li class="muted small">로그인이 필요합니다.</li>';
        return;
      }
    }
    const userPresets = await store().listUserPresets();
    state.presets = (QADOC.DATA.presets || []).concat(userPresets || []);
    await renderSidebar();
    if (!state.current) renderEmpty();
  }

  function renderAuthScreen() {
    $("#editor").innerHTML =
      '<div class="empty-state">' +
      "<h2>로그인</h2>" +
      "<p>사내 이메일로 로그인 링크를 받습니다 (비밀번호 없음).</p>" +
      '<input id="auth-email" type="email" placeholder="you@company.com" style="margin:8px 0;min-width:260px" />' +
      '<div><button class="btn btn-primary" data-action="signin">로그인 링크 보내기</button></div>' +
      "</div>";
  }

  async function signIn() {
    const el = $("#auth-email");
    const email = el ? el.value.trim() : "";
    if (!email) return alert("이메일을 입력하세요.");
    try {
      await store().signIn(email);
      flash("로그인 링크를 메일로 보냈습니다. 메일함을 확인하세요.");
    } catch (e) {
      alert("로그인 실패: " + (e.message || e));
    }
  }

  async function signOut() {
    try {
      await store().signOut();
    } catch (e) {
      /* ignore */
    }
    state.current = null;
    render();
  }

  function bindEvents() {
    document.body.addEventListener("click", onClick);
    const fileInput = $("#preset-file");
    if (fileInput) fileInput.addEventListener("change", onPresetUpload);
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id");

    switch (action) {
      case "new-testcase":
        return startNew("testcase");
      case "new-spec":
        return startNew("spec");
      case "open-doc":
        return openDoc(id);
      case "delete-doc":
        return deleteDoc(id, e);
      case "review":
        return runReview();
      case "review-llm":
        return runReviewLLM();
      case "save":
        return saveCurrent();
      case "export":
        return exportCurrent();
      case "export-all":
        return exportAllOfType();
      case "signin":
        return signIn();
      case "signout":
        return signOut();
    }
  }

  // ---------- 사이드바: 문서 목록 ----------
  async function renderSidebar() {
    const list = $("#doc-list");
    let docs = [];
    try {
      docs = await store().listDocuments();
    } catch (e) {
      list.innerHTML = '<li class="muted small">문서 목록을 불러오지 못했습니다.</li>';
      return;
    }
    if (docs.length === 0) {
      list.innerHTML = '<li class="muted small">아직 저장된 문서가 없습니다.</li>';
      return;
    }
    list.innerHTML = docs
      .map((d) => {
        const typeTag = d.type === "testcase" ? "TC" : "기획";
        const active = state.current && state.current.id === d.id ? " active" : "";
        return (
          '<li class="doc-item' + active + '" data-action="open-doc" data-id="' + esc(d.id) + '">' +
          '<span class="doc-type">' + typeTag + "</span>" +
          '<span class="doc-title">' + esc(d.title || "(제목 없음)") + "</span>" +
          '<button class="doc-del" data-action="delete-doc" data-id="' + esc(d.id) + '" title="삭제">×</button>' +
          "</li>"
        );
      })
      .join("");
  }

  // ---------- 편집 영역 ----------
  function renderEmpty() {
    $("#editor").innerHTML =
      '<div class="empty-state">' +
      "<h2>표준화된 문서 작성을 시작하세요</h2>" +
      "<p>좌측에서 <strong>새 테스트케이스</strong> 또는 <strong>새 기획서</strong>를 선택하면 프리셋 폼이 열립니다.</p>" +
      "</div>";
    clearReview();
  }

  function startNew(type) {
    const presets = presetsByType(type);
    if (presets.length === 0) {
      alert("해당 유형의 프리셋이 없습니다.");
      return;
    }
    state.current = { type: type, presetId: presets[0].id, title: "", content: {} };
    renderEditor();
    renderSidebar();
  }

  async function openDoc(id) {
    const doc = await store().getDocument(id);
    if (!doc) return;
    state.current = {
      id: doc.id,
      type: doc.type,
      presetId: doc.presetId,
      title: doc.title,
      content: Object.assign({}, doc.content || {})
    };
    renderEditor();
    renderSidebar();
    clearReview();
  }

  async function deleteDoc(id, e) {
    if (e) e.stopPropagation();
    if (!confirm("이 문서를 삭제할까요?")) return;
    await store().deleteDocument(id);
    if (state.current && state.current.id === id) {
      state.current = null;
      renderEmpty();
    }
    renderSidebar();
  }

  function renderEditor() {
    const cur = state.current;
    const preset = presetById(cur.presetId);
    const typeName = cur.type === "testcase" ? "테스트케이스" : "기획서";

    // 같은 유형의 프리셋 선택 옵션
    const presetOptions = presetsByType(cur.type)
      .map((p) => '<option value="' + esc(p.id) + '"' + (p.id === cur.presetId ? " selected" : "") + ">" + esc(p.name) + "</option>")
      .join("");

    const fieldsHtml = preset.fields.map((f) => renderField(f, cur.content[f.key])).join("");

    $("#editor").innerHTML =
      '<div class="editor-toolbar">' +
      '<div class="toolbar-left">' +
      '<span class="type-badge">' + typeName + "</span>" +
      '<select id="preset-select" class="preset-select">' + presetOptions + "</select>" +
      "</div>" +
      '<div class="toolbar-right">' +
      '<button class="btn btn-review" data-action="review">검토</button>' +
      '<button class="btn" data-action="review-llm" title="무료 LLM으로 문장 명확성·모호성 보조 검토">LLM 검토</button>' +
      '<button class="btn" data-action="save">저장</button>' +
      '<button class="btn" data-action="export">Excel 내보내기</button>' +
      "</div>" +
      "</div>" +
      '<div class="form-grid">' +
      '<label class="field"><span class="field-label">문서 제목</span>' +
      '<input id="doc-title" type="text" value="' + esc(cur.title) + '" placeholder="문서 제목" /></label>' +
      fieldsHtml +
      "</div>";

    // 프리셋 변경 핸들러
    const sel = $("#preset-select");
    if (sel) {
      sel.addEventListener("change", function () {
        syncFormToState();
        state.current.presetId = sel.value;
        renderEditor();
      });
    }
  }

  function renderField(f, value) {
    const req = f.required ? '<span class="req">*</span>' : "";
    const label = '<span class="field-label">' + esc(f.label) + req + "</span>";
    const id = "f_" + f.key;
    const ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "";
    let control = "";

    if (f.type === "textarea") {
      control = '<textarea id="' + id + '" rows="3"' + ph + ">" + esc(value || "") + "</textarea>";
    } else if (f.type === "list") {
      const text = Array.isArray(value) ? value.join("\n") : value || "";
      control =
        '<textarea id="' + id + '" rows="4" class="list-input"' + ph + ">" + esc(text) + "</textarea>" +
        '<span class="field-hint">한 줄에 한 항목</span>';
    } else if (f.type === "select") {
      const opts = ['<option value="">선택</option>']
        .concat((f.options || []).map((o) => '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + ">" + esc(o) + "</option>"))
        .join("");
      control = '<select id="' + id + '">' + opts + "</select>";
    } else {
      control = '<input id="' + id + '" type="text" value="' + esc(value || "") + '"' + ph + " />";
    }

    const wide = f.type === "textarea" || f.type === "list" ? " field-wide" : "";
    return '<label class="field' + wide + '">' + label + control + "</label>";
  }

  // 폼 → 상태
  function syncFormToState() {
    const cur = state.current;
    if (!cur) return;
    const preset = presetById(cur.presetId);
    const titleEl = $("#doc-title");
    if (titleEl) cur.title = titleEl.value.trim();
    const content = {};
    preset.fields.forEach((f) => {
      const el = document.getElementById("f_" + f.key);
      if (!el) return;
      if (f.type === "list") {
        content[f.key] = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
      } else {
        content[f.key] = el.value;
      }
    });
    cur.content = content;
  }

  // ---------- 검토 ----------
  // 룰베이스 검토 (항상 동작, 비용 0)
  function ruleFindings() {
    const cur = state.current;
    const ruleset = QADOC.review.activeRulesetFor(cur.type);
    const findings = QADOC.review.run(cur.content, ruleset).findings.map((f) =>
      Object.assign({ source: "rule" }, f)
    );
    return { findings: findings, ruleset: ruleset };
  }

  function runReview() {
    syncFormToState();
    const r = ruleFindings();
    renderReview(r.findings, r.ruleset, { state: "idle" });
  }

  // LLM 검토: 룰 결과를 먼저 즉시 표시하고, 무료 LLM 결과를 비동기로 덧붙인다.
  // LLM이 막히면(서버 미연결·쿼터 등) 룰 결과만으로 정상 동작 (fallback).
  async function runReviewLLM() {
    syncFormToState();
    const cur = state.current;
    const preset = presetById(cur.presetId);
    const r = ruleFindings();

    renderReview(r.findings, r.ruleset, { state: "loading" });

    const payload = {
      type: cur.type,
      fields: preset.fields.map((f) => ({ key: f.key, label: f.label })),
      content: cur.content
    };

    try {
      const res = await QADOC.reviewLLM(payload);
      const llm = (res.findings || []).map((f) => Object.assign({ source: "llm" }, f));
      renderReview(r.findings.concat(llm), r.ruleset, { state: "done", provider: res.provider });
    } catch (e) {
      renderReview(r.findings, r.ruleset, { state: "error", reason: e.reason || e.message });
    }
  }

  function renderReview(findings, ruleset, llm) {
    const out = $("#review-output");
    const preset = presetById(state.current.presetId);

    const order = { error: 0, warning: 1, info: 2 };
    findings = findings.slice().sort((a, b) => (order[a.severity] || 9) - (order[b.severity] || 9));

    const counts = findings.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    }, {});

    let html = '<div class="review-meta">';
    html += '<span class="review-ruleset">기준: ' + esc(ruleset.name || "-") + " v" + (ruleset.version || 1) + "</span>";
    html += llmStatus(llm);
    html += "</div>";

    if (findings.length === 0) {
      html +=
        '<div class="review-pass">✓ 기준을 모두 통과했습니다.</div>' +
        '<p class="muted small">형식·필수항목 기준 기반입니다. 문장 명확성 등 보조 검토는 LLM 검토 버튼으로 확인하세요.</p>';
      out.innerHTML = html;
      return;
    }

    html +=
      '<div class="review-summary">' +
      badge("error", counts.error) +
      badge("warning", counts.warning) +
      badge("info", counts.info) +
      "</div>";

    html += '<ul class="finding-list">';
    html += findings
      .map((f) => {
        const src = f.source === "llm" ? '<span class="src-tag src-llm">LLM</span>' : '<span class="src-tag src-rule">룰</span>';
        return (
          '<li class="finding sev-' + esc(f.severity) + '">' +
          '<div class="finding-head">' +
          src +
          '<span class="sev-tag">' + sevLabel(f.severity) + "</span>" +
          '<span class="finding-field">' + esc(fieldLabel(preset, f.field)) + "</span>" +
          "</div>" +
          '<div class="finding-msg">' + esc(f.message) + "</div>" +
          (f.guideline ? '<div class="finding-guide">💡 ' + esc(f.guideline) + "</div>" : "") +
          "</li>"
        );
      })
      .join("");
    html += "</ul>";

    out.innerHTML = html;
  }

  function llmStatus(llm) {
    if (!llm || llm.state === "idle") return "";
    if (llm.state === "loading") return '<span class="llm-status loading">LLM 검토 중…</span>';
    if (llm.state === "done") return '<span class="llm-status ok">LLM 검토 완료 (' + esc(llm.provider || "llm") + ")</span>";
    if (llm.state === "error") return '<span class="llm-status err">LLM 미사용 — ' + esc(llm.reason || "실패") + " · 룰 결과만 표시</span>";
    return "";
  }

  function badge(sev, n) {
    if (!n) return "";
    return '<span class="count-badge sev-' + sev + '">' + sevLabel(sev) + " " + n + "</span>";
  }
  function sevLabel(sev) {
    return sev === "error" ? "오류" : sev === "warning" ? "주의" : "참고";
  }
  function clearReview() {
    $("#review-output").innerHTML = '<p class="muted">작성 후 <strong>검토</strong> 버튼을 눌러보세요.</p>';
  }

  // ---------- 저장 ----------
  async function saveCurrent() {
    syncFormToState();
    const cur = state.current;
    if (!cur.title) {
      alert("문서 제목을 입력하세요.");
      return;
    }
    let saved;
    try {
      saved = await store().saveDocument({
        id: cur.id,
        type: cur.type,
        presetId: cur.presetId,
        title: cur.title,
        content: cur.content
      });
    } catch (e) {
      return alert("저장 실패: " + (e.message || e));
    }
    state.current.id = saved.id;
    renderSidebar();
    flash("저장되었습니다 (v" + (saved.currentVersion || 1) + ")");
  }

  // ---------- 내보내기 ----------
  function exportCurrent() {
    syncFormToState();
    const cur = state.current;
    const preset = presetById(cur.presetId);
    if (!cur.title && Object.keys(cur.content).length === 0) {
      alert("내보낼 내용이 없습니다.");
      return;
    }
    QADOC.exportExcel.exportDocument(cur, preset);
  }

  async function exportAllOfType() {
    const cur = state.current;
    const preset = presetById(cur.presetId);
    const all = await store().listDocuments();
    const docs = all.filter((d) => d.type === cur.type);
    if (docs.length === 0) {
      alert("내보낼 저장 문서가 없습니다.");
      return;
    }
    QADOC.exportExcel.exportAll(docs, preset, "qadoc-" + cur.type);
  }

  // ---------- 프리셋 업로드 ----------
  function onPresetUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function () {
      try {
        const parsed = JSON.parse(reader.result);
        const presets = Array.isArray(parsed) ? parsed : (parsed.presets || [parsed]);
        const valid = presets.filter(validatePreset);
        if (valid.length === 0) {
          alert("유효한 프리셋을 찾지 못했습니다. (id, type, fields 필요)");
          return;
        }
        for (const p of valid) {
          await store().addUserPreset(p);
          state.presets.push(p);
        }
        flash(valid.length + "개 프리셋을 가져왔습니다.");
      } catch (err) {
        alert("JSON 파싱 실패: " + err.message);
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function validatePreset(p) {
    return p && typeof p.id === "string" &&
      (p.type === "testcase" || p.type === "spec") &&
      Array.isArray(p.fields) && p.fields.length > 0;
  }

  // ---------- 토스트 ----------
  function flash(msg) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
