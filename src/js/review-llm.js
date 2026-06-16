/*
 * LLM 검토 클라이언트.
 * /api/review (서버사이드 프록시)만 호출한다. provider/API 키는 프론트가 전혀 모른다.
 * 실패 시 throw → 호출부(app.js)가 룰베이스 결과로 fallback 한다.
 *
 * payload: { type, fields: [{key,label}], content }
 * 반환:    { kind:'llm', provider, findings: [{severity,field,message,guideline}] }
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});

  QADOC.reviewLLM = async function (payload) {
    let res;
    try {
      res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (networkErr) {
      const e = new Error("network");
      e.reason = "네트워크 오류";
      throw e;
    }

    if (!res.ok) {
      let info = {};
      try {
        info = await res.json();
      } catch (e) {
        /* ignore */
      }
      const e = new Error(info.error || "http_" + res.status);
      e.status = res.status;
      // 사람이 읽을 사유
      e.reason =
        res.status === 404
          ? "서버(Pages Functions) 미연결 — 정적 미리보기에서는 LLM 검토를 쓸 수 없습니다"
          : info.error === "rate_limited"
          ? "요청이 많습니다. 잠시 후 다시 시도하세요"
          : info.error === "llm_unavailable"
          ? "LLM 사용 불가(쿼터 초과 또는 미설정)"
          : "LLM 검토 실패 (" + (info.error || res.status) + ")";
      throw e;
    }
    return res.json();
  };
})();
