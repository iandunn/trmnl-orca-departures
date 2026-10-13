# The stats page — `src/stats/`

Loaded when working under `src/stats/`. Split out of the root `CLAUDE.md` on 2026-08-02.

## The stats page

`/stats`, HTTP Basic on `STATS_PASSWORD`, matched **before** the token gate because it carries no path secret and would otherwise 404 as an unshaped path. Backed by Analytics Engine: free on the Workers Free plan at 100k writes and 10k read queries a day, written through a Worker binding and read through an HTTP SQL API that needs `CLOUDFLARE_ACCOUNT_ID` and a token scoped to Account Analytics read. **Expected volume is ~3-5k data points a day against that 100k** — there is no quota question, stated so nobody re-derives one.

**Blob and double positions in `src/stats/schema.js` are permanent.** Analytics Engine rows are positional arrays with no schema, so inserting a field mid-list silently reinterprets every historical row, with no migration and no way to detect it afterwards. **Append only.** Queries reference columns through `blobColumn()` rather than writing `blob14`, so appending cannot shift a query onto the wrong column. `src/stats/schema.test.js` pins the order by absolute position — never as "the last one", which would silently follow a column that moved.

## Twenty blobs and twenty doubles, and the row is rejected whole past that

**Analytics Engine's per-row ceiling is 20 blobs and 20 doubles.** It is a fixed number of slots, not a schema that grows with what you write — `SELECT * LIMIT 1` returns `double1` through `double20` on a dataset that has only ever been written 10 doubles. A row handed more than 20 of either is **dropped entirely**, not truncated to the first 20.

**This cost a full day of data on 2026-08-02.** Seven device columns and `upstreamReason` were appended to a request schema already at 20, taking it to 28. From that deploy until the split below, **every** write was rejected: no request outcomes, no rejections, no scanner traffic. Nothing surfaced it — `recordRequest()` swallowed the error, `/stats` rendered a reassuring "that is the expected state" banner over an empty dataset, and 739 tests stayed green. The only visible symptom was two panels reporting `unknown column: "blob21"`, which reads like a bad query rather than like a dataset that has stopped accepting rows.

Three things now guard it, and the order matters because the first two are not what you would expect:

- **`assertWithinLimits()` throws at module load** in every file defining a dataset schema. It cannot be swallowed by a write path's catch.
- **`npm test` is what catches that throw. `wrangler deploy --dry-run` is not** — verified by pushing the list to 21 on purpose: the dry-run bundles without executing top-level code and reports a clean upload, while eight test files fail. So `npm run deploy` runs the suite first, and that gate is load-bearing rather than belt and braces.
- **Failed writes are logged** rather than silently swallowed. The original reasoning — that a rejected write "shows up as a suspiciously empty `/stats` page" — was exactly backwards, since an empty page is also what a Worker nothing has found looks like.

The cost of the throw is worth knowing: if an over-long schema ever did ship, module evaluation fails and **every request 500s**, so the sign goes dark rather than merely losing analytics. That is the intended trade — a dead Worker is found in minutes, a silently rejected dataset was not found for a day — but it is why the deploy gate matters.

## Device telemetry is its own dataset

`src/stats/device-telemetry.js`, dataset `trmnl_orca_departures_devices_v2`, binding `DEVICE_TELEMETRY`. Added 2026-08-02 to fix the overflow above, and right on its own terms: these columns describe a **device**, not a request, and most rows in the requests dataset are scanner traffic where every one of them is empty.

**`deviceId` is the MAC address, from the `ID` header, and it is the only stable per-device key.** Everything else the firmware sends describes a *kind* of device — model, geometry, firmware build — so without it two identical signs are indistinguishable, which is exactly the case the identity alarms exist to catch. **There is no serial number**; the firmware sends none, so the MAC stands in for one.

- **One row per authenticated device request**, written from the same `recordOutcome()` closure in `src/gate.js` as the request row, so the two cannot drift apart.
- **`wakeTime` is milliseconds awake before the request**, confirmed on the real device: 10-13 seconds normally, minutes when the wake was spent retrying a failed connection. That makes it the clearest per-poll sign of the connection stalls in `docs/deploying.md`.
- **The Devices box skips image, setup and log rows when picking a device's latest row**, found on the first real device 2026-10-12. Every wake's image download lands a second after the poll carrying only `ID` and `Access-Token`, so an unfiltered "newest row" showed no battery, WiFi or firmware at all. It excludes those three rather than keeping only `byos-display`, because a poll with a mistyped stop or a stale key is recorded under another outcome and still carries every header.
- **Gated on `identifiesADevice()`** — an `ID` or `Model` header, either alone. The setup-logo download sends no headers at all, and a row for it would be eighteen empty columns claiming a device reported nothing.
- **`upstreamReason` lives here**, not on the request row. An upstream failure only ever happens on a device poll.
- **The request schema was cut back to its original 20**, which is a deletion of slots with *no history behind them* rather than the reorder the append-only rule forbids: `blob21`+ were never successfully written, so nothing was reinterpreted. `clientIp` went with them, so it is now recorded on device rows only.
- The panels reading device facts — firmware, panel repaints, refresh echo, charge, WiFi signal, Devices, upstream failures — all query this dataset. That is what stops the owner's own `curl` from rendering as a device.
- **`BLOB_FIELDS` is now deliberately wider than what `query.js` reads.** `imageCached`, `updateSource`, `wakeTime`, `batteryCapacity` and all ten doubles lost their reader in the move; `route` and `httpProtocol` never had one. They keep their slots and keep being written, because a write that stops announces nothing — a later query would silently span a boundary where the column just goes blank. `model` and `firmwareVersion` are still read here, by the enrollment breakdown, since `/api/setup` is a request and sends both.
- **`identity.networks` still reads the requests dataset, filtered to authenticated**, and that is the one device-shaped panel that deliberately did not move. The leaked-token alarm has to catch an authenticated caller *without* device headers, which is exactly what a stolen URL looks like. A consequence: on an unpaired sign that row can name a network from the owner's own `curl` while the row above it says no device has polled. Odd-looking and correct.

## Everything that describes one device lives in that device's box

Changed 2026-08-05. Panel repaints, refresh rate echo, charge over time and WiFi signal over time were page-level panels aggregating across every device. Each of them describes **one piece of hardware**, so the aggregate averaged a healthy sign against a failing one and described neither — invisible while there are no devices, and wrong on the first day there are two. `query.js` groups all four by `deviceId`; `render.js` filters each slice into `deviceBox()` as a `subsection()`, an `h3` inside the box rather than an `h2` on the page.

Three things this brought with it, none of them optional:

- **The battery query sorts `DESC` and is reversed in JS, so its `LIMIT 4000` drops the oldest points.** `ORDER BY bucket ASC LIMIT n` takes the first n of an oldest-first sort, which cuts the *recent* end — the part of the chart anyone is looking at. That was the original shape and it was wrong by construction rather than by sizing. The cap is also per device now: at 90 days one device fills 360 six-hour buckets.

- **The query errors are repeated in the no-device branch of `devicesSection()`.** With no boxes there is nowhere for a panel-repaint or battery failure to render, and a failed query shown nowhere is indistinguishable from a device that never polled. Same trap `emptyState()` exists for, one level up.

- **The "latest reading" line was deleted, not moved.** It printed charge, voltage and RSSI beside the facts rows that already print them — from a *different source*, the six-hour bucket average rather than the last raw poll, so one box showed two different WiFi numbers. The charts keep only what the facts cannot show, which is the shape over time.

**It is `Panel repaints`, not `Panel health`.** A cache miss means the board really changed, which during the day it does most minutes, so a low rate is what live departures look like rather than a fault. The fault it exposes is the rate collapsing while the board is *static* — the filename churning, flashing the panel for nothing.

## Every device-box row that came from a header is marked

A `*` on the label, and one italic footnote per box. The classification is stored as `OBSERVED_DEVICE_FACTS` — the six rows the server worked out for itself — and everything else is marked, so a row added later is treated as spoofable until someone decides otherwise. `render.test.js` pins the unmarked set against the rendered output, so renaming a label without updating the constant fails rather than silently reclassifying a row.

**The MAC is a header like any other, and that bounds what the per-device split can do.** It separates devices that report honestly. Someone replaying the sign's URL with its MAC merges into its box and the split shows nothing — which is why the identity alarms above key on network and firmware instead, and why a single calm device box is not evidence of a single device.

## "No device has polled" is a state, not an empty panel

Every check in the Device identity panel is a comparison against what a paired sign looks like, and none of them means anything before one exists. Two hand-made `curl` calls were enough to make `/stats` report an "unknown" firmware build on a panel of `-1 x -1` and a poll volume of "2 vs ~12,614 expected", every line labelled `ok` — three sentences describing a device in trouble, with no device. `identity.deviceCount` drives an explicit **Paired device** row saying so once, and the expected poll count is withheld until there is something to compare it against. Guarded on the query error too, because a failed query returns zero rows and "no device has polled" is a claim, not a default.

`buildUnpairedMockStatsData()` renders that state at **`/_preview/stats?unpaired`**. It is what the owner looks at for the whole gap between deploying and pairing, and nobody had looked at it.

**No panel may print reassurance beside its own error.** "Every stop answered on every poll" under a 422 is the page describing data it failed to read, and the sentence is the part a reader believes. `emptyState()` in `render.js` withholds an empty-state line whenever that panel's query failed. The rule was written down once, for the device-logs panel, and applied to none of the five others that needed it.

**Copy describing what the Worker does not do yet becomes a lie the day someone implements it.** The device-logs panel claimed `/api/log` was unimplemented for a day after it landed, which would have read a real outage as expected state. `render.test.js` now pins the endpoint being described as working.

The per-device panels are the only place two devices are ever separated. They group raw recent rows in JS rather than with a `GROUP BY`: *latest* is the question, and the aggregate a group-by can give — an average voltage — is not what a device box is asking for.

**`upstreamReason` records why OneBusAway did not answer, including on partial failures.** One stop answering is enough for a board, so a degrading quota never reaches `obafail` and would be invisible until it was total. The HTTP status is folded into the slug — `http-429`, not `http-status` — because the status is the whole content of that reason. It is deliberately **not** part of the `filename`: two outages that look identical on the glass must not repaint the panel.

**`clientIp` is recorded, which extends the screenshot warning.** A `/stats` screenshot now carries an IP as well as roughly a home address. Same reasoning as the geo and network columns: on a single-device sign the address is a constant, and a constant is what makes a deviation legible if the URL token ever leaks.

**Compare filters against the `OUTCOMES` constants, never a retyped string.** The enrollment alarm was dead from the day it was written because `query.js` matched `'setup'` while the recorded value has always been `'byos-setup'`. `render.js` already states this rule for its label maps; that bug is what breaking it costs, and nothing in the test suite would have caught it.

**Geo and network are recorded on authenticated requests too, and that is deliberate.** The instinct to strip them is wrong: on a single-device sign the network is a constant, and that is exactly what makes a deviation legible. If the URL token ever leaks, the attacker authenticates *successfully*, and a change of network is the only signal that would ever exist. Cloudflare's own request logs hold the client IP regardless, so omitting it would deny the owner the one view where a compromise is visible without denying anyone else anything. The Device identity panel is built for this and is designed so the normal state is one calm line.

**Stop IDs are recorded raw, by the owner's explicit decision**, because "which stop was this failing request for" is what the page is for. This does not breach the privacy rule, which is about tracked files — the stop still never enters git. The residual risk is narrower and named on the page itself: a screenshot of `/stats` carries roughly a home address.

**The token is never recorded**, only a 4-byte fingerprint, which distinguishes forty attempts at one wrong token from forty different guesses. Raw paths are never recorded either, except for unauthenticated requests, which go through `safeProbePath()` — an **allow-list** that keeps short ordinary segments and replaces anything long or high-entropy with `[redacted]`. Written as an allow-list on purpose: a deny-list of "things that look like a token" would fail the moment the token format changed, and a near-miss URL such as `/toke/<real token>/…` would otherwise write the live secret straight into the dataset.

**Device logs are kept as history, not only streamed.** `/api/log` entries go to a second Analytics Engine dataset via `recordDeviceLogs()` in `src/stats/device-logs.js`, and are read back by the Device logs panel. `console.log` and `wrangler tail` are kept alongside it for watching a device you are standing next to, but they are not a substitute: the entries that matter arrive during a failure, which is exactly when nobody is watching a tail, and `[observability.logs]` retention is a few days in a separate store that cannot be joined against the request rows explaining what the device was reacting to. `sourcePath` plus `sourceLine` are the pair that earns the whole dataset — together they name the exact line of firmware that failed. Its columns are positional and append-only for the same reason the request schema's are.

`src/stats/render.js` is pure and takes a plain data object, so the page is unit-testable with no Analytics Engine mock. **It must escape everything** — it renders attacker-controlled user agents and paths. `src/dev/preview.js` builds HTML without escaping because its inputs are fixtures; that is not a precedent this page can follow.

