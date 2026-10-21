-- JD Creator Collective CRM: data minimisation and invoker-rights view (applied as crm_04_hardening and crm_05_function_access)
-- The sync stores an age band only. Date of birth and identity columns stay empty.
alter table public.applications add column if not exists age_band text;

create or replace function public.current_email() returns text
language sql stable set search_path = '' as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create policy team_read_apps on public.applications for select to authenticated
using (public.is_team() and not exists (select 1 from public.deleted_submissions d where d.submission_id = applications.submission_id));

create or replace view public.app_applications with (security_invoker = on) as
select
  a.submission_id, a.form_id, a.submitted_at, a.jotform_updated_at, a.full_name, a.email, a.phone, a.province, a.city,
  a.age_band,
  a.languages, a.language_other, a.speaking_style, a.equipment, a.editing_software,
  a.tiktok_url, a.instagram_url, a.youtube_url, a.tiktok_followers, a.instagram_followers, a.youtube_subscribers,
  a.post_urls, a.portfolio_url, a.brands, a.worked_with_jd, a.is_employee, a.is_customer, a.partnership_ads,
  a.can_do, a.content_lanes, a.niche, a.sets_apart, a.tell_more, a.anything_else,
  a.consent, a.age_confirmed, a.terms_agreed, a.lat, a.lng, a.headshot_path, a.setup_paths, a.previews
from public.applications a;

create policy team_read_deleted on public.deleted_submissions for select to authenticated using (public.is_team());

revoke execute on function public.tg_board_member(), public.tg_crm_change(), public.tg_new_application(), public.tg_note_added(), public.tg_score_owner() from public, anon, authenticated;
revoke execute on function public.team_members(), public.is_team() from public, anon;
revoke execute on function public.shared_board(text) from public, anon, authenticated;
grant execute on function public.team_members(), public.is_team() to authenticated;
