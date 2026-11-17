# Team Account Tracker

A login-protected website for a small bookkeeping team: weekly production logs, initial rule setup, time per account, hours, payments (admin only), a team board, a private partner board (admin only), and questions for the admin.

- **Website:** plain HTML/JS in this repo, hosted free on GitHub Pages. The repo and the page code are public, so **nothing secret lives here**.
- **Login + database + screenshots:** Supabase (free tier).
- **Security:** enforced by the database (Row Level Security rules in `supabase/schema.sql`), not by the website. Hiding a tab is only for tidiness; the database refuses the data.

| Read this | For |
|---|---|
| [SETUP.md](SETUP.md) | The owner's checklist: what to click, how to add interns, how to test with a fake intern |
| [SECURITY.md](SECURITY.md) | The audit: what was wrong, what was fixed, what risks remain |

## Who sees what

| | Admin | Intern | Signed in but not on the team | Not signed in |
|---|---|---|---|---|
| Own accounts, weekly log, setup ticks | all | own only | no | no |
| Other interns' accounts and logs | yes | only if **share_logs** is on (read only) | no | no |
| Weekly hour totals for everyone | yes | yes by default (**share_hours**) | no | no |
| Whether a week is marked paid (date only) | all | own weeks only | no | no |
| **Pay amounts, payment history, notes** | yes | **never** | no | no |
| For the team board | post/edit | read only | no | no |
| **Partner board, its screenshots, the partner's name** | yes | **never** | no | no |
| **People & accounts, login emails, settings** | yes | **never** | no | no |
| Questions for the admin | answer all | ask; see own, plus others' if **share_questions** is on | no | no |

The three switches live under **People & accounts > What interns can see**. There is no switch for the "never" rows.

## Tests

```bash
tests/run.sh
```

Needs a local Postgres (any superuser via the usual `PGHOST` / `PGUSER` / `PGPASSWORD` variables). It builds a throwaway database with made-up data, then runs about 190 checks as the admin, an intern, a removed intern, a signed-up stranger and a signed-out visitor, calling the database directly the way dev tools would. It covers a fresh install and an upgrade from the first version of the schema. GitHub runs the same tests on every push (Actions tab).

The tests never touch the real Supabase project. To check the real one, sign in as a test intern and open `#selftest` (see SETUP.md).

## Rules for this repo

Never commit the Supabase **secret / service_role** key, the database password, real names, real emails or pay data. `config.js` holds only the project URL and the publishable key, which are designed to be public.
