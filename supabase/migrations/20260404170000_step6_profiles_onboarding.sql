create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.onboarding_responses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  responses jsonb not null default '{}'::jsonb,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_onboarding_responses_updated_at on public.onboarding_responses;
create trigger set_onboarding_responses_updated_at
before update on public.onboarding_responses
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.onboarding_responses enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
on public.profiles
for delete
using (auth.uid() = id);

drop policy if exists onboarding_responses_select_own on public.onboarding_responses;
create policy onboarding_responses_select_own
on public.onboarding_responses
for select
using (auth.uid() = user_id);

drop policy if exists onboarding_responses_insert_own on public.onboarding_responses;
create policy onboarding_responses_insert_own
on public.onboarding_responses
for insert
with check (auth.uid() = user_id);

drop policy if exists onboarding_responses_update_own on public.onboarding_responses;
create policy onboarding_responses_update_own
on public.onboarding_responses
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists onboarding_responses_delete_own on public.onboarding_responses;
create policy onboarding_responses_delete_own
on public.onboarding_responses
for delete
using (auth.uid() = user_id);
