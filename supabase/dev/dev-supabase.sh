#!/usr/bin/env bash
# Runs Supabase CLI backend operations against the racesignal-dev project ONLY.
#
# The repo's own supabase/.temp link points at PRODUCTION, so a bare `supabase db push` or
# `supabase functions deploy` run from supabase/ would change production. This wrapper never touches that
# link: it copies config/migrations/functions into a throwaway workspace, links THAT to the dev ref (read
# from mobile/config/environments.json), refuses to continue if the dev ref is not what ended up linked or
# if it equals the repo's production link, and passes the dev ref explicitly to every command.
#
#   supabase/dev/dev-supabase.sh status                     # remote migration + function state of dev
#   supabase/dev/dev-supabase.sh push [--dry-run]           # apply supabase/migrations to dev
#   supabase/dev/dev-supabase.sh deploy [fn ...]            # deploy functions (default: all three) to dev
#   supabase/dev/dev-supabase.sh secrets                    # list dev secret NAMES (digests, no values)
# Secrets are set with supabase/dev/set-dev-secret.sh (silent prompt).
#
# Needs the dev database password in ~/.racesignal-dev/dev-db-password (mode 600) for `push`/`status`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEV_REF="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['development']['supabaseProjectRef'])" "$REPO/mobile/config/environments.json")"
PROD_REF="$(cat "$REPO/supabase/.temp/project-ref" 2>/dev/null || true)"
PW_FILE="$HOME/.racesignal-dev/dev-db-password"

[ -n "$DEV_REF" ] || { echo "could not read the dev project ref" >&2; exit 1; }
CMD="${1:-}"; shift || true
case "$CMD" in status|push|deploy|secrets) ;; *) sed -n '2,15p' "$0" >&2; exit 1 ;; esac

WS="$(mktemp -d "${TMPDIR:-/tmp}/racesignal-dev-ws.XXXXXX")"
case "$WS" in /*/racesignal-dev-ws.*) ;; *) echo "unexpected workspace path" >&2; exit 1 ;; esac
trap 'rm -rf "$WS"' EXIT
mkdir "$WS/supabase"
cp -R "$REPO/supabase/config.toml" "$REPO/supabase/migrations" "$REPO/supabase/functions" "$WS/supabase/"

sb() { supabase --workdir "$WS" "$@"; }

if [ "$CMD" != "secrets" ] && [ "$CMD" != "deploy" ]; then
  [ -r "$PW_FILE" ] || { echo "missing $PW_FILE (dev database password)" >&2; exit 1; }
  sb link --project-ref "$DEV_REF" --password "$(cat "$PW_FILE")" >/dev/null
else
  sb link --project-ref "$DEV_REF" >/dev/null 2>&1 || true
fi
LINKED="$(cat "$WS/supabase/.temp/project-ref" 2>/dev/null || true)"
if [ "$LINKED" != "$DEV_REF" ] || { [ -n "$PROD_REF" ] && [ "$LINKED" = "$PROD_REF" ]; }; then
  echo "refusing: workspace is linked to '$LINKED', expected the dev project '$DEV_REF'" >&2; exit 1
fi
echo "[dev-supabase] target: development project $DEV_REF (production $PROD_REF is not touched)" >&2

case "$CMD" in
  status)
    sb migration list --linked -p "$(cat "$PW_FILE")"
    sb functions list --project-ref "$DEV_REF" ;;
  push)
    sb db push --linked -p "$(cat "$PW_FILE")" "$@" ;;
  deploy)
    FUNCS=("$@"); [ ${#FUNCS[@]} -gt 0 ] || FUNCS=(race-discovery signal delete-account)
    for fn in "${FUNCS[@]}"; do
      case "$fn" in race-discovery|signal|delete-account) ;; *) echo "unknown function $fn" >&2; exit 1 ;; esac
      sb functions deploy "$fn" --project-ref "$DEV_REF" --use-api
    done ;;
  secrets)
    sb secrets list --project-ref "$DEV_REF" ;;
esac
