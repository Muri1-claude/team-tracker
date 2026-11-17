# Security audit

Audited assuming an intern is actively trying to see pay data: reading the page code, using browser dev tools, editing requests, and calling the database API directly with their own login.

**Plain-English summary.** The site was already built the right way round (a public page, plus a database that decides who gets what). But the database rules allowed more than the requirements do, most importantly: an intern could read their own pay amounts, one switch could expose everyone's pay, and any intern could ask the database "was person X paid for week Y?". Those are fixed in the database and proven by tests.

## How it works (and why a public repo is OK)

1. **The website is just a display.** Everything in this repo, including the code for the admin pages, is readable by anyone on the internet. That is fine because it contains no data and no secrets.
2. **The address and "publishable key" in `config.js` are public on purpose.** They identify the Supabase project, like a street address. They do not open any doors.
3. **Each person signs in.** Supabase gives their browser a signed token that says which email they are. It cannot be forged or edited.
4. **The database checks every single request** against the rules in `supabase/schema.sql` ("Row Level Security"). It looks up the email on the team list, sees whether that person is the admin or an intern, and returns only the rows that person may have. An intern who skips the website and asks the database directly gets the same answer: nothing.

So the only things that must stay private are: your admin password, your Supabase and GitHub logins, and Supabase's **secret (service_role) key**, which is never needed by this site and must never be pasted anywhere.

## What was found

### Ways an intern could get pay data (all fixed)

| # | Problem | Fix |
|---|---|---|
| 1 | **Interns could read their own payment rows**: amount, hours paid, date, note. The requirement is that interns never access pay amounts. | `payments` is admin-only. Interns get only "this week of mine was paid on this date" through a narrow function (`my_paid_weeks`). The website no longer even requests payments for interns. |
| 2 | **A "share pay" switch** existed. One tap (or a mistake) exposed everyone's pay to every intern. | Switch and column removed. No setting can expose pay. |
| 3 | **`week_is_paid(person, week)` could be called by any signed-in user**, for any person. An intern could map out exactly which weeks each teammate was paid for. | No longer callable from the website. |
| 4 | **The "paid weeks are locked" rule leaked the same thing**: trying to write to a teammate's week gave a different error if that week was paid. | The lock only ever answers about the caller's own weeks. Tested: paid and unpaid give identical errors. |
| 5 | **The partner's name** was stored in the settings row that every intern can read. | Moved to an admin-only table. |
| 6 | **The Supabase library was loaded from a CDN with no integrity check.** If that CDN were compromised, its code would run inside your admin session and could read everything. | The library is now a file in this repo, and the page has a content security policy that blocks any other script. |
| 7 | **Data stayed in memory after sign-out.** On a shared device, some admin data was still in the page for the next person. | Sign-out and user switches wipe everything. |

### Other bugs (fixed)

| # | Problem | Fix |
|---|---|---|
| 8 | **Interns could not actually sign up.** Supabase's built-in email only delivers to members of your Supabase organization (and only 2 per hour), so confirmation emails to interns would never arrive. | New flow: you create each login in the Supabase dashboard with a temporary password; the intern changes it with the new **Password** button. Public sign-up is hidden and should be switched off (SETUP.md). |
| 9 | Interns could fake "last saved by" (e.g. make a log look saved by you), mark logs as imported, and backdate questions. | The database stamps these itself. |
| 10 | Rows loaded through the SQL editor had their answers wiped by the question guard, and could not be repaired there. | Guards now apply only to website users. |
| 11 | Questions were shared between interns by default, which contradicts "own data only by default". | Default is now off. **The upgrade switches it off once**; turn it back on under People & accounts if you want it. |
| 12 | Interns could see the names of people you had removed from the team. | Hidden. |
| 13 | Screenshot storage accepted any file type and size. | Images only, 10 MB each. |
| 14 | The README claimed the rules were tested, but no tests were in the repo. | `tests/` plus a GitHub Action. |
| 15 | No protection if someone later adds a sloppy database rule. | "Second lock" rules on payments, emails, partner posts and admin settings: they stay closed even if another rule opens them. Tested. |

### Checked and found OK

- **Git history**: all commits scanned. No passwords, secret keys, real emails, names or pay data. Only the public URL and publishable key.
- **Script injection**: the page never builds HTML from user text, so an intern cannot plant a script in a question or note that runs in your browser.
- **Becoming admin**: interns cannot edit the people list, emails, or settings. Extra claims an intern can put in their own profile are ignored (tested).
- **Removed interns** lose access immediately, even while still signed in.
- **Strangers who create an account** get nothing: they are not on the team list.

## Risks that code cannot fix (your part)

These are in the SETUP.md checklist. In order of importance:

1. **Your admin login is the key to everything.** Use a long password you use nowhere else. Anyone who gets it sees all pay data.
2. **Supabase settings.** "Allow new users to sign up" should be OFF and "Confirm email" ON. If sign-up is on and confirmation is off, someone could register an email you have added to the team but that has no login yet, and become that person.
3. **Who can change this repo.** Anyone with write access could change the site's code to quietly copy your data the next time you sign in. Never add interns as collaborators, and turn on two-factor login for GitHub and Supabase.
4. **Never invite interns to the Supabase project.** The dashboard bypasses every rule.
5. **The secret / service_role key** must never go in this repo, a chat, or an email.

## Accepted by design

- Interns see current teammates' names and (while the hours switch is on) weekly hour totals.
- An intern sees which of their own weeks are marked paid and the date. No amounts.
- With "Everyone's accounts and logs" on, interns can read each other's client account names and notes.
- The project URL and the table layout are public. The rules do not rely on these being hidden.

## Limits of this audit (honest notes)

- **The automated tests run against a local copy of the database rules, not your live Supabase project.** This environment could not reach it, so I could not see your live settings, whether the old rules are still active there, or whether "Confirm email" is on. Until you run the new `schema.sql`, the live database still has problems 1 to 5. The in-app **Security check** (`#selftest`) is how you confirm the live project.
- The local tests imitate Supabase's login and file-storage pieces with a small stand-in (`tests/supabase_shim.sql`). The table rules themselves are real Postgres and behave the same. The storage rules are the least directly tested part; the in-app check covers partner screenshots on the live project.
- Supabase's dashboard changes often. Menu names in SETUP.md are from memory and may have moved slightly.
