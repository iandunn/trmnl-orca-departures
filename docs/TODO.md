# TODO

Completed items are deleted rather than checked off. Anything worth keeping moves to `CLAUDE.md`, the relevant doc, or a code comment first — this file is the work queue, not the record.

Organised into **phases**, roughly largest scope first. Phase 1 is everything that can be finished without the hardware, phase 2 is everything that cannot, and the rest is unscheduled. Priority is the ordering within each phase.

## Where this stands — updated 2026-08-02

**The whole server is built and deployed.** The design lives in `src/` and is reproducible from source; the four device routes serve live OneBusAway departures; the request gate, `/stats`, the refresh schedule and the overnight screen are all in. Tests and lint are clean as of 2026-08-02.

Deployed to `trmnl-orca-departures.ian-dunn.workers.dev` with both Analytics Engine datasets bound and all five secrets set — `ANALYTICS_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEVICE_TOKEN`, `OBA_API_KEY`, `STATS_PASSWORD`. **There is no deploy blocker left.** No device has been paired.

Settled and written up in `CLAUDE.md`: the Metro-faithful layout, real-time vs scheduled (Metro's own `Scheduled`-above-the-time treatment), Fira Sans, the two-stop grouping with direction bands, circle badges for light rail, the OneBusAway footer mark, the sample stops, and the schedule.

Docs are split by audience: `README.md` is the overview and links out, `docs/how-it-works.md` explains the BYOS architecture and the constraints it imposes, `docs/alternatives.md` is why it is a Worker rather than Terminus, a plugin, a Pi or Pages, `docs/deploying.md` is everything needed to stand up your own sign, `docs/development.md` is everything needed to work on the code.

**To view the design:** `npm run dev`, then `http://localhost:8788/_preview`. Requires `DEV_PREVIEW=1` in `.dev.vars`. Rejected and parked variants render at `/_preview/parked`.

**The next substantial piece of work is the failure-mode sweep**, and the decision it is waiting on is [which durable store to use](#pick-the-durable-store--one-decision-with-six-consumers).

---

# Read first — what exists and what it guarantees

Written as each piece landed. These are live constraints on the next change, not history.

## Config and the clock

`readConfig()` in `src/config.js` is the only place that reads a display or scheduling value off `env`; `formatBoardTime()` in `src/clock.js` turns a timestamp into the header fields and the "Updated at" stamp.

- Everything coerces and falls back rather than throwing, deliberately: the same var arrives as a **number** from `[vars]` and as a **string** from `.dev.vars` or a secret, and `/api/display` must never fail over a config value. Refresh rates below 1 second are refused, since 0 hot-loops the device flat.

- `activeStartMinutes`/`activeEndMinutes` are read by `src/schedule.js` and by the rest screen. `HEADER_TEXT` was deleted 2026-08-01 rather than wired up: both modes draw a logo rather than a word, so it was config for a case that never arises, and a different agency needs its own logo asset that no string could supply. `REFRESH_IDLE_SECONDS` was deleted the same way when the schedule landed.

- Secrets are deliberately **not** in the config object, so no future log line can serialise one. `directionOverrides` is in it and is privacy-sensitive — never log the object.

- **`formatBoardTime()` throws on a non-finite timestamp, on purpose**, and `loadBoard()` is what decides that a board with no usable `currentTime` is simply not drawn. Falling back to our own clock is the tempting fix and the wrong one — it would stamp the board with a time that says nothing about how fresh the predictions are.

- The preview renders at a fixed reference instant by default so the header stays consistent with the fixture rows; `?now=live` renders at the real clock.

- Verified against ICU rather than assumed: legacy zone aliases (`US/Pacific`, `PST`) resolve to the full zone and stay DST-aware, so the timezone guard only has to catch what actually throws. Separately, ICU separates the day period with U+202F, which Fira Sans need not carry — every string is assembled from `formatToParts()` with ASCII spaces for that reason.

- **Row count is deliberately not configuration** — it follows from how many departures the data has, bounded by what fits. `rowMetrics()` in `render/board.js` derives row height from the count, and `maxRowsPerGroup()` derives the bound from the panel and a legibility floor, so no deployment sets either. Neither is the staleness threshold, which was withdrawn as a requirement when the "Updated at" stamp became the mechanism.

## The request gate and `/stats`

`src/gate.js` is the shell every request passes through; `src/abuse.js` classifies, `src/stats/` records and displays.

- **`gate()` returns either a finished `Response` or an authorized classification.** The BYOS handlers hang off the second case and should not need to touch `src/gate.js` or `src/abuse.js` at all. `src/worker.js` is deliberately just that seam.

- **`recordOutcome()` must be called exactly once per authorized request.** Authenticated requests are deliberately *not* logged by the gate, because the interesting outcome is not knowable there — which board state was served, whether OneBusAway answered. Logging a placeholder in the gate plus a real row in the handler would double-count every request the sign ever makes. Add new outcome names to `OUTCOMES` in `src/abuse.js` and pass them, along with `filenameTag`.

- **Every telemetry header is captured**, so the handlers do not need to log them again: `ID` (the MAC), `Model`, `FW-Version`, `FW-Commit`, `Image-Cached`, `Update-Source`, `Wake-Time`, `Refresh-Rate`, `RSSI`, `WiFi-Band`, `Battery-Charging`, `USB-Connected`, `Temperature-Profile`, `Width`/`Height` and all seven battery fields, plus Cloudflare's `CF-Connecting-IP`.

- **`deviceId` — the MAC from the `ID` header — is the only stable per-device key, and `/stats` is the only place two devices are ever separated.** Everything else the firmware sends describes a *kind* of device, so before 2026-08-02 two identical signs were indistinguishable in the dataset. That is exactly what the identity alarms exist to catch, and they were inferring it from network and firmware counts because there was nothing better to group on. **There is no serial number** — the firmware sends none.

	The per-device panels group raw recent rows in JS rather than with a `GROUP BY`, because *latest* is the question and the aggregate a group-by can give — an average voltage — is not what a device box is asking for. `argMax` may not exist on this SQL surface.

- **`upstreamReason` records partial failures, not just polls that ended in `obafail`.** One stop answering is enough for a board, so a quota problem is invisible until it is total unless partials are recorded too. The HTTP status is folded into the slug (`http-429`) because the status is the whole content of that reason.

- **`clientIp` is recorded, and that is a new privacy consequence.** A screenshot of `/stats` now carries an IP as well as roughly a home address. Same decision as recording stop IDs raw: on a single-device sign the address is a constant, and a constant is what makes a deviation legible. Cloudflare's own request logs hold it regardless.

- **`/api/log` calls `recordDeviceLogs( env, logs, { agency, stopIds } )`** from `src/stats/device-logs.js`. It maps the documented snake_case payload onto the `DEVICE_LOGS` dataset, caps one request at 64 entries so a device cannot spend the daily write quota, never throws, and returns how many it persisted. The panel that reads them back is on `/stats`.

	A `console.log` of the same entries is complementary and worth keeping — that is the live `wrangler tail` view. It is **not** a substitute for the dataset: `[observability.logs]` retains console output for a few days in a separate store that cannot be queried alongside the request rows explaining what the device was reacting to, and the entries that matter arrive during a failure, which is exactly when nobody is watching a tail.

- **Analytics Engine columns are positional and permanent.** `BLOB_FIELDS` and `DOUBLE_FIELDS` in `src/stats/schema.js` are the schema. **Append only** — inserting a field mid-list silently reinterprets every historical row, with no migration and no way to notice afterwards except that the numbers look wrong.

- **The token is never recorded, only a 4-byte fingerprint.** Raw paths are never recorded either, except for unauthenticated requests, which go through `safeProbePath()` — an allow-list that keeps `/wp-login.php` and replaces anything long or high-entropy with `[redacted]`, because a URL one character away from ours would otherwise write the live shared secret into the dataset.

- **Stop IDs are recorded raw, by decision, and are printed on `/stats`.** The stop still never enters git, but a screenshot of that page carries roughly a home address. The page says so on itself.

- **The tarpit is keyed on path shape, never on token validity.** A 25-second delay exceeds the device's 15-second read timeout, and the first three failed polls draw nothing at all — so tarpitting a well-shaped path would make a token typo at the captive portal into a sign that does nothing for seven minutes with no clue why. `src/abuse.test.js` asserts `tarpit: false` for `bad-token` specifically; that assertion is the regression guard for the whole design.

- **`byos-unimplemented` is retired but undeletable.** Rows carrying it predate the endpoints. Left in `OUTCOMES` with a comment saying so, because it is already in the dataset, and `/stats` labels it "(historical)".

	It is still what `classifyRequest()` sets as the **placeholder** outcome, because the gate cannot know how a request ended — every BYOS branch overrides it when it calls `recordOutcome()`. So a row with a *recent* timestamp carrying this value means a handler returned without recording, which is a bug rather than history.

## Live data and the device endpoints

- **The memo is isolate-local, so it is best-effort.** `/api/display` and `/image` land seconds apart and almost always in the same isolate, but nothing guarantees it. A miss simply refetches, which costs one extra upstream call and a render whose bytes differ slightly from the ones the filename was hashed over — survivable, and the reason the Cache API was not worth a spike. If the sign ever shows evidence of the two disagreeing, `caches.default` is the next thing to try, after checking whether it is honoured on a `workers.dev` subdomain at all.

- **A failed stop's band is only bare on a cold isolate.** It takes its name and bearing from the last response the isolate saw, so during an ordinary outage the band reads normally and only the rows say anything is missing. The gap left is the first poll after a deploy or an idle period coinciding with an upstream failure: nothing has been seen yet, so the band falls back to the bare stop ID. Closing that means persisting stop identity — see [the durable store](#pick-the-durable-store--one-decision-with-six-consumers).

- **`OBA_FAILURE_REASONS` is finer than anything consumes.** Every reason collapses to the same board. The distinctions are in the log line and are there for the failure-mode sweep, which is where they earn their keep.

- **The `Access-Token` check is a second copy of the path secret, not a second factor.** `src/byos/credentials.js` derives the key by HMAC from `DEVICE_TOKEN`, so it is reproducible on every request and needs nothing persisted. What it does *not* do is add a factor: the device obtains the key from `/api/setup`, which anyone holding the URL can reach. Rotating `DEVICE_TOKEN` invalidates both at once and forces a re-pair — correct, but a physical trip to the sign.

- **The zero-flicker no-op is gone, and the stamp is only half the reason.** The cache key is hashed over the rendered SVG, which carries a minute-resolution "Updated at" stamp, so at `refresh_rate: 60` the panel repaints every poll. Minute accuracy is a hard requirement — a stamp that can be hours stale on a healthy sign is indistinguishable from the failure it exists to expose — but **do not attribute the whole cost to it.** Any row showing a countdown changes every minute on its own, so the board's hash moves every minute regardless. The stamp costs nothing during service and everything only when the board is otherwise static: overnight, on an all-clock-times board, and on the degraded screens. Which is where freshness is hardest to judge, so it is spent where it buys the most.

	**If flicker ever needs cutting, the countdown is the lever, not the stamp.** Quantising the stamp saves almost nothing during service because the countdowns dominate; dropping countdowns for clock times would cut it by an order of magnitude, since a clock-time row is static until a departure rolls off. `CLAUDE.md` already argues for that independently on honesty grounds — a frozen "**4** min" is actively false in the largest type on the sign, while "4:26 pm" stays true forever. Two arguments pointing the same way. Verified 2026-08-01 that the X gets no partial refresh either way: the partial path is commented out at `display.cpp:1836-1839`, and `REFRESH_PARTIAL` is only ever selected for a 1bpp image while ours is 4-bit greyscale.

---

# Phase 1 — finish the server, before the device arrives

## Next up

### Sweep the failure modes, guard them, log them, and get notified

Right now nothing tells us the sign is wrong — the panel holds its last image, the device cannot be prodded, and Cloudflare raises no alarm. **This is the next substantial piece of work.**

**Start here, if you are picking this up fresh.** Everything it was waiting on now exists: the four device routes (`src/byos/`), live departures (`src/oba/`), the request gate and `/stats` (`src/gate.js`, `src/abuse.js`, `src/stats/`), the refresh schedule and the overnight screen (`src/schedule.js`, `src/render/overnight.js`), and a working deploy with all five secrets set. What does **not** exist is any durable storage, which parts 4 and 5 both need — decide that first, per the item below.

Read first: the "request gate and `/stats`" section above (especially the rule that `recordOutcome()` fires exactly once per authorized request), and `CLAUDE.md`'s "Failure and staleness" and "Five ways stale data reaches the glass" sections, which already enumerate part of the inventory.

**1. Write the inventory.** The five staleness rows in `CLAUDE.md` are a start but cover only staleness. Enumerate every mode in both directions and say for each what we can detect and what we cannot: OneBusAway down / 429 / empty / malformed, the render throwing, `formatBoardTime()` on a missing `currentTime`, a bad or missing config value, a bad token, a stop ID that no longer exists, the device never waking, WiFi lost, battery flat, the PNG failing to decode silently, and the stuck firmware error screen. Mark honestly which ones are invisible to us — that set is the argument for everything below.

**2. Guard each one.** Every detectable mode gets a degraded screen that is obvious across the room, with a `filename` stable for that state and distinct from every good render, per `FILENAME_TAGS` in `src/filename.js`. Nothing may throw out of `/api/display`.

**3. Log each one, in one shape.** A single structured event so the Workers Logs view is searchable — mode, stop hash, upstream status, duration. Always `redactPath()`; never the raw path, never `directionOverrides`.

**4. Get notified — nothing is built in.** Verified 2026-08-01: Cloudflare's notification catalogue has **no Workers alert types at all**, and Workers Logs has no alerting layer, so this has to be built. Two halves, and they fail differently:

- **Worker up but something is wrong** (OBA down, render failed, config bad). The Worker can call out itself: a fire-and-forget `fetch()` to a webhook inside `ctx.waitUntil()`, so it never delays the device's response.

	Transport, cheapest first: **ntfy.sh** (free, self-hostable, iOS and Android push, one `POST` with a plain-text body), a **Discord or Slack webhook** (free, one `POST`, good if you already live there), **Pushover** (one-time ~$5 per platform, the most reliable phone push). Cloudflare's own `send_email` binding also exists but wants Email Routing on a domain in the account with verified destination addresses, which a `workers.dev` deployment does not have — so it is the highest-friction option, not the lowest.

	**The trap is volume.** `/api/display` runs ~1440 times a day, so an alert per failed poll during an OBA outage is 1440 messages. It has to fire on **state transitions only** — entering the failure and recovering from it — which needs the durable store.

- **Worker down.** Same class as the unfixable staleness case: a Worker that is not running cannot report that it is not running, so anything living inside Cloudflare is useless here. Two shapes, and one is clearly better:

	- **External uptime monitor** (UptimeRobot's free tier is 50 monitors at 5-minute intervals) polling a health path. Awkward here — everything lives under `/token/<token>/`, so either the monitor holds the secret or we add an unauthenticated health path, which is a new unauthenticated surface on a Worker whose whole access design is "token first, short-circuit before anything else".

	- **Dead man's switch.** A **Cron Trigger** (5 per account on Free) pings healthchecks.io on a schedule (free tier: 20 checks) and it alerts when the pings stop. **Preferred** — no new endpoint, no secret handed to a third party, and it catches "deployed but broken" as well as "Cloudflare is down", because the ping only happens if our code actually ran.

- **Device silent.** Only detectable server-side, since the Worker is the only thing that ever sees a poll. The same cron reads a "last seen" timestamp and alerts when it is older than a few refresh intervals.

	**One cron plus one key covers both directions** — the outbound ping proves the Worker is alive, the recency check proves the sign is. The whole monitoring design fits the Free plan with room to spare.

- Early warning is nearly free now that `/api/log` is stored: a climbing `retry` or a falling `wifi_signal` shows up **before** the sign goes dark, and is the only lead time we will ever get.

- **Alerts must never carry the raw path.** The device token is a path segment, so a webhook body with a URL in it publishes the secret to Discord or ntfy. `redactPath()` applies to alerts exactly as it does to logs.

- **Tuning caveat, now live rather than hypothetical:** "device has not polled" will false-positive against the overnight sleep window, which exists as of 2026-08-01 in `src/schedule.js`. The threshold has to read the same schedule, or it pages every night at 2am.

**5. Return as much as possible in both directions.** Device → Worker is fixed — the firmware sends what it sends — so the work is capturing all of it rather than asking for more. Worker → device is genuinely constrained: the response vocabulary has no field meaning "degraded", and getting it wrong is destructive (`status: 500` factory-resets, an absent `refresh_rate` flat-batteries). **The only channel to a human is the rendered image**, which is why the degraded screens in part 2 carry the whole load.

### Pick the durable store — one decision with six consumers

**There is no KV, D1 or Durable Object binding on this Worker.** Six separate pieces of work each want one, which is why this is its own item rather than a footnote on any of them — and why it has not been made, since from any single site it looks like a side quest.

The consumers, in the order they will need it:

1. **The recovery generation.** The fix for the stuck firmware error screen: whenever the server has been unavailable or returned an error, the next `filename` must be perturbed even if the image bytes are identical, or the cache no-op keeps the firmware's own error screen on the glass indefinitely. Written on error-state transitions only.

2. **Alert state transitions** — entering a failure and recovering from it, so an OBA outage is two messages rather than 1440.

3. **Device "last seen"**, for the silent-device check.

4. **The `schedule-for-stop` prefetch**, held across the overnight sleep so tomorrow's first departures can be fetched while the sign is still awake.

5. **Stop identity**, so a failed stop's band is not bare on a cold isolate.

6. **Tap-to-swap direction state**, if that is ever built. Listed for completeness — it is unscheduled, not phase 1.

**Quota is not the constraint on writes** — all of these write on transitions, not per request. **The read path is.** `/api/display` would read it ~1440 times a day and must never fail, so decide the failure behaviour explicitly and write it down: on a read error, proceed with generation 0 and serve a valid response rather than failing the endpoint.

Note the earlier reasoning that ruled KV out for `/stats` does **not** apply here: that was about a write per request against KV's 1000/day free quota. Transition-only writes are nowhere near it.

### Tomorrow's first departures — `schedule-for-stop`, the one real feature debt

**Two asks, one feature, both currently rendering invented times.**

1. **A group whose last bus has gone should say when the first one is tomorrow**, under `No more departures today` rather than instead of it. **The rendering is done** — `group.tomorrow` in `src/render/board.js`, with `Tomorrow` in the slot a scheduled row uses for `Scheduled`, covered by two tests and visible on `edge-no-service` at `/_preview`. Only the data is missing.

2. **The overnight screen should list tomorrow's earliest departures**, including ones before `ACTIVE_START`. Also rendered — `first-departures-inverse-moon` at `/_preview/parked`, the runner-up for the overnight design, which lost *only* because of this.

Both draw from `src/dev/*` fixtures with real route names and **placeholder clock times**. Nothing in `src/oba/` produces them.

**What has to be built:**

- **A second OneBusAway endpoint.** `arrivals-and-departures-for-stop` only answers about a window around now — it cannot see tomorrow at all. First trips come from **`schedule-for-stop/{agency}_{id}.json?date=YYYY-MM-DD`**, which returns a different shape: a per-route array of `stopTimes` for the service day, not a flat prediction list. It needs its own client call, its own mapper, and its own captured fixtures under `src/oba/fixtures/`.

- **The date is the service day, not the calendar day.** Ask for tomorrow's date in the configured timezone, which `src/clock.js` can already produce; a UTC date is wrong for eight hours of every day in Pacific time.

- **Scheduled, never predicted.** These are timetable times by definition, so they must be labelled as such — the `Tomorrow` label does that job on the board, and the row must never render a countdown. A countdown to a bus fourteen hours out is the most dangerous thing this sign could draw.

**The design decision to make first, before writing any of it:** outside the active window the Worker currently calls OneBusAway **not at all**, and that is exactly what stops an upstream outage at 9:30 pm from pinning an error screen to the glass until morning. Drawing tomorrow's departures overnight means asking upstream overnight, so either that guarantee goes, or the first trips are fetched on the **last poll before `ACTIVE_END`** — while the sign is still awake, can still show a board if the call fails, and has somewhere to put the answer. The second keeps both properties and is the recommended shape; it needs the durable store above.

**Do item 1 first.** It happens *inside* the active window, so the fetch is already permitted and the only new thing is the endpoint — no state, no scheduling question. Item 2 then reuses the mapper.

## Correctness bugs

These are the ones where the sign is *wrong* rather than *degraded*, which is worse.

- [ ] **Compare the preview against the OneBusAway app** — discrepancies seen, not yet diagnosed.

- [ ] **Handle negative predictions**, e.g. OBA reporting `-2 min`. Relates to `NOW_GRACE_MS` in `src/oba/format.js`, which is 60 seconds; anything older currently has no defined treatment.

- [ ] **Handle "running late" / "ahead of schedule"** when OBA reports it.

- [ ] **Pin every `/stats` filter against the `OUTCOMES` constant it is meant to match.** The enrollment alarm — the clearest signal that something other than your device holds the URL — was dead from the day it was written, because `query.js` compared against `'setup'` while the recorded value has always been `'byos-setup'`. Fixed 2026-08-02, but nothing would have caught it: the tests assert the page renders, not that its filters match values the writer actually emits. Cheap to add alongside the failure-mode sweep, and this class of bug is silent by construction — a filter that matches nothing looks exactly like a thing that never happened.

## Quick wins

Self-contained only. Skip one if it would overlap code with another.

- [ ] **Swap the Sound Transit text for their logo at a light rail stop.** Candidate artwork: the icon in [this totem photo](https://storage.ghost.io/c/19/31/1931222a-d1c5-42ac-8932-2ee3ac1f8927/content/images/old-theurbanist-org/wp-content/uploads/2019/11/new-totems.png), or the official set at [soundtransit.org](https://www.soundtransit.org/get-to-know-us/our-brand/logos).

- [ ] **Vertically centre today's date in the header band** — equal padding above and below.

## Confirm before shipping

- [ ] **Confirm whether the deployed `OBA_API_KEY` is a real Sound Transit key or `TEST`.** The secret exists; which value it holds is not visible from `npm run secret:list`, and it matters — `TEST` is heavily rate-limited and will 429 in production the same way it does locally. `/stats` will show it as upstream failures if it is still `TEST`.

	If the real key has not arrived: the source is confirmed against the operator's own page — `pugetsound.onebusaway.org/wiki/Developers` sends you to `soundtransit.org/Open-Transit-Data` and lists no alternative. **There is no way to get a key "direct from OneBusAway"** — OBA is open-source software and each regional deployment issues its own keys. Set it with `npm run secret -- OBA_API_KEY` (never `npx wrangler`, which is denied here) and add it to `.dev.vars` for local work.

- [ ] **Nothing has been measured against the real OneBusAway rate limit.** Every render so far was against the shared `TEST` key, which 429s freely — one verification render caught a live 429 on one stop, which is how the partial-failure path got seen. With a real key the memo means ~1440 calls a day for a one-stop sign and ~2880 for two. That has never been checked against whatever quota Sound Transit issues.

- [ ] **Draft the pairing runbook — how the sign actually gets loaded.** "How does this get onto the device" has no answer anywhere in the repo yet, and it is the step with the most ways to fail silently.

	The runbook needs: joining the captive portal, entering the base URL, and the traps already documented — the URL is discarded silently if the WiFi password is wrong, changing the base URL wipes `api_key` and `friendly_id` and forces a clean re-pair, and `/api/setup` follows no redirects at all so enrollment fails quietly if anything redirects.

	Draftable now from the firmware research; `docs/deploying.md` step 4 is the skeleton. It can only be *finished* against the device.

- [ ] **Watch the tarpit's effect on concurrency once there is real traffic.** A held request occupies a Worker invocation for 25 seconds. Wall time is not billed CPU so it costs nothing against that budget, but a large enough flood could crowd out the device's own poll. If the sign ever fails during an observable scan, lower `TARPIT_MS` or drop the tarpit — nothing depends on it.

## The ready-for-testing gate

Run this block before first contact with the device. It is what closes phase 1.

- [ ] Compare against the template repo to see if anything should be added or changed, or whether any of its features make sense here.

- [ ] Look for performance work — flicker time, Worker load — and remove cruft from the source.

- [ ] Run a `/security-review`.

- [ ] Test everything.

- [ ] Audit all the docs for accuracy. `development.md`, `deploying.md`, `alternatives.md` and the README should read as durable descriptions rather than referencing past changes.

---

# Phase 2 — when the device arrives

**The TRMNL X has not arrived as of 2026-08-02.** Nothing in the server work is blocked by that. Everything below is, and none of it should be assumed done.

## Do this first, before the device is ever pointed at the Worker

- [ ] **Clear out the `/stats` data so the device starts against a clean slate.** Everything recorded so far is development traffic — `wrangler dev` polls, hand-run `curl`s, `byos-check` runs, the deliberate bad-token and probe tests. Left in place it permanently skews every number on the page, and the panels that matter most on day one are exactly the ones it ruins: "device identity" is built to make a *single* deviation legible, and it cannot do that against a background of test rows from a dozen different shapes of request.

	**Analytics Engine has no delete.** There is no purge API and no dashboard button; rows age out on their own retention and not before. So the way to start clean is to **write to new datasets** — change the `dataset` on both `[[analytics_engine_datasets]]` bindings in `wrangler.toml` and the matching `ANALYTICS_DATASET` / `DEVICE_LOGS_DATASET` vars, then redeploy. Suffixing something like `_v2` is enough.

	Three things to get right, since a half-done rename is worse than not doing it:

	- **The var and the binding must move together.** They are separate values that have to match, which is exactly why they are vars rather than hardcoded — `/stats` queries the name in the var, the Worker writes to the name on the binding, and if they drift the page silently reads an empty dataset while the writes land somewhere else.
	- **Both datasets, not just the requests one.** `DEVICE_LOGS` carries the same development noise.
	- **Verify by reading, not by deploying.** Load `/stats` after the redeploy and confirm it is empty, then make one authenticated request and confirm exactly one row appears.

	Worth doing at the same time: decide whether `byos-unimplemented` still needs its comment in `OUTCOMES`. It was kept only because retired values were already in the dataset — a fresh dataset removes that reason.

## Cannot be closed without hardware

- [ ] **The BYOS contract is verified against source, never against hardware.** Every silent-failure trap in `CLAUDE.md` — exact `image/png`, `status: 0`, the `filename` cache gates, the 31-character bug — is read from firmware, not observed. First contact with the real device is the real test.

- [ ] **Legibility at physical size.** 227 PPI on a 10.3" panel cannot be judged on a monitor, and the design must be redrawn at native resolution rather than scaled up.

- [ ] **Size the "Updated at" stamp properly — it is the single load-bearing staleness defense.** "At a glance" is the entire condition the accepted risk rests on, so it must be readable from wherever the departures are. It currently sits bottom-left at 38px regular, starting at the left margin now that the OneBusAway mark is gone — better than a footer caption, still unproven at physical size, and the removal of the logo freed the width to grow it. Going to four rows helped the ratio without touching the stamp: the countdown numeral came down from 76px to 62px while the stamp held at 38. The stacked day/date in the header is the second half of this — it catches a panel frozen since yesterday, which a bare `h:mm` cannot.

- [ ] **Finish the pairing runbook** against the real captive portal. The draft is a phase 1 item above.

- [ ] **The setup logo is the full-panel board image.** `/api/setup` must return an `image_url` that downloads, or the friendly-ID screen is replaced by an error screen, so it points at the ordinary image route — meaning the "logo" on the pairing screen is a 1872x1404 notice board. It will look wrong. Rendering something small needs a second size through `rasterize()`, which is hardcoded to panel dimensions. Cosmetic, and shown once.

## Watch for on the glass

Do not pre-solve any of these. Each is cheap to fix if it appears and wasted work if it does not.

- [ ] **Ghosting on the inked overnight screen.** Recorded 2026-08-01 at the owner's direction: the chosen variant fills the panel with black, which is the shape most likely to ghost into the next render, and the deep clear that would remove it only runs every eighth update (`(iUpdateCount & 7) == 0`). Nothing about this is knowable without the device. **If it never shows up on the glass, there is nothing to do.** If it does, the levers in order of cost are: lighten the panel from `#111` toward a mid grey, drop back to one of the light variants at `/_preview/parked`, or force a slow clear by sending a non-zero `temperature_profile` — which is the worst of the three, because it makes *every* update slow rather than the one that needs it.

- [ ] **The overnight sleep has never been observed.** It is a `refresh_rate` of ~32000 seconds, which the firmware's own source says is honoured exactly and stored in NVS. That is read, not seen. The first night with a real device is the test, and the failure mode if it is wrong is a sign that does not come back in the morning.

- [ ] **Confirm the overnight layout, then delete the parked variants.** `badge-moon-inverse-stars` ships — the inked panel with stars, both rules, and `Wakes at 6:30 am` in the footer, set as `DEFAULT_OVERNIGHT_VARIANT`.

	**Everything not chosen stays in `src/render/overnight.js` and renders at `/_preview/parked`** rather than being deleted: the choice is provisional until the panel has been seen at 227 PPI, and switching back is one word. Delete them once the device has confirmed the pick.

	Two of them — `badge-moon-row` and `badge-moon-header-time` — print `Back at 6:30 am` twice, because every variant carries it in the footer by decision and those two also say it in their own slot. They are really proposals about *where* that line goes, so picking either means dropping the footer copy.

	The runner-up, `first-departures-inverse-moon`, lost only because it is blocked on `schedule-for-stop`, not on taste. Revisit it once that lands.

	**Judge them at physical size, not in the browser.** One thing already learned that way: stars are plain circles, and on the light panel they read as dust on the glass while reversed out of ink they read as sky. Same shape, opposite result — which is why the paper-with-stars version was dropped rather than kept as a pair.

## The physical build

- [ ] **Settle the wall mount.** Options below are unreviewed.

	- **French cleat, VHB'd to the back.** A 3-5mm aluminium or printed cleat bonded with 3M VHB 4941, mating to a cleat screwed into the wall. Zero holes in the device, sits nearly flush, holds far more than 450g, and lifts straight up and off for charging. Claude's pick.

	- **Printed surround that doubles as the mount.** Print a shroud that the X drops into, with keyhole slots in the shroud rather than the case. Look at the Connectpoint photo again — that unit has an angled sun hood over the top and sides, and reproducing it in black filament would make the thing read as a real transit fixture rather than a tablet on a wall. Best-looking outcome by a distance.

	- **Boost the magnet.** If the included magnetic sticker holds but feels marginal, screw a steel plate to the wall and add a few N52 discs. Keeps the intended lift-off-to-charge behaviour, no fabrication.

	- **Industrial Velcro.** 365-450g is nothing. Ugly, five minutes, fully reversible, and genuinely fine behind a device that covers it.

	- **Shadow box frame.** Mount the X inside a shallow picture frame and hang the frame conventionally. Reads as a deliberate object, which matters for a gift.

	- **Print one from [usetrmnl/mounts](https://github.com/usetrmnl/mounts)** — the hidden-magnet or mainframe designs.

- [ ] **Design a sticker for the case** — something colourful in Metro brand colours, printed and applied over the black.

---

# Later — not scheduled

## Rendering and design

- [ ] **Match the sign's typeface more closely.** Fira Sans is chosen and applied — it is the only tested open face with the **open-top `4`** the real sign uses, and the reasoning is written up in `CLAUDE.md`. What remains is that the real face is still unidentified: it is a Connectpoint choice, absent from Metro's brand standards, and pinning it down needs the vendor spec or a font-identification service. Frutiger and Myriad are the closest matches and both are commercial.

	**Generating a font is not the answer.** Drawing a usable typeface is not something to take on here, and modifying one open glyph to notch the `4` gets a single character closer while leaving every other letterform unchanged, which is the wrong end of the effort curve.

	Settle the face before subsetting it.

- [ ] **Subset the font.** `@expo-google-fonts/fira-sans` was picked because it ships real TTFs where fontsource ships none, and it drags in the full weight range plus a `.ttf.png` preview per face. `docs/plans/initial-plan.md` always intended a subsetted font (digits + latin) vendored into the repo. Provisional, not the endgame.

- [ ] **Bundle the dark Metro lockup.** `assets/sources/metro-brand/metro-logo-1280.png` is the positive artwork, 1280x458, dark marks on transparent. It is the only thing missing for a **light** badge plate, since the lockup bundled in `src/assets/metro-logo.js` is the *reversed* white version and vanishes on anything pale.

	**Not done, because nothing live needs it.** The chosen overnight screen is inked, so it uses the reversed logo we already have; the only variant that wanted a dark one is `logo-plate-inverse-white`, which is parked. Do this when a light-panel variant is actually picked.

	**It is a PNG, so this is now a much smaller job than it used to be** — embed it as a data URI at author time exactly the way `metro-logo.js` already handles the reversed raster, with no SVG re-framing and none of the namespace-stripping the OneBusAway mark needed. The vector positive, `metro-logo-seeklogo.svg`, is 38 Inkscape references deep and only worth cleaning up if a design needs to scale past 1280px; if it is ever used, strip the `inkscape:` and `sodipodi:` attributes along with the outer `<svg>`, because resvg rejects the whole document over an undeclared prefix rather than ignoring it.

- [ ] **Shorten long headsigns — nothing overflows any more, so what is left is taste rather than a bug.** Two halves are done: `collapseRepeatedPhrases()` in `src/headsign.js` drops a stuttered phrase, and `destinationSize()` in `src/render/board.js` steps the type down so a long destination cannot reach the time column. `Pioneer Square Chinatown International District Waterfront`, the region's longest, now fits at every density.

	What remains is that a shrunken row is visibly smaller than its neighbours, which is a legibility cost on the very row that is hardest to read. Options if it ever bothers: **stripping a trailing `Via …` clause** is tempting but loses real information — `Rainier Beach Via Rainier Ave S` and `Madrona and 34th Ave Via E Cherry St` both use it to distinguish a routing, and the owner wants the `Via` kept — and **truncation** would be worse: `Rainier Beach Via Rai…` is worse than useless.

	If it is picked up, the honest improvement is **measuring rendered width instead of estimating it**. `AVERAGE_ADVANCE` in `render/board.js` is 0.5 per character, calibrated from one render at 0.46 and rounded up for slack, so every shrunken row is a few points smaller than it strictly needs to be. Real measurement means glyph metrics, which live in `render/index.js` with the font rather than in the pure layout module — a bigger change than it looks.

- [ ] **Consider showing OneBusAway service alerts.** The real Connectpoint signs devote a block to them, and it is genuinely the most useful thing on the sign when it fires — a cancelled trip is otherwise invisible in a departures list.

	**Reserved space is rejected** (decided 2026-08-01): permanently giving up a row for something that is usually absent is a bad trade on a board with four rows per direction. Preferred shape instead, cheapest first:

	1. **A ⚠ marker on the affected row**, beside the badge or destination. Costs zero rows and zero layout change. Conveys "something is wrong with this trip" but not what.
	2. **Alert text under the destination**, within the existing row. Costs no rows, but rows would need to already have the height for a second line, which they currently do not.
	3. **Drop exactly one row, only while an alert exists**, and use the freed strip for a single line of alert text. The dropped row should be the last one, which is the least useful since it is furthest out.

	Recommended: **1 plus 3** — the marker says which trip, the strip says what. A layout that changes height also changes the image and therefore the filename, which triggers a repaint — that is correct here, since an alert appearing is exactly the kind of news worth a repaint.

	Check first whether OBA returns situations on the arrivals response we already make; if it needs a second request it is a bigger change than it looks.

## Features not being built

- [ ] **Route filtering.** Explicitly **not needed** for the initial build — recorded so the reasoning is not relost. The chosen stop serves few enough routes that everything fits.

	It would matter at a busy stop: 3rd Ave & Virginia St serves 21 routes per direction, and trip counts range from 1 a day (`24`, `27`) to 141 (`E Line`). A peak-only express that runs three times a day will almost never be in the next eight departures anyway, so sorting by time already filters most of the noise — an explicit allow/deny list is only worth it if a frequent route you never ride keeps crowding out one you do.

	Must be configuration if built, per the no-hardcoding rule.

	**Session `36225e1a-cd8c-4ed8-81d0-32aace01555d` already holds the route data** for every stop looked up so far — full Monday schedules with per-route trip counts and headsigns for `1_590`, `1_430`, `1_600`, `1_420`, `40_621`, `40_623`, `40_1108`, `40_1121`. Resume it rather than re-querying; the `TEST` key is heavily rate-limited and each of those took several retries.

- [ ] **Tap to swap between directions, instead of showing both at once.** Decided 2026-08-01 to render **both stops on one screen**, which is what 1872x1404 comfortably allows. Recorded as a future option, not a gap.

	**The X has a gesture touch bar, not a touchscreen**, and the three gestures behave completely differently — only one of them is usable:

	- **Middle tap → a full `/api/display` round trip.** The one that works. The request arrives with `Update-Source` set to a touch value rather than `timer`, so the server can recognise a deliberate press and return the other direction.
	- **Left/right tap or swipe → `show_cached_image_by_offset()`, zero HTTP.** Repaints a *previously served image* straight from the flash playlist cache. On a departures board that silently shows stale times with nothing marking them stale — worse than useless. Do not build on this gesture.
	- **Both corners held → the WiFi reset flow.** Do not design anything near it.

	Costs if built: a full-panel flash plus a network round trip per press, so it is not instant, and it needs server-side state for "which direction is currently showing" — the same store as the recovery generation, so no new infrastructure.

	The trade is a permanently-visible second stop for one hidden behind a press, which is why it lost. Revisit only if the two-stop layout turns out to be too cramped to read from across the room.

	All firmware-source-derived, never observed on hardware.

- [ ] **Add Link light rail alongside a bus stop.** Rail-only boards already work — a board whose `agency` segment is `40` renders with circle badges, and `40_621`/`40_623` are the standing rail sample. What is **not** possible is a board mixing a Metro bus stop with a Link station.

	**Most of Sound Transit already comes for free.** A stop's agency prefix identifies who owns the pole, not who serves it — sampling downtown stops prefixed `1_` returned **36 Metro routes and 8 Sound Transit routes** in the same response. So ST Express buses calling at a Metro stop are already included with no code or config change. **The only thing genuinely missing is Link**, because Link stations are their own `40_` stops rather than routes at a bus stop.

	**One API, one key, 11 agencies** (queried live from `agencies-with-coverage.json`): `1` Metro Transit, `3` Pierce, `19` Intercity, `20` Kitsap, `23` City of Seattle (streetcar), `29` Community, `40` Sound Transit, `51` Amtrak, `95` WA State Ferries, `96` Monorail, `97` Everett. No second integration, no second key, no second endpoint — adding an agency is purely a question of which stop IDs get requested.

	**The blocker is the URL shape.** The settled base URL is `/token/<token>/agency/<agency>/stop/<stopId>[,<stopId>]`, with a single shared `agency` segment, which cannot express a cross-agency pair. Two ways out:

	- **Fully-qualified stop IDs, dropping the `agency` segment**: `/token/<token>/stop/1_1550,40_99101`. Preferred. Every agency ID is numeric, so splitting on the **first** underscore is unambiguous even though the remainder is opaque and can hold its own underscores and hyphens (`40_S_KS_T3`, `40_E15-T1`, `96_SCM`). The earlier objection to this form assumed splitting on the *last* underscore, which was the real mistake.
	- **Repeat the pair**: `/token/<token>/agency/1/stop/1550/agency/40/stop/99101`. Unambiguous and readable, but verbose in a field typed by hand on a phone.

	**Changing the shape is reversible but not free** — it means re-typing the base URL in the captive portal, which wipes the device's stored `api_key` and `friendly_id` and forces a clean re-pair. Supported, not corrupt, but a physical trip to the sign.

	Also unresolved if this is picked up: Link headways are short enough that a station could crowd out the bus rows entirely, so it is a layout decision as much as a data one.

- [ ] **Mix TRMNL ecosystem plugins into this BYOS sign.** Verified against `docs.trmnl.com/go/private-api/`. Two mechanisms, and the second is the better fit:

	**Display API — proxy their rendered images.** `GET https://trmnl.com/api/display` with an `access-token` header returns an `image_url` for a rendered plugin plus a `refresh_rate`, with no device involved. Our Worker could interleave those with our own render. Use `GET /api/current_screen` instead when we do **not** want the call to auto-advance their playlist, which `/api/display` does as a side effect.

	**Plugin Data API — take the parsed JSON and render it ourselves.** Connect a plugin (weather, calendar, stocks), hide it on the playlist so it never draws natively, and its parsed JSON becomes available. **Preferred**, because the sign then keeps one visual language instead of alternating between a Metro-styled board and a TRMNL-styled card.

	Prerequisites and traps:

	- Needs a **TRMNL device or a BYOD license** for the API key, and the Private API is documented as a **Developer edition** feature. The Clarity Kit bundles Developer edition.
	- The trmnl.com API key is **separate** from the `api_key` our own `/api/setup` issues. Different tokens, different servers; pointing the device at us does not invalidate theirs.
	- **Never redirect the device to their S3 URL.** Cross-host images lose auth headers and the firmware's redirect handling is broken in several ways. Fetch the bytes and re-serve them ourselves, which also lets us guarantee an exact `image/png` Content-Type.
	- Their render is sized for whatever device model the key is registered to, and the docs' older examples show `.bmp` — **BMP is completely broken on the X**. Verify the format before trusting it, and be ready to re-encode.
	- Rotating between sources changes the image and so the `filename`, which means a repaint. That is correct, but it interacts with the flicker budget.

	**Running Terminus instead of this Worker is the other route, and it is settled — see [alternatives.md](alternatives.md#running-terminus-instead-of-this-worker).** It would bring the plugin ecosystem across natively, and it loses because it cannot be serverless. Not open work; do not re-litigate it here.

	The live option is the middle path: keep this Worker as the sign and pull plugin *data* from trmnl.com, so the plugin ecosystem arrives without giving up serverless or the render.

## Housekeeping

- [ ] **Reframe `docs/plans/initial-plan.md` as an archive, or prune it further.** 776 lines across 60 sections with ~49 superseded/corrected/struck-through markers — larger than `CLAUDE.md` and `README.md` combined, and roughly half of it is decisions that were later reversed: the OG-vs-X debate, the 10 ms CPU panic, the WOFF font that never worked.

	The specific harm is its opening: **"# STATE — Read this first"** competes with `CLAUDE.md`, which is the operative doc. A fresh session can read a dated snapshot and act on it.

	**Do not simply delete it.** The firmware research there is deeper than the `CLAUDE.md` summary, and the `blueset/trmnl-recipes` prior-art analysis exists nowhere else.

	Suggested: rename to something like `docs/decision-history.md`, replace the opening with a header pointing at `CLAUDE.md`, and optionally drop Addendum 01. It has been patched with strikethroughs about eight times; that is the wrong shape for a doc that is really a record.

	**The rejected-options half is already done.** `docs/alternatives.md` now owns Terminus, the hosted plugin, a Pi, Pages and the six withdrawn hosting options. What remains to prune is the OG-vs-X debate and the CPU-panic sections.

- [ ] **Remove dead exports in `src/`.** Two left, down from five — `rasterize()` and `pngResponse()` are now consumed by `src/byos/image.js`, and `GREY`/`FAINT` are no longer exported at all.

	- `tramGlyph()` in `render/board.js`, plus `OBA_TRAM_VIEWBOX` and `OBA_TRAM_RATIO` in `assets/oba-mark.js` — the light-rail icon from the rejected variant 11/12 badge designs. Only useful if bus and rail ever share one board, which they never will, since the modes have separate platforms. **Clearest deletion candidate.**
	- `obaMark()` in `render/board.js`, plus the `OBA_VEHICLES_*` assets it needs. **Keep this one.** The footer stopped drawing the OneBusAway mark on 2026-08-01 and it is exported only so it stays reachable; putting it back is a one-line change and re-deriving the two-step recolour is not.

	While in there: `GREY = '#6b6b6b'` is now declared separately in `render/board.js`, `render/overnight.js` and `render/notice.js`. Three copies of one value, worth collapsing into a shared palette module if any of them ever changes.

- [ ] **Close a test gap in `src/worker.test.js`.** It asserts 404 on every path, but only with `env` undefined. It does not assert that **with `DEV_PREVIEW` enabled, `/api/display` still 404s** — that the preview cannot leak into the BYOS paths. That is the failure mode actually worth guarding, and the current test would not catch it.

- [ ] **Cover the preview's `?now=` parsing.** `requestedTime()` in `src/dev/preview.js` is verified by hand only — `?now=0` and `?now=` correctly fall back to the reference instant rather than rendering December 1969 — but it is not exported, and `preview.test.js` deliberately avoids importing the module because of the wasm. Dev-only, so low stakes; just do not count it as covered.

- [ ] **Add `postinstall` git hooks.** `git config --local core.hooksPath git-hooks` plus a pre-commit running lint and tests.

- [ ] **Give `/api/log` a longer window, but only if 3 days turns out to be too short.** Decided 2026-08-01: `console.log` plus `npm run tail` and the dashboard's Workers Logs view is the live view, the `DEVICE_LOGS` dataset is the history, and the Free plan's **3-day** console retention (200,000 logs/day; Paid is 7) is accepted — a device that fails overnight is still readable the next morning, which is the case that matters. Written up in `docs/development.md`.

	If it does prove too short, the cheap version is appending to KV or D1 keyed by day and reading it back through an authenticated endpoint under the existing token prefix; a JSON dump is enough. **A custom UI is the last thing to build, not the first**, and quite possibly never.

- [ ] **Delete `.npm-cache/` when convenient.** 284 MB sitting in the project directory. Covered by `~/.gitignore_global` so it is harmless to git, and it only exists because `~/.npm/_cacache` is denied in the sandbox. Removing it just costs a slower next install.

## Not actionable / need to reproduce

Nothing currently.
