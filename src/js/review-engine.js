/*
 * 룰베이스 검토 엔진.
 * 룰셋(데이터)을 해석해 findings 를 만든다. LLM 과 무관하게 항상 동작하며 비용 0.
 * LLM 검토(Phase 2)도 동일한 결과 스키마를 반환하도록 설계 → UI 는 출처를 신경쓰지 않는다.
 *
 * finding 스키마:
 *   { ruleId, severity, field, message, guideline }
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  function asText(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.join("\n");
    return String(value);
  }

  function isEmpty(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.filter((x) => x && String(x).trim()).length === 0;
    return String(value).trim() === "";
  }

  function targetFields(rule, content) {
    return rule.field === "*" ? Object.keys(content) : [rule.field];
  }

  function makeFinding(rule, field, extra) {
    return {
      ruleId: rule.id,
      severity: rule.severity || "warning",
      field: field || rule.field,
      message: rule.message + (extra ? ` ("${extra}")` : ""),
      guideline: rule.guideline || ""
    };
  }

  const handlers = {
    required(rule, content) {
      return isEmpty(content[rule.field]) ? [makeFinding(rule)] : [];
    },

    minItems(rule, content) {
      const v = content[rule.field];
      const count = Array.isArray(v)
        ? v.filter((x) => x && String(x).trim()).length
        : (String(v || "").trim() ? 1 : 0);
      return count < rule.min ? [makeFinding(rule)] : [];
    },

    minLength(rule, content) {
      if (isEmpty(content[rule.field])) return []; // 누락은 required 가 담당
      return asText(content[rule.field]).trim().length < rule.min ? [makeFinding(rule)] : [];
    },

    maxLength(rule, content) {
      return asText(content[rule.field]).length > rule.max ? [makeFinding(rule)] : [];
    },

    regex(rule, content) {
      const t = asText(content[rule.field]).trim();
      if (!t) return []; // 누락은 required 가 담당
      return new RegExp(rule.pattern).test(t) ? [] : [makeFinding(rule)];
    },

    // 금지 패턴이 "발견되면" 위반
    pattern(rule, content) {
      const re = new RegExp(rule.pattern, "m");
      const out = [];
      targetFields(rule, content).forEach((f) => {
        if (re.test(asText(content[f]))) out.push(makeFinding(rule, f));
      });
      return out;
    },

    // 모호/금지 단어가 포함되면 위반
    forbiddenWords(rule, content) {
      const out = [];
      targetFields(rule, content).forEach((f) => {
        const text = asText(content[f]);
        const hit = (rule.words || []).find((w) => text.includes(w));
        if (hit) out.push(makeFinding(rule, f, hit));
      });
      return out;
    }
  };

  /**
   * @param {object} content   작성 내용 { fieldKey: value }
   * @param {object} ruleset   { rules: [...] }
   * @returns {{kind:string, findings: Array}}
   */
  function run(content, ruleset) {
    let findings = [];
    if (ruleset && Array.isArray(ruleset.rules)) {
      ruleset.rules.forEach((rule) => {
        const handler = handlers[rule.type];
        if (handler) {
          try {
            findings = findings.concat(handler(rule, content));
          } catch (e) {
            // 잘못된 룰 정의가 전체 검토를 막지 않도록 방어
            console.warn("룰 처리 오류:", rule.id, e);
          }
        } else {
          console.warn("알 수 없는 룰 타입:", rule.type);
        }
      });
    }
    return { kind: "rule", findings };
  }

  function activeRulesetFor(type) {
    const sets = (QADOC.DATA && QADOC.DATA.rulesets) || [];
    return (
      sets.find((r) => r.type === type && r.active) ||
      sets.find((r) => r.type === type) ||
      { rules: [] }
    );
  }

  QADOC.review = { run, handlers, activeRulesetFor };
})();
