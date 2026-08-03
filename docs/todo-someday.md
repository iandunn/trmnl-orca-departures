# TODO — someday

Companion to [`TODO.md`](TODO.md), which is the active queue. This holds work that is real but is not going to be started soon, plus ideas that are deliberately not being built and things that misbehaved once and cannot be pinned down yet.

Nothing here is a commitment. An item earns its way back into `TODO.md` when something makes it worth doing; the traffic is not expected to run the other way.

## Blocked on state the Worker does not have

These two are one knot. From either end it looks like a side quest, which is why neither has been decided.

### Pick the durable store — one decision, six consumers

- [ ] There is no KV, D1 or Durable Object binding yet, and all of these want one.

	1. **The recovery generation** — perturb `filename` after any error even when the bytes are identical, or a firmware error screen sticks to the glass indefinitely.
	2. Alert state transitions.
	3. Device "last seen".
	4. The `schedule-for-stop` prefetch, held across the overnight sleep.
	5. Stop identity, so a failed stop's band is not bare on a cold isolate.
	6. Tap-to-swap direction state, if it is ever built.

	Writes are transition-only, so quota is not the constraint — the reasoning that ruled KV out for `/stats` was about per-request writes and does not apply. **The read path is the constraint:** `/api/display` reads it ~1440x/day and must never fail, so decide explicitly that a read error proceeds with generation 0 and still serves a valid response.

	Of the six, only #1 is a correctness bug rather than a feature: without it a firmware-drawn error screen survives the server recovering, because the device's repaint gate matches the last good `filename` and returns before touching the panel.


### Sweep the failure modes, guard them, log them, alert on them

Nothing currently tells us the sign is wrong: the panel holds its last image, the device cannot be prodded, and Cloudflare has **no Workers alert types at all** (verified 2026-08-01), so alerting has to be built rather than configured.

**Only the alerting bullet actually needs the durable store.** The first three need no storage and could be done today — they are here because the section moved as a whole, not because they are blocked. Pull them back into `TODO.md` if the sweep becomes the next thing.

- [ ] **Inventory every failure mode**, both directions, marking honestly which are invisible to us — that set is the argument for the rest. `CLAUDE.md`'s "Five ways stale data reaches the glass" is a start but covers only staleness.

- [ ] **Guard each detectable one** with a degraded screen that reads across the room, tagged in `FILENAME_TAGS` so the device's cache cannot suppress it. Nothing may throw out of `/api/display`.

- [ ] **Log each one in a single structured shape** — mode, stop hash, upstream status, duration. Always `redactPath()`. `recordOutcome()` fires **exactly once per authorized request**: the gate deliberately does not log authenticated ones, because which board was served is not knowable there, and adding a placeholder would double-count every poll the sign ever makes.

- [ ] **Alert on state transitions only.** At ~1440 polls a day, one alert per failed poll is 1440 messages for a single outage. Needs the durable store above.

	- *Worker up, something wrong* — fire-and-forget `fetch()` inside `ctx.waitUntil()`. ntfy.sh or a Discord webhook are free; Pushover is ~$5 once and the most reliable phone push. Cloudflare's `send_email` binding needs Email Routing on a real domain, so on `workers.dev` it is the *highest*-friction option, not the lowest.
	- *Worker down* — a Cron Trigger pinging healthchecks.io. Beats an external uptime monitor, which would need either the secret or a new unauthenticated health path, and this also catches "deployed but broken" since the ping only fires if our code ran.
	- *Device silent* — the same cron against a "last seen" timestamp. **It has to know the sleep schedule**, or it pages every night at 2am.
	- Never put a raw path in an alert body. The token is a path segment.


## Tomorrow's first departures — removed 2026-08-02, notes kept

A group whose last bus has gone says `No more departures today` and nothing else. It used to list tomorrow's first two departures under that sentence, drawn from placeholder times in `dev/edge-case-boards.js`, because nothing ever produced real ones. **The rendering was deleted rather than left in place** — a code path only reachable from a hand-written fixture is not a feature, it is a thing that looks finished at `/_preview` and is not.

The design thinking is worth more than the code was, so it is here rather than only in git:

- **Both facts, not one.** "Nothing more today" and "here is the first one tomorrow" are different answers, and someone reading the sign at midnight wants both. Tomorrow's rows went *under* the sentence, never instead of it — a group showing only rows would look like a normal board, which is the one thing that group must not look like.
- **`Tomorrow` went in the slot a scheduled row uses for `Scheduled`.** Same slot, same job: the word that stops the number below it being read as the next bus. These are timetable times, so they must never render as a countdown.
- Rows were drawn at the group's own row pitch starting one row down, so they lined up with a working direction on the other half of the board instead of forming a second grid. The sentence shrank from 64px to 46px and moved to the top of the reserved span to make room.
- Tomorrow's destinations were included in `destinationSize()`'s input, since they share the column and would otherwise be measured against nothing and overrun the time.

To put it back, `git show 28d5d21 -- src/render/board.js src/dev/edge-case-boards.js src/render/board.test.js` is the last revision that has it. The data is the actual work:

- [ ] **Add `schedule-for-stop/{agency}_{id}.json?date=YYYY-MM-DD`.** A different response shape from the arrivals call — per-route `stopTimes` for the service day, not a flat prediction list — so it needs its own client call, mapper and fixtures. Ask for tomorrow's date **in the configured timezone**; a UTC date is wrong for eight hours a day here.

The board case needs no stored state and no scheduling decision, because it happens inside the active window when the Worker is already talking to OneBusAway. Only the overnight-screen variant needed the prefetch held across the sleep, and that variant lost.

**The overnight variants that show first departures are still in the code and still render** — `first-departures`, `first-departures-inverse`, `first-departures-inverse-moon` and `-single` in `render/overnight.js`, on the parked contact sheet at `/_preview/parked`. They were deliberately kept as the visual reference, so the layout does not have to be recovered from git even though the board rendering does.


## Rendering

- [ ] **Identify the real typeface.** Fira Sans is the only tested open face with the open-top `4`; the actual Connectpoint face is unidentified and the closest matches (Frutiger, Myriad) are commercial. Settle this before subsetting.

- [ ] **Subset the font.** `@expo-google-fonts/fira-sans` drags in the full weight range plus a preview PNG per face.

- [ ] **Bundle the dark Metro lockup** when a light-panel design needs it. `assets/sources/metro-brand/metro-logo-1280.png` is a PNG, so it embeds as a data URI directly — no SVG re-framing, no namespace stripping.

- [ ] **Long headsigns fit now; what remains is taste.** A shrunken row is visibly smaller than its neighbours. The honest fix is measuring rendered width instead of `AVERAGE_ADVANCE`'s 0.5/char estimate, which means glyph metrics in `render/index.js`. Keep `Via …` clauses — they distinguish real routings — and never truncate.

- [ ] **Service alerts.** Reserved space is rejected. Preferred: a ⚠ marker on the affected row, plus dropping the last row only while an alert exists to free a strip for its text. Check first whether OBA returns situations on the arrivals response we already make.


## Features not being built

- [ ] **Route filtering.** Not needed — the chosen stop serves few enough routes. Sorting by time already filters most noise. Must be configuration if built.

- [ ] **Tap to swap directions.** Only the *middle* tap does an `/api/display` round trip; left/right repaint a cached image with no HTTP, which on a departures board silently shows stale times. Needs direction state, so it shares the durable store. Lost to showing both stops at once; revisit only if the two-stop layout reads badly across the room.

- [ ] **Link light rail alongside a bus stop.** Rail-only boards already work. The blocker is the URL shape: `/agency/<agency>/stop/<ids>` has one shared agency segment and cannot express a cross-agency pair. Preferred fix is fully-qualified IDs (`/stop/1_1550,40_99101`) split on the **first** underscore — agency IDs are numeric, the remainder is opaque and may contain its own underscores. Changing the shape forces a re-pair. Also unresolved: Link headways could crowd out the bus rows.

- [ ] **Mix in TRMNL ecosystem plugins.** Prefer the Plugin Data API (take the parsed JSON, render it ourselves) over proxying their images, so the sign keeps one visual language. Needs a BYOD license or device for the key. Never redirect the device to their S3 URL. Their examples show BMP, which is completely broken on the X.


## Not actionable / need to reproduce

Nothing right now. For things that misbehave once and cannot be pinned down yet — park them here with whatever was observed, rather than losing them or filing them as work nobody can start.
