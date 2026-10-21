-- New sync runs reach open CRM tabs instantly, so new applicants appear without waiting for the poll (applied as crm_08_realtime_sync_runs)
alter publication supabase_realtime add table public.sync_runs;
