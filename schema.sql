-- Waterloo Supabase schema
-- Run this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique(sender_id, receiver_id),
  check(sender_id <> receiver_id)
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, friend_id),
  check(user_id <> friend_id)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  game_type text not null check (game_type in ('2d','3d')),
  scene jsonb not null default '{"objects":[]}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.games enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "profile own insert" on public.profiles;
create policy "profile own insert" on public.profiles for insert with check (auth.uid()=id);
drop policy if exists "profile own update" on public.profiles;
create policy "profile own update" on public.profiles for update using (auth.uid()=id);

drop policy if exists "requests visible to participants" on public.friend_requests;
create policy "requests visible to participants" on public.friend_requests for select using (auth.uid()=sender_id or auth.uid()=receiver_id);
drop policy if exists "requests send" on public.friend_requests;
create policy "requests send" on public.friend_requests for insert with check (auth.uid()=sender_id);
drop policy if exists "requests receiver update" on public.friend_requests;
create policy "requests receiver update" on public.friend_requests for update using (auth.uid()=receiver_id);

drop policy if exists "friendships visible to user" on public.friendships;
create policy "friendships visible to user" on public.friendships for select using (auth.uid()=user_id or auth.uid()=friend_id);
drop policy if exists "friendship insert participant" on public.friendships;
create policy "friendship insert participant" on public.friendships for insert with check (auth.uid()=user_id or auth.uid()=friend_id);

drop policy if exists "games public readable" on public.games;
create policy "games public readable" on public.games for select using (true);
drop policy if exists "games own insert" on public.games;
create policy "games own insert" on public.games for insert with check (auth.uid()=owner_id);
drop policy if exists "games own update" on public.games;
create policy "games own update" on public.games for update using (auth.uid()=owner_id);
drop policy if exists "games own delete" on public.games;
create policy "games own delete" on public.games for delete using (auth.uid()=owner_id);

-- Automatically create a profile row after email signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),20)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Waterloo Hydro economy + community groundwork
-- ---------------------------------------------------------------------------
create table if not exists public.hydro_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.hydro_ledger (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references public.profiles(id) on delete set null,
  to_user uuid references public.profiles(id) on delete set null,
  amount bigint not null check (amount > 0),
  kind text not null check (kind in ('transfer','purchase','sale','refund','promo','adjustment')),
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.launch_promo_claims (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hydro_amount bigint not null check (hydro_amount > 0),
  payment_reference text unique not null,
  claimed_at timestamptz not null default now()
);

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('normal','dev')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.game_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  source_url text,
  lod_urls jsonb not null default '{}'::jsonb,
  maturity text not null default 'all_ages' check (maturity in ('all_ages','18_plus','21_plus')),
  created_at timestamptz not null default now()
);

alter table public.hydro_accounts enable row level security;
alter table public.hydro_ledger enable row level security;
alter table public.forum_posts enable row level security;
alter table public.game_assets enable row level security;

drop policy if exists "hydro own read" on public.hydro_accounts;
create policy "hydro own read" on public.hydro_accounts for select using (auth.uid()=user_id);

drop policy if exists "hydro ledger own read" on public.hydro_ledger;
create policy "hydro ledger own read" on public.hydro_ledger for select using (auth.uid()=from_user or auth.uid()=to_user);

drop policy if exists "forum public read" on public.forum_posts;
create policy "forum public read" on public.forum_posts for select using (true);
drop policy if exists "forum own insert" on public.forum_posts;
create policy "forum own insert" on public.forum_posts for insert with check (auth.uid()=author_id);
drop policy if exists "forum own update" on public.forum_posts;
create policy "forum own update" on public.forum_posts for update using (auth.uid()=author_id);
drop policy if exists "forum own delete" on public.forum_posts;
create policy "forum own delete" on public.forum_posts for delete using (auth.uid()=author_id);

drop policy if exists "assets public read" on public.game_assets;
create policy "assets public read" on public.game_assets for select using (true);
drop policy if exists "assets own insert" on public.game_assets;
create policy "assets own insert" on public.game_assets for insert with check (auth.uid()=owner_id);
drop policy if exists "assets own update" on public.game_assets;
create policy "assets own update" on public.game_assets for update using (auth.uid()=owner_id);
drop policy if exists "assets own delete" on public.game_assets;
create policy "assets own delete" on public.game_assets for delete using (auth.uid()=owner_id);

create or replace function public.ensure_hydro_account(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.hydro_accounts(user_id) values (p_user) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.transfer_hydro(p_to_user uuid, p_amount bigint, p_reference text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  sender_balance bigint;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_to_user = me then raise exception 'cannot transfer to yourself'; end if;
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  perform public.ensure_hydro_account(me);
  perform public.ensure_hydro_account(p_to_user);
  select balance into sender_balance from public.hydro_accounts where user_id=me for update;
  if sender_balance < p_amount then raise exception 'insufficient Hydro'; end if;
  update public.hydro_accounts set balance=balance-p_amount,updated_at=now() where user_id=me;
  update public.hydro_accounts set balance=balance+p_amount,updated_at=now() where user_id=p_to_user;
  insert into public.hydro_ledger(from_user,to_user,amount,kind,reference) values(me,p_to_user,p_amount,'transfer',p_reference);
end;
$$;

revoke all on function public.transfer_hydro(uuid,bigint,text) from public;
grant execute on function public.transfer_hydro(uuid,bigint,text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),20)
  )
  on conflict (id) do nothing;
  insert into public.hydro_accounts(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
