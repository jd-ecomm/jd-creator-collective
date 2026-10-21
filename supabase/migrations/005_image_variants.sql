-- Fast photo versions made by the sync (applied as crm_06_image_variants and crm_07_shared_board_variants)
alter table public.applications add column if not exists variants jsonb not null default '{}'::jsonb;
-- app_applications view re-created with variants as its last column; shared_board() returns variants too.
