-- =====================================================================
-- Team Account Tracker: database schema + security rules
-- Run in Supabase: Dashboard > SQL Editor > New query > paste ALL of it > Run.
-- Safe to run again at any time: it upgrades an existing database in place
-- and never deletes logs, payments, posts or questions.
--
-- Who can see what is enforced HERE, by the database itself (Row Level
-- Security). The website only shows what the database hands back, so an
-- intern opening the page code or calling the API directly still gets
-- nothing they aren't allowed to see.
--
--   Admin .................. everything
--   Interns ................ their own accounts, logs and questions
--                            + which of THEIR OWN weeks are marked paid (date only)
--                            + everyone's weekly hours (toggle: share_hours)
--                            + the "For the team" board (read only)
--   Anyone else signed in .. nothing at all (not on the team list)
--   Not signed in .......... nothing at all
--
-- Admin toggles (People & accounts > What interns can see):
--   share_logs       interns see each other's accounts and weekly logs (read only)
--   share_hours      interns see each other's weekly hour totals (ON by default)
--   share_questions  interns see each other's questions + the admin's answers
--
-- NEVER visible to interns, and there is no toggle that changes this:
--   * the payments table (amounts, hours paid, notes, dates of other people)
--   * the partner board and its screenshots, including the partner's name
--   * login emails, and all editing of people, accounts, settings and posts
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.people (
  id        text primary key,
  name      text not null,
  role      text not null default 'intern' check (role in ('intern','admin')),
  sort      int  not null default 99,
  archived  boolean not null default false
);

-- Login emails live in their own table so interns can see teammates'
-- names without seeing their email addresses.
create table if not exists public.member_emails (
  person_id text primary key references public.people(id) on delete cascade,
  email     text not null unique check (email = lower(email))
);

create table if not exists public.accounts (
  id         text primary key default ('a' || substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
  person_id  text references public.people(id) on delete set null,
  name       text not null,
  setup_done boolean not null default false,
  sort       int not null default 99,
  archived   boolean not null default false
);

create table if not exists public.week_logs (
  person_id  text not null references public.people(id) on delete cascade,
  week       date not null,                       -- Monday of the week
  mode       text not null default 'perAccount' check (mode in ('perAccount','total')),
  total_min  int check (total_min is null or total_min >= 0),
  week_note  text not null default '',
  imported   boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (person_id, week)
);

create table if not exists public.week_entries (
  person_id  text not null,
  week       date not null,
  account_id text not null references public.accounts(id) on delete cascade,
  minutes    int check (minutes is null or minutes >= 0),
  note       text not null default '',
  through    date,
  primary key (person_id, week, account_id),
  foreign key (person_id, week) references public.week_logs(person_id, week) on delete cascade
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  person_id  text not null references public.people(id) on delete cascade,
  weeks      date[] not null default '{}',        -- Mondays this payment covers
  label      text not null default '',
  amount     numeric(10,2),
  minutes    int,
  hours      numeric(8,3),                         -- only for payments imported from the sheet
  paid_on    date,
  note       text not null default '',
  imported   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  board      text not null check (board in ('team','partner')),
  title      text not null default '',
  body       text not null default '',
  pinned     boolean not null default false,
  img_path   text,
  imported   boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null references public.people(id) on delete cascade,
  account     text not null default '',
  body        text not null,
  img_path    text,
  status      text not null default 'open' check (status in ('open','answered')),
  answer      text,
  answered_at timestamptz,
  imported    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  id              int primary key default 1 check (id = 1),
  share_logs      boolean not null default false,
  share_hours     boolean not null default true,
  share_questions boolean not null default false,
  -- display names, kept in the database so no real names live in the public code
  team_name       text not null default 'Team Tracker',
  admin_name      text not null default 'Admin'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- Admin-only settings. The partner board's name lives here (not in
-- "settings") so interns can't even read who the partner is.
create table if not exists public.admin_settings (
  id           int primary key default 1 check (id = 1),
  partner_name text not null default 'Partner'
);
insert into public.admin_settings (id) values (1) on conflict do nothing;

-- One-time upgrade from the first version of this schema.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'settings' and column_name = 'partner_name') then
    execute 'update public.admin_settings a set partner_name = s.partner_name
               from public.settings s where s.id = 1 and a.id = 1';
    execute 'alter table public.settings drop column partner_name';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'settings' and column_name = 'share_pay') then
    -- Interns can no longer see pay at all, so the "share pay" switch is removed.
    execute 'alter table public.settings drop column share_pay';
    -- Requirement: interns see only their own data by default. The first version
    -- shared questions by default; reset it once. The admin can turn it back on.
    execute 'update public.settings set share_questions = false';
    execute 'alter table public.settings alter column share_questions set default false';
  end if;
end $$;

-- ---------- identity helpers ----------
-- The signed-in user's email comes from their login token, which Supabase
-- signs. It can't be faked from the browser.
create or replace function public.jwt_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- True when the request comes through the website / API (it carries a login
-- token or the public key). False in the dashboard SQL editor, so the owner
-- can always load and repair data there without tripping the guards below.
create or replace function public.from_website() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') <> ''
$$;

create or replace function public.my_person() returns text
language sql stable security definer set search_path = public as $$
  select p.id from member_emails m join people p on p.id = m.person_id
  where m.email = public.jwt_email() and m.email <> '' and not p.archived
  limit 1
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_person() is not null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from member_emails m join people p on p.id = m.person_id
    where m.email = public.jwt_email() and m.email <> '' and p.role = 'admin' and not p.archived)
$$;

create or replace function public.share(flag text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case flag
      when 'logs' then share_logs
      when 'hours' then share_hours when 'questions' then share_questions
      else false end from settings where id = 1), false)
$$;

-- who am I? (used by the website right after login)
create or replace function public.whoami() returns table(person_id text, name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.role from member_emails m join people p on p.id = m.person_id
  where m.email = public.jwt_email() and m.email <> '' and not p.archived
  limit 1
$$;

-- Weekly hour totals per person. Interns get everyone's totals only while
-- share_hours is on; otherwise just their own. No notes, no pay.
create or replace function public.team_hours() returns table(person_id text, name text, week date, minutes int)
language sql stable security definer set search_path = public as $$
  select l.person_id, p.name, l.week,
    (case when l.mode = 'total' then coalesce(l.total_min, 0)
          else coalesce((select sum(e.minutes) from week_entries e
                          where e.person_id = l.person_id and e.week = l.week), 0) end)::int
  from week_logs l join people p on p.id = l.person_id
  where public.is_admin()
     or l.person_id = public.my_person()
     or (public.is_member() and public.share('hours'))
$$;

-- Interns tick "initial rule setup" on their own accounts without being
-- able to change anything else about the account.
create or replace function public.set_setup(acc text, done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update accounts set setup_done = done
   where id = acc and (public.is_admin() or person_id = public.my_person());
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Interns can't answer their own questions, reassign them or backdate them.
-- (Only applies to website users, so answered questions can be loaded from the SQL editor.)
create or replace function public.guard_question() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.from_website() and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.answer := null; new.answered_at := null; new.status := 'open'; new.imported := false;
      new.created_at := now();
    else
      new.answer := old.answer; new.answered_at := old.answered_at;
      new.person_id := old.person_id; new.imported := old.imported; new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_question on public.questions;
create trigger guard_question before insert or update on public.questions
  for each row execute function public.guard_question();

-- Interns can't fake who saved a log or when, or mark it as imported.
-- (Only applies to website users, not the dashboard SQL editor.)
create or replace function public.stamp_week_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.from_website() then
    new.updated_at := now();
    new.updated_by := public.my_person();
    if not public.is_admin() then
      new.imported := case when tg_op = 'UPDATE' then old.imported else false end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists stamp_week_log on public.week_logs;
create trigger stamp_week_log before insert or update on public.week_logs
  for each row execute function public.stamp_week_log();

-- An intern's own paid weeks: the week and the date it was paid. Nothing
-- else: no amounts, no notes, and never anyone else's weeks.
create or replace function public.my_paid_weeks() returns table(week date, paid_on date)
language sql stable security definer set search_path = public as $$
  select w.week, max(p.paid_on)
    from payments p cross join lateral unnest(p.weeks) as w(week)
   where p.person_id = public.my_person()
   group by w.week
$$;

-- Lock function access to signed-in users only.
revoke all on function public.whoami(), public.team_hours(), public.set_setup(text, boolean),
  public.my_person(), public.is_member(), public.is_admin(), public.share(text),
  public.my_paid_weeks(), public.jwt_email(), public.from_website() from public, anon;
grant execute on function public.whoami(), public.team_hours(), public.set_setup(text, boolean),
  public.my_person(), public.is_member(), public.is_admin(), public.share(text),
  public.my_paid_weeks(), public.jwt_email(), public.from_website() to authenticated;
-- Trigger functions are never called directly.
revoke all on function public.guard_question(), public.stamp_week_log() from public, anon, authenticated;

-- ---------- row level security ----------
alter table public.people        enable row level security;
alter table public.member_emails enable row level security;
alter table public.accounts      enable row level security;
alter table public.week_logs     enable row level security;
alter table public.week_entries  enable row level security;
alter table public.payments      enable row level security;
alter table public.posts         enable row level security;
alter table public.questions     enable row level security;
alter table public.settings      enable row level security;
alter table public.admin_settings enable row level security;

-- Nothing at all for signed-out visitors.
revoke all on public.people, public.member_emails, public.accounts, public.week_logs,
  public.week_entries, public.payments, public.posts, public.questions, public.settings,
  public.admin_settings from anon;

-- Signed-in users get table access explicitly (works even when the project's
-- "Automatically expose new tables" option is off). The policies below still
-- decide which rows each person can actually see or change.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.people, public.member_emails, public.accounts,
  public.week_logs, public.week_entries, public.payments, public.posts, public.questions,
  public.settings to authenticated;
grant select, update on public.admin_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- people: current teammates' names are visible to members; only admin edits
drop policy if exists people_read  on public.people;
drop policy if exists people_admin on public.people;
create policy people_read  on public.people for select to authenticated using (public.is_member() and not archived);
create policy people_admin on public.people for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- member_emails: admin only.
-- The "restrictive" policy is a second lock: even if someone later adds a
-- policy that opens this table up by mistake, non-admins are still refused.
drop policy if exists emails_admin on public.member_emails;
drop policy if exists emails_lock  on public.member_emails;
create policy emails_admin on public.member_emails for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy emails_lock  on public.member_emails as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- accounts: own (or all when share_logs); only admin edits
drop policy if exists accounts_read  on public.accounts;
drop policy if exists accounts_admin on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (
  public.is_admin() or person_id = public.my_person() or (public.is_member() and public.share('logs')));
create policy accounts_admin on public.accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- week_logs: own (or all read-only when share_logs); write own
drop policy if exists logs_read  on public.week_logs;
drop policy if exists logs_write on public.week_logs;
create policy logs_read on public.week_logs for select to authenticated using (
  public.is_admin() or person_id = public.my_person() or (public.is_member() and public.share('logs')));
create policy logs_write on public.week_logs for all to authenticated
  using (public.is_admin() or person_id = public.my_person())
  with check (public.is_admin() or person_id = public.my_person());

-- week_entries: same, and an intern can only log against accounts assigned to them
drop policy if exists entries_read  on public.week_entries;
drop policy if exists entries_write on public.week_entries;
create policy entries_read on public.week_entries for select to authenticated using (
  public.is_admin() or person_id = public.my_person() or (public.is_member() and public.share('logs')));
create policy entries_write on public.week_entries for all to authenticated
  using (public.is_admin() or person_id = public.my_person())
  with check (public.is_admin() or (person_id = public.my_person()
    and exists (select 1 from public.accounts a where a.id = account_id and a.person_id = public.my_person())));

-- Paid weeks are locked: once a payment covers a week, only the admin can change
-- that week's log or entries. (Applies to website users; the dashboard SQL editor
-- has no login token and is not blocked, so the owner can always fix data.)
create or replace function public.week_is_paid(pid text, wk date) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payments where person_id = pid and wk = any(weeks)) $$;
-- Not callable from the website: it would let an intern ask "has X been paid
-- for week Y?" about anyone. Only the lock trigger below uses it.
revoke all on function public.week_is_paid(text, date) from public, anon, authenticated;

create or replace function public.guard_paid_week() returns trigger
  language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if not public.from_website() or public.is_admin() then return coalesce(new, old); end if;
  me := public.my_person();
  -- Only ever answer about the caller's OWN weeks. Attempts on someone else's
  -- rows fall through and are refused by the row security rules, with the same
  -- error whether or not that week was paid.
  if tg_op in ('UPDATE','DELETE') and old.person_id = me and public.week_is_paid(old.person_id, old.week) then
    raise exception 'This week has been paid and is locked. Ask the admin to change it.' using errcode = '42501';
  end if;
  if tg_op in ('INSERT','UPDATE') and new.person_id = me and public.week_is_paid(new.person_id, new.week) then
    raise exception 'This week has been paid and is locked. Ask the admin to change it.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_paid_week() from public, anon, authenticated;
drop trigger if exists lock_paid_logs on public.week_logs;
create trigger lock_paid_logs before insert or update or delete on public.week_logs
  for each row execute function public.guard_paid_week();
drop trigger if exists lock_paid_entries on public.week_entries;
create trigger lock_paid_entries before insert or update or delete on public.week_entries
  for each row execute function public.guard_paid_week();

-- payments: ADMIN ONLY, always. Interns cannot read any payment row, not even
-- their own (they get "paid / not paid" for their own weeks from my_paid_weeks()).
drop policy if exists pay_read  on public.payments;
drop policy if exists pay_admin on public.payments;
drop policy if exists pay_lock  on public.payments;
create policy pay_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pay_lock  on public.payments as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- posts: team board readable by members; partner board admin only; admin only writes
drop policy if exists posts_read  on public.posts;
drop policy if exists posts_admin on public.posts;
create policy posts_read on public.posts for select to authenticated using (
  public.is_admin() or (board = 'team' and public.is_member()));
create policy posts_admin on public.posts for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists posts_partner_lock on public.posts;
create policy posts_partner_lock on public.posts as restrictive for all to authenticated
  using (board <> 'partner' or public.is_admin()) with check (board <> 'partner' or public.is_admin());

-- questions: own (or all when share_questions); members ask as themselves
drop policy if exists q_read   on public.questions;
drop policy if exists q_insert on public.questions;
drop policy if exists q_update on public.questions;
drop policy if exists q_delete on public.questions;
create policy q_read on public.questions for select to authenticated using (
  public.is_admin() or person_id = public.my_person() or (public.is_member() and public.share('questions')));
create policy q_insert on public.questions for insert to authenticated with check (
  public.is_admin() or person_id = public.my_person());
create policy q_update on public.questions for update to authenticated
  using (public.is_admin() or person_id = public.my_person())
  with check (public.is_admin() or person_id = public.my_person());
create policy q_delete on public.questions for delete to authenticated using (
  public.is_admin() or person_id = public.my_person());

-- settings: members read (so the site knows what to show); admin edits
drop policy if exists settings_read  on public.settings;
drop policy if exists settings_admin on public.settings;
create policy settings_read  on public.settings for select to authenticated using (public.is_member());
create policy settings_admin on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_settings (partner board name): admin only
drop policy if exists admin_settings_admin on public.admin_settings;
drop policy if exists admin_settings_lock  on public.admin_settings;
create policy admin_settings_admin on public.admin_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_settings_lock  on public.admin_settings as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- screenshot storage (private bucket) ----------
-- Paths:  team/<file>               team board images  (members read)
--         partner/<file>            partner board images (admin only)
--         q/<person_id>/<file>      question images    (owner + admin; everyone when share_questions)
-- Images only, 10 MB each, so nobody can fill the free storage or upload web pages.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attachments', 'attachments', false, 10485760, array['image/png','image/jpeg','image/gif','image/webp'])
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tt_read   on storage.objects;
drop policy if exists tt_insert on storage.objects;
drop policy if exists tt_delete on storage.objects;
create policy tt_read on storage.objects for select to authenticated using (
  bucket_id = 'attachments' and (
    public.is_admin()
    or (public.is_member() and (storage.foldername(name))[1] = 'team')
    or (public.is_member() and (storage.foldername(name))[1] = 'q'
        and ((storage.foldername(name))[2] = public.my_person() or public.share('questions')))));
create policy tt_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'attachments' and (
    public.is_admin()
    or (public.is_member() and (storage.foldername(name))[1] = 'q'
        and (storage.foldername(name))[2] = public.my_person())));
create policy tt_delete on storage.objects for delete to authenticated using (
  bucket_id = 'attachments' and public.is_admin());
