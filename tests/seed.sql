-- Fake data for the tests. Nothing here is real. Values containing SENTINEL
-- (and the amount 91234.56) are secrets that must never reach an intern.
insert into public.people (id, name, role, sort, archived) values
  ('boss', 'Boss',  'admin',  0, false),
  ('ana',  'Ana',   'intern', 1, false),
  ('ben',  'Ben',   'intern', 2, false),
  ('old',  'Oldie', 'intern', 3, true);
insert into public.member_emails (person_id, email) values
  ('boss', 'boss-sentinel@test.example'),
  ('ana',  'ana-sentinel@test.example'),
  ('ben',  'ben-sentinel@test.example'),
  ('old',  'old-sentinel@test.example');
insert into public.accounts (id, person_id, name) values
  ('acc-ana-1', 'ana', 'Brand A - Ana One'),
  ('acc-ana-2', 'ana', 'Brand A - Ana Two'),
  ('acc-ben-1', 'ben', 'Brand B - Ben One');
-- 2026-01-05 and 2026-01-12 are Mondays. Week 1 is paid for both, week 2 is not.
insert into public.week_logs (person_id, week, mode, total_min, week_note) values
  ('ana', '2026-01-05', 'perAccount', null, 'ana note w1'),
  ('ana', '2026-01-12', 'perAccount', null, 'ana note w2'),
  ('ben', '2026-01-05', 'total',      300,  'ben note w1'),
  ('ben', '2026-01-12', 'total',      120,  'ben note w2');
insert into public.week_entries (person_id, week, account_id, minutes, note) values
  ('ana', '2026-01-05', 'acc-ana-1', 60, 'e1'),
  ('ana', '2026-01-05', 'acc-ana-2', 30, 'e2'),
  ('ana', '2026-01-12', 'acc-ana-1', 45, 'e3');
insert into public.payments (person_id, weeks, label, amount, minutes, paid_on, note) values
  ('ana', '{2026-01-05}', 'PAYLABEL-SENTINEL ana', 91234.56, 90,  '2026-01-20', 'PAYNOTE-SENTINEL ana'),
  ('ben', '{2026-01-05,2026-01-19}', 'PAYLABEL-SENTINEL ben', 91234.56, 300, '2026-01-21', 'PAYNOTE-SENTINEL ben');
insert into public.posts (board, title, body, img_path) values
  ('team',    'Team post', 'hello team', 'team/t.png'),
  ('partner', 'PARTNERPOST-SENTINEL title', 'PARTNERPOST-SENTINEL body', 'partner/p.png');
-- (the first schema version wiped answers on rows loaded from the SQL editor; skip that here)
alter table public.questions disable trigger guard_question;
insert into public.questions (person_id, body, status, answer, img_path) values
  ('ana', 'ana question', 'open', null, 'q/ana/a.png'),
  ('ben', 'ben question', 'answered', 'ben answer', 'q/ben/b.png');
alter table public.questions enable trigger guard_question;
insert into storage.objects (bucket_id, name) values
  ('attachments', 'team/t.png'),
  ('attachments', 'partner/PARTNERFILE-SENTINEL.png'),
  ('attachments', 'q/ana/a.png'),
  ('attachments', 'q/ben/b.png'),
  ('other-bucket', 'x/OTHERBUCKET-SENTINEL.png');
update public.settings set team_name = 'Test Team', admin_name = 'Boss';
