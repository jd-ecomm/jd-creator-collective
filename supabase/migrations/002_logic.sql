-- JD Creator Collective CRM: automatic behaviour (applied as crm_02a_triggers_view)
create or replace function public.tg_new_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_state (submission_id, stage_since) values (new.submission_id, new.submitted_at) on conflict do nothing;
  insert into public.activity (submission_id, actor, action, at) values (new.submission_id, 'Jotform', 'Applied via Jotform', new.submitted_at);
  return new;
end $$;
create trigger trg_new_application after insert on public.applications for each row execute function public.tg_new_application();

create or replace function public.tg_crm_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text := coalesce(nullif(public.current_email(), ''), 'system');
begin
  new.updated_at := now();
  new.updated_by := who;
  if new.status is distinct from old.status then
    new.stage_since := now();
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Moved from ' || old.status || ' to ' || new.status);
  end if;
  if new.favourite is distinct from old.favourite then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, case when new.favourite then 'Added to favourites' else 'Removed from favourites' end);
  end if;
  if new.owner is distinct from old.owner then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Owner set to ' || new.owner);
  end if;
  if new.creator_type is distinct from old.creator_type then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Creator type set to ' || new.creator_type);
  end if;
  if new.remuneration is distinct from old.remuneration then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Remuneration set to ' || new.remuneration);
  end if;
  if new.tier is distinct from old.tier then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Deliverable tier set to ' || new.tier);
  end if;
  if new.tags is distinct from old.tags then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Tags: ' || coalesce(nullif(array_to_string(new.tags, ', '), ''), 'none'));
  end if;
  if new.rights_start is distinct from old.rights_start then
    insert into activity (submission_id, actor, action) values (new.submission_id, who, 'Usage rights start set to ' || coalesce(new.rights_start::text, 'none'));
  end if;
  return new;
end $$;
create trigger trg_crm_change before update on public.crm_state for each row execute function public.tg_crm_change();

create or replace function public.tg_note_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity (submission_id, actor, action) values (new.submission_id, new.author, 'Added a note');
  return new;
end $$;
create trigger trg_note_added after insert on public.notes for each row execute function public.tg_note_added();

create or replace function public.tg_score_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewer := public.current_email();
  new.updated_at := now();
  return new;
end $$;
create trigger trg_score_owner before insert or update on public.scores for each row execute function public.tg_score_owner();

create or replace function public.team_members() returns table (email text)
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email)::text from auth.users u
  where public.is_team() and split_part(lower(u.email), '@', 2) in (select domain from public.allowed_domains)
  order by 1
$$;
-- app_applications view and shared_board(): see 003 and 004 for the current definitions
