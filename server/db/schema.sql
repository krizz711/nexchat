-- ============================================================
-- CHAT APP - SUPABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── USERS ────────────────────────────────────────────────────
create table users (
  id uuid primary key default uuid_generate_v4(),
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  avatar_url text,
  bio text default '',
  created_at timestamptz default now()
);

-- ── GROUPS ───────────────────────────────────────────────────
create table groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references users(id) on delete set null,
  is_private boolean default false,
  is_global boolean default false,
  invite_code text unique,
  created_at timestamptz default now()
);

-- ── GROUP MEMBERS ─────────────────────────────────────────────
create table group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- ── INDEXES ───────────────────────────────────────────────────
create index idx_group_members_user on group_members(user_id);
create index idx_group_members_group on group_members(group_id);
create index idx_groups_global on groups(is_global);
create index idx_groups_invite on groups(invite_code);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
alter table users enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;

-- Service role bypasses RLS (our server uses service role key)
-- These policies are for direct client access safety

create policy "Users can read all profiles"
  on users for select using (true);

create policy "Users can update own profile"
  on users for update using (auth.uid()::text = id::text);

create policy "Anyone can read public groups"
  on groups for select using (is_private = false or is_global = true);

create policy "Members can read private groups"
  on groups for select using (
    exists (
      select 1 from group_members
      where group_id = groups.id and user_id::text = auth.uid()::text
    )
  );

-- ── SEED: 4 GLOBAL ROOMS ─────────────────────────────────────
insert into groups (name, is_global, is_private) values
  ('🌍 General', true, false),
  ('🎮 Gaming', true, false),
  ('🎵 Music & Arts', true, false),
  ('💻 Tech Talk', true, false);

-- ============================================================
-- DONE. Your database is ready.
-- ============================================================
