-- JD Creator Collective CRM: tables (applied as crm_01_tables)
-- Two layers: applications (written only by the hourly Jotform sync) and team tables (written by JD staff in the app).
create table if not exists public.allowed_domains (domain text primary key);
insert into public.allowed_domains (domain) values ('jdcanada.ca'), ('jdsports.ca') on conflict do nothing;

create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_domains d where d.domain = split_part(public.current_email(), '@', 2))
$$;

create table if not exists public.applications (
  submission_id text primary key, form_id text not null, submitted_at timestamptz not null, jotform_updated_at timestamptz,
  full_name text, email text, phone text, province text, city text, dob date, identity text,
  languages text[] default '{}', language_other text, speaking_style text, equipment text[] default '{}', editing_software text[] default '{}',
  tiktok_url text, instagram_url text, youtube_url text, tiktok_followers integer, instagram_followers integer, youtube_subscribers integer,
  post_urls text[] default '{}', portfolio_url text, brands text[] default '{}', worked_with_jd text, is_employee text, is_customer text, partnership_ads text,
  can_do text[] default '{}', content_lanes text[] default '{}', niche text, sets_apart text, tell_more text, anything_else text,
  consent boolean, age_confirmed boolean, terms_agreed boolean, lat double precision, lng double precision,
  headshot_path text, setup_paths text[] default '{}', media_sources jsonb default '{}'::jsonb, previews jsonb default '[]'::jsonb,
  previews_built_at timestamptz, answers_hash text, synced_at timestamptz default now()
);
create table if not exists public.deleted_submissions (submission_id text primary key, deleted_by text, deleted_at timestamptz default now());
create table if not exists public.geocache (key text primary key, lat double precision, lng double precision, looked_up_at timestamptz default now());
create table if not exists public.sync_runs (id bigserial primary key, started_at timestamptz default now(), finished_at timestamptz, fetched integer default 0, inserted integer default 0, updated integer default 0, files_copied integer default 0, error text);
create table if not exists public.crm_state (
  submission_id text primary key references public.applications(submission_id) on delete cascade,
  status text not null default 'New' check (status in ('New','Reviewed','Shortlisted','Contacted','Onboarded','Declined')),
  stage_since timestamptz not null default now(), favourite boolean not null default false, owner text not null default 'Unassigned',
  creator_type text not null default 'Not set', remuneration text not null default 'Not set', tier text not null default 'Not set',
  tags text[] not null default '{}', contacted_at timestamptz, rights_start date, updated_at timestamptz default now(), updated_by text
);
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(), submission_id text not null references public.applications(submission_id) on delete cascade,
  author text not null default public.current_email(), body text not null check (length(body) between 1 and 4000), created_at timestamptz not null default now()
);
create table if not exists public.scores (
  submission_id text not null references public.applications(submission_id) on delete cascade, reviewer text not null default public.current_email(),
  cam smallint check (cam between 1 and 5), prod smallint check (prod between 1 and 5), fit smallint check (fit between 1 and 5),
  updated_at timestamptz not null default now(), primary key (submission_id, reviewer)
);
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 120), description text,
  created_by text not null default public.current_email(), created_at timestamptz not null default now(),
  share_on boolean not null default false, share_token text unique default replace(gen_random_uuid()::text, '-', ''), share_expires_at timestamptz
);
create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade, submission_id text not null references public.applications(submission_id) on delete cascade,
  added_by text not null default public.current_email(), added_at timestamptz not null default now(), primary key (board_id, submission_id)
);
create table if not exists public.activity (
  id bigserial primary key, submission_id text references public.applications(submission_id) on delete cascade,
  actor text not null default public.current_email(), action text not null, at timestamptz not null default now()
);
create index if not exists activity_sub_idx on public.activity (submission_id, at desc);
create index if not exists notes_sub_idx on public.notes (submission_id);
create index if not exists board_members_sub_idx on public.board_members (submission_id);
