# Team Account Tracker

A login-protected website for a small bookkeeping team. It covers weekly production logs, initial rule setup, time per account (or one weekly total), hours and pay, a team board, a private partner board, and questions for the admin.

- **Frontend:** plain HTML/JS in this repo, hosted on GitHub Pages.
- **Login + database:** Supabase (free tier). It handles email/password sign-in, the Postgres database and private screenshot storage.
- **Security:** enforced by the database's Row Level Security rules in `supabase/schema.sql`, not by the website. The rules were tested against 60 cases (strangers, interns, admin, every sharing toggle) before launch.

## Who sees what

| | Admin | Intern | Signed up but not on the team | Not signed in |
|---|---|---|---|---|
| Own accounts, weekly log, setup ticks | ✅ all | ✅ own only | ❌ | ❌ |
| Other interns' accounts and logs | ✅ | only if **share_logs** is on (read only) | ❌ | ❌ |
| Weekly hour totals for everyone | ✅ | ✅ by default (**share_hours**) | ❌ | ❌ |
| Payments | ✅ all, edit | own only, unless **share_pay** is on | ❌ | ❌ |
| For the team board | ✅ post/edit | read only | ❌ | ❌ |
| Partner board | ✅ | ❌ never | ❌ | ❌ |
| People & accounts, emails, settings | ✅ | ❌ never | ❌ | ❌ |
| Questions for the admin | ✅ answer all | ask; see own, plus others' if **share_questions** is on (default on) | ❌ | ❌ |

Toggles live under **People & accounts → What interns can see**.


## Setup
The owner has the step-by-step setup instructions. In short: create a Supabase project, run `supabase/schema.sql`, load the starter data, put the project URL and publishable key in `config.js`, turn on GitHub Pages, and keep **Confirm email** on in Supabase Auth.

Never put the Supabase **service_role** key or the database password in this repo.
