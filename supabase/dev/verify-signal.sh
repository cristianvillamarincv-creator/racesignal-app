#!/usr/bin/env bash
# Verifies, against the racesignal-dev project ONLY, that Signal answers and that quota accounting is right,
# using the synthetic dev account. Run it after `supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY`.
#
#   supabase/dev/verify-signal.sh
#
# It sends ONE real Signal request (costs a few cents of the dev Anthropic key), then a duplicate of the SAME
# requestId (must be served from the dedup cache: no model call, no extra ask consumed). It checks the free
# lifetime counter (signal_free_usage) moved by exactly 1 and the usage log gained exactly 1 row.
# Never prints keys, passwords, or tokens. Resets the dev account's free counter first, so it is repeatable.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEV_REF="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['development']['supabaseProjectRef'])" "$HERE/../../mobile/config/environments.json")"
B="https://$DEV_REF.supabase.co"
PWF="$HOME/.racesignal-dev/dev-account-password"
[ -r "$PWF" ] || { echo "missing $PWF (run supabase/dev/seed-dev.mjs first)" >&2; exit 1; }

SR="$(supabase projects api-keys --project-ref "$DEV_REF" -o json 2>/dev/null | python3 -c "
import json,sys; t=sys.stdin.read(); d=json.JSONDecoder().raw_decode(t[t.find('['):])[0]
print(next(k['api_key'] for k in d if k['name']=='service_role'))")"
ANON="$(supabase projects api-keys --project-ref "$DEV_REF" -o json 2>/dev/null | python3 -c "
import json,sys; t=sys.stdin.read(); d=json.JSONDecoder().raw_decode(t[t.find('['):])[0]
print(next(k['api_key'] for k in d if k['name']=='anon'))")"
EMAIL="dev.athlete@example.com"
rest() { curl -s "$B/rest/v1/$1" -H "apikey: $SR" -H "Authorization: Bearer $SR" "${@:2}"; }
TOK="$(curl -s -X POST "$B/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$(cat "$PWF")\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")"
[ -n "$TOK" ] || { echo "FAIL: dev account sign-in" >&2; exit 1; }
UID_="$(rest "athlete_profiles?select=id&limit=1" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")"

# Clean slate: free counter 0, no dedup rows for this account (service-role, dev project only).
rest "signal_free_usage?athlete_id=eq.$UID_" -X DELETE -o /dev/null
rest "signal_request_dedup?athlete_id=eq.$UID_" -X DELETE -o /dev/null
count() { rest "signal_free_usage?athlete_id=eq.$UID_&select=lifetime_count" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r[0]['lifetime_count'] if r else 0)"; }
logs()  { rest "signal_usage_log?athlete_id=eq.$UID_&select=id" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"; }
C0=$(count); L0=$(logs)

RID="verify-$(date +%s)-$RANDOM"
BODY="{\"message\":\"In one short sentence, what races do I have coming up?\",\"history\":[],\"requestId\":\"$RID\",\"context\":{\"sameSportDetailed\":[],\"otherSportsCompact\":[],\"bestPerDistance\":[],\"upcoming\":[{\"name\":\"Synthetic Upcoming IRONMAN\",\"sport\":\"triathlon\",\"distanceLabel\":\"IRONMAN\",\"eventDate\":\"2026-12-16\",\"location\":\"Synthetic City\"}]}}"
ask() { curl -s -X POST "$B/functions/v1/signal" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$BODY"; }
summ() { python3 -c "
import json,sys; r=json.load(sys.stdin)
if r.get('available'):
    d=r['data']; print('available=true remaining=%s cap=%s isPremium=%s replyChars=%d' % (d.get('remaining'),d.get('cap'),d.get('isPremium'),len(d.get('reply',''))))
else: print('available=false reason=%s' % r.get('reason'))"; }

R1="$(ask)"; echo "1st request : $(echo "$R1" | summ)"
C1=$(count); L1=$(logs)
R2="$(ask)"; echo "same request: $(echo "$R2" | summ)  (duplicate requestId)"
C2=$(count); L2=$(logs)

echo "free counter: $C0 -> $C1 after 1st -> $C2 after duplicate"
echo "usage log rows: $L0 -> $L1 -> $L2"
ok=1
echo "$R1" | grep -q '"available":true' || { echo "FAIL: first request did not succeed"; ok=0; }
[ "$C1" = "$((C0+1))" ] || { echo "FAIL: free counter should have moved by exactly 1"; ok=0; }
[ "$C2" = "$C1" ] || { echo "FAIL: duplicate requestId consumed an extra ask"; ok=0; }
[ "$L1" = "$((L0+1))" ] && [ "$L2" = "$L1" ] || { echo "FAIL: usage log should gain exactly one row"; ok=0; }
[ "$ok" = 1 ] && echo "PASS: Signal works on dev and quota accounting is exact (free cap 3 lifetime, duplicate not double-counted)."
# leave the dev account usable for the next test
rest "signal_free_usage?athlete_id=eq.$UID_" -X DELETE -o /dev/null
[ "$ok" = 1 ]
