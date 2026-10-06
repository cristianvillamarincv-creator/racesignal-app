# Future ideas (not approved scope)

Nice-to-haves recorded at the 2026-10-06 checkpoint. None is scheduled, designed or approved for 1.1.

## Add an upcoming race from a screenshot or race-wallet pass
Let an athlete add an upcoming race from a registration screenshot or a race-wallet pass, with QR support if the QR carries useful information. Extract the details and show them for the athlete to review and edit before saving; nothing is saved automatically. Open questions: what registration confirmations and wallet passes actually contain, whether a QR payload is ever more than an opaque ticket id, extraction accuracy, and the privacy cost of sending images off the device.

## Explore next-season races through Signal
Let an athlete ask Signal about next-season races and save the ones they are interested in (for example as "considering"). This is an idea, not an approved implementation scope. It would need a source of event data (see below), a rule for what Signal may claim about events it cannot verify, and a decision on how saved interests relate to the existing race statuses.

## Find a race: deferred
The planned flow (search by name or city, pick an event and distance, review, Add race, with "Can't find your race? Add manually") is deferred. The existing manual upcoming-race flow, including distance entry, stays as it is. No catalogue, provider integration or outreach has been started.

What the source evaluation found (research only, 2026-10-06):
- **RunSignup API:** free and instant registration (required from 2027-01-01), good US coverage including local triathlons with distances. Thin for Canada (about ten upcoming races in the whole country when tested, no triathlons) and it lists IRONMAN events only as third-party bike-rental or vendor entries. Its developer contract has open questions to confirm with RunSignup before use: a 30-day deletion duty after termination (against permanent storage of an athlete-selected event), a "competes directly or indirectly" clause, a provider event id kept for duplicate prevention, athlete edits, and possible future fees.
- **ACTIVE Activity Search API:** ruled out. Its terms require session-only storage with deletion within 24 hours, disallow edits, and allow free non-commercial apps only.
- **Sportstats (the existing provider):** has upcoming-event pages with date, location and distances for IRONMAN and major Canadian races, but no documented API, search or terms; the current integration has no agreement documented.
- **ahotu and other directories:** no published API, access requirements or pricing found; any feed would be a negotiated licence (price unknown). Race Roster's API is for organizers only; IRONMAN has no public API.
- **Bounded curated catalogue (fallback):** about 250 to 350 hand-entered marquee events in Canada and the US (IRONMAN and 70.3, Canada Running Series and large Canadian races, major marathons, major triathlon series) from organizers' official pages, refreshed once a season. The terms of the source sites (including ironman.com, which could not be fetched) have not been read.
- **Honest gap:** Canadian local running and triathlon outside the marquee events have no tested source with usable rights; manual entry covers them.
