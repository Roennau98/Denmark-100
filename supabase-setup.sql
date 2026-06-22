-- =====================================================================
--  Danmark · 100 Seværdigheder — backend til familie-deling (Supabase)
-- =====================================================================
--  Kør HELE denne fil i Supabase: Dashboard → SQL Editor → New query →
--  indsæt → Run. Den opretter tabeller + sikkerhedsregler (RLS), så:
--    * hver person kun kan ændre sine EGNE afkrydsninger
--    * familiemedlemmer kan SE hinandens afkrydsninger (samme familie)
--  Bagefter: kopiér Project URL + anon-nøgle (Settings → API) ind i
--  src/config.js. Færdig.
-- =====================================================================

-- ---- Tabeller ----
create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Vores familie',
  join_code  text unique not null,
  created_at timestamptz default now()
);

create table if not exists profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Mig',
  color        text not null default '#c8102e',
  family_id    uuid references families on delete set null,
  created_at   timestamptz default now()
);

create table if not exists visits (
  user_id    uuid not null references auth.users on delete cascade,
  place_id   text not null,
  visited_at timestamptz default now(),
  primary key (user_id, place_id)
);

-- ---- Hjælpefunktion: min families-id (security definer undgår RLS-rekursion) ----
create or replace function public.my_family_id()
returns uuid language sql stable security definer set search_path = public as $$
  select family_id from public.profiles where user_id = auth.uid()
$$;

-- ---- Slå Row Level Security til ----
alter table families enable row level security;
alter table profiles enable row level security;
alter table visits   enable row level security;

-- ---- families ----
drop policy if exists "families read"   on families;
drop policy if exists "families insert" on families;
drop policy if exists "families update" on families;
-- alle indloggede kan slå en familie op (nødvendigt for at deltage via kode)
create policy "families read"   on families for select to authenticated using (true);
create policy "families insert" on families for insert to authenticated with check (true);
create policy "families update" on families for update to authenticated using (id = public.my_family_id());

-- ---- profiles ----
drop policy if exists "profiles read"   on profiles;
drop policy if exists "profiles insert" on profiles;
drop policy if exists "profiles update" on profiles;
-- man kan se sin egen profil + alle i samme familie
create policy "profiles read"   on profiles for select to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family_id()));
create policy "profiles insert" on profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles update" on profiles for update to authenticated using (user_id = auth.uid());

-- ---- visits ----
drop policy if exists "visits read"   on visits;
drop policy if exists "visits insert" on visits;
drop policy if exists "visits update" on visits;
drop policy if exists "visits delete" on visits;
-- man kan se sine egne besøg + besøg fra alle i samme familie
create policy "visits read" on visits for select to authenticated using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.user_id = visits.user_id and p.family_id = public.my_family_id()
  )
);
-- men kun ændre sine EGNE
create policy "visits insert" on visits for insert to authenticated with check (user_id = auth.uid());
create policy "visits update" on visits for update to authenticated using (user_id = auth.uid());
create policy "visits delete" on visits for delete to authenticated using (user_id = auth.uid());

-- ---- (valgfrit) live-opdatering, så familiens afkrydsninger dukker op uden genindlæsning ----
-- Kør kun hvis den ikke allerede er tilføjet (ellers giver den blot en harmløs fejl):
alter publication supabase_realtime add table visits;
