#!/usr/bin/env bash
# Runs the security tests against a throwaway local Postgres database.
# Nothing here touches the real Supabase project.
#
#   tests/run.sh            uses the Postgres that PG* env vars point at
#                           (PGHOST, PGPORT, PGUSER, PGPASSWORD), as a superuser
#
# Two scenarios are tested, and both must pass every check:
#   fresh    a brand-new database gets schema.sql (run twice, to prove re-running is safe)
#   upgrade  a database on the FIRST version of the schema, with pay sharing
#            switched ON (the worst case), is upgraded by running schema.sql
set -euo pipefail
cd "$(dirname "$0")/.."
export PGUSER="${PGUSER:-postgres}" PGDATABASE=postgres PGOPTIONS="-c client_min_messages=warning"
q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
status=0
for scenario in fresh upgrade; do
  db="tt_test_${scenario}"
  q -c "drop database if exists ${db}" -c "create database ${db}"
  q -d "$db" -f tests/supabase_shim.sql
  if [ "$scenario" = fresh ]; then
    q -d "$db" -f supabase/schema.sql
    q -d "$db" -f supabase/schema.sql
    q -d "$db" -f tests/seed.sql
    q -d "$db" -c "update public.admin_settings set partner_name = 'PARTNERNAME-SENTINEL'"
  else
    q -d "$db" -f tests/fixtures/schema_v1.sql
    q -d "$db" -f tests/seed.sql
    q -d "$db" -c "update public.settings set partner_name = 'PARTNERNAME-SENTINEL', share_pay = true, share_questions = true"
    q -d "$db" -f supabase/schema.sql
    q -d "$db" -f supabase/schema.sql
  fi
  echo "=== scenario: ${scenario} ==="
  if ! q -d "$db" -v scenario="$scenario" -f tests/security_test.sql; then status=1; fi
  q -c "drop database if exists ${db}"
done
if [ "$status" = 0 ]; then echo "ALL SECURITY TESTS PASSED"; else echo "SECURITY TESTS FAILED"; fi
exit "$status"
