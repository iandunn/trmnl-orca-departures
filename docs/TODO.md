# TODO

The work queue. Completed items are deleted rather than checked off — anything worth keeping moves to `CLAUDE.md`, the doc that owns it, or a code comment.

Three phases, roughly largest scope first: phase 1 needs no hardware, phase 2 needs the device, and the rest is unscheduled.

## Phase 1 — finish the server

### Sweep the failure modes, guard them, log them, alert on them

The biggest piece of work left. Nothing currently tells us the sign is wrong: the panel holds its last image, the device cannot be prodded, and Cloudflare has **no Workers alert types at all** (verified 2026-08-01), so alerting has to be built rather than configured.

- [ ] **Inventory every failure mode**, both directions, marking honestly which are invisible to us — that set is the argument for the rest. `CLAUDE.md`'s "Five ways stale data reaches the glass" is a start but covers only staleness.

- [ ] **Guard each detectable one** with a degraded screen that reads across the room, tagged in `FILENAME_TAGS` so the device's cache cannot suppress it. Nothing may throw out of `/api/display`.

- [ ] **Log each one in a single structured shape** — mode, stop hash, upstream status, duration. Always `redactPath()`. `recordOutcome()` fires **exactly once per authorized request**: the gate deliberately does not log authenticated ones, because which board was served is not knowable there, and adding a placeholder would double-count every poll the sign ever makes.

- [ ] **Alert on state transitions only.** At ~1440 polls a day, one alert per failed poll is 1440 messages for a single outage. Needs the durable store below.

	- *Worker up, something wrong* — fire-and-forget `fetch()` inside `ctx.waitUntil()`. ntfy.sh or a Discord webhook are free; Pushover is ~$5 once and the most reliable phone push. Cloudflare's `send_email` binding needs Email Routing on a real domain, so on `workers.dev` it is the *highest*-friction option, not the lowest.
	- *Worker down* — a Cron Trigger pinging healthchecks.io. Beats an external uptime monitor, which would need either the secret or a new unauthenticated health path, and this also catches "deployed but broken" since the ping only fires if our code ran.
	- *Device silent* — the same cron against a "last seen" timestamp. **It has to know the sleep schedule**, or it pages every night at 2am.
	- Never put a raw path in an alert body. The token is a path segment.

### Pick the durable store — one decision, six consumers

- [ ] There is no KV, D1 or Durable Object binding yet, and all of these want one. Listed together because from any single site it looks like a side quest, which is why it keeps not being decided.

	1. **The recovery generation** — perturb `filename` after any error even when the bytes are identical, or a firmware error screen sticks to the glass indefinitely.
	2. Alert state transitions.
	3. Device "last seen".
	4. The `schedule-for-stop` prefetch, held across the overnight sleep.
	5. Stop identity, so a failed stop's band is not bare on a cold isolate.
	6. Tap-to-swap direction state, if it is ever built.

	Writes are transition-only, so quota is not the constraint — the reasoning that ruled KV out for `/stats` was about per-request writes and does not apply. **The read path is the constraint:** `/api/display` reads it ~1440x/day and must never fail, so decide explicitly that a read error proceeds with generation 0 and still serves a valid response.

### Tomorrow's first departures — the one real feature debt

Two asks, one feature. Both are **already rendered against fixtures with invented times**: `group.tomorrow` in `render/board.js` (visible on `edge-no-service`), and `first-departures-inverse-moon` at `/_preview/parked`. Only the data is missing.

- [ ] **Add `schedule-for-stop/{agency}_{id}.json?date=YYYY-MM-DD`.** A different response shape from the arrivals call — per-route `stopTimes` for the service day, not a flat prediction list — so it needs its own client call, mapper and fixtures. Ask for tomorrow's date **in the configured timezone**; a UTC date is wrong for eight hours a day here. These are timetable times, so they must never render as a countdown.

- [ ] **Decide the overnight fetch question first.** Outside the active window the Worker calls OneBusAway *not at all*, which is what stops a 9:30pm outage pinning an error screen until morning. Fetching first trips on the **last poll before `ACTIVE_END`** keeps that property; it needs the durable store. Do the board case first — it happens inside the active window, so it needs no state and no scheduling decision.

### Correctness bugs

Where the sign is *wrong* rather than degraded, which is worse.

- [ ] **Compare the preview against the OneBusAway app** — discrepancies seen, not diagnosed.

- [ ] **Handle negative predictions** (`-2 min`). `NOW_GRACE_MS` in `oba/format.js` is 60s; anything older has no defined treatment.

- [ ] **Handle "running late" / "ahead of schedule"** when OBA reports it.

- [ ] **Settle what `Wake-Time` means — `/stats` labels it with a unit that may be wrong.** `deviceBox()` in `render.js` prints `${wakeTime} ms` under "Awake last cycle", but the fixture value `1785564693` is an epoch, not a duration. It is stored verbatim in `device-telemetry.js` so no guess is baked into the data, but the page still commits to a reading. Confirm against the first real poll, then fix the label or the parse.

- [ ] **Pin every `/stats` filter against the `OUTCOMES` value it is meant to match.** The enrollment alarm was dead from the day it was written — `query.js` compared `'setup'` against a recorded `'byos-setup'`. Fixed 2026-08-02, but nothing would have caught it, and a filter matching nothing looks exactly like a thing that never happened.

### Quick wins

Claude you should do as many of these as possible when I aske, but skip ones that would touch the same lines of code and cause conflicts.

- [ ] **Use the Sound Transit logo instead of text at a rail stop.** Reference: `assets/sources/connectpoint-photos/link-signpost.png`, or the official set at [soundtransit.org](https://www.soundtransit.org/get-to-know-us/our-brand/logos).

- [ ] **Vertically centre today's date in the header band** — equal padding top and bottom.

### Confirm before shipping

- [ ] **Is the deployed `OBA_API_KEY` the real key or `TEST`?** `secret:list` shows it exists, not what it holds. `TEST` is heavily rate-limited and will 429 in production. Set with `npm run secret -- OBA_API_KEY`.

- [ ] **Nothing has been measured against the real rate limit.** With a real key the memo means ~1440 calls/day for one stop, ~2880 for two — never checked against whatever quota Sound Transit issues.

- [ ] **Draft the pairing runbook.** How the sign gets onto the device has no answer in the repo yet, and it is the step with the most silent failures: the URL is discarded if the WiFi password is wrong, changing it wipes `api_key` and `friendly_id`, and `/api/setup` follows no redirects. `docs/deploying.md` step 4 is the skeleton. Finishable only against the device.

- [ ] **Watch the tarpit's effect on concurrency** once there is real traffic. A held request occupies an invocation for 25s. If the sign ever fails during a scan, lower `TARPIT_MS` or drop it — nothing depends on it.

### The gate that closes phase 1

Run this block before first contact with the device.

- [ ] Compare against the template repo for anything worth adopting.
- [ ] Performance pass — flicker time, Worker load — and cruft removal.
- [ ] Run a `/security-review`.
- [ ] Test everything.
- [ ] Audit the docs. `development.md`, `deploying.md`, `alternatives.md` and the README should read as durable descriptions, not changelogs.

## Phase 2 — when the device arrives

Nothing in the server work is blocked on the hardware. Everything here is. Getting it onto a wall is a separate question — see [mounting-ideas.md](mounting-ideas.md).

- [ ] **Clear `/stats` before the device is ever pointed at the Worker.** Everything recorded so far is development traffic, and it permanently skews the panels that matter most on day one — device identity is built to make a *single* deviation legible.

	**The procedure is in [`manual-testing.md`](manual-testing.md#clearing-the-stats-data)** — Analytics Engine has no delete, so it means renaming all three datasets and redeploying. Follow it there rather than duplicating it here; it has the traps, and a half-done rename is worse than not doing it.

- [ ] **The BYOS contract has only ever been verified against firmware source.** Every silent-failure trap in `CLAUDE.md` — exact `image/png`, `status: 0`, the `filename` cache gates, the 31-character bug — is read, not observed.

- [ ] **Judge legibility at physical size.** 227 PPI on a 10.3" panel cannot be assessed on a monitor.

- [ ] **Size the "Updated at" stamp.** The single load-bearing staleness defense, and "at a glance" is the whole condition the accepted risk rests on. Currently 38px bottom-left, unproven at physical size; losing the OneBusAway mark freed width to grow it.

- [ ] **Finish the pairing runbook** against the real captive portal.

- [ ] **The setup logo is the full-panel board image**, so the pairing screen shows a 1872x1404 notice. Cosmetic, shown once; a smaller render needs a second size through `rasterize()`.

- [ ] **Watch for ghosting on the inked overnight screen.** A full black field is the shape most likely to ghost, and the deep clear only runs every eighth update. **Do not pre-solve it.** If it appears: lighten `#111` toward mid grey, fall back to a light variant at `/_preview/parked`, or — worst option, since it slows *every* update — send a non-zero `temperature_profile`.

- [ ] **The overnight sleep has never been observed.** ~32000s `refresh_rate`, honoured per firmware source. If it is wrong, the sign does not come back in the morning.

- [ ] **Confirm the overnight layout, then delete the parked variants.** `badge-moon-inverse-stars` ships; the rest stay in `render/overnight.js` because switching back is one word. Judge at physical size — stars read as dust on the light panel and as sky reversed out of ink, which is why the light-with-stars pairing was dropped.

## Later — unscheduled

### Rendering

- [ ] **Identify the real typeface.** Fira Sans is the only tested open face with the open-top `4`; the actual Connectpoint face is unidentified and the closest matches (Frutiger, Myriad) are commercial. Settle this before subsetting.

- [ ] **Subset the font.** `@expo-google-fonts/fira-sans` drags in the full weight range plus a preview PNG per face.

- [ ] **Bundle the dark Metro lockup** when a light-panel design needs it. `assets/sources/metro-brand/metro-logo-1280.png` is a PNG, so it embeds as a data URI directly — no SVG re-framing, no namespace stripping.

- [ ] **Long headsigns fit now; what remains is taste.** A shrunken row is visibly smaller than its neighbours. The honest fix is measuring rendered width instead of `AVERAGE_ADVANCE`'s 0.5/char estimate, which means glyph metrics in `render/index.js`. Keep `Via …` clauses — they distinguish real routings — and never truncate.

- [ ] **Service alerts.** Reserved space is rejected. Preferred: a ⚠ marker on the affected row, plus dropping the last row only while an alert exists to free a strip for its text. Check first whether OBA returns situations on the arrivals response we already make.

### Features not being built

- [ ] **Route filtering.** Not needed — the chosen stop serves few enough routes. Sorting by time already filters most noise. Must be configuration if built.

- [ ] **Tap to swap directions.** Only the *middle* tap does an `/api/display` round trip; left/right repaint a cached image with no HTTP, which on a departures board silently shows stale times. Needs direction state, so it shares the durable store. Lost to showing both stops at once; revisit only if the two-stop layout reads badly across the room.

- [ ] **Link light rail alongside a bus stop.** Rail-only boards already work. The blocker is the URL shape: `/agency/<agency>/stop/<ids>` has one shared agency segment and cannot express a cross-agency pair. Preferred fix is fully-qualified IDs (`/stop/1_1550,40_99101`) split on the **first** underscore — agency IDs are numeric, the remainder is opaque and may contain its own underscores. Changing the shape forces a re-pair. Also unresolved: Link headways could crowd out the bus rows.

- [ ] **Mix in TRMNL ecosystem plugins.** Prefer the Plugin Data API (take the parsed JSON, render it ourselves) over proxying their images, so the sign keeps one visual language. Needs a BYOD license or device for the key. Never redirect the device to their S3 URL. Their examples show BMP, which is completely broken on the X.

### Housekeeping

- [ ] **Reframe `docs/plans/initial-plan.md` as an archive.** 776 lines, roughly half reversed decisions, and its "# STATE — Read this first" opening competes with `CLAUDE.md`. Keep the firmware research and the `blueset/trmnl-recipes` prior-art analysis, which exist nowhere else.

- [ ] **Delete `tramGlyph()`** in `render/board.js` plus `OBA_TRAM_VIEWBOX` / `OBA_TRAM_RATIO` — only useful if bus and rail shared a board, which they never will. Keep `obaMark()`, which is parked deliberately. Separately, `GREY = '#6b6b6b'` is now declared in three render modules.

- [ ] **Assert that `/api/display` still 404s with `DEV_PREVIEW` enabled.** `worker.test.js` only tests with `env` undefined, so it would not catch the preview leaking into the BYOS paths.

- [ ] **Cover `requestedTime()` in `dev/preview.js`** — verified by hand only, not exported, and `preview.test.js` avoids importing the module because of the wasm.

- [ ] **Add `postinstall` git hooks** — `core.hooksPath` plus a pre-commit running lint and tests.

- [ ] **Give `/api/log` a longer window only if 3 days proves too short.** The `DEVICE_LOGS` dataset is the history; console retention is the live view.

- [ ] **Delete `.npm-cache/`** — 284 MB, only exists because the sandbox denies `~/.npm/_cacache`.

## Not actionable / need to reproduce

Nothing right now. For things that misbehave once and cannot be pinned down yet — park them here with whatever was observed, rather than losing them or filing them as work nobody can start.
