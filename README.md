# JD Creator Collective CRM

Team CRM for JD Creator Collective applicants. Jotform collects applications; this site is where the JD team browses, scores, shortlists, shares and contacts creators.

**Nothing in this repository contains applicant data or secret keys.** Applicant data lives in Supabase (Canada region) behind JD-email logins.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| Web app | `docs/` on GitHub Pages | The CRM. Sign in with a JD email link. |
| Database and photos | Supabase project `jd-creator-collective` (ca-central-1) | Applicants, team data, private photo storage, live updates |
| Sync | `.github/workflows/sync.yml` running `sync/sync.mjs` | Stays running and copies new and changed Jotform submissions, photos, map locations and link previews into Supabase every few minutes, or straight away when someone presses Refresh now |
| Shared boards | `docs/share.html` + Supabase edge function `shared-board` | Read-only board links for brand partners or leadership |

Jotform stays the place applicants submit. The sync never writes back to Jotform. Team work (stage, favourites, owner, tags, notes, scores, boards, outreach log) is stored only in Supabase, and the sync never overwrites it.

## Privacy rules built in

- Only signed-in users with an email on an allowed domain (`jdcanada.ca`, `jdsports.ca`) can read anything. Add a domain in the `allowed_domains` table.
- Gender (the form's "How do you identify" answer) and date of birth are stored so the team can filter by them. The CRM shows age, not the date of birth. Neither is included in shared board links.
- Submissions where the applicant did not consent to data storage are skipped, and erased if previously stored.
- Contact details are masked until someone clicks to view them, and each view is logged.
- "Erase applicant" removes someone from the CRM immediately; the next sync permanently deletes their data and photos. Also delete the submission in Jotform.
- If a submission is deleted in Jotform, the next sync erases it here too.
- The app never deletes rows directly. Removing from boards or archiving boards flips a flag.

- Sync logs never contain names, IDs, emails or file links, because this repository and its Actions logs are public.

## Settings

GitHub repository secrets (Settings → Secrets and variables → Actions):

- `JOTFORM_API_KEY`: read-only key from the shared Jotform account
- `SUPABASE_URL`: `https://pssvzybdugbfpnfmjqqq.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: from Supabase project settings, API keys. Server key, never put it in `docs/`
- `META_OEMBED_TOKEN` (optional): enables Instagram post previews

Optional repository variables: `JOTFORM_FORM_ID` (default `262455225676261`), `JOTFORM_UTC_OFFSET` (default `-04:00`, the Jotform account's time zone).

## Common changes

- **Sync frequency:** edit `LAUNCH_DAY`, `LAUNCH_INTERVAL_MIN` and `DAY_INTERVAL_MIN` in `.github/workflows/sync.yml`.
- **Board rules:** set them in the app (Boards → open a board → Add rules / Edit rules). Stored as `rules` (in the `boards` table) adds matching applicants automatically. Keys: `lanes_any`, `can_all`, `langs_all`, `provinces_any`, `provinces_none`, `min_followers` (+ optional `platforms`), `partnership_ads`, `gender_any`, `age_min`, `age_max`.
- **Run a sync now:** Actions tab → Jotform sync → Run workflow.
- **A form question was renamed or added:** update the matching pattern in `sync/mapping.mjs`. The sync log lists questions it could not match.
- **Stores open or close:** update `docs/stores.js` (taken from the jdsports.ca store locator).
- **Scheduled syncs paused:** GitHub pauses scheduled workflows after 60 days with no repository activity. Re-enable from the Actions tab.
