# QADOC

기획서와 테스트케이스(TC)를 한 기준으로 작성하고, 둘의 일관성을 점검해 보완 지점을 조언하는 사내 문서 도구입니다.
검토 기준은 팀이 쓰면서 직접 쌓아 회사의 노하우가 됩니다. 가입 없이 브라우저에서 바로 동작합니다.

## 주요 기능

- 일관성 점검 — 기획서의 요구사항이 연결된 TC로 충분히 검증되는지 증적 기반으로 점검하고 보완 지점을 안내합니다.
- 검토 기준 편집 — 기준을 평범한 문장으로 추가·수정하고 버전으로 관리합니다. 코드 배포 없이 즉시 반영됩니다.
- 자동 검토 — 필수항목 누락, 형식 오류, 모호한 표현을 기준에 따라 검사하고 개선 가이드를 제시합니다. 비용 없이 항상 동작합니다.
- LLM 보조 검토 — 문장 명확성·모호성은 무료 LLM이 보조합니다. 막히면 기준 검토 결과만 표시됩니다.
- 기본 틀·예시 — TC·기획서 기본 틀과 채워진 예시를 라이브러리에서 바로 열어 시작할 수 있습니다.
- 내보내기·공유·이력 — TC는 Excel, 기획서는 PPT로 내보내고, 읽기전용 링크 공유와 버전 이력을 지원합니다.

## 설계 원칙

검토 기준과 양식은 코드가 아니라 데이터입니다(`src/data/*.js` 기본값 + 화면에서 버전 저장).
배포 없이 기준을 수정·추가할 수 있고, 기준은 버전으로 이력이 남습니다.

## 로컬 실행

별도 빌드가 필요 없습니다.

```bash
# 정적 서버 — 작성/검토/내보내기/저장/공유/이력 동작 (LLM 검토는 자동 대체)
python3 -m http.server 8080
# 랜딩: http://localhost:8080/   ·   도구: http://localhost:8080/app.html

# LLM 검토까지 포함해서 실행 (Cloudflare Pages Functions + Workers AI)
cp .dev.vars.example .dev.vars
npx wrangler pages dev .
```

LLM 검토는 두 번째 방법에서만 동작하고, 정적 서버에서는 기준 검토 결과만 표시됩니다.
내보내기 라이브러리(SheetJS·PptxGenJS)는 CDN에서 로드하므로 최초 실행 시 인터넷이 필요합니다.

## 배포 (Cloudflare Pages)

1. Cloudflare Pages에 저장소 연결
2. Build command 없음, Build output directory는 저장소 루트(`/`)
3. LLM 검토용: Workers AI 바인딩 `AI` 추가, 환경변수 `LLM_PROVIDER=cloudflare`
4. (Claude 교체 시) `wrangler pages secret put ANTHROPIC_API_KEY` — 키는 Secret으로만 보관

## 프로젝트 구조

```
index.html              랜딩 페이지
app.html                작성·검토 도구
about/privacy/terms/contact.html   정보 페이지
landing.css             랜딩·정보 페이지 스타일
src/css/
  theme.css             라이트/다크 공용 디자인 토큰 + 테마 토글
  styles.css            앱 스타일
src/data/
  presets.js            기본 틀(프리셋)
  rulesets.js           기본 검토 기준
  examples.js           예시 문서
src/js/
  theme.js              라이트/다크 테마 토글
  icons.js              인라인 SVG 아이콘
  storage.js            저장소 추상화 (localStorage)
  review-engine.js      기준 검토 엔진
  consistency.js        기획서-TC 일관성 점검
  rules-store.js        검토 기준 편집·버전 관리
  review-llm.js         LLM 보조 검토 클라이언트
  export-excel.js       Excel 내보내기 (TC)
  export-ppt.js         PPT 내보내기 (기획서)
  share.js              읽기전용 공유 링크
  app.js                상태·렌더링·이벤트
functions/api/review.js LLM 검토 프록시 (서버사이드, 키 보관)
```

## 양식 업로드 형식 (프리셋 JSON)

```json
{
  "id": "tc-mycompany",
  "type": "testcase",
  "name": "우리 회사 TC 양식",
  "fields": [
    { "key": "tc_id", "label": "TC ID", "type": "text", "required": true },
    { "key": "steps", "label": "절차", "type": "list", "required": true },
    { "key": "priority", "label": "우선순위", "type": "select",
      "options": ["High", "Medium", "Low"], "required": true }
  ]
}
```

`type`: `text` / `textarea` / `list`(줄바꿈=항목) / `select`(`options` 필요)

보안·서버 저장소 전환 안내는 [SUPABASE.md](SUPABASE.md)를 참고하세요.
