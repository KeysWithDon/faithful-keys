-- Password-code protected administration without email accounts. The browser
-- receives only a short-lived opaque session token; its hash is stored here.
create table if not exists public.faithful_admin_access (
  id boolean primary key default true check (id),
  code_hash text not null,
  rotated_at timestamptz not null default now()
);

create table if not exists public.faithful_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists faithful_admin_sessions_expiry_idx
  on public.faithful_admin_sessions (expires_at);

-- These are the only user-created Gospel Standards visible to learners. The
-- full source media stays private in song_charts and is removed by the worker.
create table if not exists public.published_gospel_standards (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 180),
  composer text not null default '',
  style text not null default 'Admin chart study',
  chart jsonb not null check (jsonb_typeof(chart) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists published_gospel_standards_updated_idx
  on public.published_gospel_standards (updated_at desc);

alter table public.faithful_admin_access enable row level security;
alter table public.faithful_admin_sessions enable row level security;
alter table public.published_gospel_standards enable row level security;

revoke all on public.faithful_admin_access from anon, authenticated;
revoke all on public.faithful_admin_sessions from anon, authenticated;
revoke all on public.published_gospel_standards from anon, authenticated;
grant select on public.published_gospel_standards to anon, authenticated;

drop policy if exists "published gospel standards are readable" on public.published_gospel_standards;
create policy "published gospel standards are readable"
  on public.published_gospel_standards for select
  to anon, authenticated using (true);

-- A random setup code is inserted directly during project provisioning. It is
-- SHA-256 hashed and never committed to source control.
