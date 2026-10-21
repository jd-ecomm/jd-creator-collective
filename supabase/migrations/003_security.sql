-- JD Creator Collective CRM: soft removes, shared boards, row level security, storage, live updates (applied as crm_03_security)
-- Nothing in the app ever deletes rows: removals flip a flag, and applicant erasure is done by the sync with the server key.
alter table public.board_members add column if not exists active boolean not null default true;
alter table public.boards add column if not exists archived boolean not null default false;
alter table public.deleted_submissions add column if not exists purged_at timestamptz;

create or replace function public.tg_board_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare b text;
begin
  select name into b from boards where id = new.board_id;
  if tg_op = 'INSERT' or (new.active and not old.active) then
    insert into activity (submission_id, actor, action) values (new.submission_id, coalesce(nullif(public.current_email(), ''), new.added_by), 'Added to ' || b);
  elsif (not new.active and old.active) then
    insert into activity (submission_id, actor, action) values (new.submission_id, coalesce(nullif(public.current_email(), ''), 'system'), 'Removed from ' || b);
  end if;
  return new;
end $$;
create trigger trg_board_member after insert or update on public.board_members for each row execute function public.tg_board_member();

-- public data for a shared board link: only safe fields, called by the shared-board edge function
create or replace function public.shared_board(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', b.name, 'description', b.description,
    'creators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.full_name, 'city', a.city, 'province', a.province, 'lat', a.lat, 'lng', a.lng,
        'tiktok_followers', a.tiktok_followers, 'instagram_followers', a.instagram_followers, 'youtube_subscribers', a.youtube_subscribers,
        'content_lanes', a.content_lanes, 'can_do', a.can_do, 'languages', a.languages,
        'headshot_path', a.headshot_path, 'setup_paths', a.setup_paths, 'post_urls', a.post_urls, 'previews', a.previews
      ) order by m.added_at)
      from board_members m join applications a on a.submission_id = m.submission_id
      where m.board_id = b.id and m.active
        and not exists (select 1 from deleted_submissions d where d.submission_id = a.submission_id)), '[]'::jsonb))
  from boards b
  where b.share_token = p_token and b.share_on and not b.archived and (b.share_expires_at is null or b.share_expires_at > now())
$$;

alter table public.allowed_domains     enable row level security;
alter table public.applications        enable row level security;
alter table public.deleted_submissions enable row level security;
alter table public.geocache            enable row level security;
alter table public.sync_runs           enable row level security;
alter table public.crm_state           enable row level security;
alter table public.notes               enable row level security;
alter table public.scores              enable row level security;
alter table public.boards              enable row level security;
alter table public.board_members       enable row level security;
alter table public.activity            enable row level security;

create policy team_read_sync on public.sync_runs for select to authenticated using (public.is_team());
create policy team_request_erase on public.deleted_submissions for insert to authenticated with check (public.is_team() and deleted_by = public.current_email());
create policy team_read_crm on public.crm_state for select to authenticated using (public.is_team());
create policy team_edit_crm on public.crm_state for update to authenticated using (public.is_team()) with check (public.is_team());
create policy team_read_notes on public.notes for select to authenticated using (public.is_team());
create policy team_add_notes on public.notes for insert to authenticated with check (public.is_team() and author = public.current_email());
create policy own_edit_notes on public.notes for update to authenticated using (public.is_team() and author = public.current_email()) with check (author = public.current_email());
create policy team_read_scores on public.scores for select to authenticated using (public.is_team());
create policy team_add_scores on public.scores for insert to authenticated with check (public.is_team());
create policy own_edit_scores on public.scores for update to authenticated using (public.is_team() and reviewer = public.current_email());
create policy team_read_boards on public.boards for select to authenticated using (public.is_team());
create policy team_add_boards on public.boards for insert to authenticated with check (public.is_team());
create policy team_edit_boards on public.boards for update to authenticated using (public.is_team()) with check (public.is_team());
create policy team_read_members on public.board_members for select to authenticated using (public.is_team());
create policy team_add_members on public.board_members for insert to authenticated with check (public.is_team());
create policy team_edit_members on public.board_members for update to authenticated using (public.is_team()) with check (public.is_team());
create policy team_read_activity on public.activity for select to authenticated using (public.is_team());
create policy team_add_activity on public.activity for insert to authenticated with check (public.is_team() and actor = public.current_email());

insert into storage.buckets (id, name, public, file_size_limit) values ('media', 'media', false, 15728640) on conflict (id) do nothing;
create policy team_read_media on storage.objects for select to authenticated using (bucket_id = 'media' and public.is_team());

alter publication supabase_realtime add table public.crm_state, public.notes, public.scores, public.boards, public.board_members, public.activity;
