/*
 * 기본 프리셋(템플릿) 정의 — 시스템 제공.
 * 코드가 아니라 "데이터"다. 새 양식은 여기 추가하거나, UI의 "양식 가져오기"로 업로드하면 된다.
 *
 * field.type: text | textarea | list | select
 *   - list   : 줄바꿈마다 한 항목 (배열로 저장)
 *   - select : options 배열 필요
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});
  QADOC.DATA = QADOC.DATA || {};

  QADOC.DATA.presets = [
    {
      id: "tc-default",
      type: "testcase",
      name: "기본 테스트케이스",
      fields: [
        { key: "tc_id", label: "TC ID", type: "text", required: true, placeholder: "TC-001" },
        { key: "category_major", label: "대분류", type: "text", required: true, placeholder: "예: 로그인" },
        { key: "category_minor", label: "중분류", type: "text", required: false, placeholder: "예: 소셜 로그인" },
        { key: "title", label: "제목", type: "text", required: true, placeholder: "검증하려는 항목" },
        { key: "precondition", label: "사전조건", type: "textarea", required: true, placeholder: "테스트 시작 전 충족되어야 하는 상태" },
        { key: "steps", label: "테스트 절차", type: "list", required: true, placeholder: "한 줄에 한 단계씩 작성" },
        { key: "test_data", label: "입력 데이터", type: "textarea", required: false },
        { key: "expected", label: "기대 결과", type: "textarea", required: true, placeholder: "측정 가능하고 명확하게" },
        { key: "priority", label: "우선순위", type: "select", required: true, options: ["High", "Medium", "Low"] },
        { key: "result", label: "결과", type: "select", required: false, options: ["N/A", "Pass", "Fail", "Block"] }
      ]
    },
    {
      id: "spec-default",
      type: "spec",
      name: "기본 기획서",
      fields: [
        { key: "title", label: "기능명", type: "text", required: true },
        { key: "purpose", label: "목적 / 배경", type: "textarea", required: true },
        { key: "scope", label: "범위", type: "textarea", required: true, placeholder: "포함 / 미포함 범위" },
        { key: "user_story", label: "사용자 스토리", type: "textarea", required: false, placeholder: "~로서 ~을 원한다. 왜냐하면 ~" },
        { key: "requirements", label: "상세 요구사항", type: "list", required: true, placeholder: "한 줄에 하나씩" },
        { key: "flow", label: "주요 흐름", type: "textarea", required: false },
        { key: "edge_cases", label: "예외 / 엣지 케이스", type: "textarea", required: false },
        { key: "acceptance", label: "완료 조건(Acceptance)", type: "list", required: true, placeholder: "측정 가능한 완료 기준" }
      ]
    }
  ];
})();
