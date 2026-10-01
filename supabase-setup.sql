-- Run once in Supabase: SQL Editor > New query > paste > Run

create table public.media (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author text not null check (char_length(author) between 1 and 40),
  kind text not null check (kind in ('photo','audio')),
  bucket text not null check (bucket in ('guest-media','private-wishes')),
  path text not null unique,
  secs int check (secs between 0 and 31),
  is_private boolean not null default false,
  check (is_private = (bucket = 'private-wishes'))
);
alter table public.media enable row level security;

-- Guests (anonymous) may add items and see only non-private ones
create policy "guests add"        on public.media for insert to anon, authenticated with check (true);
create policy "guests see public" on public.media for select to anon using (is_private = false);
-- Logged-in couple (admin) can do everything
create policy "admin all"         on public.media for all to authenticated using (true) with check (true);

-- Storage buckets: photos + public wishes are public-readable, private wishes are not
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('guest-media','guest-media', true, 5242880,
   array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/ogg']),
 ('private-wishes','private-wishes', false, 5242880,
   array['audio/webm','audio/mp4','audio/mpeg','audio/ogg'])
on conflict (id) do nothing;

create policy "guests upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id in ('guest-media','private-wishes'));
create policy "admin read"    on storage.objects for select to authenticated
  using (bucket_id in ('guest-media','private-wishes'));
create policy "admin delete"  on storage.objects for delete to authenticated
  using (bucket_id in ('guest-media','private-wishes'));
