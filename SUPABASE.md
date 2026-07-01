# Supabase 연동 가이드 (Phase 4b)

QADOC은 기본적으로 **localStorage**로 동작합니다(파일럿 무가입 체험). 실제 저장·인증·다중 사용자가 필요해지면 Supabase로 전환합니다. 저장소는 추상화되어 있어 **교체 지점만 바꾸면** 됩니다.

## 1. 프로젝트 + 스키마

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 실행 → 테이블 + RLS 정책 + 공유 함수 생성
3. Authentication → Providers에서 **Email(매직링크)** 활성화 (파일럿 기본). 필요 시 Google OAuth 추가
4. (선택) 사내 도메인만 허용하려면 Auth 설정에서 도메인 제한

## 2. 프론트 설정

```bash
cp src/js/config.example.js src/js/config.js
# config.js 에 SUPABASE_URL, SUPABASE_ANON_KEY 입력 (anon 키는 공개 가능)
```

`index.html` `<head>` 또는 스크립트 영역에 추가:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="src/js/config.js"></script>
<!-- 기존 storage.js 뒤에 -->
<script src="src/js/storage-supabase.js"></script>
```

## 3. 앱 전환 (배선 완료)

`app.js`는 이미 **백엔드 무관(async)**으로 리팩터링되어 있습니다. `store()`가 설정 여부에 따라 자동 선택합니다:

```js
function store() { return QADOC.storageSupabase || QADOC.storage; }
```

- **config.js / supabase-js 가 없으면** → `storage-supabase.js`가 스스로 비활성화 → localStorage(`storage.js`) 사용 (무가입 체험 그대로)
- **2단계의 스크립트 3줄을 index.html에 추가하면** → Supabase 사용 + 미로그인 시 **이메일 매직링크 로그인 화면**이 뜨고, 로그인하면 문서가 Supabase에 저장됩니다.

> [주의] 라이브 검증 안내: 이 전환 코드는 실제 Supabase 프로젝트 키로만 끝까지 확인할 수 있습니다. localStorage 경로는 키 없이도 정상 동작하도록 보존되어 있습니다(`await`는 동기 값에도 안전).

## 키 안전성

- **anon 키**: 공개 가능(프론트 노출 OK). 데이터 보호는 **RLS**가 담당 — `schema.sql`의 정책으로 사용자는 본인 데이터만 접근.
- **service_role 키**: 절대 프론트/깃에 두지 마세요. 서버사이드에서만.
- LLM 키(`ANTHROPIC_API_KEY` 등)는 이미 Pages Functions Secret으로만 관리됩니다.

## 보안 체크리스트(현실적 범위)

- [x] RLS 활성화 + 소유자 기반 정책 (`schema.sql`)
- [x] 공유 링크는 토큰+만료 검증하는 SECURITY DEFINER 함수로만 읽기
- [x] 시크릿은 환경변수/Secret, `.dev.vars`/`config.js`는 `.gitignore`
- [x] CI 자동 검사: 시크릿 스캔(gitleaks) + 시크릿 위생 가드 + 의존성 리뷰 (`.github/workflows/security.yml`)
- [ ] SAST(CodeQL) — 파일럿에선 비활성. 정식 단계에서 모달 코드 정리 후 비차단(report-only)으로 재추가 예정
- [x] HTTPS/DDoS는 Cloudflare 앞단
- [ ] (별도 단계) 금융권/공공 컴플라이언스 체크리스트 — 코드만으로 보장 불가, 인증·감리 영역
