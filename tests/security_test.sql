-- =====================================================================
-- Security tests. Run by tests/run.sh against a throwaway database.
--
-- Every check runs the way the real website talks to the database: as the
-- "authenticated" role with a login token for one particular email (or as
-- "anon" with no token). The website's own code is NOT involved, so these
-- prove what someone gets when they skip the site and call the database
-- directly with dev tools.
--
-- Each check is rolled back afterwards, so checks don't affect each other.
-- =====================================================================
\set QUIET on
\pset pager off
set client_min_messages = warning;
\o /dev/null

create schema t;
create table t.results (n serial, name text, ok boolean not null, detail text);
-- A check whose outcome is unknown (NULL) counts as FAILED, never as passed.
create function t.fail_closed() returns trigger language plpgsql as $$
begin new.ok := coalesce(new.ok, false); return new; end $$;
create trigger fail_closed before insert on t.results for each row execute function t.fail_closed();

-- Become `who`, run `q`, undo it, and report what happened.
--   who = ''            signed-out visitor (anon role, no token)
--   who = 'a@b'         signed-in user whose token carries that email
--   who = '{...}'       signed-in user with exactly these token claims
create function t.exec(who text, q text, out n bigint, out val text, out err text, out msg text)
language plpgsql as $$
begin
  begin
    if who = '' then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        case when left(who, 1) = '{' then who
             else json_build_object('email', who, 'role', 'authenticated')::text end, true);
      set local role authenticated;
    end if;
    if q ~* '^\s*(select|with)\y' then execute q into val; else execute q; end if;
    get diagnostics n = row_count;
    raise exception 'undo' using errcode = 'TT000';
  exception when others then
    if sqlstate <> 'TT000' then n := null; val := null; err := sqlstate; msg := sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- how many rows does `who` get back from this SELECT?  (errors count as failure)
create function t.sees(name text, who text, q text, want bigint) returns void language plpgsql as $$
declare r record;
begin
  r := t.exec(who, 'select count(*) from (' || q || ') _q');
  insert into t.results (name, ok, detail) values (name, r.err is null and r.val::bigint = want,
    format('wanted %s rows, got %s', want, coalesce(r.val, 'error ' || r.err || ': ' || r.msg)));
end $$;

-- `who` must get NOTHING from this SELECT: zero rows or a permission error.
create function t.hidden(name text, who text, q text) returns void language plpgsql as $$
declare r record;
begin
  r := t.exec(who, 'select count(*) from (' || q || ') _q');
  insert into t.results (name, ok, detail) values (name,
    (r.err is null and r.val::bigint = 0) or r.err in ('42501', '42883', '42703'),
    format('wanted nothing, got %s', coalesce(r.val || ' rows', 'error ' || r.err || ': ' || r.msg)));
end $$;

-- this INSERT / UPDATE / DELETE / function call by `who` must change nothing:
-- either a permission error, or zero rows affected.
create function t.blocked(name text, who text, q text) returns void language plpgsql as $$
declare r record;
begin
  r := t.exec(who, q);
  insert into t.results (name, ok, detail) values (name,
    r.err = '42501' or (r.err is null and r.n = 0),
    format('wanted refusal, got %s', coalesce('error ' || r.err || ': ' || r.msg, r.n || ' rows changed')));
end $$;

-- this statement by `who` must work and affect exactly `want` rows.
create function t.allowed(name text, who text, q text, want bigint default 1) returns void language plpgsql as $$
declare r record;
begin
  r := t.exec(who, q);
  insert into t.results (name, ok, detail) values (name, r.err is null and r.n = want,
    format('wanted %s rows changed, got %s', want, coalesce('error ' || r.err || ': ' || r.msg, r.n::text)));
end $$;

-- this single-value query by `who` must return exactly `want`.
create function t.value(name text, who text, q text, want text) returns void language plpgsql as $$
declare r record;
begin
  r := t.exec(who, q);
  insert into t.results (name, ok, detail) values (name, r.err is null and r.val is not distinct from want,
    format('wanted %s, got %s', coalesce(want, 'NULL'), coalesce('error ' || r.err || ': ' || r.msg, r.val, 'NULL')));
end $$;

create function t.check(name text, ok boolean, detail text default '') returns void language sql as $$
  insert into t.results (name, ok, detail) values (name, coalesce(ok, false), detail) $$;

-- Everything `who` can possibly read, as one big string: every row of every
-- table (public + storage) plus the output of every function the website can
-- call. Used to prove that secret marker values never reach an intern.
create function t.everything(who text) returns text language plpgsql as $$
declare out text := ''; rel record; r record; fn text;
begin
  for rel in select c.oid::regclass::text as name from pg_class c join pg_namespace s on s.oid = c.relnamespace
              where s.nspname in ('public', 'storage') and c.relkind in ('r', 'v', 'm', 'p') loop
    r := t.exec(who, format('select coalesce(string_agg(to_jsonb(x)::text, '' ''), '''') from %s x', rel.name));
    out := out || ' ' || coalesce(r.val, '');
  end loop;
  foreach fn in array array['select to_jsonb(x) from public.whoami() x', 'select to_jsonb(x) from public.team_hours() x',
      'select to_jsonb(x) from public.my_paid_weeks() x', 'select public.my_person()', 'select public.share(''pay'')',
      'select public.week_is_paid(''ben'', ''2026-01-05'')'] loop
    r := t.exec(who, format('select coalesce(string_agg(y::text, '' ''), '''') from (%s) _f(y)', fn));
    out := out || ' ' || coalesce(r.val, '');
  end loop;
  return out;
end $$;
create function t.no_secrets(name text, who text) returns void language plpgsql as $$
declare d text := t.everything(who); hit text;
begin
  hit := substring(d from '(?i)(.{0,30}(sentinel|91234).{0,30})');
  insert into t.results (name, ok, detail) values (name, hit is null, 'leaked: ' || coalesce(hit, ''));
end $$;

\set BOSS '''boss-sentinel@test.example'''
\set ANA  '''ana-sentinel@test.example'''
\set BEN  '''ben-sentinel@test.example'''
\set OLD  '''old-sentinel@test.example'''
\set STRANGER '''stranger@test.example'''
\set ANON ''''''
-- a real intern token whose self-editable parts claim to be the admin
\set FAKER '''{"email":"ana-sentinel@test.example","role":"authenticated","user_metadata":{"role":"admin","email":"boss-sentinel@test.example","is_admin":true},"app_metadata":{"role":"admin"}}'''
\set NOEMAIL '''{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}'''

-- ---------- 0. starting point ----------
select t.check('defaults: logs private, hours shared, questions private',
  (select not share_logs and share_hours and not share_questions from public.settings), 'settings row: ' || (select to_jsonb(s)::text from public.settings s));
select t.check('settings has no share_pay switch and no partner name',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name in ('share_pay', 'partner_name')));
select t.check('upgrade kept the data', (select count(*) from public.payments) = 2 and (select count(*) from public.week_logs) = 4
  and (select partner_name from public.admin_settings) = 'PARTNERNAME-SENTINEL');

-- ---------- 1. the admin sees everything (so "intern sees 0" below means something) ----------
select t.sees('admin: all payments',        :BOSS, 'select amount from public.payments', 2);
select t.sees('admin: partner board',       :BOSS, $$select * from public.posts where board = 'partner'$$, 1);
select t.sees('admin: login emails',        :BOSS, 'select * from public.member_emails', 4);
select t.value('admin: partner name',       :BOSS, 'select partner_name from public.admin_settings', 'PARTNERNAME-SENTINEL');
select t.sees('admin: everyone''s logs',    :BOSS, 'select * from public.week_logs', 4);
select t.sees('admin: all people incl. removed', :BOSS, 'select * from public.people', 4);
select t.sees('admin: all screenshots in the bucket', :BOSS, 'select * from storage.objects', 4);
select t.allowed('admin: can record a payment', :BOSS, $$insert into public.payments (person_id, weeks, amount) values ('ana', '{2026-01-12}', 10)$$);
select t.allowed('admin: can edit a paid week', :BOSS, $$update public.week_logs set week_note = 'fixed' where person_id = 'ana' and week = '2026-01-05'$$);
select t.allowed('admin: can flip a sharing switch', :BOSS, 'update public.settings set share_logs = true');

-- ---------- 2. PAY: an intern can never read it ----------
select t.hidden('intern: payments table',              :ANA, 'select * from public.payments');
select t.hidden('intern: own payment amount',          :ANA, $$select amount from public.payments where person_id = 'ana'$$);
select t.hidden('intern: payment count / sum',         :ANA, 'select 1 from public.payments having count(*) > 0 or sum(amount) > 0');
select t.blocked('intern: cannot add a payment',       :ANA, $$insert into public.payments (person_id, weeks, amount) values ('ana', '{2026-01-12}', 999999)$$);
select t.blocked('intern: cannot change a payment',    :ANA, 'update public.payments set amount = 1');
select t.blocked('intern: cannot delete a payment',    :ANA, 'delete from public.payments');
select t.blocked('intern: cannot ask "was X paid for week Y"', :ANA, $$select public.week_is_paid('ben', '2026-01-05')$$);
select t.value('intern: own paid weeks = week + date only', :ANA, 'select string_agg(to_jsonb(x)::text, '','') from public.my_paid_weeks() x',
  '{"week": "2026-01-05", "paid_on": "2026-01-20"}');
select t.sees('intern: my_paid_weeks never lists a teammate''s weeks', :ANA, $$select * from public.my_paid_weeks() where week = '2026-01-19'$$, 0);
-- The paid-week lock must not work as a yes/no oracle about OTHER people's pay:
-- touching Ben's paid week and Ben's unpaid week must fail identically.
select t.check('intern: lock gives the same answer for a teammate''s paid and unpaid weeks',
  (select (a.err, a.msg) is not distinct from (b.err, b.msg) and a.err = '42501'
     from t.exec(:ANA, $$insert into public.week_logs (person_id, week) values ('ben', '2026-01-19')$$) a,
          t.exec(:ANA, $$insert into public.week_logs (person_id, week) values ('ben', '2026-01-26')$$) b),
  'error for paid week differs from error for unpaid week');
select t.check('intern: same for entries',
  (select (a.err, a.msg) is not distinct from (b.err, b.msg) and a.err = '42501'
     from t.exec(:ANA, $$insert into public.week_entries (person_id, week, account_id, minutes) values ('ben', '2026-01-05', 'acc-ben-1', 1)$$) a,
          t.exec(:ANA, $$insert into public.week_entries (person_id, week, account_id, minutes) values ('ben', '2026-01-12', 'acc-ben-1', 1)$$) b),
  'error for paid week differs from error for unpaid week');

-- ---------- 3. PARTNER BOARD ("For <partner>") ----------
select t.hidden('intern: partner posts',                 :ANA, $$select * from public.posts where board = 'partner'$$);
select t.sees('intern: sees only the team post',         :ANA, 'select * from public.posts', 1);
select t.hidden('intern: partner name',                  :ANA, 'select * from public.admin_settings');
select t.hidden('intern: partner name via old column',   :ANA, 'select partner_name from public.settings');
select t.hidden('intern: partner screenshots',           :ANA, $$select * from storage.objects where name like 'partner/%'$$);
select t.blocked('intern: cannot post to partner board', :ANA, $$insert into public.posts (board, body) values ('partner', 'x')$$);
select t.blocked('intern: cannot post to team board',    :ANA, $$insert into public.posts (board, body) values ('team', 'x')$$);
select t.blocked('intern: cannot edit posts',            :ANA, $$update public.posts set body = 'x'$$);
select t.blocked('intern: cannot move a post between boards', :ANA, $$update public.posts set board = 'team' where board = 'partner'$$);
select t.blocked('intern: cannot delete posts',          :ANA, 'delete from public.posts');
select t.blocked('intern: cannot rename the partner',    :ANA, $$update public.admin_settings set partner_name = 'x'$$);
select t.blocked('intern: cannot upload into partner/',  :ANA, $$insert into storage.objects (bucket_id, name) values ('attachments', 'partner/x.png')$$);

-- ---------- 4. PEOPLE & ACCOUNTS ----------
select t.hidden('intern: login emails',                    :ANA, 'select * from public.member_emails');
select t.sees('intern: sees current teammates'' names only', :ANA, 'select * from public.people', 3);
select t.hidden('intern: removed people',                  :ANA, 'select * from public.people where archived');
select t.blocked('intern: cannot make self admin',         :ANA, $$update public.people set role = 'admin' where id = 'ana'$$);
select t.blocked('intern: cannot rename people',           :ANA, $$update public.people set name = 'x'$$);
select t.blocked('intern: cannot add a person',            :ANA, $$insert into public.people (id, name, role) values ('evil', 'Evil', 'admin')$$);
select t.blocked('intern: cannot remove a person',         :ANA, $$delete from public.people where id = 'ben'$$);
select t.blocked('intern: cannot add a login email',       :ANA, $$insert into public.member_emails (person_id, email) values ('boss', 'evil@test.example')$$);
select t.blocked('intern: cannot change a login email',    :ANA, $$update public.member_emails set email = 'evil@test.example'$$);
select t.blocked('intern: cannot delete login emails',     :ANA, 'delete from public.member_emails');
select t.blocked('intern: cannot flip sharing switches',   :ANA, 'update public.settings set share_logs = true, share_questions = true');
select t.blocked('intern: cannot add a settings row',      :ANA, 'insert into public.settings (id) values (1)');
select t.blocked('intern: cannot add accounts',            :ANA, $$insert into public.accounts (person_id, name) values ('ana', 'x')$$);
select t.blocked('intern: cannot take a teammate''s account', :ANA, $$update public.accounts set person_id = 'ana' where id = 'acc-ben-1'$$);
select t.blocked('intern: cannot rename own account',      :ANA, $$update public.accounts set name = 'x' where id = 'acc-ana-1'$$);
select t.blocked('intern: cannot delete accounts',         :ANA, 'delete from public.accounts');
select t.blocked('intern: cannot tick setup on a teammate''s account', :ANA, $$select public.set_setup('acc-ben-1', true)$$);
select t.allowed('intern: can tick setup on own account',  :ANA, $$select public.set_setup('acc-ana-1', true)$$);

-- ---------- 5. own data only by default; hours shared ----------
select t.sees('intern: own accounts only',       :ANA, 'select * from public.accounts', 2);
select t.sees('intern: own weekly logs only',    :ANA, 'select * from public.week_logs', 2);
select t.sees('intern: own entries only',        :ANA, 'select * from public.week_entries', 3);
select t.sees('intern: own questions only',      :ANA, 'select * from public.questions', 1);
select t.sees('intern: own + team screenshots only', :ANA, 'select * from storage.objects', 2);
select t.sees('intern: everyone''s weekly hour totals', :ANA, 'select * from public.team_hours()', 4);
select t.value('intern: teammate''s hours total is right', :ANA, $$select minutes::text from public.team_hours() where person_id = 'ben' and week = '2026-01-05'$$, '300');
select t.value('intern: hours carry no notes, only person/name/week/minutes', :ANA,
  $$select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(to_jsonb(x)) k from public.team_hours() x) _$$, 'minutes,name,person_id,week');

-- ---------- 6. an intern's own writes ----------
select t.allowed('intern: can edit own unpaid week',          :ANA, $$update public.week_logs set week_note = 'x' where person_id = 'ana' and week = '2026-01-12'$$);
select t.allowed('intern: can log time on own account',       :ANA, $$insert into public.week_entries (person_id, week, account_id, minutes) values ('ana', '2026-01-12', 'acc-ana-2', 5)$$);
select t.blocked('intern: cannot edit own PAID week',         :ANA, $$update public.week_logs set total_min = 9999, mode = 'total' where person_id = 'ana' and week = '2026-01-05'$$);
select t.blocked('intern: cannot delete own PAID week',       :ANA, $$delete from public.week_logs where person_id = 'ana' and week = '2026-01-05'$$);
select t.blocked('intern: cannot change entries of own PAID week', :ANA, $$update public.week_entries set minutes = 9999 where person_id = 'ana' and week = '2026-01-05'$$);
select t.blocked('intern: cannot add entries to own PAID week', :ANA, $$insert into public.week_entries (person_id, week, account_id, minutes) values ('ana', '2026-01-05', 'acc-ana-1', 9999) on conflict (person_id, week, account_id) do update set minutes = 9999$$);
select t.blocked('intern: cannot move an unpaid week onto a paid one', :ANA, $$update public.week_entries set week = '2026-01-05' where person_id = 'ana' and week = '2026-01-12'$$);
select t.blocked('intern: cannot edit a teammate''s log',     :ANA, $$update public.week_logs set week_note = 'x' where person_id = 'ben'$$);
select t.blocked('intern: cannot delete a teammate''s log',   :ANA, $$delete from public.week_logs where person_id = 'ben'$$);
select t.blocked('intern: cannot write a log as a teammate',  :ANA, $$insert into public.week_logs (person_id, week) values ('ben', '2026-02-02')$$);
select t.blocked('intern: cannot hand own log to a teammate', :ANA, $$update public.week_logs set person_id = 'ben' where person_id = 'ana' and week = '2026-01-12'$$);
select t.blocked('intern: cannot log time on a teammate''s account', :ANA, $$insert into public.week_entries (person_id, week, account_id, minutes) values ('ana', '2026-01-12', 'acc-ben-1', 5)$$);
select t.value('intern: cannot fake who saved a log or mark it imported', :ANA,
  $$with u as (update public.week_logs set updated_by = 'boss', imported = true, updated_at = '2000-01-01' where person_id = 'ana' and week = '2026-01-12' returning *)
    select updated_by || '/' || imported || '/' || (updated_at > '2020-01-01') from u$$, 'ana/false/true');
select t.blocked('intern: cannot ask a question as a teammate', :ANA, $$insert into public.questions (person_id, body) values ('ben', 'x')$$);
select t.value('intern: cannot answer own question', :ANA,
  $$with u as (insert into public.questions (person_id, body, answer, status, answered_at) values ('ana', 'q', 'self-answer', 'answered', now()) returning *)
    select coalesce(answer, 'none') || '/' || status from u$$, 'none/open');
select t.value('intern: cannot rewrite the admin''s answer', :BEN,
  $$with u as (update public.questions set answer = 'forged' where person_id = 'ben' returning *) select answer from u$$, 'ben answer');
select t.blocked('intern: cannot upload into team/',            :ANA, $$insert into storage.objects (bucket_id, name) values ('attachments', 'team/x.png')$$);
select t.blocked('intern: cannot upload into a teammate''s folder', :ANA, $$insert into storage.objects (bucket_id, name) values ('attachments', 'q/ben/x.png')$$);
select t.blocked('intern: cannot upload into another bucket',   :ANA, $$insert into storage.objects (bucket_id, name) values ('other-bucket', 'q/ana/x.png')$$);
select t.allowed('intern: can upload a screenshot for own question', :ANA, $$insert into storage.objects (bucket_id, name) values ('attachments', 'q/ana/x.png')$$);
select t.blocked('intern: cannot rename/move files',            :ANA, $$update storage.objects set name = 'q/ana/moved.png'$$);
select t.blocked('intern: cannot delete files',                 :ANA, 'delete from storage.objects');

-- ---------- 7. forged or odd login tokens ----------
select t.value('token claiming admin in its editable parts is still an intern', :FAKER, 'select public.is_admin()::text', 'false');
select t.hidden('...and still sees no payments',     :FAKER, 'select * from public.payments');
select t.hidden('...and no partner board',           :FAKER, $$select * from public.posts where board = 'partner'$$);
select t.hidden('...and no emails',                  :FAKER, 'select * from public.member_emails');
select t.no_secrets('...and nothing secret anywhere', :FAKER);
select t.no_secrets('token with no email gets nothing secret', :NOEMAIL);
select t.hidden('token with no email: people',       :NOEMAIL, 'select * from public.people');

-- ---------- 8. removed intern, stranger with an account, signed-out visitor ----------
select who.label, t.hidden(who.label || ': ' || q.what, who.id, q.sql)
  from (values ('removed intern', :OLD), ('signed-up stranger', :STRANGER), ('signed-out visitor', :ANON)) who(label, id),
       (values ('people', 'select * from public.people'), ('emails', 'select * from public.member_emails'),
               ('accounts', 'select * from public.accounts'), ('logs', 'select * from public.week_logs'),
               ('entries', 'select * from public.week_entries'), ('payments', 'select * from public.payments'),
               ('posts', 'select * from public.posts'), ('questions', 'select * from public.questions'),
               ('settings', 'select * from public.settings'), ('admin settings', 'select * from public.admin_settings'),
               ('hours', 'select * from public.team_hours()'), ('paid weeks', 'select * from public.my_paid_weeks()'),
               ('whoami', 'select * from public.whoami()'), ('files', 'select * from storage.objects')) q(what, sql);
select who.label, t.blocked(who.label || ': ' || q.what, who.id, q.sql)
  from (values ('removed intern', :OLD), ('signed-up stranger', :STRANGER), ('signed-out visitor', :ANON)) who(label, id),
       (values ('add self to team', $$insert into public.people (id, name, role) values ('evil', 'Evil', 'admin')$$),
               ('add own email', $$insert into public.member_emails (person_id, email) values ('boss', 'stranger@test.example')$$),
               ('write a log', $$insert into public.week_logs (person_id, week) values ('ana', '2026-03-02')$$),
               ('ask a question', $$insert into public.questions (person_id, body) values ('ana', 'x')$$),
               ('add a payment', $$insert into public.payments (person_id, weeks, amount) values ('ana', '{}', 1)$$),
               ('upload a file', $$insert into storage.objects (bucket_id, name) values ('attachments', 'q/ana/x.png')$$),
               ('change settings', 'update public.settings set share_logs = true'),
               ('delete logs', 'delete from public.week_logs')) q(what, sql);
select t.no_secrets('removed intern: nothing secret anywhere', :OLD);
select t.no_secrets('stranger: nothing secret anywhere', :STRANGER);
select t.no_secrets('signed-out visitor: nothing secret anywhere', :ANON);

-- ---------- 9. the big sweep, default switches ----------
-- Dump every row of every table and every callable function as the intern and
-- look for the secret markers (pay amount 91234.56, pay notes/labels, partner
-- name/posts/files, anyone's email).
select t.no_secrets('intern (default switches): nothing secret anywhere', :ANA);
select t.check('sanity: the sweep does find the secrets when run as admin', t.everything(:BOSS) ~ '91234' and t.everything(:BOSS) ~ 'PARTNERPOST-SENTINEL' and t.everything(:BOSS) ~ 'PARTNERNAME-SENTINEL' and t.everything(:BOSS) ~ 'PAYNOTE-SENTINEL');

-- ---------- 10. hours switch off ----------
update public.settings set share_hours = false;
select t.sees('hours switch off: intern sees own hours only', :ANA, 'select * from public.team_hours()', 2);
select t.hidden('hours switch off: no teammate hours', :ANA, $$select * from public.team_hours() where person_id <> 'ana'$$);

-- ---------- 11. EVERY sharing switch on ("everyone" mode) ----------
update public.settings set share_logs = true, share_hours = true, share_questions = true;
select t.sees('everyone mode: intern sees all accounts',  :ANA, 'select * from public.accounts', 3);
select t.sees('everyone mode: intern sees all logs',      :ANA, 'select * from public.week_logs', 4);
select t.sees('everyone mode: intern sees all questions', :ANA, 'select * from public.questions', 2);
select t.sees('everyone mode: all question screenshots, still no partner files', :ANA, 'select * from storage.objects', 3);
select t.blocked('everyone mode: still read-only on teammates'' logs',     :ANA, $$update public.week_logs set week_note = 'x' where person_id = 'ben'$$);
select t.blocked('everyone mode: still cannot edit teammates'' questions', :ANA, $$update public.questions set body = 'x' where person_id = 'ben'$$);
select t.blocked('everyone mode: still cannot delete teammates'' questions', :ANA, $$delete from public.questions where person_id = 'ben'$$);
select t.blocked('everyone mode: still cannot edit accounts',              :ANA, $$update public.accounts set name = 'x'$$);
select t.hidden('everyone mode: payments still hidden',      :ANA, 'select * from public.payments');
select t.hidden('everyone mode: partner board still hidden', :ANA, $$select * from public.posts where board = 'partner'$$);
select t.hidden('everyone mode: partner files still hidden', :ANA, $$select * from storage.objects where name like 'partner/%'$$);
select t.hidden('everyone mode: emails still hidden',        :ANA, 'select * from public.member_emails');
select t.hidden('everyone mode: partner name still hidden',  :ANA, 'select * from public.admin_settings');
select t.blocked('everyone mode: still cannot ask about teammates'' pay', :ANA, $$select public.week_is_paid('ben', '2026-01-05')$$);
select t.sees('everyone mode: paid weeks still own only',    :ANA, 'select * from public.my_paid_weeks()', 1);
select t.no_secrets('intern (every switch on): nothing secret anywhere', :ANA);
select t.no_secrets('stranger (every switch on): nothing secret anywhere', :STRANGER);
select t.no_secrets('signed-out visitor (every switch on): nothing secret anywhere', :ANON);
select t.hidden('everyone mode: stranger still sees no logs', :STRANGER, 'select * from public.week_logs');
update public.settings set share_logs = false, share_hours = true, share_questions = false;

-- ---------- 12. even a careless future change can't open the locked tables ----------
-- Simulate someone later adding an "allow everyone" rule by mistake.
create policy oops_pay    on public.payments       for select to authenticated using (true);
create policy oops_emails on public.member_emails  for select to authenticated using (true);
create policy oops_admin  on public.admin_settings for select to authenticated using (true);
create policy oops_posts  on public.posts          for select to authenticated using (true);
select t.hidden('second lock: payments stay hidden despite a bad rule',      :ANA, 'select * from public.payments');
select t.hidden('second lock: emails stay hidden despite a bad rule',        :ANA, 'select * from public.member_emails');
select t.hidden('second lock: partner name stays hidden despite a bad rule', :ANA, 'select * from public.admin_settings');
select t.hidden('second lock: partner posts stay hidden despite a bad rule', :ANA, $$select * from public.posts where board = 'partner'$$);
drop policy oops_pay on public.payments; drop policy oops_emails on public.member_emails;
drop policy oops_admin on public.admin_settings; drop policy oops_posts on public.posts;

-- ---------- 13. structure checks ----------
select t.check('every table has row security switched on',
  not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
               where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  (select string_agg(c.relname, ', ') from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity));
select t.check('signed-out visitors have no access to any table',
  not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
               where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select,insert,update,delete')));
-- our own functions (not ones that came with an extension)
create view t.fns as
  select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
select t.check('signed-out visitors can call no functions',
  not exists (select 1 from t.fns where has_function_privilege('anon', oid, 'execute')),
  (select string_agg(proname, ', ') from t.fns where has_function_privilege('anon', oid, 'execute')));
select t.check('signed-in users can call exactly the expected functions',
  (select string_agg(proname, ',' order by proname) from t.fns where has_function_privilege('authenticated', oid, 'execute'))
    = 'from_website,is_admin,is_member,jwt_email,my_paid_weeks,my_person,set_setup,share,team_hours,whoami',
  (select string_agg(proname, ',' order by proname) from t.fns where has_function_privilege('authenticated', oid, 'execute')));
select t.check('every elevated function pins its search path',
  not exists (select 1 from t.fns where prosecdef and not coalesce(proconfig::text, '') like '%search_path=%'));
select t.check('screenshot bucket is private, images only, size-capped',
  (select not public and file_size_limit is not null and allowed_mime_types is not null from storage.buckets where id = 'attachments'));

-- ---------- report ----------
\o
\pset tuples_only on
select count(*) || ' checks, ' || count(*) filter (where not ok) || ' failed' from t.results;
select 'FAILED  ' || name || '  (' || detail || ')' from t.results where not ok order by n;
select (count(*) filter (where not ok)) = 0 as all_ok from t.results \gset
\if :all_ok
\else
  do $$ begin raise exception 'security tests failed'; end $$;
\endif
