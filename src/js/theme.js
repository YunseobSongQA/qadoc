/*
 * 라이트/다크 테마 토글 — 모든 페이지 공용.
 * <html data-theme="..."> 를 설정한다.
 * 진입 시에는 항상 라이트 모드로 시작하고, 사용자가 토글을 눌러
 * 직접 선택한 값만 localStorage 에 기억한다(로드만으로는 저장하지 않음).
 * 버튼은 [data-theme-toggle] 속성으로 표시하며, 없으면 토글만 적용된다.
 */
(function () {
  // 저장 키에 버전을 붙였다. 과거 버전은 로드 시 테마를 자동 저장해
  // "dark" 가 브라우저에 눌러붙는 문제가 있었으므로, 키를 갱신해 옛 값을 무시한다.
  var KEY = "qadoc-theme-v2";
  var root = document.documentElement;

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function initial() {
    var saved = localStorage.getItem(KEY);
    // 사용자가 직접 토글해 저장한 값이 있으면 그 값을 따른다.
    if (saved === "dark" || saved === "light") return saved;
    // 저장된 선택이 없으면 OS 설정과 무관하게 항상 라이트 모드로 진입한다.
    return "light";
  }

  // 화면에만 테마를 반영한다(저장하지 않음).
  function setView(theme) {
    root.setAttribute("data-theme", theme);
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = theme === "dark" ? SUN : MOON;
      btns[i].setAttribute("aria-label", theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
      btns[i].setAttribute("title", theme === "dark" ? "라이트 모드" : "다크 모드");
    }
  }

  // 사용자가 직접 선택한 경우에만 저장한다.
  function apply(theme) {
    setView(theme);
    localStorage.setItem(KEY, theme);
  }

  // 깜빡임 방지: data-theme 은 즉시 설정(저장은 하지 않음)
  setView(initial());

  function toggle() {
    apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  document.addEventListener("DOMContentLoaded", function () {
    // 버튼이 준비된 뒤 아이콘까지 반영(진입 단계이므로 저장하지 않음)
    setView(root.getAttribute("data-theme") || initial());
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-theme-toggle]");
      if (t) {
        e.preventDefault();
        toggle();
      }
    });
  });

  window.QADOC = window.QADOC || {};
  window.QADOC.theme = { apply: apply, toggle: toggle };
})();
