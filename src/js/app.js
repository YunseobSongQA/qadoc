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
  let historyCache = {}; // version -> content (이력 되돌리기용)

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
    // 공유 링크로 열렸으면 읽기 전용 보기
    const sh = new URLSearchParams(location.search).get("share");
    if (sh) {
      renderSharedView(QADOC.share.decode(sh));
      return;
    }
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
      case "history":
        return showHistory();
      case "share":
        return shareCurrent();
      case "restore-version":
        return restoreVersion(Number(el.getAttribute("data-ver")));
      case "modal-close":
        return closeModal();
      case "rules-open":
        return openRulesEditor();
      case "rules-pick":
        return renderRulesEditor(el.getAttribute("data-type"), Number(el.getAttribute("data-ver")));
      case "rules-validate":
        return validateRulesForm();
      case "rules-save":
        return saveRulesForm();
      case "rules-activate":
        return activateRulesVersion(el.getAttribute("data-type"), Number(el.getAttribute("data-ver")));
      case "rules-reset":
        return resetRulesForm(el.getAttribute("data-type"));
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

    // TC는 Excel, 기획서는 PPT로 내보내기
    const exportLabel = cur.type === "testcase" ? "Excel 내보내기" : "PPT 내보내기";

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
      '<button class="btn" data-action="export">' + exportLabel + "</button>" +
      '<button class="btn" data-action="history">이력</button>' +
      '<button class="btn" data-action="share">공유</button>' +
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
  function activeRuleset(type) {
    // 화면 편집/버전 관리되는 룰셋 우선, 없으면 시스템 기본
    return QADOC.rules ? QADOC.rules.active(type) : QADOC.review.activeRulesetFor(type);
  }

  function ruleFindings() {
    const cur = state.current;
    const ruleset = activeRuleset(cur.type);
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

  // ---------- 내보내기 (TC→Excel, 기획서→PPT) ----------
  function exporterFor(type) {
    return type === "testcase" ? QADOC.exportExcel : QADOC.exportPpt;
  }

  function exportCurrent() {
    syncFormToState();
    const cur = state.current;
    const preset = presetById(cur.presetId);
    if (!cur.title && Object.keys(cur.content).length === 0) {
      alert("내보낼 내용이 없습니다.");
      return;
    }
    try {
      exporterFor(cur.type).exportDocument(cur, preset);
    } catch (e) {
      alert("내보내기 실패: " + (e.message || e));
    }
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
    exporterFor(cur.type).exportAll(docs, preset, "qadoc-" + cur.type);
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

  // ---------- 버전 이력 ----------
  async function showHistory() {
    const cur = state.current;
    if (!cur || !cur.id) {
      alert("먼저 저장한 문서여야 이력이 있습니다.");
      return;
    }
    const doc = await store().getDocument(cur.id);
    let past = [];
    try {
      past = await store().getVersions(cur.id);
    } catch (e) {
      /* ignore */
    }
    historyCache = {};
    const all = [{ version: doc.currentVersion || 1, content: doc.content, savedAt: doc.updatedAt, current: true }].concat(past);
    const items = all
      .map((v) => {
        historyCache[v.version] = v.content;
        const when = v.savedAt ? new Date(v.savedAt).toLocaleString("ko-KR") : "";
        const tag = v.current ? '<span class="ver-cur">현재</span>' : "";
        const btn = v.current
          ? ""
          : '<button class="btn btn-sm" data-action="restore-version" data-ver="' + v.version + '">되돌리기</button>';
        return (
          '<li class="ver-item"><div><strong>v' + v.version + "</strong> " + tag +
          '<div class="muted small">' + esc(when) + "</div></div>" + btn + "</li>"
        );
      })
      .join("");
    openModal("버전 이력", '<ul class="ver-list">' + items + "</ul>");
  }

  function restoreVersion(ver) {
    const content = historyCache[ver];
    if (!content) return;
    state.current.content = Object.assign({}, content);
    renderEditor();
    closeModal();
    flash("v" + ver + " 내용을 불러왔습니다. 저장하면 새 버전이 됩니다.");
  }

  // ---------- 공유 (자체 완결형 읽기 전용 링크) ----------
  function shareCurrent() {
    syncFormToState();
    const cur = state.current;
    const preset = presetById(cur.presetId);
    if (!cur.title && Object.keys(cur.content).length === 0) {
      alert("공유할 내용이 없습니다.");
      return;
    }
    const payload = {
      t: cur.type,
      ti: cur.title,
      c: cur.content,
      f: preset.fields.map((f) => ({ key: f.key, label: f.label, type: f.type }))
    };
    const link = location.origin + location.pathname + "?share=" + QADOC.share.encode(payload);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(
        () => flash("공유 링크를 복사했습니다."),
        () => {}
      );
    }
    openModal(
      "공유 링크 (읽기 전용)",
      '<p class="muted small">문서 내용을 담은 자체 완결형 링크입니다. 받는 사람은 로그인 없이 읽기 전용으로 봅니다.</p>' +
        '<textarea id="share-link" readonly rows="4" style="width:100%" onclick="this.select()"></textarea>'
    );
    // 링크는 DOM text → innerHTML 경로를 피하려고 .value 로 직접 주입 (XSS 정적분석 경고 회피 + 안전)
    const ta = $("#share-link");
    if (ta) ta.value = link;
  }

  function renderSharedView(payload) {
    if (!payload) {
      $("#editor").innerHTML = '<div class="empty-state"><h2>잘못된 공유 링크</h2><p>링크가 손상되었거나 만료되었습니다.</p></div>';
      $("#doc-list").innerHTML = '<li class="muted small">공유 보기 모드</li>';
      return;
    }
    const typeName = payload.t === "testcase" ? "테스트케이스" : "기획서";
    const rows = (payload.f || [])
      .map((f) => {
        const v = payload.c ? payload.c[f.key] : "";
        const val = Array.isArray(v) ? v.join("\n") : v == null ? "" : String(v);
        return (
          '<div class="ro-field"><div class="ro-label">' + esc(f.label) + "</div>" +
          '<div class="ro-value">' + esc(val).replace(/\n/g, "<br>") + "</div></div>"
        );
      })
      .join("");
    $("#editor").innerHTML =
      '<div class="share-banner">📎 공유된 ' + typeName + " (읽기 전용)</div>" +
      '<div class="ro-doc"><h2>' + esc(payload.ti || "(제목 없음)") + "</h2>" + rows + "</div>";
    $("#doc-list").innerHTML = '<li class="muted small">공유 보기 모드</li>';
    $("#review-output").innerHTML = '<p class="muted small">읽기 전용 공유 보기입니다.</p>';
  }

  // ---------- 검토 기준(룰셋) 편집 ----------
  let rulesEditorType = "testcase";
  let rulesEditorVersion = null; // 현재 편집창에 띄운 버전

  const RULE_TYPES = [
    ["required", "필수 입력 (값 비면 위반)"],
    ["minItems", "리스트 최소 개수 (min)"],
    ["minLength", "최소 글자수 (min)"],
    ["maxLength", "최대 글자수 (max)"],
    ["regex", "형식 일치 (pattern, 불일치 시 위반)"],
    ["pattern", "금지 패턴 발견 시 위반 (pattern, field \"*\"=전체)"],
    ["forbiddenWords", "금지/모호어 포함 시 위반 (words: [])"]
  ];

  function openRulesEditor() {
    rulesEditorType = state.current ? state.current.type : "testcase";
    renderRulesEditor(rulesEditorType, null);
  }

  function renderRulesEditor(type, version) {
    rulesEditorType = type;
    const versions = QADOC.rules.versions(type);
    const active = QADOC.rules.active(type);
    const showVer = version || active.version;
    rulesEditorVersion = showVer;
    const shown = versions.find((v) => v.version === showVer) || active;

    const typeName = type === "testcase" ? "테스트케이스" : "기획서";
    const typeBtns =
      ["testcase", "spec"]
        .map(
          (t) =>
            '<button class="btn btn-sm' + (t === type ? " btn-primary" : "") + '" data-action="rules-pick" data-type="' +
            t + '" data-ver="' + QADOC.rules.active(t).version + '">' +
            (t === "testcase" ? "TC" : "기획서") + "</button>"
        )
        .join(" ");

    // 버전 이름은 사용자 입력에서 온 값일 수 있으므로 innerHTML 에 넣지 않고
    // 렌더 후 textContent 로 주입한다 (정적 분석상 DOM text→HTML 흐름 차단 + XSS 안전).
    const verItems = versions
      .map((v) => {
        const tag = v.active ? '<span class="ver-cur">활성</span>' : "";
        const here = v.version === showVer ? " sel" : "";
        const act = v.active
          ? ""
          : '<button class="btn btn-sm" data-action="rules-activate" data-type="' + type + '" data-ver="' + v.version + '">활성화</button>';
        return (
          '<li class="ver-item' + here + '">' +
          '<div><button class="btn-link" data-action="rules-pick" data-type="' + type + '" data-ver="' + v.version + '"><strong>v' + v.version + "</strong></button> " +
          tag + ' <span class="muted small vn" data-vn="' + v.version + '"></span></div>' + act + "</li>"
        );
      })
      .join("");

    // RULE_TYPES 는 코드 상수(정적)라 innerHTML 에 그대로 사용해도 안전
    const typesHelp = RULE_TYPES.map((r) => "<code>" + esc(r[0]) + "</code> — " + esc(r[1])).join("<br>");

    const body =
      '<div class="rules-bar"><span class="muted small">유형:</span> ' + typeBtns +
      '<span class="muted small" style="margin-left:10px">버전 전환·생성</span></div>' +
      '<ul class="ver-list rules-vers">' + verItems + "</ul>" +
      '<label class="field-label">기준 이름</label>' +
      '<input id="rules-name" type="text" style="width:100%;margin-bottom:8px" />' +
      '<label class="field-label">룰 정의 (JSON 배열)</label>' +
      '<textarea id="rules-json" rows="14" style="width:100%;font-family:monospace;font-size:12px"></textarea>' +
      '<div id="rules-msg" class="rules-msg muted small"></div>' +
      '<div class="rules-actions">' +
      '<button class="btn btn-sm" data-action="rules-validate">검증</button>' +
      '<button class="btn btn-sm btn-primary" data-action="rules-save">새 버전으로 저장 + 활성화</button>' +
      '<button class="btn btn-sm" data-action="rules-reset" data-type="' + type + '">기본값 복원</button>' +
      "</div>" +
      '<details class="rules-help"><summary>지원하는 룰 타입</summary><div class="muted small">' +
      typesHelp +
      "<br><br>공통 필드: <code>id</code>, <code>field</code>(필드 key 또는 \"*\"), <code>severity</code>(error|warning|info), <code>message</code>, <code>guideline</code></div></details>";

    openModal("검토 기준 편집 — " + typeName, body);

    // 동적(=사용자 입력 유래 가능) 텍스트는 DOM 프로퍼티로 주입 (innerHTML 미경유)
    const nameEl = $("#rules-name");
    if (nameEl) nameEl.value = shown.name || "";
    const jsonEl = $("#rules-json");
    if (jsonEl) jsonEl.value = JSON.stringify(shown.rules || [], null, 2);
    versions.forEach((v) => {
      const span = document.querySelector('.vn[data-vn="' + v.version + '"]');
      if (span) span.textContent = v.name || "";
    });
  }

  function readRulesForm() {
    const nameEl = $("#rules-name");
    const jsonEl = $("#rules-json");
    const name = nameEl ? nameEl.value.trim() : "";
    const parsed = JSON.parse(jsonEl.value); // throws on bad JSON
    if (!Array.isArray(parsed)) throw new Error("룰은 JSON 배열이어야 합니다.");
    const validTypes = Object.keys(QADOC.review.handlers);
    parsed.forEach((r, i) => {
      if (!r || typeof r !== "object") throw new Error(i + "번째 항목이 객체가 아닙니다.");
      if (!r.id || typeof r.id !== "string") throw new Error(i + "번째 룰에 문자열 id가 필요합니다.");
      if (!r.field || typeof r.field !== "string") throw new Error("룰 '" + r.id + "'에 field 가 필요합니다.");
      if (validTypes.indexOf(r.type) < 0) throw new Error("룰 '" + r.id + "'의 type '" + r.type + "'은 지원되지 않습니다.");
      if (r.severity && ["error", "warning", "info"].indexOf(r.severity) < 0)
        throw new Error("룰 '" + r.id + "'의 severity 가 잘못되었습니다.");
    });
    return { name: name, rules: parsed };
  }

  function setRulesMsg(text, ok) {
    const el = $("#rules-msg");
    if (el) {
      el.textContent = text;
      el.className = "rules-msg small " + (ok ? "ok" : "err");
    }
  }

  function validateRulesForm() {
    try {
      const f = readRulesForm();
      setRulesMsg("✓ 유효합니다. 룰 " + f.rules.length + "개.", true);
    } catch (e) {
      setRulesMsg("✗ " + (e.message || e), false);
    }
  }

  function saveRulesForm() {
    let f;
    try {
      f = readRulesForm();
    } catch (e) {
      return setRulesMsg("✗ " + (e.message || e), false);
    }
    const saved = QADOC.rules.saveNewVersion(rulesEditorType, f.name, f.rules);
    flash("기준 저장됨 — " + (rulesEditorType === "testcase" ? "TC" : "기획서") + " v" + saved.version + " 활성화");
    renderRulesEditor(rulesEditorType, saved.version);
  }

  function activateRulesVersion(type, version) {
    const a = QADOC.rules.setActive(type, version);
    flash("v" + a.version + " 활성화됨");
    renderRulesEditor(type, version);
  }

  function resetRulesForm(type) {
    if (!confirm("시스템 기본 기준을 새 버전으로 복원하고 활성화할까요?")) return;
    const a = QADOC.rules.resetToDefault(type);
    if (a) {
      flash("기본값으로 복원됨 (v" + a.version + ")");
      renderRulesEditor(type, a.version);
    }
  }

  // ---------- 모달 ----------
  function openModal(title, bodyHtml) {
    closeModal();
    const overlay = document.createElement("div");
    overlay.id = "modal-overlay";
    overlay.className = "modal-overlay";
    overlay.setAttribute("data-action", "modal-close");
    overlay.innerHTML =
      '<div class="modal" onclick="event.stopPropagation()">' +
      '<div class="modal-head"><span>' + esc(title) + "</span>" +
      '<button class="modal-x" data-action="modal-close">×</button></div>' +
      '<div class="modal-body">' + bodyHtml + "</div></div>";
    document.body.appendChild(overlay);
  }
  function closeModal() {
    const el = document.getElementById("modal-overlay");
    if (el) el.remove();
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
