# Owner's checklist

Everything here is free. Do the steps in order. Do not enter real pay data until step 5 passes.

Menu names are from memory of the Supabase dashboard and may have moved a little. If you can't find one, search the dashboard for the quoted words.

## 1. Lock down your own accounts (5 min)

- [ ] **GitHub**: turn on two-factor authentication (Settings > Password and authentication).
- [ ] **GitHub repo**: Settings > Collaborators. Make sure no intern is listed. Never add one.
- [ ] **Supabase**: turn on two-factor (Account > Security), and never invite interns to the project or organization.
- [ ] Never copy the Supabase **secret / service_role key** or database password anywhere. This site does not need them.

## 2. Update the database rules (2 min)

- [ ] Open `supabase/schema.sql` in this branch on GitHub, tap **Raw**, select all, copy.
- [ ] Supabase > **SQL Editor** > New query > paste > **Run**. It should say "Success".
  - Safe to run more than once. It keeps all existing logs, payments, posts and questions.
  - It removes the "share pay" switch, hides pay from interns, and switches "Everyone's questions" off once.

Do this **before** step 3. Until this is run, interns can still read their own pay rows directly from the database.

## 3. Publish the new site code

- [ ] Merge the branch `claude/zen-albattani-22kkod` into `main` (or whichever branch GitHub Pages publishes; see repo Settings > Pages). Ask Claude to open the pull request if you want.
- [ ] Wait a minute or two, then reload the site. You should see a **Password** button next to Sign out.
- [ ] GitHub > Actions tab: the "Security tests" run should have a green tick.

## 4. Supabase login settings (5 min)

Supabase > **Authentication**:

- [ ] **Sign In / Providers**: turn **OFF** "Allow new users to sign up". (You will create logins yourself.)
- [ ] **Sign In / Providers > Email**: "Confirm email" **ON**. Set minimum password length to **10** if offered.
- [ ] Leave every other provider (Google, phone, anonymous) **off**.
- [ ] **URL Configuration**: Site URL = your GitHub Pages address (the exact address of the tracker). This makes password-reset links for you land in the right place.
- [ ] Make sure **your own** admin login exists and you can sign in to the site. If you never created one: Authentication > Users > Add user > Create new user, your email, a long unique password, tick "Auto Confirm User". Your email must match the one on your admin row in People & accounts.
- [ ] Sign in to the site as yourself and check **People & accounts > What interns can see**. Default: hours on, logs off, questions off.

## 5. Test with a fake intern (10 min), BEFORE real pay data

Set up something to hide:

- [ ] On the site as admin: People & accounts > add "Test Intern" with an email (it does not need to be a real inbox, e.g. `test.intern@example.com`), and add one account for them.
- [ ] Supabase > Authentication > Users > **Add user > Create new user**: same email, a temporary password, tick **Auto Confirm User**.
- [ ] As admin, in Weekly log pick Test Intern and enter some minutes. In Hours & pay, tick that week and record a **made-up $1 payment**.
- [ ] Post one made-up note on the partner board ("For ...").
- [ ] Open the site with `#selftest` on the end of the address. As admin it shows how many payments, partner posts and emails exist. All three should be above 0.

Now be the intern:

- [ ] Open a **private / incognito** window (or sign out), sign in as the test intern.
- [ ] You should see only: Weekly log, Hours, For the team, Questions. No partner tab, no People & accounts, no dollar amounts anywhere. In Hours, the test week shows "Paid" with a date and nothing else.
- [ ] Add `#selftest` to the address and tap **Run the check**. Every row must say **Pass** on a green banner.
  - If anything says FAILED: stop, do not enter real data, re-run step 2, and test again.
- [ ] Tap **Password** and change the temporary password, to see what interns will do.

Clean up:

- [ ] As admin: delete the fake payment and the partner test post. People & accounts > Test Intern > Remove from team.
- [ ] Supabase > Authentication > Users > delete the test user.

## 6. Add real interns

For each intern:

- [ ] Site > People & accounts > **Add a team member**: name + their email. Add their accounts.
- [ ] Supabase > Authentication > Users > **Add user > Create new user**: the **same email**, a temporary password, tick **Auto Confirm User**.
- [ ] Send them the site address and the temporary password (a text or call is better than email). Tell them to tap **Password** and set their own (the site nags until they do).

Day to day:

- **Intern forgot their password**: Supabase > Authentication > Users > delete that user, then Add user again with a new temporary password. Their logs are tied to the team list, not the login, so nothing is lost.
- **Intern leaves**: People & accounts > Remove from team (access ends immediately), then delete their user in Supabase.
- **Let interns see each other's work**: People & accounts > "Everyone's accounts and logs". Pay, the partner board and this page stay hidden regardless.
- **You forgot your own password**: "Forgot password" on the sign-in page. Supabase's free email only delivers to the project owner's address, which is you.

## Good to know about the free tier

- Supabase pauses free projects after about a week with no activity. If the site suddenly can't load data, open the Supabase dashboard and press Restore. (From memory; check Supabase's current pricing page.)
- The free tier has no automatic backups as far as I know. Once a month: Supabase > Table Editor > each table > Export to CSV, and keep the files somewhere private (not in this repo).
- GitHub Pages, GitHub Actions for public repos, and Supabase's free plan cost nothing. Nothing here needs a card.

## Assumptions made while you were away

1. **"Never access pay amounts" includes an intern's own.** Interns see only whether each of their own weeks is marked paid and the date. If you want interns to see their own amounts, say so; it is a small change.
2. **"Everyone's questions" was switched off by the upgrade** to match "own data only by default".
3. **Hours stay shared by default**, with a switch to turn that off.
4. **No public sign-up.** You create logins. This also works around Supabase's free email not delivering to interns.
5. The existing Supabase project and GitHub Pages hosting are kept. No new services.
