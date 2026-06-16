/*
 * 검토 기준(룰셋) — 시스템 제공 기본값.
 * 핵심: 기준은 "코드"가 아니라 "데이터"다. 코드 배포 없이 여기서 추가/수정하면 즉시 반영된다.
 * version / active 로 기준 자체의 이력도 관리한다(추후 관리자 UI로 편집 예정).
 *
 * rule.type 핸들러는 review-engine.js 가 해석한다:
 *   required     : 값이 비어있으면 위반
 *   minItems     : list 항목 수 < min 이면 위반
 *   minLength    : 텍스트 길이 < min 이면 위반
 *   regex        : 패턴과 일치하지 않으면 위반 (형식 검사)
 *   pattern      : 금지 패턴이 발견되면 위반 (field "*" = 모든 필드)
 *   forbiddenWords : 모호/금지 단어가 포함되면 위반
 *   maxLength    : 길이 > max 이면 위반
 *
 * severity: error | warning | info
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});
  QADOC.DATA = QADOC.DATA || {};

  const commonFormatRules = [
    { id: "no-double-space", type: "pattern", field: "*", pattern: "  +", severity: "warning",
      message: "이중 공백이 있습니다", guideline: "불필요한 연속 공백을 하나로 정리하세요." },
    { id: "no-trailing-space", type: "pattern", field: "*", pattern: "[ \\t]+$", severity: "info",
      message: "줄 끝 공백이 있습니다", guideline: "줄 끝 공백을 제거하세요." }
  ];

  QADOC.DATA.rulesets = [
    {
      id: "tc-default-rules",
      type: "testcase",
      name: "기본 TC 검토 기준",
      version: 1,
      active: true,
      rules: [
        { id: "req-tc_id", type: "required", field: "tc_id", severity: "error",
          message: "TC ID는 필수입니다", guideline: "TC-001 형식의 고유 식별자를 입력하세요." },
        { id: "fmt-tc_id", type: "regex", field: "tc_id", pattern: "^TC-\\d+$", severity: "warning",
          message: "TC ID 형식 권장: TC-숫자", guideline: "예) TC-001, TC-105" },
        { id: "req-category", type: "required", field: "category_major", severity: "error",
          message: "대분류는 필수입니다", guideline: "기능 영역을 명시하세요." },
        { id: "req-title", type: "required", field: "title", severity: "error",
          message: "제목은 필수입니다", guideline: "무엇을 검증하는지 한 줄로." },
        { id: "req-pre", type: "required", field: "precondition", severity: "error",
          message: "사전조건은 필수입니다", guideline: "테스트 시작 전 상태를 명시하세요." },
        { id: "req-steps", type: "minItems", field: "steps", min: 1, severity: "error",
          message: "테스트 절차는 최소 1단계 이상이어야 합니다", guideline: "재현 가능한 단계로 작성하세요." },
        { id: "req-expected", type: "required", field: "expected", severity: "error",
          message: "기대 결과는 필수입니다", guideline: "측정 가능하고 명확하게." },
        { id: "len-expected", type: "minLength", field: "expected", min: 5, severity: "warning",
          message: "기대 결과가 너무 짧습니다", guideline: "검증 가능한 수준으로 구체화하세요." },
        { id: "req-priority", type: "required", field: "priority", severity: "warning",
          message: "우선순위를 지정하세요", guideline: "High / Medium / Low" },
        { id: "vague-expected", type: "forbiddenWords", field: "expected",
          words: ["등등", "적당히", "알아서", "대충", "잘 되는지", "정상적으로"], severity: "warning",
          message: "기대 결과에 모호한 표현이 있습니다", guideline: "무엇이 '정상'인지 구체적 기준으로 바꾸세요." },
        ...commonFormatRules
      ]
    },
    {
      id: "spec-default-rules",
      type: "spec",
      name: "기본 기획서 검토 기준",
      version: 1,
      active: true,
      rules: [
        { id: "req-title", type: "required", field: "title", severity: "error",
          message: "기능명은 필수입니다", guideline: "기능을 식별할 수 있는 이름." },
        { id: "req-purpose", type: "required", field: "purpose", severity: "error",
          message: "목적/배경은 필수입니다", guideline: "왜 만드는지 명시하세요." },
        { id: "req-scope", type: "required", field: "scope", severity: "error",
          message: "범위는 필수입니다", guideline: "포함/미포함 범위를 분명히." },
        { id: "req-requirements", type: "minItems", field: "requirements", min: 1, severity: "error",
          message: "상세 요구사항은 최소 1개 이상이어야 합니다", guideline: "검증 가능한 단위로 나누세요." },
        { id: "req-acceptance", type: "minItems", field: "acceptance", min: 1, severity: "error",
          message: "완료 조건은 최소 1개 이상이어야 합니다", guideline: "측정 가능한 완료 기준을 적으세요." },
        { id: "vague-purpose", type: "forbiddenWords", field: "purpose",
          words: ["등등", "적당히", "알아서", "대충"], severity: "warning",
          message: "목적에 모호한 표현이 있습니다", guideline: "구체적으로 서술하세요." },
        ...commonFormatRules
      ]
    }
  ];
})();
