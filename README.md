# QADOC

TC(테스트케이스)와 기획서를 **공통 기준으로 작성·검토**하게 해주는 사내 웹 서비스.
작성자마다 양식이 달라 생기는 가독성·파악 시간 편차를 줄이는 것이 목표.

> 현재: **Phase 1~3 + Phase 4 일부 — 파일럿**. 가입 없이 브라우저에서 바로 동작합니다.
> LLM 검토(무료)는 서버 함수가 있을 때만 동작하고, 없으면 자동으로 룰 검토 결과만 보여줍니다.

## Phase 1에 포함된 것

- **프리셋 기반 작성** — TC / 기획서 기본 프리셋 제공, 폼으로 작성
- **룰베이스 검토** — "검토" 버튼 → 필수항목 누락·형식·모호 표현 검사 → 미흡 항목 + 개선 가이드 (LLM 없이, 비용 0, 항상 동작)
- **저장 / 이력** — 저장 시 자동 버전 적립 (현재는 브라우저 localStorage)
- **양식(프리셋) 가져오기** — 회사 양식을 JSON으로 업로드하면 작성 폼에 반영

### Phase 3: 내보내기 · 공유 · 버전 이력

- **유형별 내보내기** — 문서 유형에 맞춰 버튼이 자동 전환: **테스트케이스 → Excel(SheetJS)**, **기획서 → PPT(PptxGenJS)**. 모두 클라이언트 사이드.
- **공유 링크** — "공유" 버튼 → 문서 내용을 담은 **자체 완결형 읽기전용 링크**(`?share=…`) 생성·복사. 백엔드 없이 동작하며, 받는 사람은 로그인 없이 읽기 전용으로 봅니다. (서버 기반 토큰 공유는 `supabase/schema.sql`의 shares 테이블로 추후 전환)
- **버전 이력** — "이력" 버튼 → 현재/과거 버전 목록 + 특정 버전 **되돌리기**(불러와 저장하면 새 버전 적립).

### Phase 2: LLM 보조 검토 (무료, provider 교체형)

- **"LLM 검토" 버튼** — 룰 검토 결과를 먼저 보여준 뒤, 무료 LLM이 잡은 문장 명확성·모호성 항목을 덧붙입니다. 각 항목엔 `룰` / `LLM` 출처 태그가 붙습니다.
- **provider 교체 가능** — `functions/api/review.js`가 서버사이드 프록시. 환경변수 `LLM_PROVIDER`로 백엔드만 교체. **API 키는 서버에만**, 프론트는 `/api/review`만 호출.
  - 현재: **Cloudflare Workers AI 무료 티어** (`@cf/meta/llama-3.1-8b-instruct`, 카드 불필요)
  - 추후: **Anthropic Claude Haiku**(`claude-haiku-4-5`) — 지금은 미구현, `callAnthropic` 스텁에 구현 레시피만 주석으로 남겨둠 (채우면 교체됨)
- **항상 fallback** — LLM이 막히거나(쿼터·키 없음) 정적 서버라 함수가 없으면, 룰베이스 검토는 그대로 동작.

### 설계 핵심: 기준을 "데이터"로

검토 기준(룰)과 프리셋은 **코드가 아니라 데이터**(`src/data/*.js`)다.
→ 코드 배포 없이 기준을 수정/추가/업데이트할 수 있고, 룰셋은 `version`/`active`로 이력 관리된다.
이는 "공통 기준을 지속적으로 다듬어 시스템화한다"는 목표와 직결된다.

## 로컬 실행

별도 빌드가 필요 없습니다.

```bash
# 방법 1) 정적 서버 — 작성/룰 검토/내보내기(Excel·PPT)/저장/공유/이력 전부 동작 (LLM 검토는 fallback)
cd qadoc
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속

# 방법 2) LLM 검토까지 포함해서 실행 (Pages Functions + Workers AI)
cp .dev.vars.example .dev.vars       # 최초 1회
npx wrangler pages dev .
# wrangler가 안내하는 주소로 접속 (보통 http://localhost:8788)
```

> `index.html`을 더블클릭해도 동작하지만, 일부 브라우저 보안정책 때문에 정적 서버 실행을 권장합니다.
> 내보내기 라이브러리(SheetJS·PptxGenJS)는 CDN에서 로드하므로 최초 실행 시 인터넷이 필요합니다.
> LLM 검토는 방법 2에서만 동작합니다. 방법 1에서는 버튼을 눌러도 룰 검토 결과만 표시됩니다(정상 fallback).

## 배포 (Cloudflare Pages)

정적 사이트라 설정이 단순합니다.

1. Cloudflare Pages에서 이 저장소 연결
2. **Build command**: 없음 (비워둠)
3. **Build output directory**: `/` (저장소 루트)
4. 브랜치 전략: `main`(프로덕션) / `dev`(스테이징) + PR마다 **프리뷰 배포** 자동 생성
5. **LLM 검토용 설정** (Pages Functions는 `functions/`에서 자동 인식):
   - Workers AI 바인딩 `AI` 추가 (Settings → Functions → AI bindings) — `wrangler.toml`에도 선언됨
   - 환경변수 `LLM_PROVIDER=cloudflare`
   - (추후 Claude 교체 시) `wrangler pages secret put ANTHROPIC_API_KEY` — 키는 Secret으로만, 깃/프론트 노출 금지

## 프로젝트 구조

```
index.html              앱 셸
wrangler.toml           Cloudflare Pages 설정 (AI 바인딩, 환경변수)
.dev.vars.example       로컬 환경변수 예시 (.dev.vars 는 깃 제외)
functions/
  api/review.js         LLM 검토 프록시 (서버사이드, provider 교체형, 키 보관)
src/
  css/styles.css        스타일
  data/
    presets.js          프리셋(템플릿) — 데이터
    rulesets.js         검토 기준(룰셋) — 데이터
  js/
    storage.js          저장소 추상화 (localStorage → 추후 Supabase 교체 지점)
    review-engine.js    룰베이스 검토 엔진 (룰셋 해석기)
    review-llm.js        LLM 검토 클라이언트 (/api/review 호출, 실패 시 fallback)
    export-excel.js     SheetJS Excel 내보내기 (테스트케이스)
    export-ppt.js       PptxGenJS PPT 내보내기 (기획서)
    share.js            공유 링크 인코딩/디코딩 (읽기전용)
    storage-supabase.js Supabase 저장소 어댑터 (설정 시 전환, async)
    app.js              상태/렌더링/이벤트
```

## 양식 업로드 형식 (프리셋 JSON)

```json
{
  "id": "tc-mycompany",
  "type": "testcase",            // "testcase" | "spec"
  "name": "우리 회사 TC 양식",
  "fields": [
    { "key": "tc_id", "label": "TC ID", "type": "text", "required": true },
    { "key": "steps", "label": "절차", "type": "list", "required": true },
    { "key": "priority", "label": "우선순위", "type": "select",
      "options": ["High", "Medium", "Low"], "required": true }
  ]
}
```
`type`: `text` | `textarea` | `list`(줄바꿈=항목) | `select`(`options` 필요)

## 다음 단계 (로드맵)

- **Phase 2** — LLM 검토(provider 추상화 + Cloudflare Workers AI 무료티어, 룰 fallback, rate limit) ✅ 구현. Anthropic Claude Haiku 교체는 확장 지점만 남김(미구현).
- **Phase 3** — ✅ 유형별 내보내기(TC→Excel, 기획서→PPT), 공유 링크(읽기전용), 버전 이력 UI
- **Phase 4** — ✅ CI/CD 보안 자동검사(CodeQL·시크릿·의존성, `.github/workflows/`) + Supabase 스키마·RLS·어댑터(`supabase/schema.sql`, `SUPABASE.md`). localStorage 기본 유지, Supabase는 설정 시 전환(async 전환은 라이브 검증 단계로 분리).
- **Phase 5** — 축적 데이터 기반 통계/리포트로 기준 정립 보조

보안·배포 상세는 [SUPABASE.md](SUPABASE.md) 참고.
