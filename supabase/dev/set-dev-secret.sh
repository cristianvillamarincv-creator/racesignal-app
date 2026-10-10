#!/usr/bin/env bash
# Sets ONE secret on the racesignal-dev Supabase project, prompting for the value silently so it is
# never typed into a chat, a shell history line, or a file. Refuses to touch any other project.
#
#   supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY
set -euo pipefail
NAME="${1:-}"
case "$NAME" in
  ANTHROPIC_API_KEY|REVENUECAT_PUBLIC_API_KEY|REVENUECAT_SECRET_API_KEY|REVENUECAT_PROJECT_ID|SPORTSTATS_DAILY_REQUEST_CAP) ;;
  *) echo "usage: $0 ANTHROPIC_API_KEY|REVENUECAT_PUBLIC_API_KEY|REVENUECAT_SECRET_API_KEY|REVENUECAT_PROJECT_ID|SPORTSTATS_DAILY_REQUEST_CAP" >&2; exit 1 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEV_REF="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['development']['supabaseProjectRef'])" "$HERE/../../mobile/config/environments.json")"
printf 'Paste the value for %s (input hidden), then press Enter: ' "$NAME" >&2
read -r -s VALUE; echo >&2
[ -n "$VALUE" ] || { echo "empty value; aborting" >&2; exit 1; }
# The value goes to the CLI through a private temporary env file (mode 600, removed on exit), never as a command-line argument,
# so it does not appear in the process list.
umask 077
TMP="$(mktemp "${TMPDIR:-/tmp}/racesignal-dev-secret.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
printf '%s=%s\n' "$NAME" "$VALUE" > "$TMP"
unset VALUE
supabase secrets set --env-file "$TMP" --project-ref "$DEV_REF"
echo "Set $NAME on the development project ($DEV_REF)."
