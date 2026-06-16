/*
 * 공유 링크 인코딩/디코딩.
 * 파일럿: 백엔드 없이도 동작하도록 문서 내용을 URL에 담는 "자체 완결형 읽기 전용 링크".
 *   index.html?share=<base64url(JSON)>
 * (서버 기반 토큰 공유는 supabase/schema.sql 의 shares 테이블 + get_shared_document 로 추후 전환 가능)
 *
 * UTF-8(한글) 안전 base64.
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  QADOC.share = {
    encode(obj) {
      const json = JSON.stringify(obj);
      const b64 = btoa(unescape(encodeURIComponent(json)));
      return encodeURIComponent(b64);
    },
    decode(s) {
      try {
        const b64 = decodeURIComponent(s);
        const json = decodeURIComponent(escape(atob(b64)));
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }
  };
})();
