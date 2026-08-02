# TODO

Completed items are deleted rather than checked off. Anything worth keeping moves to `CLAUDE.md`, the relevant doc, or a code comment first — this file is the work queue, not the record.

## Where this stands — updated 2026-08-01

**The design is now in `src/` and reproducible from source** — verified end to end on 2026-08-01. `npm run dev`, then `http://localhost:8788/_preview`, renders both boards at 1872x1404 in 4-bit greyscale. They matched the spike byte for byte when the code moved out of it; the bus board has since diverged (52785 bytes, was 53681) because the direction labels changed, which is a real change rather than drift. The spike in `.claude/tmp/cpu-spike/` is history now: its PNGs record variants that were rejected, not the current design.

Settled and written up in `CLAUDE.md`: the Metro-faithful layout, real-time vs scheduled (Metro's own `Scheduled`-above-the-time treatment), Fira Sans, the two-stop grouping with direction bands, circle badges for light rail, the OneBusAway footer mark, and the sample stops.

In `src/` and tested — **202 tests, lint clean**: `render/png.js` (quantise + encoder), `render/board.js` (SVG + `directionLabel`), `render/index.js` (resvg), `assets/` (pre-processed logos), `dev/sample-boards.js`, `dev/preview.js`, `config.js`, `clock.js`, plus `filename.js` and `routing.js` from before.

Docs are split by audience: `README.md` is the overview and links out, `docs/how-it-works.md` explains the BYOS architecture and the constraints it imposes, `docs/alternatives.md` is why it is a Worker rather than Terminus, a plugin, a Pi or Pages, `docs/deploying.md` is everything needed to stand up your own sign, `docs/development.md` is everything needed to work on the code.

**The four device routes are in, as of 2026-08-01** — `src/byos/`, one file per endpoint, landed together and dispatched off the gate's classification. Verified against `wrangler dev` and by looking at the PNG rather than its status code. They serve the "No departure data" notice screen until OneBusAway is wired up.

**To view the design:** `npm run dev`, then `http://localhost:8788/_preview`. Requires `DEV_PREVIEW=1` in `.dev.vars`.

### What the config surface already guarantees

Built 2026-08-01. `readConfig()` in `src/config.js` is the only place that reads a display or scheduling value off `env`; `formatBoardTime()` in `src/clock.js` turns a timestamp into the header fields and the "Updated at" stamp. What the next piece needs to know:

- Everything coerces and falls back rather than throwing, deliberately: the same var arrives as a **number** from `[vars]` and as a **string** from `.dev.vars` or a secret, and `/api/display` must never fail over a config value. Refresh rates below 1 second are refused, since 0 hot-loops the device flat.
- `activeStartMinutes`/`activeEndMinutes` are exposed but **unconsumed** — the scheduler is their first reader. `HEADER_TEXT` was deleted 2026-08-01 rather than wired up: both modes draw a logo rather than a word, so it was config for a case that never arises, and a different agency needs its own logo asset that no string could supply.
- Secrets are deliberately **not** in the config object, so no future log line can serialise one. `directionOverrides` is in it and is privacy-sensitive — never log the object.
- **`formatBoardTime()` throws on a non-finite timestamp, on purpose, and nothing catches it yet.** This is the one place the never-fail rule and a deliberate throw collide: `/api/display` must catch it and fall back to the render-failed screen rather than let a missing OneBusAway `currentTime` take down the endpoint. Silently formatting a bad timestamp would stamp the board 1969, which is worse.
- The preview renders at a fixed reference instant by default so the header stays consistent with the fixture rows; `?now=live` renders at the real clock.
- Verified against ICU rather than assumed: legacy zone aliases (`US/Pacific`, `PST`) resolve to the full zone and stay DST-aware, so the timezone guard only has to catch what actually throws. Separately, ICU separates the day period with U+202F, which Fira Sans need not carry — every string is assembled from `formatToParts()` with ASCII spaces for that reason.
- **Row count is deliberately not configuration** — it follows from how many departures the data has, bounded by what fits. `rowMetrics()` in `render/board.js` derives row height from the count rather than the other way round, so no deployment sets it. Neither is the staleness threshold, which was withdrawn as a requirement when the "Updated at" stamp became the mechanism.

### What the request gate and stats page already guarantee

Built 2026-08-01. `src/gate.js` is the shell every request passes through; `src/abuse.js` classifies, `src/stats/` records and displays. What the next piece needs to know:

- **`gate()` returns either a finished `Response` or an authorized classification.** The BYOS handlers hang off the second case and should not need to touch `src/gate.js` or `src/abuse.js` at all. `src/worker.js` is deliberately just that seam — replace its final branch, which today records the outcome and 404s.
- **`recordOutcome()` must be called exactly once per authorized request.** Authenticated requests are deliberately *not* logged by the gate, because the interesting outcome is not knowable there — which board state was served, whether OneBusAway answered. Logging a placeholder in the gate plus a real row in the handler would double-count every request the sign ever makes. Add the new outcome names to `OUTCOMES` in `src/abuse.js` and pass them, along with `filenameTag`.
- **Every telemetry header is already captured**, so the handlers do not need to log them again: `Model`, `FW-Version`, `Image-Cached`, `Update-Source`, `Wake-Time`, `Refresh-Rate`, `RSSI`, `Width`/`Height` and all seven battery fields.
- **`/api/log` must call `recordDeviceLogs( env, logs, { agency, stopIds } )`** from `src/stats/device-logs.js`. It maps the documented snake_case payload onto the `DEVICE_LOGS` dataset, caps one request at 64 entries so a device cannot spend the daily write quota, never throws, and returns how many it persisted. The panel that reads them back is already on `/stats`.
  A `console.log` of the same entries is complementary and worth keeping — that is the live `wrangler tail` view. It is **not** a substitute for the dataset: `[observability.logs]` retains console output for a few days in a separate store that cannot be queried alongside the request rows explaining what the device was reacting to, and the entries that matter arrive during a failure, which is exactly when nobody is watching a tail.
- **Analytics Engine columns are positional and permanent.** `BLOB_FIELDS` and `DOUBLE_FIELDS` in `src/stats/schema.js` are the schema. **Append only** — inserting a field mid-list silently reinterprets every historical row, with no migration and no way to notice afterwards except that the numbers look wrong.
- **The token is never recorded, only a 4-byte fingerprint.** Raw paths are never recorded either, except for unauthenticated requests, which go through `safeProbePath()` — an allow-list that keeps `/wp-login.php` and replaces anything long or high-entropy with `[redacted]`, because a URL one character away from ours would otherwise write the live shared secret into the dataset.
- **Stop IDs are recorded raw, by decision, and are printed on `/stats`.** The stop still never enters git, but a screenshot of that page carries roughly a home address. The page says so on itself.
- **The tarpit is keyed on path shape, never on token validity.** A 25-second delay exceeds the device's 15-second read timeout, and the first three failed polls draw nothing at all — so tarpitting a well-shaped path would make a token typo at the captive portal into a sign that does nothing for seven minutes with no clue why. `src/abuse.test.js` asserts `tarpit: false` for `bad-token` specifically; that assertion is the regression guard for the whole design.

### Still to do on top of the gate

- **Fill in `CLOUDFLARE_ACCOUNT_ID`** in `wrangler.toml`, and **enable Analytics Engine in the dashboard** before the first deploy or it fails with error `10089`. Both are one-time human steps; the value is in `.cloudflare.env`.
- **Watch the tarpit's effect on concurrency once there is real traffic.** A held request occupies a Worker invocation for 25 seconds. Wall time is not billed CPU so it costs nothing against that budget, but a large enough flood could crowd out the device's own poll. If the sign ever fails during an observable scan, lower `TARPIT_MS` or drop the tarpit — nothing depends on it.

### The next piece

**Live OneBusAway data.** One fetch per stop; `references.routes` and `references.stops` ride along so no second call is needed. Dedup by `tripId`, drop anything already past, use `predictedArrivalTime` and fall back to `scheduledArrivalTime` with `live: false`. Map `route.type` to board mode — **0 is rail, 3 is bus; never match on the route name**, since RapidRide's `H Line` is a bus and would be drawn as rail. Note the region also returns type `2` (Sounder, Amtrak) and type `4` (ferries), so the mode map needs a default rather than assuming 0 or 3.

Take the destination from each arrival's **`tripHeadsign`**, never from `stopGroupings[].stopGroups[].name`. The group names look like headsigns and are not: OneBusAway disambiguates same-named groups by appending a counter, so route 125's two groups both come back as `Downtown Seattle South Seattle College - 0` and `- 1`. Drawing that on the panel would put a stray `- 0` on the sign. Take the "Updated at" timestamp from OBA's `currentTime`, not our own clock.

It slots into a `departuresScreen()` in `src/byos/screens.js`: return a `{ tag, notice|board }` the way the three existing screens do, and `/api/display` and `/image` both pick it up with no other change. The cache key is hashed over the rendered SVG, so nothing extra is needed to make the filename move when the departures do.

Still open and genuinely undecided: where the recovery generation is stored, and how the "Updated at" stamp is sized (cannot be judged until the device arrives).

### Left open by the endpoints work — 2026-08-01

- **The setup logo is the full-panel board image.** `/api/setup` must return an `image_url` that downloads, or the friendly-ID screen is replaced by an error screen, so it points at the ordinary image route — meaning the "logo" on the pairing screen is a 1872x1404 notice board. It will look wrong. Rendering something small needs a second size through `rasterize()`, which is hardcoded to panel dimensions. Cosmetic, shown once, and unverifiable until the device arrives.
- **`refresh_rate` is a single constant.** `/api/display` returns `refreshActiveSeconds` unconditionally. `activeStartMinutes`, `activeEndMinutes` and `refreshIdleSeconds` are still unconsumed, which is step 8 of the task order in `docs/plans/initial-plan.md` — the windowed rate plus the overnight "seconds until morning", computed fresh each evening rather than assumed constant.
- **The `Access-Token` check is a second copy of the path secret, not a second factor**, and the earlier note that it needed storage was wrong. `src/byos/credentials.js` derives the key by HMAC from `DEVICE_TOKEN`, so it is reproducible on every request and needs nothing persisted. What it does *not* do is add a factor: the device obtains the key from `/api/setup`, which anyone holding the URL can reach. Rotating `DEVICE_TOKEN` invalidates both at once and forces a re-pair — correct, but a physical trip to the sign.
- **`byos-unimplemented` is retired but undeletable.** Nothing emits it now; rows carrying it predate the endpoints. Left in `OUTCOMES` with a comment saying so, because it is already in the dataset.
- **The zero-flicker no-op is gone, and the stamp is only half the reason.** The cache key is hashed over the rendered SVG, which carries a minute-resolution "Updated at" stamp, so at `refresh_rate: 60` the panel repaints every poll. Minute accuracy is a hard requirement — a stamp that can be hours stale on a healthy sign is indistinguishable from the failure it exists to expose — but **do not attribute the whole cost to it.** Once departures are live, any row showing a countdown changes every minute on its own, so the board's hash moves every minute regardless. The stamp costs nothing during service and everything only when the board is otherwise static: overnight, on an all-clock-times board, and on the degraded screens. Which is where freshness is hardest to judge, so it is spent where it buys the most.

	**If flicker ever needs cutting, the countdown is the lever, not the stamp.** Quantising the stamp saves almost nothing during service because the countdowns dominate; dropping countdowns for clock times would cut it by an order of magnitude, since a clock-time row is static until a departure rolls off. `CLAUDE.md` already argues for that independently on honesty grounds — a frozen "**4** min" is actively false in the largest type on the sign, while "4:26 pm" stays true forever. Two arguments pointing the same way. Verified 2026-08-01 that the X gets no partial refresh either way: the partial path is commented out at `display.cpp:1836-1839`, and `REFRESH_PARTIAL` is only ever selected for a 1bpp image while ours is 4-bit greyscale.

## Quick Wins

Try to do as many of these as possible. Don't do one if it'd overlap code with another though. Only do the ones that are self-contained.

- [ ] swap sound transit text for their logo when at a light rail stop
	maybe use the icon+link from https://storage.ghost.io/c/19/31/1931222a-d1c5-42ac-8932-2ee3ac1f8927/content/images/old-theurbanist-org/wp-content/uploads/2019/11/new-totems.png
	or use the logo from https://www.soundtransit.org/get-to-know-us/our-brand/logos


## High Priority

- [ ] Once this is ready for initial testing (before device arrives)
	- [ ] compare to the template repo to see if anything should be added/changed or any features would make sense to add etc
	- [ ] look for any perf optimizations to improve the flicker time or reduce worker load or things of that nature. aslso cruft removal from source code
	- [ ] Once this is ready for initial testing, run a `/security-review`
	- [ ] test everything
	- [ ] audit all the docs to make sure they're accurate and up to date. dev/deplyoy/alternaitves/readme should be durable rather than referenceing past changes

- [ ] flush wall mount options according to claude - not reviewed
	- French cleat, VHB'd to the back. A 3–5mm aluminum or printed cleat bonded with 3M VHB 4941, mating to a cleat screwed into the wall. Zero holes in the device, sits nearly flush, holds far more than 450g, and lifts straight up and off for charging. This is what I'd do.

	- Printed surround that doubles as the mount. it's the version that fits the project: print a shroud that the X drops into, with keyhole slots in the shroud rather than the case. And then — look at your Connectpoint photo again. That unit has an angled sun hood over the top and sides. Reproducing that hood in black filament would make the thing read as a real transit fixture rather than a tablet on a wall. Best-looking outcome by a distance.

	- Boost the magnet. If the included magnetic sticker holds but feels marginal, screw a steel plate to the wall and add a few N52 discs. Keeps the intended lift-off-to-charge behavior, no fabrication.

	- Industrial Velcro. 365–450g is nothing. Ugly solution, five minutes, fully reversible, and genuinely fine behind a device that covers it.

	- Shadow box frame. Mount the X inside a shallow picture frame and hang the frame conventionally. Reads as a deliberate object, which matters for a gift.

	- 3d print something from https://github.com/usetrmnl/mounts
		- hidden magnet
		- mainframe


- [ ] **Sweep the failure modes, guard them, log them, and get notified.** Right now nothing tells us the sign is wrong — the panel holds its last image, the device cannot be prodded, and Cloudflare raises no alarm. Best done after the three endpoints exist, since most of it hangs off them. Five parts:

	**1. Write the inventory.** The five staleness rows in `CLAUDE.md` are a start but cover only staleness. Enumerate every mode in both directions and say for each what we can detect and what we cannot: OneBusAway down / 429 / empty / malformed, the render throwing, `formatBoardTime()` on a missing `currentTime`, a bad or missing config value, a bad token, a stop ID that no longer exists, the device never waking, WiFi lost, battery flat, the PNG failing to decode silently, and the stuck firmware error screen. Mark honestly which ones are invisible to us — that set is the argument for everything below.

	**2. Guard each one.** Every detectable mode gets a degraded screen that is obvious across the room, with a `filename` stable for that state and distinct from every good render, per `FILENAME_TAGS` in `src/filename.js`. Nothing may throw out of `/api/display`.

	**3. Log each one, in one shape.** A single structured event so the Workers Logs view is searchable — mode, stop hash, upstream status, duration. Always `redactPath()`; never the raw path, never `directionOverrides`.

	**4. Get notified — nothing is built in.** Verified 2026-08-01: Cloudflare's notification catalogue has **no Workers alert types at all**, and Workers Logs has no alerting layer, so this has to be built. Two halves, and they fail differently:
	- **Worker up but something is wrong** (OBA down, render failed, config bad). The Worker can call out itself: a fire-and-forget `fetch()` to a webhook inside `ctx.waitUntil()`, so it never delays the device's response.
		Transport, cheapest first: **ntfy.sh** (free, self-hostable, iOS and Android push, one `POST` with a plain-text body), a **Discord or Slack webhook** (free, one `POST`, good if you already live there), **Pushover** (one-time ~$5 per platform, the most reliable phone push). Cloudflare's own `send_email` binding also exists but wants Email Routing on a domain in the account with verified destination addresses, which a `workers.dev` deployment does not have — so it is the highest-friction option, not the lowest.
		**The trap is volume.** `/api/display` runs ~1440 times a day, so an alert per failed poll during an OBA outage is 1440 messages. It has to fire on **state transitions only** — entering the failure and recovering from it — which needs the same durable store as the recovery generation below. One piece of infrastructure, not two.

	- **Worker down.** Same class as the unfixable staleness case: a Worker that is not running cannot report that it is not running, so anything living inside Cloudflare is useless here. Two shapes, and one is clearly better:
		- **External uptime monitor** (UptimeRobot's free tier is 50 monitors at 5-minute intervals) polling a health path. Awkward here — everything lives under `/token/<token>/`, so either the monitor holds the secret or we add an unauthenticated health path, which is a new unauthenticated surface on a Worker whose whole access design is "token first, short-circuit before anything else".
		- **Dead man's switch.** A **Cron Trigger** (5 per account on Free) pings healthchecks.io on a schedule (free tier: 20 checks) and it alerts when the pings stop. **Preferred** — no new endpoint, no secret handed to a third party, and it catches "deployed but broken" as well as "Cloudflare is down", because the ping only happens if our code actually ran.

	- **Device silent.** Only detectable server-side, since the Worker is the only thing that ever sees a poll. The same cron reads a "last seen" timestamp out of KV and alerts when it is older than a few refresh intervals.
		**One cron plus one KV key covers both directions** — the outbound ping proves the Worker is alive, the recency check proves the sign is. The whole monitoring design fits the Free plan with room to spare.

	- Early warning is nearly free once `/api/log` is stored: a climbing `retry` or a falling `wifi_signal` shows up **before** the sign goes dark, and is the only lead time we will ever get.

	- **Alerts must never carry the raw path.** The device token is a path segment, so a webhook body with a URL in it publishes the secret to Discord or ntfy. `redactPath()` applies to alerts exactly as it does to logs.

	- **Tuning caveat:** "device has not polled" will false-positive against the overnight sleep window once that exists. The threshold has to know the schedule, or it pages every night at 2am.

	**5. Return as much as possible in both directions.** Device → Worker is fixed — the firmware sends what it sends — so the work is capturing all of it rather than asking for more. Worker → device is genuinely constrained: the response vocabulary has no field meaning "degraded", and getting it wrong is destructive (`status: 500` factory-resets, an absent `refresh_rate` flat-batteries). **The only channel to a human is the rendered image**, which is why the degraded screens in part 2 carry the whole load.

- [ ] **Store the recovery generation.** The only genuinely stateful piece left. Written on error-state transitions only, so quota is not the constraint — the open question is the **read** path, since `/api/display` reads it ~1440x/day and must never fail. Decide the failure behaviour explicitly: on a read error, proceed with generation 0 and serve a valid response rather than failing the endpoint.

- [ ] **Size the "Updated at" stamp properly — it is the single load-bearing staleness defense.** "At a glance" is the entire condition the accepted risk rests on, so it must be readable from wherever the departures are. It currently sits bottom-left at 38px regular, starting at the left margin now that the OneBusAway mark is gone — better than a footer caption, still unproven at physical size, and the removal of the logo freed the width to grow it. Going to four rows helped the ratio without touching the stamp: the countdown numeral came down from 76px to 62px while the stamp held at 38. The stacked day/date in the header is the second half of this — it catches a panel frozen since yesterday, which a bare `h:mm` cannot.

- [ ] **Match the sign's typeface more closely.** Fira Sans is chosen and applied — it is the only tested open face with the **open-top `4`** the real sign uses, and the reasoning is written up in `CLAUDE.md`. What remains is that the real face is still unidentified: it is a Connectpoint choice, absent from Metro's brand standards, and pinning it down needs the vendor spec or a font-identification service. Frutiger and Myriad are the closest matches and both are commercial.
	**Generating a font is not the answer.** Drawing a usable typeface is not something to take on here, and modifying one open glyph to notch the `4` gets a single character closer while leaving every other letterform unchanged, which is the wrong end of the effort curve.
	Related: settle the face before subsetting it.

- [ ] **Write the pairing runbook — how the sign actually gets loaded.** Asked 2026-08-01 and worth writing down, because "how does this get onto the device" has no answer anywhere in the repo yet, and it is the step with the most ways to fail silently.
	The runbook needs: joining the captive portal, entering the base URL, and the traps already documented — the URL is discarded silently if the WiFi password is wrong, changing the base URL wipes `api_key` and `friendly_id` and forces a clean re-pair, and `/api/setup` follows no redirects at all so enrollment fails quietly if anything redirects.
	Cannot be finished until the device arrives, but the checklist can be drafted from the firmware research now. `docs/deploying.md` step 4 is the skeleton.

- [ ] **Subset the font, and revisit `@expo-google-fonts/inter`.** Picked mid-spike purely because it ships real TTFs where fontsource ships none; it drags in the full Inter weight range plus a `.ttf.png` preview per face. `docs/initial-plan.md` always intended a subsetted font (digits + latin) vendored into the repo. Provisional, not the endgame.

- [ ] **OneBusAway API key — requested 2026-08-01, waiting on Sound Transit.** Add it to `.dev.vars` as `OBA_API_KEY` when it arrives, and `npx wrangler secret put OBA_API_KEY` before the first real deploy.
	Source confirmed against the operator's own page: `pugetsound.onebusaway.org/wiki/Developers` sends you to `soundtransit.org/Open-Transit-Data` and lists no alternative. **There is no way to get a key "direct from OneBusAway"** — OBA is open-source software and each regional deployment issues its own keys; there is no central authority.
	`TEST` covers development in the meantime but is **heavily rate-limited** — it returned HTTP 429 twice during a handful of exploratory calls on 2026-08-01. Retry with backoff, and do not build anything whose correctness depends on its throughput.


- [ ] **The TRMNL X has not arrived as of 2026-08-01.** Nothing in the server work is blocked by that, but two things cannot be closed without it, and neither should be assumed done:
	- **The BYOS contract is verified against source, never against hardware.** Every silent-failure trap in `CLAUDE.md` — exact `image/png`, `status: 0`, the `filename` cache gates, the 31-character bug — is read from firmware, not observed. First contact with the real device is the real test.
	- **Legibility at physical size.** 227 PPI on a 10.3" panel cannot be judged on a monitor, and the design must be redrawn at native resolution rather than scaled up.
	Until it arrives, build against the local preview page instead.


- [ ] see if claude can design a sticker that could print and put overtop the black case. something colorful and metro brand colors



## Medium Priority

- [ ] **Decide how `.cloudflare.env` gets into wrangler's environment.** It holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, but nothing loads it — the `deploy` script is a bare `wrangler deploy`. Either source it by hand each time, or change the script to `source .cloudflare.env && wrangler deploy`. Left alone rather than guessed at.

- [ ] **Add `postinstall` git hooks once there are real tests.** `git config --local core.hooksPath git-hooks` plus a pre-commit running lint and tests. Skipped during scaffolding — nothing worth gating on yet.

## Low Priority

- [ ] **Reframe `docs/plans/initial-plan.md` as an archive, or prune it further.** 776 lines across 60 sections with ~49 superseded/corrected/struck-through markers — larger than `CLAUDE.md` and `README.md` combined, and roughly half of it is decisions that were later reversed: the OG-vs-X debate, the 10 ms CPU panic, the WOFF font that never worked.
	The specific harm is its opening: **"# STATE — Read this first"** competes with `CLAUDE.md`, which is the operative doc. A fresh session can read a dated snapshot and act on it.
	**Do not simply delete it.** The firmware research there is deeper than the `CLAUDE.md` summary, and the `blueset/trmnl-recipes` prior-art analysis exists nowhere else.
	Suggested: rename to something like `docs/decision-history.md`, replace the opening with a header pointing at `CLAUDE.md`, and optionally drop Addendum 01. It has been patched with strikethroughs about eight times; that is the wrong shape for a doc that is really a record.
	**The rejected-options half is already done.** `docs/alternatives.md` now owns Terminus, the hosted plugin, a Pi, Pages and the six withdrawn hosting options; the four sections here that duplicated them were replaced with pointers on 2026-08-01. What remains to prune is the OG-vs-X debate and the CPU-panic sections. The `blueset/trmnl-recipes` prior-art analysis is still the part that exists nowhere else — keep it.

- [ ] **Remove dead exports in `src/`.** Five exported symbols with no consumer — but one of them is parked on purpose, so read before deleting:
	- `obaMark()` in `render/board.js`, plus the `OBA_VEHICLES_*` assets it needs. **Keep this one.** The footer stopped drawing the OneBusAway mark on 2026-08-01 and it is exported only so it stays reachable; putting it back is a one-line change and re-deriving the two-step recolour is not.
	- `tramGlyph()` in `render/board.js`, plus `OBA_TRAM_VIEWBOX` and `OBA_TRAM_RATIO` in `assets/oba-mark.js` — the light-rail icon from the rejected variant 11/12 badge designs. Only useful if bus and rail ever share one board, which they never will, since the modes have separate platforms. **Clearest deletion candidate.**
	- `GREY` and `FAINT` in `render/board.js` — exported for no reason; both are only used inside that module.
	- `rasterize()` and `pngResponse()` in `render/index.js` — written speculatively for the BYOS work. `pngResponse()` earns its keep once `/api/display` lands, because it is where the exact `image/png` Content-Type rule gets enforced in one place; dead until then.

- [ ] **Close a test gap in `src/worker.test.js`.** It asserts 404 on every path, but only with `env` undefined. It does not assert that **with `DEV_PREVIEW` enabled, `/api/display` still 404s** — that the preview cannot leak into the BYOS paths. That is the failure mode actually worth guarding, and the current test would not catch it.

- [ ] **Cover the preview's `?now=` parsing.** `requestedTime()` in `src/dev/preview.js` is verified by hand only — `?now=0` and `?now=` correctly fall back to the reference instant rather than rendering December 1969 — but it is not exported, and `preview.test.js` deliberately avoids importing the module because of the wasm. Dev-only, so low stakes; just do not count it as covered.

- [ ] **Give `/api/log` durable storage, but only if 3 days turns out to be too short.** Decided 2026-08-01: `console.log` plus `npm run tail` and the dashboard's Workers Logs view is the whole mechanism, and the Free plan's **3-day retention** (200,000 logs/day; Paid is 7) is accepted — a device that fails overnight is still readable the next morning, which is the case that matters. Written up in `docs/development.md`.
	If it does prove too short, the cheap version is appending to KV or D1 keyed by day and reading it back through an authenticated endpoint under the existing token prefix; a JSON dump is enough. **A custom UI is the last thing to build, not the first**, and quite possibly never.

- [ ] **Delete `.npm-cache/` when convenient.** 284 MB sitting in the project directory. Covered by `~/.gitignore_global` so it is harmless to git, and it only exists because `~/.npm/_cacache` is denied in the sandbox. Removing it just costs a slower next install.

- [ ] **Shorten long headsigns — nothing overflows any more, so what is left is taste rather than a bug.** Two halves are done: `collapseRepeatedPhrases()` in `src/headsign.js` drops a stuttered phrase, and `destinationSize()` in `src/render/board.js` steps the type down so a long destination cannot reach the time column. `Pioneer Square Chinatown International District Waterfront`, the region's longest, now fits at every density.
	What remains is that a shrunken row is visibly smaller than its neighbours, which is a legibility cost on the very row that is hardest to read. Options if it ever bothers: **stripping a trailing `Via …` clause** is tempting but loses real information — `Rainier Beach Via Rainier Ave S` and `Madrona and 34th Ave Via E Cherry St` both use it to distinguish a routing, and the owner wants the `Via` kept — and **truncation** would be worse: `Rainier Beach Via Rai…` is worse than useless.
	If it is picked up, the honest improvement is **measuring rendered width instead of estimating it**. `AVERAGE_ADVANCE` in `render/board.js` is 0.5 per character, calibrated from one render at 0.46 and rounded up for slack, so every shrunken row is a few points smaller than it strictly needs to be. Real measurement means glyph metrics, which live in `render/index.js` with the font rather than in the pure layout module — a bigger change than it looks.

- [ ] **Route filtering.** Explicitly **not needed** for the initial build — recorded so the reasoning is not relost. The chosen stop serves few enough routes that everything fits.
	It would matter at a busy stop: 3rd Ave & Virginia St serves 21 routes per direction, and trip counts range from 1 a day (`24`, `27`) to 141 (`E Line`). A peak-only express that runs three times a day will almost never be in the next eight departures anyway, so sorting by time already filters most of the noise — an explicit allow/deny list is only worth it if a frequent route you never ride keeps crowding out one you do.
	Must be configuration if built, per the no-hardcoding rule.

	**Session `36225e1a-cd8c-4ed8-81d0-32aace01555d` already holds the route data** for every stop looked up so far — full Monday schedules with per-route trip counts and headsigns for `1_590`, `1_430`, `1_600`, `1_420`, `40_621`, `40_623`, `40_1108`, `40_1121`. Resume it rather than re-querying; the `TEST` key is heavily rate-limited and each of those took several retries.

- [ ] **Mix TRMNL ecosystem plugins into this BYOS sign.** Asked 2026-08-01, and it is genuinely possible — verified against `docs.trmnl.com/go/private-api/`. Two mechanisms, and the second is the better fit:

	**Display API — proxy their rendered images.** `GET https://trmnl.com/api/display` with an `access-token` header returns an `image_url` for a rendered plugin plus a `refresh_rate`, with no device involved. Our Worker could interleave those with our own render. Use `GET /api/current_screen` instead when we do **not** want the call to auto-advance their playlist, which `/api/display` does as a side effect.

	**Plugin Data API — take the parsed JSON and render it ourselves.** Connect a plugin (weather, calendar, stocks), hide it on the playlist so it never draws natively, and its parsed JSON becomes available. **Preferred**, because the sign then keeps one visual language instead of alternating between a Metro-styled board and a TRMNL-styled card.

	Prerequisites and traps:
	- Needs a **TRMNL device or a BYOD license** for the API key, and the Private API is documented as a **Developer edition** feature. The Clarity Kit bundles Developer edition.
	- The trmnl.com API key is **separate** from the `api_key` our own `/api/setup` issues. Different tokens, different servers; pointing the device at us does not invalidate theirs.
	- **Never redirect the device to their S3 URL.** Cross-host images lose auth headers and the firmware's redirect handling is broken in several ways. Fetch the bytes and re-serve them ourselves, which also lets us guarantee an exact `image/png` Content-Type.
	- Their render is sized for whatever device model the key is registered to, and the docs' older examples show `.bmp` — **BMP is completely broken on the X**. Verify the format before trusting it, and be ready to re-encode.
	- Rotating between sources changes the image and so the `filename`, which means a repaint. That is correct, but it interacts with the flicker budget — a rotating playlist gives up the zero-flicker no-op that unchanged departures currently enjoy.

	**Running Terminus instead of this Worker is the other route, and it is settled — see [alternatives.md](alternatives.md#running-terminus-instead-of-this-worker).** It would bring the plugin ecosystem across natively, and it loses because it cannot be serverless. Not open work; do not re-litigate it here.

	The live option is the middle path: keep this Worker as the sign and pull plugin *data* from trmnl.com per the API above, so the plugin ecosystem arrives without giving up serverless or the render.


- [ ] **Consider showing OneBusAway service alerts.** The real Connectpoint signs devote a block to them, and it is genuinely the most useful thing on the sign when it fires — a cancelled trip is otherwise invisible in a departures list.
	**Reserved space is rejected** (decided 2026-08-01): permanently giving up a row for something that is usually absent is a bad trade on a board with only six. Preferred shape instead, cheapest first:
	1. **A ⚠ marker on the affected row**, beside the badge or destination. Costs zero rows and zero layout change. Conveys "something is wrong with this trip" but not what.
	2. **Alert text under the destination**, within the existing row. Costs no rows, but rows would need to already have the height for a second line, which they currently do not.
	3. **Drop exactly one row, only while an alert exists**, and use the freed strip for a single line of alert text. The dropped row should be the last one, which is the least useful since it is furthest out.
	Recommended: **1 plus 3** — the marker says which trip, the strip says what. A layout that changes height also changes the image and therefore the filename, which triggers a repaint — that is correct here, since an alert appearing is exactly the kind of news worth a repaint.
	Check first whether OBA returns situations on the arrivals response we already make; if it needs a second request it is a bigger change than it looks.

- [ ] **Tap to swap between directions, instead of showing both at once.** Decided 2026-08-01 to render **both stops on one screen** for the initial build, which is what 1872x1404 comfortably allows. This is recorded as a future option, not a gap.

	**The X has a gesture touch bar, not a touchscreen**, and the three gestures behave completely differently — only one of them is usable:

	- **Middle tap → a full `/api/display` round trip.** The one that works. The request arrives with `Update-Source` set to a touch value rather than `timer`, so the server can recognise a deliberate press and return the other direction.
	- **Left/right tap or swipe → `show_cached_image_by_offset()`, zero HTTP.** Repaints a *previously served image* straight from the flash playlist cache. On a departures board that silently shows stale times with nothing marking them stale — worse than useless. Do not build on this gesture.
	- **Both corners held → the WiFi reset flow.** Do not design anything near it.

	Costs if built: a full-panel flash plus a network round trip per press, so it is not instant, and it needs server-side state for "which direction is currently showing" — the same store as the recovery generation, so no new infrastructure.

	The trade is a permanently-visible second stop for one hidden behind a press, which is why it lost. Revisit only if the two-stop layout turns out to be too cramped to read from across the room.

	All firmware-source-derived, never observed on hardware.

- [ ] **Add Sound Transit / Link light rail, if it ever turns out to be wanted.** Decided 2026-08-01: **Metro only for the initial build.** Everything needed to revisit is recorded here so it does not have to be re-researched.

	**Most of Sound Transit already comes for free, so this is narrower than it sounds.** A stop's agency prefix identifies who owns the pole, not who serves it — sampling downtown stops prefixed `1_` returned **36 Metro routes and 8 Sound Transit routes** in the same response. So ST Express buses calling at a Metro stop are already included with no code change and no config change. **The only thing genuinely missing is Link light rail**, because Link stations are their own `40_` stops rather than routes at a bus stop.

	**One API, one key, 11 agencies** (queried live from `agencies-with-coverage.json`): `1` Metro Transit, `3` Pierce, `19` Intercity, `20` Kitsap, `23` City of Seattle (streetcar), `29` Community, `40` Sound Transit, `51` Amtrak, `95` WA State Ferries, `96` Monorail, `97` Everett. No second integration, no second key, no second endpoint — adding an agency is purely a question of which stop IDs get requested.

	**The blocker is the URL shape, and only for Link.** The settled base URL is `/token/<token>/agency/<agency>/stop/<stopId>[,<stopId>]`, with a single shared `agency` segment. That cannot express a cross-agency pair like "Metro bus stop + Link station". Two ways out:

	- **Fully-qualified stop IDs, dropping the `agency` segment**: `/token/<token>/stop/1_1550,40_99101`. Preferred. Every agency ID is numeric, so splitting on the **first** underscore is unambiguous even though the remainder is opaque and can hold its own underscores and hyphens (`40_S_KS_T3`, `40_E15-T1`, `96_SCM`). The earlier objection to this form assumed splitting on the *last* underscore, which was the real mistake.
	- **Repeat the pair**: `/token/<token>/agency/1/stop/1550/agency/40/stop/99101`. Unambiguous and readable, but verbose in a field typed by hand on a phone.

	**Changing the shape is reversible but not free** — it means re-typing the base URL in the captive portal, which wipes the device's stored `api_key` and `friendly_id` and forces a clean re-pair. That is a supported operation, not a corrupt state, but it is a physical trip to the sign.

	Also unresolved if this is picked up: Link headways are short enough that a station could crowd out the bus rows entirely, so it is a layout decision as much as a data one.


## Not Actionable / Need to Reproduce
