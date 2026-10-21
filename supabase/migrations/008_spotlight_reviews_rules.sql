-- Spotlight stage, review requests, and richer auto-board rules
alter table public.crm_state drop constraint crm_state_status_check;
alter table public.crm_state add constraint crm_state_status_check check (status in ('New','Spotlight','Reviewed','Shortlisted','Contacted','Onboarded','Declined'));

-- review requests: "please review" aimed at a teammate; cleared automatically when they score the creator
create table if not exists public.review_requests (
  id bigserial primary key,
  submission_id text not null,
  requested_for text not null,
  requested_by text not null default public.current_email(),
  note text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text
);
create index if not exists review_requests_open on public.review_requests (requested_for) where done_at is null;
alter table public.review_requests enable row level security;
create policy team_read_rr on public.review_requests for select to authenticated using (public.is_team());
create policy team_add_rr on public.review_requests for insert to authenticated with check (public.is_team() and requested_by = public.current_email());
create policy team_edit_rr on public.review_requests for update to authenticated using (public.is_team()) with check (public.is_team());
alter publication supabase_realtime add table public.review_requests;

create or replace function public.tg_rr_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activity (submission_id, actor, action) values (new.submission_id, new.requested_by, 'Asked ' || new.requested_for || ' to review' || coalesce(': ' || nullif(new.note, ''), ''));
  elsif new.done_at is not null and old.done_at is null then
    insert into activity (submission_id, actor, action) values (new.submission_id, coalesce(new.done_by, nullif(public.current_email(), ''), new.requested_for), 'Review done');
  end if;
  return new;
end $$;
create trigger trg_rr_log after insert or update on public.review_requests for each row execute function public.tg_rr_log();

create or replace function public.tg_score_clears_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update review_requests set done_at = now(), done_by = new.reviewer where submission_id = new.submission_id and requested_for = new.reviewer and done_at is null;
  return new;
end $$;
create trigger trg_score_clears_request after insert or update on public.scores for each row execute function public.tg_score_clears_request();

-- JD stores, so board rules can use distance to the nearest store
create table if not exists public.jd_stores (name text primary key, lat double precision not null, lng double precision not null);
alter table public.jd_stores enable row level security;
create policy team_read_stores on public.jd_stores for select to authenticated using (public.is_team());
insert into public.jd_stores (name, lat, lng) values ('Bayshore Shopping Centre',45.34739,-75.807),('Bramalea City Centre',43.71555,-79.72197),('Carrefour Angrignon',45.44782,-73.61554),('Carrefour Laval',45.57067,-73.75251),('CF Promenades St-Bruno',45.50537,-73.3783),('Champlain Place',46.09602,-64.76056),('Chinook Centre',50.99776,-114.07201),('Coquitlam Centre',49.27919,-122.79794),('Cornwall Centre',50.45129,-104.61185),('CrossIron Mills',51.20303,-113.99343),('Dufferin Mall',43.65582,-79.43536),('Fairview Mall',43.77554,-79.34518),('Fairview Park',43.42201,-80.4423),('Fairview Pointe Claire',45.46377,-73.83237),('Galeries d''Anjou',45.60013,-73.56569),('Galeries de la Capitale',46.83038,-71.29971),('Georgian Mall',44.41337,-79.70821),('Guildford Town Centre',49.19068,-122.8011),('Heartland Town Centre',43.61333,-79.69266),('Intercity Shopping Centre',48.40411,-89.24351),('Kingsway Mall',53.55489,-113.4967),('Lime Ridge',43.21752,-79.86384),('Market Mall',51.08637,-114.15377),('Markville Mall',43.86844,-79.28814),('Masonville',43.02598,-81.27832),('Mayfair Shopping Centre',48.44623,-123.37105),('Metrotown',49.22688,-123.00051),('Mic Mac Mall',44.68655,-63.55953),('Midtown',52.12709,-106.66764),('Oshawa Centre',43.89052,-78.87919),('Pickering Town Centre',43.83549,-79.08604),('Place Rosemère',45.63063,-73.81961),('Polo Park',49.89079,-97.15174),('Richmond Centre',49.16592,-123.13881),('Rideau Centre',45.4254,-75.69143),('Robson Street',49.2838,-123.12381),('Sainte-Catherine',45.50223,-73.57106),('Scarborough Town Centre',43.77592,-79.2579),('Sevenoaks Mall',49.05066,-122.31238),('Southcentre Mall',50.95077,-114.06541),('Southgate Centre',53.48559,-113.51412),('Square One',43.59311,-79.64232),('St. Vital',49.829,-97.11017),('Toronto Eaton Centre',43.65368,-79.38011),('Tsawwassen Mills',49.03814,-123.08564),('Vaughan Mills',43.82572,-79.53832),('West Edmonton Mall',53.52234,-113.62292),('Willowbrook',49.11448,-122.67512),('Woodgrove Centre',49.23656,-124.05022) on conflict (name) do update set lat = excluded.lat, lng = excluded.lng;

create or replace function public.nearest_store_km(p_lat double precision, p_lng double precision) returns double precision
language sql stable set search_path = '' as $$
  select min(6371 * 2 * asin(sqrt(power(sin(radians(s.lat - p_lat) / 2), 2) + cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2))))
  from public.jd_stores s where p_lat is not null
$$;

-- rules: every key optional. "_any" = has at least one, "_all" = has every one, "_none" = has none of them
create or replace function public.app_matches(a public.applications, r jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare st text; tg text[]; sc numeric; top int; v text;
begin
  if not coalesce(a.consent, false) then return false; end if;
  select c.status, c.tags into st, tg from public.crm_state c where c.submission_id = a.submission_id;
  st := coalesce(st, 'New'); tg := coalesce(tg, '{}');
  if r -> 'lanes_any' is not null and not (coalesce(a.content_lanes, '{}') && public.rule_list(r, 'lanes_any')) then return false; end if;
  if r -> 'lanes_all' is not null and not (coalesce(a.content_lanes, '{}') @> public.rule_list(r, 'lanes_all')) then return false; end if;
  if r -> 'lanes_none' is not null and coalesce(a.content_lanes, '{}') && public.rule_list(r, 'lanes_none') then return false; end if;
  if r -> 'can_any' is not null and not (coalesce(a.can_do, '{}') && public.rule_list(r, 'can_any')) then return false; end if;
  if r -> 'can_all' is not null and not (coalesce(a.can_do, '{}') @> public.rule_list(r, 'can_all')) then return false; end if;
  if r -> 'can_none' is not null and coalesce(a.can_do, '{}') && public.rule_list(r, 'can_none') then return false; end if;
  if r -> 'langs_all' is not null and not (coalesce(a.languages, '{}') @> public.rule_list(r, 'langs_all')) then return false; end if;
  if r -> 'langs_none' is not null and coalesce(a.languages, '{}') && public.rule_list(r, 'langs_none') then return false; end if;
  if r ->> 'french_ready' is not null and ((coalesce(a.languages, '{}') @> array['English', 'French']) <> (r ->> 'french_ready')::boolean) then return false; end if;
  if r -> 'provinces_any' is not null and not (coalesce(a.province, '') = any(public.rule_list(r, 'provinces_any'))) then return false; end if;
  if r -> 'provinces_none' is not null and coalesce(a.province, '') = any(public.rule_list(r, 'provinces_none')) then return false; end if;
  if r -> 'cities_any' is not null and not (lower(coalesce(a.city, '')) = any(array(select lower(x) from unnest(public.rule_list(r, 'cities_any')) x))) then return false; end if;
  if r -> 'gender_any' is not null and not (lower(coalesce(a.identity, '')) = any(array(select lower(x) from unnest(public.rule_list(r, 'gender_any')) x))) then return false; end if;
  if r ->> 'age_min' is not null and (a.dob is null or extract(year from age(current_date, a.dob)) < (r ->> 'age_min')::int) then return false; end if;
  if r ->> 'age_max' is not null and (a.dob is null or extract(year from age(current_date, a.dob)) > (r ->> 'age_max')::int) then return false; end if;
  if r ->> 'min_followers' is not null then
    top := greatest(
      case when r -> 'platforms' is null or r -> 'platforms' ? 'tiktok' then coalesce(a.tiktok_followers, 0) else 0 end,
      case when r -> 'platforms' is null or r -> 'platforms' ? 'instagram' then coalesce(a.instagram_followers, 0) else 0 end,
      case when r -> 'platforms' is null or r -> 'platforms' ? 'youtube' then coalesce(a.youtube_subscribers, 0) else 0 end);
    if top < (r ->> 'min_followers')::int then return false; end if;
  end if;
  foreach v in array array['partnership_ads', 'customer', 'employee', 'worked_jd'] loop
    if r ->> v is not null then
      if ((case v when 'partnership_ads' then a.partnership_ads when 'customer' then a.is_customer when 'employee' then a.is_employee else a.worked_with_jd end) ~* '^(yes|oui)') <> (r ->> v)::boolean then return false; end if;
    end if;
  end loop;
  if r -> 'statuses_any' is not null and not (st = any(public.rule_list(r, 'statuses_any'))) then return false; end if;
  if r -> 'statuses_none' is not null and st = any(public.rule_list(r, 'statuses_none')) then return false; end if;
  if r -> 'tags_any' is not null and not (tg && public.rule_list(r, 'tags_any')) then return false; end if;
  if r -> 'tags_none' is not null and tg && public.rule_list(r, 'tags_none') then return false; end if;
  if r ->> 'min_score' is not null then
    select avg(x) into sc from public.scores s, lateral (values (s.cam), (s.prod), (s.fit)) t(x) where s.submission_id = a.submission_id and x is not null;
    if sc is null or sc < (r ->> 'min_score')::numeric then return false; end if;
  end if;
  if r ->> 'max_store_km' is not null and (a.lat is null or public.nearest_store_km(a.lat, a.lng) > (r ->> 'max_store_km')::numeric) then return false; end if;
  return true;
end $$;

-- keep rule boards current when stage, tags or scores change too
create trigger trg_crm_refresh_boards after update of status, tags on public.crm_state for each statement execute function public.tg_refresh_boards();
create trigger trg_scores_refresh_boards after insert or update on public.scores for each statement execute function public.tg_refresh_boards();
revoke execute on function public.tg_rr_log(), public.tg_score_clears_request() from public, anon, authenticated;
