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
        return loadRulesDraft(el.getAttribute("data-type"), Number(el.getAttribute("data-ver")));
      case "rules-add":
        return openRuleForm(null);
      case "rules-edit":
        return openRuleForm(Number(el.getAttribute("data-idx")));
      case "rules-del":
        return deleteDraftRule(Number(el.getAttribute("data-idx")));
      case "rule-form-save":
        return saveRuleForm();
      case "rule-form-cancel":
        return renderRulesEditor();
      case "rules-commit":
        return commitRulesDraft();
      case "rules-activate":
        return activateRulesVersion(el.getAttribute("data-type"), Number(el.getAttribute("data-ver")));
      case "rules-reset":
        return resetRulesForm(el.getAttribute("data-type"));
      case "rules-json-toggle":
        return toggleRulesJson();
      case "rules-json-apply":
        return applyRulesJson();
      case "library-open":
        return openLibrary();
      case "example-open":
        return openExample(id);
      case "view-preset":
        return viewPreset(id);
      case "view-doc":
        return openDoc(id);
      case "consistency":
        return runConsistency();
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
          '<button class="doc-del" data-action="delete-doc" data-id="' + esc(d.id) + '" title="삭제" aria-label="삭제">' + QADOC.icon("trash") + "</button>" +
          "</li>"
        );
      })
      .join("");
  }

  // ---------- 편집 영역 ----------
  function renderEmpty() {
    const examples = QADOC.DATA.examples || [];
    const cards = examples
      .map(function (ex) {
        const tag = ex.type === "testcase" ? "테스트케이스" : "기획서";
        const ic = ex.type === "testcase" ? "clipboard" : "file-text";
        return (
          '<button class="example-card" data-action="example-open" data-id="' + esc(ex.id) + '">' +
          '<span class="example-ic">' + QADOC.icon(ic) + "</span>" +
          '<span class="example-body">' +
          '<span class="example-tag">' + tag + " 예시</span>" +
          '<span class="example-title">' + esc(ex.title.replace("[예시] ", "")) + "</span>" +
          '<span class="example-note">' + esc(ex.note || "") + "</span>" +
          "</span>" +
          '<span class="example-go">' + QADOC.icon("arrow-right") + "</span>" +
          "</button>"
        );
      })
      .join("");

    $("#editor").innerHTML =
      '<div class="welcome">' +
      '<div class="welcome-head">' +
      "<h2>무엇을 작성하든, 기준은 같게</h2>" +
      "<p>QADOC은 이전 자료의 증적을 바탕으로 <strong>기획서와 테스트케이스의 일관성</strong>을 점검하고, " +
      "<strong>어디를 고치면 좋을지</strong> 조언합니다. 검토 기준은 팀이 쓰면서 직접 쌓아갑니다.</p>" +
      "</div>" +
      '<div class="welcome-actions">' +
      '<button class="btn btn-primary" data-action="new-testcase">' + QADOC.icon("plus") + " 새 테스트케이스</button>" +
      '<button class="btn btn-primary" data-action="new-spec">' + QADOC.icon("plus") + " 새 기획서</button>" +
      '<button class="btn" data-action="library-open">' + QADOC.icon("library") + " 라이브러리 둘러보기</button>" +
      "</div>" +
      (cards
        ? '<div class="welcome-examples"><div class="welcome-sub">' +
          QADOC.icon("book-open") +
          " 예시로 빠르게 감 잡기 — 눌러서 그대로 열어보세요</div>" +
          '<div class="example-grid">' + cards + "</div></div>"
        : "") +
      "</div>";
    clearReview();
  }

  function startNew(type) {
    const presets = presetsByType(type);
    if (presets.length === 0) {
      alert("해당 유형의 프리셋이 없습니다.");
      return;
    }
    state.current = { type: type, presetId: presets[0].id, title: "", content: {}, linkedId: null };
    renderEditor();
    renderSidebar();
  }

  async function openDoc(id) {
    closeModal();
    const doc = await store().getDocument(id);
    if (!doc) return;
    state.current = {
      id: doc.id,
      type: doc.type,
      presetId: doc.presetId,
      title: doc.title,
      linkedId: doc.linkedId || null,
      content: Object.assign({}, doc.content || {})
    };
    renderEditor();
    renderSidebar();
    clearReview();
  }

  // 예시 문서를 편집기로 복제(새 문서) → 그대로 보고 고쳐서 저장 가능
  function openExample(id) {
    closeModal();
    const ex = (QADOC.DATA.examples || []).find((e) => e.id === id);
    if (!ex) return;
    state.current = {
      type: ex.type,
      presetId: ex.presetId,
      title: ex.title,
      linkedId: null,
      content: Object.assign({}, ex.content || {})
    };
    renderEditor();
    renderSidebar();
    clearReview();
    flash("예시를 불러왔습니다. 자유롭게 고치고 저장하세요.");
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
      '<button class="btn btn-review" data-action="review">' + QADOC.icon("check") + " 검토</button>" +
      '<button class="btn" data-action="consistency" title="연결된 문서와의 일관성을 점검합니다">' + QADOC.icon("scale") + " 일관성</button>" +
      '<button class="btn" data-action="review-llm" title="무료 LLM으로 문장 명확성·모호성 보조 검토">' + QADOC.icon("sparkle") + " LLM</button>" +
      '<button class="btn" data-action="save">' + QADOC.icon("save") + " 저장</button>" +
      '<button class="btn" data-action="export">' + QADOC.icon("download") + " " + exportLabel + "</button>" +
      '<button class="btn" data-action="history">' + QADOC.icon("history") + " 이력</button>" +
      '<button class="btn" data-action="share">' + QADOC.icon("share") + " 공유</button>" +
      "</div>" +
      "</div>" +
      '<div class="link-bar" id="link-bar"></div>' +
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

    renderLinkBar();
  }

  // 연결 문서 바: TC는 기획서를 연결, 기획서는 연결된 TC 수를 보여준다.
  async function renderLinkBar() {
    const bar = $("#link-bar");
    if (!bar) return;
    const cur = state.current;
    let docs = [];
    try {
      docs = await store().listDocuments();
    } catch (e) {
      /* ignore */
    }
    if (cur.type === "testcase") {
      const specs = docs.filter((d) => d.type === "spec");
      const opts = ['<option value="">— 연결된 기획서 없음 —</option>']
        .concat(
          specs.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (s.id === cur.linkedId ? " selected" : "") + ">" + esc(s.title || "(제목 없음)") + "</option>";
          })
        )
        .join("");
      bar.innerHTML =
        '<span class="link-label">' + QADOC.icon("link") + " 연결된 기획서</span>" +
        '<select id="link-select" class="preset-select">' + opts + "</select>" +
        '<span class="link-hint">연결하면 일관성 검토에서 이 기획서를 기준으로 점검합니다.</span>';
      const ls = $("#link-select");
      if (ls) ls.addEventListener("change", function () { state.current.linkedId = ls.value || null; });
    } else {
      const linked = docs.filter((d) => d.type === "testcase" && d.linkedId === cur.id);
      bar.innerHTML =
        '<span class="link-label">' + QADOC.icon("clipboard") + " 이 기획서를 검증하는 TC</span>" +
        '<span class="link-count">' + linked.length + "개</span>" +
        '<span class="link-hint">' +
        (cur.id
          ? "‘일관성’을 누르면 요구사항이 TC로 충분히 검증되는지 점검합니다."
          : "먼저 저장하면 연결된 TC와의 일관성을 점검할 수 있습니다.") +
        "</span>";
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

  // 일관성 검토: 룰 결과 위에 '증적 기반' 조언을 덧붙인다.
  async function runConsistency() {
    syncFormToState();
    const cur = state.current;
    const r = ruleFindings();
    renderReview(r.findings, r.ruleset, { state: "idle", consistency: "loading" });
    let cons = [];
    try {
      cons = await gatherConsistency(cur);
    } catch (e) {
      cons = [{ source: "consistency", severity: "info", field: "*", message: "일관성 검토를 수행하지 못했습니다", guideline: String(e.message || e) }];
    }
    renderReview(r.findings.concat(cons), r.ruleset, { state: "idle", consistency: "done" });
  }

  async function gatherConsistency(cur) {
    if (cur.type === "spec") {
      if (!cur.id) {
        return [{ source: "consistency", severity: "info", field: "*",
          message: "먼저 기획서를 저장하세요", guideline: "저장하면 이 기획서에 연결된 TC를 모아 요구사항 검증 여부를 점검합니다." }];
      }
      const all = await store().listDocuments();
      const linked = all.filter((d) => d.type === "testcase" && d.linkedId === cur.id);
      const full = [];
      for (const t of linked) {
        const d = await store().getDocument(t.id);
        if (d) full.push(d);
      }
      return QADOC.consistency.checkSpecCoverage(cur, full).findings;
    }
    // 테스트케이스
    if (!cur.linkedId) {
      return [{ source: "consistency", severity: "info", field: "*",
        message: "연결된 기획서가 없습니다", guideline: "상단의 ‘연결된 기획서’를 선택하면 이 TC가 어떤 요구사항을 검증하는지 알려드립니다." }];
    }
    const spec = await store().getDocument(cur.linkedId);
    if (!spec) {
      return [{ source: "consistency", severity: "warning", field: "*",
        message: "연결된 기획서를 찾을 수 없습니다", guideline: "기획서가 삭제되었을 수 있습니다. 연결을 다시 선택하세요." }];
    }
    const r = QADOC.consistency.tcVsSpec(spec, { content: cur.content });
    if (r.total === 0) {
      return [{ source: "consistency", severity: "info", field: "*",
        message: "연결된 기획서에 검증할 요구사항이 없습니다", guideline: "기획서의 상세 요구사항·완료 조건을 먼저 채우세요." }];
    }
    if (r.matched === 0) {
      return [{ source: "consistency", severity: "warning", field: "*",
        message: "이 TC가 기획서 요구사항과 연결되지 않습니다", guideline: "기획서 “" + (spec.title || "") + "”의 요구사항 용어가 이 TC에 보이지 않습니다. 절차·기대결과를 요구사항에 맞추세요." }];
    }
    return [{ source: "consistency", severity: "info", field: "*",
      message: "기획서 요구사항 " + r.matched + "/" + r.total + "건과 연결됩니다",
      guideline: "연결된 기획서 “" + (spec.title || "") + "”의 항목을 잘 검증하고 있습니다." }];
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
    if (llm && llm.consistency === "loading") html += '<span class="llm-status loading">일관성 검토 중…</span>';
    else if (llm && llm.consistency === "done") html += '<span class="llm-status ok">일관성 검토 완료</span>';
    html += "</div>";

    if (findings.length === 0) {
      html +=
        '<div class="review-pass">' + QADOC.icon("check-circle") + " 기준을 모두 통과했습니다.</div>" +
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
        const src =
          f.source === "llm"
            ? '<span class="src-tag src-llm">LLM</span>'
            : f.source === "consistency"
            ? '<span class="src-tag src-consistency">일관성</span>'
            : '<span class="src-tag src-rule">기준</span>';
        return (
          '<li class="finding sev-' + esc(f.severity) + '">' +
          '<div class="finding-head">' +
          src +
          '<span class="sev-tag">' + sevLabel(f.severity) + "</span>" +
          '<span class="finding-field">' + esc(fieldLabel(preset, f.field)) + "</span>" +
          "</div>" +
          '<div class="finding-msg">' + esc(f.message) + "</div>" +
          (f.guideline ? '<div class="finding-guide">' + QADOC.icon("bulb") + " " + esc(f.guideline) + "</div>" : "") +
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
        linkedId: cur.linkedId || null,
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
        const ver = Number(v.version); // 숫자 강제변환 = 안전(문자열 taint 차단)
        historyCache[ver] = v.content;
        const tag = v.current ? '<span class="ver-cur">현재</span>' : "";
        const btn = v.current
          ? ""
          : '<button class="btn btn-sm" data-action="restore-version" data-ver="' + ver + '">되돌리기</button>';
        // 날짜(저장소 유래)는 innerHTML 미경유 — 렌더 후 textContent 로 주입
        return (
          '<li class="ver-item"><div><strong>v' + ver + "</strong> " + tag +
          '<div class="muted small hist-when" data-v="' + ver + '"></div></div>' + btn + "</li>"
        );
      })
      .join("");
    openModal("버전 이력", '<ul class="ver-list">' + items + "</ul>");
    all.forEach((v) => {
      const ver = Number(v.version);
      const el = document.querySelector('.hist-when[data-v="' + ver + '"]');
      if (el) el.textContent = v.savedAt ? new Date(v.savedAt).toLocaleString("ko-KR") : "";
    });
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
      '<div class="share-banner">' + QADOC.icon("link") + " 공유된 " + typeName + " (읽기 전용)</div>" +
      '<div class="ro-doc"><h2>' + esc(payload.ti || "(제목 없음)") + "</h2>" + rows + "</div>";
    $("#doc-list").innerHTML = '<li class="muted small">공유 보기 모드</li>';
    $("#review-output").innerHTML = '<p class="muted small">읽기 전용 공유 보기입니다.</p>';
  }

  // ---------- 검토 기준 편집 (누구나 쓰는 폼 빌더) ----------
  // 기준(룰)을 "코드/JSON"이 아니라 평범한 문장으로 추가·수정한다. 팀이 쓰면서 직접 쌓는 노하우.
  let rulesEditorType = "testcase";
  let rulesDraft = null; // { type, name, rules: [...] } — 저장 전 작업본
  let rulesJsonMode = false; // 고급(JSON) 보기 여부
  let ruleFormIdx = null; // 편집 중인 기준 인덱스 (null = 새 기준)

  // 심각도: 코드값 → 누구나 이해할 친근한 라벨
  const SEVERITIES = [
    ["error", "꼭 고쳐야 함"],
    ["warning", "확인 권장"],
    ["info", "참고"]
  ];
  // 점검 방식: 친근한 라벨 + 필요한 입력값(needs) + 도움말
  const CONDITIONS = [
    { type: "required", label: "비어 있으면 안 됨", needs: [], hint: "이 항목을 반드시 채우게 합니다." },
    { type: "minItems", label: "목록 항목이 너무 적으면", needs: ["min"], hint: "목록형 항목의 최소 개수." },
    { type: "minLength", label: "내용이 너무 짧으면", needs: ["min"], hint: "최소 글자 수." },
    { type: "maxLength", label: "내용이 너무 길면", needs: ["max"], hint: "최대 글자 수." },
    { type: "forbiddenWords", label: "이런 표현이 들어가면", needs: ["words"], hint: "피해야 할 표현을 쉼표로 구분해 적으세요. 예: 등등, 적당히, 대충" },
    { type: "regex", label: "정해진 형식과 달라야 함 (고급)", needs: ["pattern"], hint: "정규식 형식. 예: ^TC-\\d+$" },
    { type: "pattern", label: "특정 패턴이 보이면 (고급)", needs: ["pattern"], hint: "정규식 금지 패턴. 예: 이중 공백 등" }
  ];

  function condMeta(type) {
    return CONDITIONS.find((c) => c.type === type) || CONDITIONS[0];
  }
  function sevLabelKo(sev) {
    const s = SEVERITIES.find((x) => x[0] === sev);
    return s ? s[1] : sev;
  }

  // 해당 유형의 모든 프리셋 필드를 모아 대상 항목 옵션을 만든다.
  function fieldsForType(type) {
    const out = [];
    const seen = {};
    presetsByType(type).forEach((p) => {
      (p.fields || []).forEach((f) => {
        if (!seen[f.key]) {
          seen[f.key] = 1;
          out.push({ key: f.key, label: f.label });
        }
      });
    });
    return out;
  }
  function ruleFieldLabel(type, key) {
    if (key === "*") return "모든 항목";
    const f = fieldsForType(type).find((x) => x.key === key);
    return f ? f.label : key;
  }

  // 기준 1개를 평범한 한국어 문장으로 풀어 쓴다.
  function ruleSentence(type, rule) {
    const fl = ruleFieldLabel(type, rule.field);
    switch (rule.type) {
      case "required":
        return "‘" + fl + "’이(가) 비어 있으면";
      case "minItems":
        return "‘" + fl + "’ 항목이 " + (rule.min || 1) + "개보다 적으면";
      case "minLength":
        return "‘" + fl + "’이(가) " + (rule.min || 0) + "자보다 짧으면";
      case "maxLength":
        return "‘" + fl + "’이(가) " + (rule.max || 0) + "자를 넘으면";
      case "forbiddenWords":
        return "‘" + fl + "’에 [" + (rule.words || []).join(", ") + "] 표현이 있으면";
      case "regex":
        return "‘" + fl + "’이(가) 형식(" + rule.pattern + ")과 다르면";
      case "pattern":
        return "‘" + fl + "’에 ‘" + rule.pattern + "’ 패턴이 보이면";
      default:
        return "‘" + fl + "’ 점검";
    }
  }

  function newRuleId() {
    return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function openRulesEditor() {
    rulesEditorType = state.current ? state.current.type : "testcase";
    loadRulesDraft(rulesEditorType, null);
  }

  // 특정 버전을 작업본(draft)으로 깊은 복사해 불러온다.
  function loadRulesDraft(type, version) {
    rulesEditorType = type;
    rulesJsonMode = false;
    ruleFormIdx = null;
    const active = QADOC.rules.active(type);
    const versions = QADOC.rules.versions(type);
    const showVer = version || active.version;
    const shown = versions.find((v) => v.version === showVer) || active;
    rulesDraft = {
      type: type,
      baseVersion: shown.version,
      name: shown.name || "",
      rules: JSON.parse(JSON.stringify(shown.rules || []))
    };
    renderRulesEditor();
  }

  function renderRulesEditor() {
    const type = rulesEditorType;
    const typeName = type === "testcase" ? "테스트케이스" : "기획서";
    const versions = QADOC.rules.versions(type);
    const active = QADOC.rules.active(type);

    const typeBtns = ["testcase", "spec"]
      .map(function (t) {
        return (
          '<button class="chip' + (t === type ? " chip-on" : "") + '" data-action="rules-pick" data-type="' +
          t + '" data-ver="' + Number(QADOC.rules.active(t).version) + '">' +
          (t === "testcase" ? "테스트케이스" : "기획서") + "</button>"
        );
      })
      .join("");

    const verBtns = versions
      .map(function (v) {
        const ver = Number(v.version);
        const on = v.version === rulesDraft.baseVersion ? " chip-on" : "";
        const act = v.active ? '<span class="ver-cur">활성</span>' : "";
        return (
          '<button class="chip' + on + '" data-action="rules-pick" data-type="' + type + '" data-ver="' + ver + '">v' + ver + " " + act + "</button>"
        );
      })
      .join("");

    // 기준 카드(읽기 쉬운 문장) 또는 고급(JSON) 보기
    let editBody;
    if (rulesJsonMode) {
      editBody =
        '<p class="muted small">JSON 배열을 직접 편집합니다. ‘적용’을 누르면 위 목록에 반영됩니다.</p>' +
        '<textarea id="rules-json" rows="14" class="mono"></textarea>' +
        '<div id="rules-msg" class="rules-msg small"></div>' +
        '<div class="rules-actions"><button class="btn btn-sm btn-primary" data-action="rules-json-apply">' + QADOC.icon("check") + " 적용</button>" +
        '<button class="btn btn-sm" data-action="rules-json-toggle">목록으로 돌아가기</button></div>';
    } else {
      const cards = (rulesDraft.rules || [])
        .map(function (r, i) {
          return (
            '<li class="crit-card sev-' + esc(r.severity || "warning") + '">' +
            '<div class="crit-main">' +
            '<div class="crit-sentence">' + esc(ruleSentence(type, r)) + '<span class="crit-sev">' + esc(sevLabelKo(r.severity)) + "</span></div>" +
            (r.message ? '<div class="crit-msg">' + esc(r.message) + "</div>" : "") +
            (r.guideline ? '<div class="crit-guide">' + QADOC.icon("bulb") + " " + esc(r.guideline) + "</div>" : "") +
            "</div>" +
            '<div class="crit-actions">' +
            '<button class="btn btn-sm" data-action="rules-edit" data-idx="' + i + '">수정</button>' +
            '<button class="icon-btn" data-action="rules-del" data-idx="' + i + '" title="삭제" aria-label="삭제">' + QADOC.icon("trash") + "</button>" +
            "</div></li>"
          );
        })
        .join("");
      editBody =
        '<div class="crit-list-head"><span class="field-label">현재 기준 ' + (rulesDraft.rules || []).length + "개</span>" +
        '<button class="btn btn-sm btn-primary" data-action="rules-add">' + QADOC.icon("plus") + " 기준 추가</button></div>" +
        '<ul class="crit-list">' + (cards || '<li class="muted small">아직 기준이 없습니다. ‘기준 추가’로 시작하세요.</li>') + "</ul>";
    }

    const body =
      '<p class="rules-intro">검토 기준은 팀이 직접 쌓아가는 노하우입니다. 평범한 문장으로 추가·수정하면, 다음 검토부터 바로 적용됩니다.</p>' +
      '<div class="rules-row"><span class="rules-row-label">유형</span><div class="chip-row">' + typeBtns + "</div></div>" +
      '<div class="rules-row"><span class="rules-row-label">불러올 버전</span><div class="chip-row">' + verBtns + "</div></div>" +
      '<label class="field-label">이 기준 묶음의 이름</label>' +
      '<input id="rules-name" type="text" class="full" placeholder="예: 우리 팀 TC 기준" />' +
      '<div class="rules-edit-area">' + editBody + "</div>" +
      '<div class="rules-footer">' +
      '<button class="btn btn-primary" data-action="rules-commit">' + QADOC.icon("save") + " 새 버전으로 저장 · 활성화</button>" +
      '<button class="btn" data-action="rules-reset" data-type="' + type + '">기본값으로 복원</button>' +
      '<button class="btn btn-ghost-sm" data-action="rules-json-toggle">' + (rulesJsonMode ? "쉬운 편집" : "고급(JSON)") + "</button>" +
      "</div>";

    openModal("검토 기준 편집 — " + typeName, body);

    const nameEl = $("#rules-name");
    if (nameEl) nameEl.value = rulesDraft.name || "";
    if (rulesJsonMode) {
      const jsonEl = $("#rules-json");
      if (jsonEl) jsonEl.value = JSON.stringify(rulesDraft.rules || [], null, 2);
    }
  }

  // ---- 기준 추가/수정 폼 (인라인 모달) ----
  function openRuleForm(idx) {
    syncDraftName();
    ruleFormIdx = idx;
    const type = rulesEditorType;
    const editing = idx != null ? rulesDraft.rules[idx] : null;
    const cur = editing || { field: "*", type: "required", severity: "warning", message: "", guideline: "" };

    const fieldOpts = [{ key: "*", label: "모든 항목" }]
      .concat(fieldsForType(type))
      .map(function (f) {
        return '<option value="' + esc(f.key) + '"' + (f.key === cur.field ? " selected" : "") + ">" + esc(f.label) + "</option>";
      })
      .join("");

    const condOpts = CONDITIONS.map(function (c) {
      return '<option value="' + c.type + '"' + (c.type === cur.type ? " selected" : "") + ">" + esc(c.label) + "</option>";
    }).join("");

    const sevOpts = SEVERITIES.map(function (s) {
      return '<option value="' + s[0] + '"' + (s[0] === cur.severity ? " selected" : "") + ">" + esc(s[1]) + "</option>";
    }).join("");

    const body =
      '<div class="rf-grid">' +
      '<label class="field"><span class="field-label">어떤 항목을</span><select id="rf-field">' + fieldOpts + "</select></label>" +
      '<label class="field"><span class="field-label">이럴 때 알려주기</span><select id="rf-cond">' + condOpts + "</select></label>" +
      '<label class="field" id="rf-param-wrap"></label>' +
      '<label class="field"><span class="field-label">어떻게 알려줄까</span><select id="rf-sev">' + sevOpts + "</select></label>" +
      "</div>" +
      '<label class="field"><span class="field-label">안내 문구 (검토 결과에 표시)</span>' +
      '<input id="rf-msg" type="text" class="full" placeholder="예: 기대 결과가 너무 짧습니다" /></label>' +
      '<label class="field"><span class="field-label">개선 가이드 (선택)</span>' +
      '<textarea id="rf-guide" rows="2" class="full" placeholder="예: 검증 가능한 수준으로 구체화하세요."></textarea></label>' +
      '<div id="rf-hint" class="muted small rf-hint"></div>' +
      '<div class="rules-actions">' +
      '<button class="btn btn-primary" data-action="rule-form-save">' + QADOC.icon("check") + " " + (editing ? "수정 완료" : "추가") + "</button>" +
      '<button class="btn" data-action="rule-form-cancel">취소</button></div>';

    openModal((editing ? "기준 수정" : "기준 추가") + " — " + (type === "testcase" ? "TC" : "기획서"), body);

    if ($("#rf-msg")) $("#rf-msg").value = cur.message || "";
    if ($("#rf-guide")) $("#rf-guide").value = cur.guideline || "";
    renderRuleParam(cur);
    const condSel = $("#rf-cond");
    if (condSel) condSel.addEventListener("change", function () { renderRuleParam(readParamValues()); });
  }

  // 선택한 점검 방식에 맞는 입력칸만 보여준다.
  function renderRuleParam(cur) {
    const wrap = $("#rf-param-wrap");
    const hint = $("#rf-hint");
    if (!wrap) return;
    const type = $("#rf-cond") ? $("#rf-cond").value : cur.type;
    const meta = condMeta(type);
    if (hint) hint.textContent = meta.hint || "";
    if (meta.needs.length === 0) {
      wrap.style.display = "none";
      wrap.innerHTML = "";
      return;
    }
    wrap.style.display = "";
    const need = meta.needs[0];
    let label = "기준 값";
    let ph = "";
    let val = "";
    if (need === "min") { label = "최소값"; ph = "예: 5"; val = cur.min != null ? cur.min : ""; }
    else if (need === "max") { label = "최대값"; ph = "예: 200"; val = cur.max != null ? cur.max : ""; }
    else if (need === "words") { label = "표현 (쉼표로 구분)"; ph = "등등, 적당히, 대충"; val = Array.isArray(cur.words) ? cur.words.join(", ") : (cur.words || ""); }
    else if (need === "pattern") { label = "형식/패턴 (정규식)"; ph = "^TC-\\d+$"; val = cur.pattern || ""; }
    wrap.innerHTML = '<span class="field-label">' + esc(label) + '</span><input id="rf-param" type="text" class="full" placeholder="' + esc(ph) + '" />';
    if ($("#rf-param")) $("#rf-param").value = val;
  }

  function readParamValues() {
    const type = $("#rf-cond") ? $("#rf-cond").value : "required";
    const p = $("#rf-param") ? $("#rf-param").value : "";
    return { type: type, min: p, max: p, words: p, pattern: p };
  }

  function saveRuleForm() {
    const type = rulesEditorType;
    const field = $("#rf-field").value;
    const cond = $("#rf-cond").value;
    const sev = $("#rf-sev").value;
    const message = $("#rf-msg").value.trim();
    const guideline = $("#rf-guide").value.trim();
    const meta = condMeta(cond);
    const pv = $("#rf-param") ? $("#rf-param").value.trim() : "";

    const rule = ruleFormIdx != null ? Object.assign({}, rulesDraft.rules[ruleFormIdx]) : { id: newRuleId() };
    rule.field = field;
    rule.type = cond;
    rule.severity = sev;
    rule.message = message || defaultMsgFor(type, field, cond);
    rule.guideline = guideline;
    // 이전 파라미터 정리 후 필요한 것만 채움
    delete rule.min; delete rule.max; delete rule.words; delete rule.pattern;
    if (meta.needs[0] === "min") {
      const n = parseInt(pv, 10);
      if (isNaN(n)) return alert("최소값에 숫자를 입력하세요.");
      rule.min = n;
    } else if (meta.needs[0] === "max") {
      const n = parseInt(pv, 10);
      if (isNaN(n)) return alert("최대값에 숫자를 입력하세요.");
      rule.max = n;
    } else if (meta.needs[0] === "words") {
      const words = pv.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (words.length === 0) return alert("피해야 할 표현을 하나 이상 입력하세요.");
      rule.words = words;
    } else if (meta.needs[0] === "pattern") {
      if (!pv) return alert("형식/패턴을 입력하세요.");
      try { new RegExp(pv); } catch (e) { return alert("정규식 형식이 올바르지 않습니다: " + e.message); }
      rule.pattern = pv;
    }

    if (ruleFormIdx != null) rulesDraft.rules[ruleFormIdx] = rule;
    else rulesDraft.rules.push(rule);
    ruleFormIdx = null;
    renderRulesEditor();
  }

  function defaultMsgFor(type, field, cond) {
    const fl = ruleFieldLabel(type, field);
    switch (cond) {
      case "required": return fl + "은(는) 필수입니다";
      case "minItems": return fl + " 항목 수가 부족합니다";
      case "minLength": return fl + "이(가) 너무 짧습니다";
      case "maxLength": return fl + "이(가) 너무 깁니다";
      case "forbiddenWords": return fl + "에 피해야 할 표현이 있습니다";
      case "regex": return fl + " 형식을 확인하세요";
      case "pattern": return fl + "에 점검 대상 패턴이 있습니다";
      default: return fl + " 점검";
    }
  }

  function deleteDraftRule(idx) {
    if (idx < 0 || idx >= rulesDraft.rules.length) return;
    rulesDraft.rules.splice(idx, 1);
    renderRulesEditor();
  }

  function syncDraftName() {
    const nameEl = $("#rules-name");
    if (nameEl && rulesDraft) rulesDraft.name = nameEl.value.trim();
  }

  function toggleRulesJson() {
    syncDraftName();
    rulesJsonMode = !rulesJsonMode;
    renderRulesEditor();
  }

  function applyRulesJson() {
    const jsonEl = $("#rules-json");
    const msg = $("#rules-msg");
    try {
      const parsed = JSON.parse(jsonEl.value);
      if (!Array.isArray(parsed)) throw new Error("JSON 배열이어야 합니다.");
      const validTypes = Object.keys(QADOC.review.handlers);
      parsed.forEach(function (r, i) {
        if (!r || typeof r !== "object") throw new Error(i + "번째 항목이 객체가 아닙니다.");
        if (!r.id) r.id = newRuleId();
        if (!r.field || typeof r.field !== "string") throw new Error("‘" + r.id + "’에 field 가 필요합니다.");
        if (validTypes.indexOf(r.type) < 0) throw new Error("‘" + r.id + "’의 점검 방식 ‘" + r.type + "’은 지원되지 않습니다.");
      });
      rulesDraft.rules = parsed;
      rulesJsonMode = false;
      renderRulesEditor();
    } catch (e) {
      if (msg) { msg.textContent = (e.message || e); msg.className = "rules-msg small err"; }
    }
  }

  function commitRulesDraft() {
    syncDraftName();
    const type = rulesEditorType;
    if (!rulesDraft.rules.length && !confirm("기준이 0개입니다. 그래도 저장할까요?")) return;
    const saved = QADOC.rules.saveNewVersion(type, rulesDraft.name || (type === "testcase" ? "TC 기준" : "기획서 기준"), rulesDraft.rules);
    flash("기준 저장됨 — " + (type === "testcase" ? "TC" : "기획서") + " v" + saved.version + " 활성화");
    loadRulesDraft(type, saved.version);
  }

  function activateRulesVersion(type, version) {
    QADOC.rules.setActive(type, version);
    flash("v" + version + " 활성화됨");
    loadRulesDraft(type, version);
  }

  function resetRulesForm(type) {
    if (!confirm("시스템 기본 기준을 새 버전으로 복원하고 활성화할까요?")) return;
    const a = QADOC.rules.resetToDefault(type);
    if (a) {
      flash("기본값으로 복원됨 (v" + a.version + ")");
      loadRulesDraft(type, a.version);
    }
  }

  // ---------- 라이브러리 (기본 틀 · 예시 · 누적 기준 보기) ----------
  async function openLibrary() {
    const presets = QADOC.DATA.presets || [];
    const examples = QADOC.DATA.examples || [];

    function presetRows(t) {
      return presets
        .filter((p) => p.type === t)
        .map(function (p) {
          return (
            '<li class="lib-item">' +
            '<div><strong>' + esc(p.name) + "</strong>" +
            '<div class="muted small">' + p.fields.length + "개 항목 · 기본 틀</div></div>" +
            '<button class="btn btn-sm" data-action="view-preset" data-id="' + esc(p.id) + '">' + QADOC.icon("eye") + " 보기</button>" +
            "</li>"
          );
        })
        .join("");
    }

    function exampleRows(t) {
      return examples
        .filter((e) => e.type === t)
        .map(function (e) {
          return (
            '<li class="lib-item">' +
            '<div><strong>' + esc(e.title) + "</strong>" +
            '<div class="muted small">' + esc(e.note || "") + "</div></div>" +
            '<button class="btn btn-sm" data-action="example-open" data-id="' + esc(e.id) + '">' + QADOC.icon("arrow-right") + " 열기</button>" +
            "</li>"
          );
        })
        .join("");
    }

    function rulesRows(t) {
      return QADOC.rules
        .versions(t)
        .map(function (v) {
          const ver = Number(v.version);
          const tag = v.active ? '<span class="ver-cur">활성</span>' : "";
          const created = v.createdAt ? new Date(v.createdAt).toLocaleDateString("ko-KR") : "";
          return (
            '<li class="lib-item">' +
            '<div><strong>v' + ver + "</strong> " + tag +
            ' <span class="vn-late" data-vt="' + t + '" data-vn="' + ver + '"></span>' +
            '<div class="muted small">' + (v.rules ? v.rules.length : 0) + "개 기준 · " + esc(created) + "</div></div>" +
            (v.active ? "" : '<button class="btn btn-sm" data-action="rules-activate" data-type="' + t + '" data-ver="' + ver + '">활성화</button>') +
            "</li>"
          );
        })
        .join("");
    }

    const body =
      '<p class="muted small">기본 틀과 예시, 그리고 팀이 쌓아온 검토 기준의 이력을 한곳에서 봅니다.</p>' +
      '<div class="lib-section"><h3 class="lib-h">' + QADOC.icon("layers") + " 기본 틀 (프리셋)</h3>" +
      '<div class="lib-col-2"><div><div class="lib-sub">테스트케이스</div><ul class="lib-list">' + presetRows("testcase") + "</ul></div>" +
      '<div><div class="lib-sub">기획서</div><ul class="lib-list">' + presetRows("spec") + "</ul></div></div></div>" +
      '<div class="lib-section"><h3 class="lib-h">' + QADOC.icon("book-open") + " 예시 문서</h3>" +
      '<ul class="lib-list">' + exampleRows("testcase") + exampleRows("spec") + "</ul></div>" +
      '<div class="lib-section"><h3 class="lib-h">' + QADOC.icon("history") + " 누적된 검토 기준 (레거시)</h3>" +
      '<div class="lib-col-2"><div><div class="lib-sub">테스트케이스 기준</div><ul class="lib-list">' + rulesRows("testcase") + "</ul></div>" +
      '<div><div class="lib-sub">기획서 기준</div><ul class="lib-list">' + rulesRows("spec") + "</ul></div></div></div>";

    openModal("라이브러리", body);

    // 버전 이름(사용자 입력)은 textContent 로 주입
    ["testcase", "spec"].forEach(function (t) {
      QADOC.rules.versions(t).forEach(function (v) {
        const el = document.querySelector('.vn-late[data-vt="' + t + '"][data-vn="' + v.version + '"]');
        if (el) el.textContent = v.name || "";
      });
    });
  }

  function viewPreset(id) {
    const p = presetById(id);
    if (!p) return;
    const rows = p.fields
      .map(function (f) {
        const req = f.required ? '<span class="req">필수</span>' : '<span class="muted small">선택</span>';
        const typeKo = { text: "한 줄", textarea: "여러 줄", list: "목록", select: "선택" }[f.type] || f.type;
        return (
          '<li class="lib-item"><div><strong>' + esc(f.label) + "</strong> " + req +
          '<div class="muted small">key: ' + esc(f.key) + " · " + typeKo + (f.placeholder ? " · 예: " + esc(f.placeholder) : "") + "</div></div></li>"
        );
      })
      .join("");
    openModal(p.name + " — 항목 구성", '<ul class="lib-list">' + rows + "</ul>");
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
      '<button class="modal-x" data-action="modal-close" aria-label="닫기">' + QADOC.icon("x") + "</button></div>" +
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
