# TODO

The work queue. Completed items are deleted rather than checked off — anything worth keeping moves to `CLAUDE.md`, the doc that owns it, or a code comment.

Two phases plus housekeeping: phase 1 needs no hardware, phase 2 needs the device. Work that is real but not going to be started soon, and ideas that are deliberately not being built, live in [`todo-someday.md`](todo-someday.md).

## Phase 1 — finish the server

### Correctness bugs

Where the sign is *wrong* rather than degraded, which is worse.

- [ ] **Compare the board against the OneBusAway app** — discrepancies were seen once and never diagnosed. **Checked again 2026-08-05 against the deployed Worker with the real API key, and every row matched.** That is one sample in one window at one pair of stops, so it retires nothing: the original discrepancies were never explained, and the cases most likely to differ — a route with no real-time, a cancelled trip, a bus already at the kerb — are exactly the ones a single mid-morning check will not contain. Keep sampling, and note when it matches as well as when it does not.

- [ ] **Handle negative predictions** (`-2 min`). `NOW_GRACE_MS` in `oba/format.js` is 60s; anything older has no defined treatment.

- [ ] **Handle "running late" / "ahead of schedule"** when OBA reports it.

- [ ] **Pin every `/stats` filter against the `OUTCOMES` value it is meant to match.** The enrollment alarm was dead from the day it was written — `query.js` compared `'setup'` against a recorded `'byos-setup'`. Fixed 2026-08-02, but nothing would have caught it, and a filter matching nothing looks exactly like a thing that never happened.

### Quick wins

Claude you should do as many of these as possible when I aske, but skip ones that would touch the same lines of code and cause conflicts.


### Confirm before shipping

- [ ] **Nothing has been measured against the real rate limit.** The memo means ~1440 calls/day for one stop, ~2880 for two — never checked against whatever quota Sound Transit issues with the key.

- [ ] **Draft the pairing runbook.** How the sign gets onto the device has no answer in the repo yet, and it is the step with the most silent failures: the URL is discarded if the WiFi password is wrong, changing it wipes `api_key` and `friendly_id`, and `/api/setup` follows no redirects. `docs/deploying.md` step 4 is the skeleton. Finishable only against the device.

- [ ] **Watch the tarpit's effect on concurrency** once there is real traffic. A held request occupies an invocation for 25s. If the sign ever fails during a scan, lower `TARPIT_MS` or drop it — nothing depends on it.

### The gate that closes phase 1

Run this block before first contact with the device.

- [ ] Performance pass — flicker time, Worker load — and cruft removal.
- [ ] Run a `/security-review`.
- [ ] Test everything.
- [ ] Audit the docs. `development.md`, `deploying.md`, `alternatives.md` and the README should read as durable descriptions, not changelogs.

## Phase 2 — when the device arrives

Nothing in the server work is blocked on the hardware. Everything here is. Getting it onto a wall is a separate question — see [mounting-ideas.md](mounting-ideas.md).

- [ ] **Find the cause of the ~5-minute stalls.** The device logs `connection refused(-1)` after 5 attempts with WiFi connected; signal and DNS filtering are ruled out. What was found and what is still suspected is in `docs/deploying.md`, under "When the sign stops updating".

- [ ] **Turn the router's DNS rules back on once the connection failures are fixed.** They were disabled on 2026-10-12 so the sign could use any resolver while diagnosing `connection refused(-1)` from `http_retry_request.cpp`, which stalled the panel for ~5 minutes at a time.

- [ ] **Clear `/stats` once the device is confirmed working — not before pointing it at the Worker.** Everything recorded so far is development traffic, and it permanently skews the panels that matter most on day one, because device identity is built to make a *single* deviation legible.

	**The timing is the point, and it is the opposite of the obvious one.** Clearing first still leaves every row that pairing itself produces: the mistyped URL, the re-pairs, the enrollment calls, the hand-made `curl` that proves an endpoint answers. That is exactly the traffic the identity alarms are built to notice, so a dataset that starts the moment the sign first works is clean in a way one that starts the moment before pairing never is. Wait for a board on the glass, then rename.

	Note there is already a phantom device in the deployed datasets from smoke tests on 2026-08-05 — headers claiming a paired X on MAC `AA:BB:CC:DD:EE:FF`, plus a `/api/log` entry and about 45 request rows. One more reason the rename is not optional.

	**The procedure is in [`manual-testing.md`](manual-testing.md#clearing-the-stats-data)** — Analytics Engine has no delete, so it means renaming all three datasets and redeploying. Follow it there rather than duplicating it here; it has the traps, and a half-done rename is worse than not doing it.

- [ ] **Parts of the BYOS contract are still only read from firmware source.** Pairing, `status: 0`, exact `image/png`, a changed `filename` triggering a download, and `refresh_rate: 60` were all observed working on the real device 2026-10-12. Not yet observed: the unchanged-`filename` no-op, the stuck-error-screen recovery, and the 31-character bug.

- [ ] **Judge legibility at physical size.** 227 PPI on a 10.3" panel cannot be assessed on a monitor.

- [ ] **Size the "Updated at" stamp.** The single load-bearing staleness defense, and "at a glance" is the whole condition the accepted risk rests on. Currently 38px bottom-left, unproven at physical size; losing the OneBusAway mark freed width to grow it.

- [ ] **Finish the pairing runbook** against the real captive portal.

- [ ] **`DEVICE_TOKEN` does not change when the device arrives**, written down because the opposite is the natural assumption. The token is ours, not the device's: `deriveApiKey()` in `src/byos/credentials.js` is an HMAC over `DEVICE_TOKEN` alone, with no MAC and nothing else from the hardware mixed in. Pairing runs one way — the token goes *into* the device as a segment of the base URL typed into the captive portal, and the device hands back an `api_key` derived from it. There is nothing to read off the hardware and no secret to sync on arrival.

	What does matter on arrival is the reverse: **re-entering the base URL wipes the stored `api_key` and `friendly_id`**, which is the supported way to re-point a device rather than a corrupt state. Rotating `DEVICE_TOKEN` after pairing therefore costs a trip to the sign, which is the argument for rotating it *before*.

- [ ] **The setup logo is the full-panel board image**, so the pairing screen shows a 1872x1404 notice. Cosmetic, shown once; a smaller render needs a second size through `rasterize()`.

- [ ] **Watch for ghosting on the inked overnight screen.** A full black field is the shape most likely to ghost, and the deep clear only runs every eighth update. **Do not pre-solve it.** If it appears: lighten `#111` toward mid grey, fall back to a light variant at `/_preview/parked`, or — worst option, since it slows *every* update — send a non-zero `temperature_profile`.

- [ ] watch the stats page to see any problems

- [ ] **The overnight sleep has never been observed.** ~32000s `refresh_rate`, honoured per firmware source. If it is wrong, the sign does not come back in the morning.

- [ ] **Confirm the overnight layout, then delete the parked variants.** `badge-moon-inverse-stars` ships; the rest stay in `render/overnight.js` because switching back is one word. Judge at physical size — stars read as dust on the light panel and as sky reversed out of ink, which is why the light-with-stars pairing was dropped.

## Housekeeping — unscheduled

- [ ] **Delete `tramGlyph()`** in `render/board.js` plus `OBA_TRAM_VIEWBOX` / `OBA_TRAM_RATIO` — only useful if bus and rail shared a board, which they never will. Keep `obaMark()`, which is parked deliberately. Separately, `GREY = '#6b6b6b'` is now declared in three render modules.

- [ ] **Assert that `/api/display` still 404s with `DEV_PREVIEW` enabled.** `worker.test.js` only tests with `env` undefined, so it would not catch the preview leaking into the BYOS paths.

- [ ] **Cover `requestedTime()` in `dev/preview.js`** — verified by hand only, not exported, and `preview.test.js` avoids importing the module because of the wasm.

- [ ] **Add `postinstall` git hooks** — `core.hooksPath` plus a pre-commit running lint and tests.

- [ ] **Give `/api/log` a longer window only if 3 days proves too short.** The `DEVICE_LOGS` dataset is the history; console retention is the live view.

- [ ] **Delete `.npm-cache/`** — 284 MB, only exists because the sandbox denies `~/.npm/_cacache`.
