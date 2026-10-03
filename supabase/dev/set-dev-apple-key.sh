#!/usr/bin/env bash
# Sets the four Sign in with Apple secrets the DEV delete-account function needs to revoke an athlete's Apple
# tokens when they delete their account. Dev project only. The .p8 key is read from a file path you type (a path
# is not a secret); its contents are never printed, stored in the repo, or put in shell history.
#
#   supabase/dev/set-dev-apple-key.sh
#
# Apple Developer -> Certificates, Identifiers & Profiles -> Keys -> "+" -> enable "Sign in with Apple" ->
# Configure (primary App ID = the dev App ID) -> Register -> download the .p8 ONCE. The Key ID is shown on that page.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
read -r DEV_REF CLIENT_ID <<<"$(python3 -c "import json,sys; d=json.load(open(sys.argv[1]))['development']; print(d['supabaseProjectRef'], d['bundleIdentifier'])" "$HERE/../../mobile/config/environments.json")"
TEAM_ID="${APPLE_TEAM_ID:-39CY6VPY8Q}"
printf 'Key ID shown next to the key in the Apple portal (10 characters): ' >&2
read -r KEY_ID
printf 'Path to the downloaded AuthKey_XXXXXXXXXX.p8 file: ' >&2
read -r P8_PATH
P8_PATH="${P8_PATH/#\~/$HOME}"
[ -r "$P8_PATH" ] || { echo "cannot read $P8_PATH" >&2; exit 1; }
[ "${#KEY_ID}" -eq 10 ] || { echo "the Key ID should be 10 characters" >&2; exit 1; }
grep -q "BEGIN PRIVATE KEY" "$P8_PATH" || { echo "that does not look like a .p8 private key" >&2; exit 1; }

ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/apple-secrets.XXXXXX")"
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
P8_PATH="$P8_PATH" TEAM_ID="$TEAM_ID" KEY_ID="$KEY_ID" CLIENT_ID="$CLIENT_ID" python3 - >"$ENV_FILE" <<'PY'
import os
pem = open(os.environ["P8_PATH"]).read().strip().replace("\n", "\\n")
print(f'APPLE_TEAM_ID="{os.environ["TEAM_ID"]}"')
print(f'APPLE_KEY_ID="{os.environ["KEY_ID"]}"')
print(f'APPLE_CLIENT_ID="{os.environ["CLIENT_ID"]}"')
print(f'APPLE_PRIVATE_KEY="{pem}"')
PY
supabase secrets set --env-file "$ENV_FILE" --project-ref "$DEV_REF"
echo "Set the four APPLE_* secrets on the development project ($DEV_REF) for client ID $CLIENT_ID." >&2
