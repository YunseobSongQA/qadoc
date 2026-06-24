/*
 * 일관성 검토 (증적 기반 조언).
 * 기획서의 요구사항/완료조건이 연결된 테스트케이스로 "검증되고 있는가"를 점검해
 * 비어 있는 부분을 '수정하면 좋을 지점'으로 조언한다. LLM 없이 동작한다.
 *
 * 토큰 겹침(키워드 교집합)으로 커버 여부를 추정한다 — 정밀 일치가 아니라
 * "이 요구사항을 다루는 TC가 있는지"를 보수적으로 안내하는 보조 신호다.
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  const STOP = new Set([
    "그리고", "또는", "하면", "한다", "하는", "있다", "없다", "위해", "해야", "되는", "되어", "표시", "화면",
    "기능", "사용자", "경우", "이내", "값을", "값이", "대해", "관련", "the", "and", "for", "with", "이다"
  ]);

  function tokens(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^0-9a-z가-힣\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !STOP.has(w));
  }

  function asList(value) {
    if (Array.isArray(value)) return value.filter((x) => x && String(x).trim());
    if (value == null || String(value).trim() === "") return [];
    return [String(value)];
  }

  // TC 전체에서 나온 토큰 집합
  function tcTokenSet(tcContent) {
    const fields = ["title", "precondition", "steps", "test_data", "expected", "category_major", "category_minor"];
    const set = new Set();
    fields.forEach((k) => {
      asList(tcContent[k]).forEach((line) => tokens(line).forEach((t) => set.add(t)));
    });
    return set;
  }

  // 한 요구사항이 TC 토큰으로 얼마나 덮이는지 (겹친 토큰 수)
  function coverage(itemTokens, tcSet) {
    let hit = 0;
    itemTokens.forEach((t) => {
      if (tcSet.has(t)) hit++;
    });
    return { hit: hit, total: itemTokens.length };
  }

  /**
   * @param {object} spec   { content }  기획서 문서
   * @param {Array}  tcs     연결된 테스트케이스 문서 배열 [{title, content}]
   * @returns {{findings: Array, summary: object}}
   */
  function checkSpecCoverage(spec, tcs) {
    const findings = [];
    const tcSets = (tcs || []).map((tc) => ({ title: tc.title, set: tcTokenSet(tc.content || {}) }));

    if (tcSets.length === 0) {
      findings.push({
        source: "consistency",
        severity: "warning",
        field: "*",
        message: "이 기획서에 연결된 테스트케이스가 없습니다",
        guideline: "요구사항을 검증할 TC를 연결하면, 어떤 항목이 아직 검증되지 않았는지 알려드립니다."
      });
      return { findings: findings, summary: { covered: 0, total: 0 } };
    }

    const targets = [
      { key: "requirements", label: "상세 요구사항" },
      { key: "acceptance", label: "완료 조건" }
    ];

    let covered = 0;
    let total = 0;

    targets.forEach((t) => {
      asList(spec.content[t.key]).forEach((item) => {
        total++;
        const it = tokens(item);
        if (it.length === 0) return;
        let best = { hit: 0, total: it.length, title: "" };
        tcSets.forEach((tc) => {
          const c = coverage(it, tc.set);
          if (c.hit > best.hit) best = { hit: c.hit, total: c.total, title: tc.title };
        });
        const ratio = best.total ? best.hit / best.total : 0;
        if (ratio >= 0.34) {
          covered++;
        } else {
          findings.push({
            source: "consistency",
            severity: "warning",
            field: t.key,
            message: t.label + " “" + clip(item) + "”을(를) 검증하는 TC가 보이지 않습니다",
            guideline: "이 항목을 다루는 테스트케이스를 추가하거나, 기존 TC의 절차·기대결과에 해당 내용을 반영하세요."
          });
        }
      });
    });

    if (total > 0 && findings.length === 0) {
      findings.push({
        source: "consistency",
        severity: "info",
        field: "*",
        message: "요구사항 " + total + "건이 연결된 TC로 검증되고 있습니다",
        guideline: "연결된 테스트케이스가 기획 항목을 잘 덮고 있습니다."
      });
    }

    return { findings: findings, summary: { covered: covered, total: total } };
  }

  function clip(s, n) {
    s = String(s || "");
    n = n || 24;
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // TC 관점: 이 TC가 연결된 기획서의 요구사항 몇 건과 연결되는가
  function tcVsSpec(spec, tc) {
    const set = tcTokenSet(tc.content || {});
    let matched = 0;
    let total = 0;
    ["requirements", "acceptance"].forEach((k) => {
      asList(spec.content[k]).forEach((item) => {
        total++;
        const it = tokens(item);
        if (it.length === 0) return;
        const c = coverage(it, set);
        if (c.hit / it.length >= 0.34) matched++;
      });
    });
    return { matched: matched, total: total };
  }

  QADOC.consistency = { checkSpecCoverage: checkSpecCoverage, tcVsSpec: tcVsSpec };
})();
