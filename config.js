// Supabase project values (Supabase dashboard > Project Settings > API Keys, the PUBLISHABLE key).
//
// These two values are meant to be public. They only identify the project; they grant
// nothing by themselves. What each signed-in person can see is decided by the database's
// security rules (supabase/schema.sql), which is why those rules are tested (tests/).
//
// NEVER put any of these in this file or anywhere in this repo:
//   - the "secret" / "service_role" key   (it bypasses every security rule)
//   - the database password
//   - real names, emails or pay data
window.TT_CONFIG = {
  SUPABASE_URL: "https://rhuqkmjkyquwitchefti.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_e096-KA12yyEe2ESxSTOYQ_DDYFtnWM",
  // Leave false. The admin creates each login in the Supabase dashboard (see SETUP.md), and
  // public sign-ups should also be switched off there. Set true only if you deliberately
  // re-enable self sign-up in Supabase.
  ALLOW_SIGNUP: false,
};
