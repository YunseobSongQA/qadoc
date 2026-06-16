/*
 * Pages Function: POST /api/review  — LLM 검토 프록시 (서버사이드)
 *
 * 설계 원칙
 *  - provider 교체 가능: 환경변수 LLM_PROVIDER=cloudflare | anthropic
 *    검토 로직은 provider에 종속되지 않게 runProvider() 뒤로 추상화.
 *  - API 키는 절대 프론트에 노출 금지 → 키는 이 Function의 환경변수/Secret에만 존재.
 *  - LLM이 막혀도(쿼터 초과·키 없음 등) 503을 반환 → 클라이언트가 룰베이스 결과로 fallback.
 *  - 결과 스키마는 룰 엔진과 동일: { findings: [{severity, field, message, guideline}] }
 */

const MAX_BODY = 24000; // 요청 본문 상한 (chars)
const MAX_FINDINGS = 20;
const SEVERITIES = ["error", "warning", "info"];

const MODELS = {
  // 무료 티어 오픈소스 모델 (카드 불필요) — 현재 사용 중인 provider
  cloudflare: "@cf/meta/llama-3.1-8b-instruct"
};

// ---- best-effort rate limit (per-isolate, 프로덕션은 KV/Durable Objects 또는 Cloudflare Rate Limiting 권장) ----
const HITS = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000;
const LIMIT = 10;
function allow(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) return false;
  arr.push(now);
  HITS.set(ip, arr);
  return true;
}

function securityHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = securityHeaders();

  // 1) 입력 검증
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 413, headers);
    payload = JSON.parse(raw);
  } catch (e) {
    return json({ error: "invalid_json" }, 400, headers);
  }
  if (!payload || typeof payload !== "object" || !payload.content || typeof payload.content !== "object") {
    return json({ error: "missing_content" }, 400, headers);
  }

  // 2) rate limit
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  if (!allow(ip)) return json({ error: "rate_limited" }, 429, headers);

  // 3) provider 분기 (프론트는 provider를 모른다)
  const provider = (env.LLM_PROVIDER || "cloudflare").toLowerCase();
  try {
    const findings = await runProvider(provider, payload, env);
    return json({ kind: "llm", provider, findings }, 200, headers);
  } catch (err) {
    // LLM 실패 → 클라이언트가 룰 결과로 fallback 하도록 503
    return json({ error: "llm_unavailable", detail: String((err && err.message) || err) }, 503, headers);
  }
}

// CORS preflight (동일 출처면 불필요하지만 안전하게)
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: securityHeaders() });
}

// ---------- provider 추상화 ----------
async function runProvider(provider, payload, env) {
  const { system, user } = buildPrompt(payload);
  const validKeys = (payload.fields || []).map((f) => f.key).concat(["*"]);

  if (provider === "anthropic") {
    return await callAnthropic(system, user, env, validKeys);
  }
  return await callCloudflare(system, user, env, validKeys);
}

async function callCloudflare(system, user, env, validKeys) {
  if (!env.AI || typeof env.AI.run !== "function") {
    throw new Error("AI binding not configured");
  }
  const out = await env.AI.run(MODELS.cloudflare, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: 1024
  });
  return parseFindings(out && out.response, validKeys);
}

// ───────────────────────────────────────────────────────────────────────────
// Anthropic Claude provider — 확장 지점 (지금은 미구현, 나중에 교체용)
//
// 지금은 무료 Cloudflare Workers AI만 쓴다. 품질이 아쉬울 때 이 함수만 채우면
// LLM_PROVIDER=anthropic 으로 교체된다. 프론트/검토 로직은 손댈 필요 없음.
//
// 구현 레시피 (claude-api 참고자료 기준, 2026-06):
//   - 모델: "claude-haiku-4-5"  (200K 컨텍스트, $1/1M 입력 · $5/1M 출력 — 가장 저렴한 Claude 티어)
//   - 엔드포인트: POST https://api.anthropic.com/v1/messages
//   - 헤더: x-api-key: env.ANTHROPIC_API_KEY, anthropic-version: 2023-06-01, content-type: application/json
//   - 바디: { model, max_tokens: 1024, system, messages: [{ role:"user", content: user }] }
//   - 응답 텍스트: data.content.filter(b=>b.type==="text").map(b=>b.text).join("")
//   - 그 텍스트를 아래 parseFindings(text, validKeys) 로 넘기면 동일 스키마로 반환됨.
//   - 키는 반드시 Secret 으로:  wrangler pages secret put ANTHROPIC_API_KEY  (프론트/깃 노출 금지)
//
// 활성화 시 위 MODELS 에 anthropic 항목을 추가하고 아래 throw 를 실제 fetch 로 교체.
// ───────────────────────────────────────────────────────────────────────────
async function callAnthropic(system, user, env, validKeys) {
  throw new Error("anthropic provider not implemented yet (free Cloudflare provider in use)");
}

// ---------- 프롬프트 ----------
function buildPrompt(payload) {
  const typeName = payload.type === "testcase" ? "테스트케이스(TC)" : "기획서";
  const fields = payload.fields || [];

  const doc = fields
    .map((f) => {
      const v = payload.content[f.key];
      const val = Array.isArray(v) ? v.join(" / ") : v == null ? "" : String(v);
      return `- [${f.key}] ${f.label}: ${val}`;
    })
    .join("\n");

  const system =
    "당신은 QA 문서 검토 전문가입니다. " +
    `주어진 ${typeName} 작성 내용에서 "문장의 명확성·모호성·일관성" 위주로 검토하세요. ` +
    "필수항목 누락이나 형식 같은 기계적 검사는 이미 룰베이스 검토에서 처리되니, 그 외의 보조적 개선점만 지적합니다. " +
    '반드시 JSON 배열만 출력하세요. 각 항목은 {"severity","field","message","guideline"} 형식입니다. ' +
    'severity는 "error"|"warning"|"info" 중 하나, field는 위 [key] 중 하나(전체면 "*"), ' +
    "message는 문제점, guideline은 개선 가이드(한국어). 지적할 게 없으면 빈 배열 [] 을 출력하세요. " +
    "JSON 외의 어떤 설명도 출력하지 마세요.";

  const user = `다음 ${typeName} 내용을 검토하세요:\n\n${doc}\n\nJSON 배열로만 답하세요.`;
  return { system, user };
}

// ---------- 모델 출력 파싱 (방어적) ----------
function parseFindings(text, validKeys) {
  if (!text || typeof text !== "string") return [];
  // JSON 배열 구간만 추출
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) return [];
  let arr;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const keySet = new Set(validKeys);
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const severity = SEVERITIES.includes(item.severity) ? item.severity : "info";
    let field = typeof item.field === "string" && keySet.has(item.field) ? item.field : "*";
    const message = typeof item.message === "string" ? item.message.slice(0, 300) : "";
    const guideline = typeof item.guideline === "string" ? item.guideline.slice(0, 300) : "";
    if (!message) continue;
    out.push({ severity, field, message, guideline });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}
