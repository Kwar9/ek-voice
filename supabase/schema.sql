-- Run this in the Supabase SQL Editor before enabling accounts/history.
create table if not exists public.conversion_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_text text not null,
  provider text not null check (provider in ('google', 'openai', 'elevenlabs')),
  voice_id text not null,
  language_code text not null default 'en-US',
  speed numeric not null default 1.0,
  character_count integer not null check (character_count >= 0),
  audio_path text not null,
  download_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversion_history_user_created_idx
  on public.conversion_history (user_id, created_at desc);

alter table public.conversion_history enable row level security;

drop policy if exists "Users can read their own history" on public.conversion_history;
create policy "Users can read their own history"
  on public.conversion_history for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own history" on public.conversion_history;
create policy "Users can insert their own history"
  on public.conversion_history for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own history" on public.conversion_history;
create policy "Users can delete their own history"
  on public.conversion_history for delete to authenticated
  using (auth.uid() = user_id);

-- Create a PRIVATE Storage bucket named "generated-audio" in Supabase Storage.
-- Then run these policies. Only the signed-in owner can access their own folder.
drop policy if exists "Users read own generated audio" on storage.objects;
create policy "Users read own generated audio"
  on storage.objects for select to authenticated
  using (bucket_id = 'generated-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload own generated audio" on storage.objects;
create policy "Users upload own generated audio"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'generated-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own generated audio" on storage.objects;
create policy "Users delete own generated audio"
  on storage.objects for delete to authenticated
  using (bucket_id = 'generated-audio' and (storage.foldername(name))[1] = auth.uid()::text);
