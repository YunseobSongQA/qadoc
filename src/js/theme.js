/*
 * 라이트/다크 테마 토글 — 모든 페이지 공용.
 * <html data-theme="..."> 를 설정하고 localStorage 에 기억한다.
 * 버튼은 [data-theme-toggle] 속성으로 표시하며, 없으면 토글만 적용된다.
 */
(function () {
  var KEY = "qadoc-theme";
  var root = document.documentElement;

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function initial() {
    var saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    return "light";
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = theme === "dark" ? SUN : MOON;
      btns[i].setAttribute("aria-label", theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
      btns[i].setAttribute("title", theme === "dark" ? "라이트 모드" : "다크 모드");
    }
  }

  // 깜빡임 방지: data-theme 은 즉시 설정
  apply(initial());

  function toggle() {
    apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.getAttribute("data-theme") || initial());
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-theme-toggle]");
      if (t) {
        e.preventDefault();
        toggle();
      }
    });
  });

  // 시스템 설정 변경 추종 (사용자가 수동 지정하지 않았을 때만)
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      if (!localStorage.getItem(KEY)) apply(e.matches ? "dark" : "light");
    });
  }

  window.QADOC = window.QADOC || {};
  window.QADOC.theme = { apply: apply, toggle: toggle };
})();
