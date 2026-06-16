-- QADOC — Supabase 스키마 + RLS 정책 (Phase 4)
-- Supabase SQL Editor에 붙여넣어 실행하세요. 인증은 Supabase Auth(auth.users) 사용.
-- 설계: 문서/버전/검토는 소유자만 접근. 프리셋·룰셋은 시스템 공용 + 개인. 공유는 토큰 읽기 전용.

-- ───────────── 프리셋(템플릿) ─────────────
create table if not exists public.presets (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('testcase','spec')),
  name        text not null,
  schema      jsonb not null,                 -- 필드 정의 배열 (presets.js 의 fields 와 동일 형태)
  is_system   boolean not null default false,
  owner_id    uuid references auth.users on delete cascade,
  created_at  timestamptz not null default now()
);

-- ───────────── 검토 기준(룰셋) ─────────────
create table if not exists public.rulesets (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('testcase','spec')),
  name        text not null,
  version     int not null default 1,
  is_active   boolean not null default true,
  rules       jsonb not null,                 -- 룰 정의 배열 (rulesets.js 와 동일 형태)
  is_system   boolean not null default false,
  owner_id    uuid references auth.users on delete cascade,
  updated_by  uuid references auth.users,
  updated_at  timestamptz not null default now()
);

-- ───────────── 문서 ─────────────
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users on delete cascade default auth.uid(),
  preset_id       uuid references public.presets,
  type            text not null check (type in ('testcase','spec')),
  title           text not null,
  status          text not null default 'draft' check (status in ('draft','reviewed','done')),
  current_version int not null default 1,
  content         jsonb not null default '{}'::jsonb,  -- 최신 작성 내용
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ───────────── 버전 이력 ─────────────
create table if not exists public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents on delete cascade,
  version      int not null,
  content      jsonb not null,
  created_by   uuid references auth.users default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ───────────── 검토 결과(룰/LLM 공통 스키마) ─────────────
create table if not exists public.reviews (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents on delete cascade,
  document_version    int,
  kind                text not null check (kind in ('rule','llm')),
  provider            text,                    -- llm일 때 cloudflare/anthropic
  findings            jsonb not null,          -- [{severity,field,message,guideline}]
  created_at          timestamptz not null default now()
);

-- ───────────── 공유 링크(읽기 전용 토큰) ─────────────
create table if not exists public.shares (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents on delete cascade,
  token        text not null unique,
  expires_at   timestamptz,
  created_by   uuid references auth.users default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists documents_owner_idx on public.documents(owner_id);
create index if not exists versions_doc_idx on public.document_versions(document_id);
create index if not exists reviews_doc_idx on public.reviews(document_id);

-- ════════════ Row Level Security ════════════
alter table public.presets            enable row level security;
alter table public.rulesets           enable row level security;
alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;
alter table public.reviews            enable row level security;
alter table public.shares             enable row level security;

-- 프리셋: 시스템 공용 또는 본인 것 읽기 / 본인 것만 쓰기
create policy presets_read on public.presets
  for select using (is_system or owner_id = auth.uid());
create policy presets_write on public.presets
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 룰셋: 동일 패턴
create policy rulesets_read on public.rulesets
  for select using (is_system or owner_id = auth.uid());
create policy rulesets_write on public.rulesets
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 문서: 소유자 전용
create policy documents_owner on public.documents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- 버전/검토: 부모 문서의 소유자만
create policy versions_owner on public.document_versions
  for all using (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  );

create policy reviews_owner on public.reviews
  for all using (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  );

-- 공유: 소유자만 생성/삭제. 토큰 기반 읽기는 SECURITY DEFINER 함수로 분리(아래).
create policy shares_owner on public.shares
  for all using (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.documents d
            where d.id = document_id and d.owner_id = auth.uid())
  );

-- 공유 링크로 문서를 읽는 안전한 경로 (RLS 우회는 이 함수 안에서만, 토큰/만료 검증)
create or replace function public.get_shared_document(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(d) from public.documents d
  join public.shares s on s.document_id = d.id
  where s.token = p_token
    and (s.expires_at is null or s.expires_at > now())
  limit 1;
$$;

revoke all on function public.get_shared_document(text) from public;
grant execute on function public.get_shared_document(text) to anon, authenticated;
