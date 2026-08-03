# TRMNL Metro Departures Sign — `trmnl-orca-departures`

A wall-mounted e-paper sign showing live King County Metro departures for one stop, styled after Metro's Connectpoint stop signs. A **[TRMNL X](https://trmnl.com/)** device polls a Cloudflare Worker, which fetches [OneBusAway](https://pugetsound.onebusaway.org/) predictions and renders a `1872x1404` image.

**Worker name: `trmnl-orca-departures`** — [ORCA](https://www.myorca.com/) is the Puget Sound fare card (the Seattle-transit reference), `departures` is the word on the real sign's header. This becomes the public `*.workers.dev` subdomain. The folder name need not match.


## Hardware constraints (TRMNL X)

Decided 2026-07-31, superseding the original plan's OG choice. The OG column is retained only because most firmware research to date was OG-scoped — treat OG-specific constants as inapplicable.

| | X (chosen) | OG (superseded) |
| --- | --- | --- |
| Resolution | 1872 x 1404, 227 PPI | 800 x 480, 128 PPI |
| Greyscale | 16 levels | 4 levels |
| Refresh | 200ms partial / 1.2s full | ~2s, full only |
| MCU / RAM | ESP32-S3 + C5, 8 MB PSRAM | ESP32-C3, 400 KB |
| Battery | 6000 / 12000 mAh | 2500 mAh |
| Image size cap | 750000 bytes | 90000 bytes |
| Measured render cost | 19 ms local / 58 ms edge | not re-measured |

Check legibility at physical size, not on a monitor, and redraw at native resolution rather than scaling a smaller design up. Sleep draw is negligible, so battery life is a function of wake count — but panel flicker is **not**, because an unchanged image skips the repaint entirely (see below).

**The "200ms partial refresh" row above is marketing, not something we get.** Verified in firmware: the X takes a **full refresh every single time** a changed image reaches the panel. The partial-update path in `display.cpp:1836-1840` is commented out, and `load_prev_image()` — the helper that would seed the previous-frame buffer it needs — is gutted (`content_size` initialized to 0 and never written, so the body is statically unreachable). Partial update survives on X only for the touchbar overlay. FastEPD *can* diff at pixel level, but nothing calls it for server images, and the X sets 4bpp mode for any non-1-bit PNG while partial requires 1/2bpp — so even re-enabling it would not cover our renders.

Every 8th render additionally gets the slow deep clear rather than the fast one (`(iUpdateCount & 7) == 0`). The counter is RTC-backed, so it resets on a power cycle, making the first render after one a slow clear.

**Consequence: flicker avoidance comes entirely from the `filename` cache no-op, not from partial refresh.** That makes the content-hash filename the single most important thing in the whole design, and it retires the flicker half of the argument for choosing the X over the OG.

## Current state — read this first

**Design is settled and the renderer is real, committed source.** Updated 2026-08-01.

**The design now lives in `src/` and is reproducible from source.** The spike in `assets/sources/` is history, not the source of truth — its PNGs are a record of variants that were rejected along the way.

- `src/render/png.js` — quantise and 4-bit greyscale PNG encoder. Pure.
- `src/render/board.js` — the board as SVG, data-driven, plus `directionLabel()`. Pure.
- `src/render/index.js` — resvg wiring; the only module that touches wasm or fonts.
- `src/assets/` — the Metro and Sound Transit logos as data URIs, and the OneBusAway mark pre-cleaned and pre-recoloured, all generated at author time so nothing is reprocessed per render. The OBA mark is **kept but no longer drawn**; see the asset notes in `src/render/CLAUDE.md`.
- `src/dev/sample-boards.js` — the two reference boards, from real OneBusAway data, four departures per direction. Rendered at a fixed reference instant; `?now=live` on a preview URL uses the real clock.
- `src/dev/preview.js` — the local contact sheet. **Gated on `DEV_PREVIEW`, which lives in `.dev.vars` and is therefore never deployed.**
- `src/config.js` — `readConfig()`, the only reader of `env` for a display or scheduling value. Coerces and range-checks everything and never throws; secrets stay off it on purpose. Added 2026-08-01.
- `src/clock.js` — `formatBoardTime( timestampMs, timezone )`, the header fields and the "Updated at" stamp. Pure, and takes the timestamp rather than reading a clock, because the stamp must come from OneBusAway's `currentTime`. Added 2026-08-01. Also `localMinutesSinceMidnight()`, which the scheduler compares against the active window, and `formatMinuteOfDay()`, which renders a configured wall-clock time with no instant and no `Intl` — see the overnight screen below for why that distinction matters.
- `src/schedule.js` — `currentSchedule( { nowMs, config } )`, the only thing that decides `refresh_rate`. Pure. Added 2026-08-01.
- `src/render/overnight.js` — the nightly rest screen: a moon in the route badge, plus the layout variants still being chosen between. Pure. Added 2026-08-01.
- `src/headsign.js` — `collapseRepeatedPhrases()`, which drops one copy of a phrase repeated back to back. Called by the renderer rather than by a data mapper, so it applies to live predictions and fixtures alike. Added 2026-08-01.
- `src/route-badge.js` — `routeBadge()`, which strips ` Line` from the 13 single-character lines so `D Line` badges as `D`. Same seam and same reason as the headsign collapse. Added 2026-08-01.
- `src/oba/` — live departures, added 2026-08-01. `client.js` fetches one stop and never throws; `memo.js` is the isolate-local cache that makes `/api/display` and `/image` agree; `departures.js` maps a response to board data and is pure; `format.js` is the `Now` / `N min` / clock ladder; `index.js` is the only entry point `src/byos/` uses. `fixtures/` holds four captured live responses for the public sample stops.
- `src/filename.js`, `src/routing.js` — the cache key and path parsing, as before.
- `src/gate.js` — the shell every request passes through. Returns either a finished `Response` or an authorized classification for a caller to dispatch on, which is the seam the BYOS handlers hang off. Added 2026-08-01.
- `src/abuse.js` — `classifyRequest()`, `diagnosePath()`, the tarpit, and the `OUTCOMES` / `REJECTION_REASONS` vocabularies. Added 2026-08-01.
- `src/stats/` — `schema.js` (the positional Analytics Engine row, the 20-column ceiling, plus `safeProbePath()`), `analytics.js` (the write path), `device-telemetry.js` (the per-device dataset, added 2026-08-02), `device-logs.js` (`/api/log` history), `query.js` (the SQL reads), `render.js` (pure HTML), `handler.js` (Basic auth). Added 2026-08-01.

**Two directories carry their own `CLAUDE.md`, which loads only when you work under them** — `src/render/CLAUDE.md` for the board design, and `src/stats/CLAUDE.md` for the Analytics Engine schema and the `/stats` panels. Split out of this file on 2026-08-02 because both are long, and neither is needed to reason about anything outside its directory. Read the relevant one before changing that area; do not re-derive a decision that is written down there.

**`vitest.config.js` aliases `.wasm` and `.ttf` to a stub** so modules that transitively import the renderer can still be unit tested; nothing depending on those contents is asserted.

**The four device routes are implemented, in `src/byos/`.** Landed together, 2026-08-01, one file per endpoint: `setup.js`, `display.js`, `log.js`, `image.js`, with `index.js` dispatching on the gate's classification, `credentials.js` deriving the `api_key`, and `screens.js` choosing what to draw. `src/worker.js` is now nothing but the seam between `gate()` and that dispatch. Verified end to end against `wrangler dev` and by looking at the rendered PNG, not just its status code: `Content-Type: image/png` exactly, 1872x1404 4-bit greyscale, and PNG magic bytes on `/image/setup`, which is the URL pairing depends on.

**They show live departures, as of 2026-08-01.** Verified by fetching the rendered PNG from `wrangler dev` and looking at it — a bus board and a rail board, both from real predictions, and the rail one happened to catch a live `429` on one of its two stops, which is how the partial-failure treatment got seen rather than only tested.

Three things about that wiring are worth knowing before changing it:

- **`currentScreen()` is async and is the seam.** It returns either a board or a notice, and `screenSvg()` picks the builder. `/image` calls the same function with `allowStale: true`; nothing else may.
- **`/api/display` and `/image` share one upstream response**, through `src/oba/memo.js`. Without it the device paints bytes rendered from a different fetch than the one its `filename` was hashed over, and OneBusAway gets asked twice per wake instead of once.
- **The board is stamped with OneBusAway's `currentTime`, and with the oldest one when two stops answer.** Our own clock is used only for cache expiry. A board that cannot be honestly stamped is not drawn — `loadBoard()` returns a failure rather than falling back to `Date.now()`, because a stamp taken from our clock says nothing about how fresh the predictions are, which is the one claim it exists to make.

- **Settled design decisions** are written up in `src/render/CLAUDE.md`: the Metro-faithful layout, the real-time vs scheduled treatment, Fira Sans, two-stop grouping, light-rail circle badges, the OneBusAway footer mark, and the sample stops.
- **The config surface is done** (2026-08-01). `HEADER_TEXT` was removed rather than wired up; see the configuration section. `REFRESH_IDLE_SECONDS` went the same way when the schedule landed — overnight is a single sleep, so there is no middle tier for it to describe.
- **The request gate and the stats page are done** (2026-08-01), and both things they left classified-but-unserved are now served: an authorized request with an unusable stop renders an error board naming the wrong segment, and the `Access-Token` header is validated on `/api/display` and `/api/log`.
- **Live OneBusAway data is wired in** (2026-08-01), including the format ladder, the mode split, and the per-stop failure treatment. See `src/render/CLAUDE.md`.
**The `refresh_rate` schedule is in, as of 2026-08-01** — `src/schedule.js`, plus the rest screen in `src/render/overnight.js`. Two states, not three: awake between `ACTIVE_START` and `ACTIVE_END` at `REFRESH_ACTIVE_SECONDS`, and one sleep until the window reopens outside it. See the section below.

- **Next:** the correctness bugs and the quick wins. See `docs/TODO.md`. The failure-mode sweep and the durable-store decision moved to `docs/todo-someday.md` on 2026-08-02 — deliberately deferred, not forgotten.

**A block comment containing a glob will silently break the build.** `**` followed by `/*` closes the comment early and the rest of the file parses as garbage. Write "a wasm glob" in prose instead.

The scaffolding notes below remain accurate.

- `npm test`, `npm run lint`, `wrangler deploy --dry-run` and `wrangler dev` were all confirmed working against this exact config.
- **The endpoints went in together, and that rule still governs edits to them.** A partial `/api/display` that omits `refresh_rate` flat-batteries the device, and a body of `{"status": 500}` factory-resets it. `/api/display` is only correct while `refresh_rate`, `filename` and `status: 0` are all right *together* — so never change one of the three without checking the other two, and never let a code path return early without a `refresh_rate`.
- **Deployed and live as of 2026-08-01.** `/stats` was confirmed recording real traffic, including an authenticated request, which is what proves `DEVICE_TOKEN` matches end to end. No device has been paired. The deployed origin is in `.dev.vars` as `WORKER_ORIGIN`, not here.
- The CPU/hosting question below is **resolved** — Workers Free fits with ~17x headroom. Nothing is blocked on it.

First thing in a fresh checkout: `nvm use && npm install`. `node_modules/` and `package-lock.json` are not committed and the lock file has never been generated, so the first install resolves versions fresh.

## Architecture

**BYOS** (Bring Your Own Server — their device, our backend; free, no license). The device is pointed at a Cloudflare Worker that serves the BYOS endpoints and renders the image itself.

- One Worker, deployed with `npm run deploy` — never a bare `wrangler deploy`, and never a dashboard paste. See the two-accounts warning below for why the script matters.
- Secrets via `npm run secret -- NAME`; local equivalents in `.dev.vars` (never committed). **`DEVICE_TOKEN` and `OBA_API_KEY` must both be set before the first `wrangler deploy`, not after** — a deployed Worker where `env.DEVICE_TOKEN` is `undefined` makes the token comparison degenerate, which is an open endpoint burning the OneBusAway quota.
- `npm run dev` runs `wrangler dev` on `localhost:8788`, pinned with `--port` so docs and links stay true. There is no SPA, so `npm run dev` stays a single process — no concurrent Vite alongside it. The design preview rides on this same server at `/_preview`; there is no second process to start. See Conventions.
- **A dedicated Cloudflare account**, not shared with any other project, on the **Free** plan. Free is confirmed sufficient — see the CPU section below; there is no reason to upgrade.
- **`trmnl-orca-departures.ian-dunn.workers.dev` now runs this repo's code**, deployed 2026-08-01. It previously held Cloudflare's stock "Hello World" template, which the first real deploy overwrote as expected.

#### Never `wrangler login`, and never a bare `wrangler` command that writes

Credentials come from `.cloudflare.env` and nowhere else. `wrangler login` stores ambient OAuth credentials that wrangler will silently prefer, which on a machine with more than one Cloudflare account means a deploy can land somewhere unintended while printing a completely normal success message and a live URL. There is no ambient login on this machine, deliberately — leave it that way.

So: **every wrangler command that touches the account goes through `npm run`** — `deploy`, `tail`, `whoami`, `secret`, `secret:list`. Each prefixes `set -a && . ./.cloudflare.env && set +a`. `dev` and `deploy:check` deliberately do **not**, because neither authenticates and coupling them to deploy credentials would stop a fresh clone from running the tests or the preview.

Two mechanisms make this fail quietly if you improvise:

- **`source .cloudflare.env && wrangler …` does not work.** `source` sets shell variables, not environment variables, so the child process never sees them and wrangler falls back to whatever ambient credentials exist. `set -a` is what exports them.
- **Auth and target account resolve separately.** A valid API token is not sufficient — `CLOUDFLARE_ACCOUNT_ID` must also be in the environment. **`wrangler whoami` is misleading here:** it lists the accounts a token *can reach*, so it happily prints the right one while an operation resolves a different account. `npm run secret:list` is the honest check, because it actually hits `/accounts/<id>/…`. A wrong account surfaces as `Authentication error [code: 10000]`.

So `CLOUDFLARE_ACCOUNT_ID` legitimately lives in **two** places, and this is not redundancy to clean up: `.cloudflare.env` tells the wrangler CLI which account to act on, and a Worker secret of the same name is the binding our own code reads to build the stats SQL URL. Neither copy is in git, and neither belongs in a tracked file — including this one.

### The render pipeline and its one hard constraint

SVG built directly in the Worker (the layout is rects and text, so satori is needless indirection) → `resvg-wasm` → raw RGBA → quantize and encode to 4-bit greyscale PNG by hand. Fonts must be bundled; Workers have no system fonts.

**Never call resvg's `asPng()`.** It encodes an RGBA PNG, which is both the wrong format for the panel and by far the most expensive step in the pipeline. Take `render().pixels` and encode 4-bit greyscale directly — `CompressionStream('deflate')` emits exactly the zlib wrapper PNG wants, so the encoder is a CRC32 table and three chunks.

### CPU is NOT a constraint — measured on the real Free plan, 2026-08-01

**The "Workers Free allows 10 ms CPU" figure that blocked this project for two sessions is stale.** Measured by deploying a throwaway spike to the actual account and reading `cpuTime` from `wrangler tail`:

| Renders in one invocation | Outcome | Billed CPU |
| --- | --- | --- |
| 1 (cold, includes wasm init) | ok | 71 ms |
| 1 (warm) | ok | 57 ms |
| 2 | ok | 111 ms |
| 8 | ok | 445 ms |
| 16 | ok | 933 ms |
| 17 | ok | 786 ms |
| 18 | **exceededCpu** | killed |

**The real Free ceiling is ~1000 ms per invocation, and one full render costs ~58 ms — roughly 17x headroom.** Do not re-derive a hosting problem from the old number; if you need to re-check the limit, deploy a spike and read `wrangler tail`, because the published figure has been wrong once already.

Edge cores are about **3x slower than an M-series Mac** (58 ms vs 19 ms for the identical pipeline), which is the multiplier to apply to any local benchmark.

Local stage breakdown, for knowing where the cost lives:

| Stage | Cumulative (local) |
| --- | --- |
| Build SVG string | ~0 ms |
| + resvg rasterize to RGBA | 12.5 ms |
| + quantize to 4-bit scanlines | 14.25 ms |
| + deflate and PNG assemble | **19 ms** |
| (`asPng()` instead, for contrast) | 57.5 ms |

Output is a 1872x1404 4-bit greyscale PNG at ~42 KB — comfortably under the 750000-byte cap.

Working spike pattern, **re-verified end to end under workerd 2026-08-01** with the output inspected as an image rather than assumed from a 200. The two corrections below each produce a plausible-looking failure, so keep the shape exactly:

```js
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '../node_modules/@resvg/resvg-wasm/index_bg.wasm';
import interBold from '../node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf';

let ready;
ready ??= initWasm(resvgWasm);   // static .wasm import, NOT a fetch/URL
await ready;

const resvg = new Resvg(svg, {
  font: { fontBuffers: [new Uint8Array(interBold)], defaultFontFamily: 'Inter' },
});
const rgba = resvg.render().pixels;   // NOT .asPng() — see the cost table below
```

**Correction 1 — never declare `**/*.wasm` as `type = "Data"`.** wrangler ships a built-in `CompiledWasm` rule for `**/*.wasm`; a Data rule overrides it and hands `initWasm()` raw bytes, so resvg calls `WebAssembly.instantiate(buffer)` and workerd throws **`CompileError: Wasm code generation disallowed by embedder`**. Dynamic compilation is forbidden in the runtime; the module must arrive pre-compiled. The committed `wrangler.toml` carried this bug and is now fixed. It globs `**/*.ttf` only:

```toml
[[rules]]
type = "Data"
globs = ["**/*.ttf"]
fallthrough = true
```

`fallthrough = true` is verified empirically: without it wrangler warns on every invocation that this rule shadows its built-in `**/*.bin` Data rule, and adding it silences that.

**Correction 2 — the font must be TTF or OTF. WOFF silently renders nothing.** resvg parses raw sfnt through `ttf-parser` and cannot decompress a WOFF container, so a `.woff` buffer is rejected with **no error** and every `<text>` element vanishes while rects, rules and badges draw normally. `@fontsource/inter` ships **only** `.woff` and `.woff2` — no TTF at any path — so it cannot be used here at all and has been replaced in `package.json` by `@expo-google-fonts/inter`, which ships real TTFs (`400Regular/Inter_400Regular.ttf`, `700Bold/Inter_700Bold.ttf`, magic `00 01 00 00`).

This is almost certainly what the original spike hit: it reported "a correct 800x480 PNG (4.5 KB)", and a textless render of that layout is exactly that size. **Always look at the image.** A blank-but-valid PNG passes every check short of viewing it, and it also makes the render benchmark meaningless — glyph rasterization more than doubles the cost.

Note timing cannot be measured from inside a Worker — the clock is frozen during synchronous execution, so `performance.now()` deltas are useless. Measure wall time externally with many iterations per request, or read billed CPU from `wrangler tail`.

### BYOS endpoint contract

Verified against `usetrmnl/terminus` (the reference BYOS server) and the GPLv3 firmware.

**Auth is by provisioned token, not by MAC.** `/api/setup` returns an `api_key`, which the device then sends back as an `Access-Token` header on every `/api/display` call. Terminus authenticates on that key alone — `app/aspects/devices/synchronizer.rb` looks the device up by `model.api_key` with no MAC fallback, and an unknown key gets a 404. Terminus's own `doc/api.adoc` claims `ID` is the recommended auth header; **that doc is wrong** at the current commit.

- `GET /api/setup` — first contact. Returns `{ status, api_key, friendly_id, image_url, message }`. Reads `status` from the **JSON body**, not the HTTP status line, and **it must be exactly `200`** — the opposite of `/api/display`, see below. `friendly_id` is required and is missing from the reference field list: the firmware persists it (`device_setup.cpp:92`) and draws it on the setup screen, which is how a person confirms the pairing worked. The `image_url` here is a **setup logo**, not a board; the 2.4 GHz path sniffs PNG magic bytes and accepts one, while the X's 5 GHz modem path accepts only a BMP of exactly `DISPLAY_BMP_IMAGE_SIZE` (48062) bytes. That asymmetry is unfixable — the one format both accept is broken elsewhere on this hardware — and harmless, because `api_key` is persisted *before* the download, so enrollment succeeds either way and only the logo is lost.
- `GET /api/display` — the workhorse, called on the interval the previous response set. All telemetry rides in request headers. Response fields: `image_url`, `filename`, `refresh_rate`, `image_url_timeout`, `maximum_compatibility`, `special_function`, `reset_firmware`, `update_firmware`, `firmware_url`, `firmware_version`, `temperature_profile`.
- `POST /api/log` — device diagnostics, body `{ logs: [...] }`, respond `204` (No Content: success, empty body, nothing for the device to parse). **Log these from the first commit** — it is the only window into a device that renders nothing.
  **`console.log` is the whole mechanism, decided 2026-08-01.** `[observability.logs]` is enabled, so payloads stream live via `npm run tail` and stay queryable in the dashboard for the Free plan's **3-day retention** (200,000 logs/day; Paid is 7 days), verified against Cloudflare's docs. That is accepted rather than a gap — no KV, no D1, no UI. Never log a raw request path, though: the token is a path segment, so use `redactPath()`.

`refresh_rate` (seconds) is how the server controls battery life and panel flicker. That scheduling logic lives on the server, not the device.

Header names on the wire are `Access-Token`, `Image-Cached`, `Refresh-Rate`, `FW-Version`, `Model`, `Width`, `Height`, `Wake-Time`, `Update-Source`, `Battery-Voltage` — not the SCREAMING_CASE the reference doc implies. HTTP headers are case-insensitive, so match case-insensitively, but those are the literal bytes. `Image-Cached` reports the **previous** wake's outcome, so don't read it as current state.

**That list is incomplete, so collect headers rather than enumerating them.** Read from `buildDisplayHeaders()` in `lib/trmnl/src/api-client/request_headers.cpp`, 2026-08-01, the full set also includes `ID` (the MAC address), `Battery-Charging`, `USB-Connected`, `FW-Commit`, `RSSI`, `WiFi-Band`, `Temperature-Profile` and a lowercase `special_function`. Several are conditional, and the set differs per board and per radio path, so anything that hardcodes a list will quietly miss a firmware update that adds one. `src/byos/telemetry.js` iterates the request's headers for that reason. Two other endpoints send narrower sets: `/api/setup` sends only `ID`, `Content-Type`, `FW-Version` and `Model`, and the **setup logo download sends no headers at all** — which is why the image route cannot require an `Access-Token`.

`ApiDisplayResponse` also parses two fields absent from the reference docs, `action` and `touchbar_mode`. Neither is sent by this server.

On the X specifically, `Model` is the literal string **`x`** (OG sends `og`), and six extra battery headers are sent: `Battery-Count`, `Percent-Charged`, `Battery-Health`, `Battery-Current`, `Battery-Temp`, `Battery-Capacity` (formatted `remaining/full`). All six report `-1` when the fuel gauge failed to initialize. `Width`/`Height` are read from the display driver at runtime rather than compiled in, so treat the reported values as the source of truth for panel geometry.

**The X has two download paths with different behavior.** On 5 GHz it uses a separate modem path that does no `Content-Type` inspection (magic-byte sniff only), sends no `Accept-Encoding`, and follows no redirects. On 2.4 GHz it uses the normal WiFi path with all the traps above. Satisfy the stricter path — exact `image/png`, no redirects — and both work.

### `filename` is a cache key — get this wrong and the panel freezes

The device caches the image by the `filename` field and skips the download when it is unchanged. **`filename` must change when the image bytes change, and must not change when they don't** — each direction fails differently. Derive it from a content hash, the way Terminus does (`<name>-<md5>.png`, `app/structs/screen.rb`).

- Constant filename → permanently frozen panel serving perfectly fresh JSON. Terminus uses exactly this trick on purpose to pin its error screen.
- Filename changing every poll → needless download plus a visible flash every time.

Done right this is the project's best feature: an unchanged `filename` returns **before** the panel is touched at all, so an unchanged render costs **zero flicker**, while `refresh_rate` is still applied (it is handled outside the cache branch). That decouples poll frequency from flicker.

**There are two gates, not one, and they behave differently.** This was previously documented as a single filesystem check, which is wrong:

- **Download gate** — a filesystem existence check on LittleFS (`bl.cpp:2235`). Decides whether to fetch the bytes. Backed by flash, so it **survives a power cycle**.
- **Repaint gate** — a `strcmp` against a `RTC_DATA_ATTR` buffer (`bl.cpp:1719`, `src/displayed_image.cpp:9`). Decides whether to touch the panel, and returns before any `display_*` call. RTC memory survives deep sleep but **not** a power cycle, so expect exactly one repaint after a cold boot.

**The zero-flicker property is accidental.** On X, `load_prev_image()` is called just before the early return, and it is dead code — `content_size` is initialized to 0 and never written, so the body is unreachable. If upstream ever fixes that function, X gains a decode before the early return.

#### The stuck error screen — the inverse of the trap above, and worse

The documented trap is an error screen being *suppressed* by the cache. The real hazard runs the other way. `showMessageWithLogo` (`bl.cpp:2996-3019`) draws firmware error screens and **never updates the RTC filename**. So:

1. The server is unreachable, the firmware paints its own error screen, and the RTC buffer still holds the **last good** filename.
2. The server recovers and returns that same filename. The file is still on flash, the `strcmp` matches, and the code returns before touching the panel.
3. **The error screen stays on the glass indefinitely while the server serves perfectly good JSON.**

The only escapes are a power cycle or a different `filename`. So: **whenever the server has been unavailable or has returned an error, perturb the next `filename` even if the image bytes are identical.** Fold a generation counter or the recovery timestamp into it. Since the server cannot observe a firmware-drawn error screen, treat any gap in successful responses as "assume the panel is wrong."

#### Filename shape — three hard rules

- **The last 10 characters must be a plausible recent epoch, all ASCII digits.** `filesystem_purge_old_file` (`filesystem.cpp:110-153`) deletes a file when its extracted timestamp is over 24h old — and a name that doesn't end in 10 digits extracts as `0`, which is always stale. **A trailing `.png` alone causes this.** The purge runs before every image write, so an epoch-less name makes each download wipe every other cached image, defeating the download gate entirely. Wasted bandwidth and wake time, not extra flicker (the RTC gate is unaffected).
- **Never exactly 31 characters.** At exactly 31, `strncpy(&dest[1], src, 31)` writes no NUL terminator into an uninitialized `char szTemp[36]`, so the cache key ends in stack garbage and is nondeterministic. Keep it **≤ 30 or ≥ 32**.
- **Over 31 chars, the middle is discarded** — first 7 plus last 17, output always exactly 25 chars. Bytes 1-13 are the "same plugin" identity used by a 14-byte `strncmp` in the purge. So entropy belongs in the id field, not just anywhere in the first 7.

Working shape: `<7-char tag>-<6-char content hash>-<10-digit epoch>`.

None of this is unit-tested upstream — and HEAD is itself a filesystem refactor — so treat 31 / 7 / 17 / 14 / 86400 as unpinned.

**The cache is PNG or JPEG, not PNG-only.** JPEG is a fully valid cached format on X. BMP is excluded for a narrower reason than previously written: it writes to a fixed `/current.bmp` instead of the hashed name. The BMP conclusion stands; the reasoning was wrong.

`image_url` and `filename` are independent; neither derives from the other. Cache on `filename`, fetch `image_url` verbatim.

### Response fields that reset or wedge the device

- **Send `"status": 0` on `/api/display` — and `"status": 200` on `/api/setup`. The two endpoints want opposite values.** Corrected 2026-08-01 against the parsers themselves, because the previous wording here said "every response" and would have failed enrollment silently. On `/api/display` the dispatch switch handles only `0`, `202` and `500`; **everything else hits `default: break;` and the entire response is silently discarded** (`bl.cpp:2166`, `:2282`), so `{"status": 200}` — the obvious thing to write — means the device ignores your `image_url`, `filename` and `refresh_rate` completely. It has no default, so an absent field parses to 0 and is fine. On `/api/setup` the rule inverts: `parse_response_api_setup.cpp:25` returns `StatusError` for anything that is not 200, and `device_setup.cpp:82` checks it again, so a `0` there aborts pairing with nothing on the glass to explain it. The field is read from the **JSON body**, not the HTTP status line, on both.
- **`{"status": 500}` in the JSON body factory-resets the device.** It clears WiFi credentials, `api_key`, `friendly_id` and the cached filename, then reboots into the captive portal. Verified directly against source: `case 500:` sets `HTTPS_RESET` (`bl.cpp:2274-2279`), which reaches `resetDeviceCredentials()` at `bl.cpp:1462` → `WifiCaptivePortal.resetSettings()` + `preferences.clear()` + `ESP.restart()`. **`reset_firmware: true` does the same**, and must never be combined with `update_firmware` — the reset restarts before the OTA block runs, with no log.
- **`{"status": 202}` and `filename: "empty_state"` share one mechanism** — both trigger `applyFastPoll()`: 5 s sleeps for 50 wakes, then 60 s ×10, 900 s ×10, then 3600 s. `empty_state` does not draw the setup logo as previously documented; it draws whatever `image_url` points at, once, gated on an NVS flag.
- **HTTP 429 is silently accepted** on `/api/display` and its body parsed.
- **`maximum_compatibility` does nothing on X** — the line that reads it is inside `#ifdef BB_EPAPER`, which is OG-only.
- **`special_function` is never acted on for X.** There is no server-pushable display state.
- **Send `temperature_profile: 0` or omit it.** `"a"` → 1, `"b"` → 2, anything else → 0. It is the only server-visible refresh control on X, but it only makes things *worse*: any non-zero value forces the slow 32-pass clear on **every** update instead of the 16-pass fast clear.

### Geometry: 1872x1404 confirmed, but still read the headers

The literals appear nowhere in the firmware, which briefly made this look unverifiable — geometry resolves at runtime from FastEPD's `BB_PANEL_TRMNL_X`. Reading the pinned FastEPD revision settles it: `BB_PANEL_TRMNL_X` is **1872 x 1404** (`FastEPD.inl:202`), and the firmware **never calls `setRotation`**, so the panel is fixed in landscape. Retail X applies no `setPanelSize` override either.

Still size the render from the `Width`/`Height` request headers and log them on first contact. It costs nothing and the constant lives in a pinned third-party dependency rather than in the firmware.

Two behaviors matter for a mis-sized image: the firmware **crops rather than scales**, and it **auto-rotates based on the PNG's own dimensions**. So a width/height swap silently rotates the render instead of erroring.

### Image format on the X — verified against `[env:TRMNL_X]`

Read directly from the firmware source for the X build. **PNG is mandatory, greyscale, 4-bit.**

- **BMP does not work on the X, at all.** The OG's hard check (`width != 800 || height != 480 || bpp != 1`) is in an unguarded file, so it compiles for the X and rejects any 10.3"-sized BMP as `BMP_BAD_SIZE`. Even if one passed, `BB_EPAPER` is undefined on X, so nothing ever loads the bitmap into the framebuffer. There is no BMP fallback here.
- **PNG has no dimension check on the X.** The strings `1872` and `1404` appear nowhere in the firmware — geometry is a runtime property read from the FastEPD driver. Oversized images are cropped with only a log; a width/height swap is treated as a rotation. Nothing rejects.
- **JPEG, unlike PNG, *does* require exactly 1872x1404.** Not worth using.
- **Use 4-bit greyscale, non-indexed** (PNG colour type 0, bit depth 4). That is the X's native framebuffer format — 16 greys, direct path, no conversion. 1/2/8-bit greyscale, truecolor and RGBA all work too but get converted down.
- **Do NOT use a palette (indexed) PNG at 1 bit.** `ReduceBpp` has cases for 24/32/8/4/2 bpp and **none for 1**, so the grey value keeps its `0` initialiser and every pixel comes out **black**. The OG has a special case for exactly this; the X does not. Greyscale, not indexed.
- **Do not serve RGBA at full width.** PNGdec sizes its line buffer via `PNG_MAX_BUFFERED_PIXELS` (14984 on X) but checks only *one* line while allocating *two* — at 1872px, RGBA8 needs ~15007 bytes and **overflows by ~24**. RGB8 (11263) and everything narrower is fine.
- **Size cap is 750000 bytes** on X (vs 90000 on OG), confirmed in `config.h`.

### Three ways to fail silently

Get these right in the first commit; each costs an afternoon otherwise.

1. **`Content-Type` must be exactly `image/png`.** The firmware chooses its PNG-vs-BMP decode path by string-comparing that header, not by magic bytes. A perfect PNG served as `application/octet-stream` takes the BMP path, fails, and **displays nothing with no error**. No charset parameter, no `image/PNG`.
2. **`refresh_rate` must be on every response.** Absent parses as `0`, is written to NVS, and the device hot-loops with no sleep — a flat battery, and it stays wedged across later cycles.
3. **Never redirect** — and note the behavior differs per endpoint, so there is no single safe rule to reason from. `setFollowRedirects()` is never called anywhere; all handling is manual. On the **image** request, 307/308 get one hop and **drop `ID`, `Access-Token` and `Accept-Encoding`** (headers are not re-applied after `begin()`); 301 is accepted then fails as "No data received"; 302 hard-fails. On **`/api/display`**, 307/308 get one hop and auth **is** re-applied, while 301 and 429 are accepted and then fail as JSON parse errors. **`/api/setup` follows no redirects at all** and silently fails enrollment. Serve 200 directly; signed-URL schemes that 302 to S3 will not work.

Also: don't gzip images (it sends `Accept-Encoding: identity`); don't return status 202 (it triggers a 5-second fast-poll loop, 50 wakes); don't emit `filename: "empty_state"` (a magic string that draws the setup logo). **PNG decode errors are swallowed by the firmware** — a `png_res = PNG_NO_ERR` debug line makes the rejection path unreachable — so a blank or stale panel may be your only signal. TLS uses `setInsecure()`, so certs are never verified and plain HTTP works; a self-signed cert is fine, but the device cannot detect a MITM.

Images hosted on a **different** host than the API get no `ID` and no `Access-Token`, so they must be publicly fetchable. The test is a raw `strncmp` of `image_url` against the stored base URL over `baseUrl.length()` — no parsing, no normalization. Since our base URL includes the secret token path, an `image_url` under that same prefix **does** receive auth, and any URL that diverges before the end of the base URL does not.

`refresh_rate` has **no clamp**, so an overnight sleep is just a large value (8h verified). It persists in NVS, so the waking request must send a normal value back, and the device wakes to poll rather than on a wall clock, so compute "seconds until morning" fresh each evening rather than assuming a constant.

### Failure and staleness — the design requirement

**E-paper is persistent.** Whatever was last painted stays on the glass indefinitely, with no power and no server. So when the Worker is unreachable, the last good render remains on the wall looking perfectly authoritative. **No server-side code can fix this** — a server that is down cannot send an error screen. Any defense living only on the server is not a defense against the server failing.

So the primary mechanism lives inside the rendered image:

1. **Every render carries a visible "Updated at h:mm" timestamp.** This is the whole defense against the unfixable case, and it needs no infrastructure. Real transit signs do this.
2. **Prefer absolute clock times over countdowns.** "4 min" becomes a lie within minutes; "4:26 pm" is still correctly labeled an hour later.
3. **Refuse to render countdowns on old data** — drop to clock times past a small age threshold.

**The trap:** an error or degraded screen must get a `filename` distinct from the last good render, or the cache no-op will suppress it and the panel will keep showing stale departures. The flicker optimization and the error path are in direct tension. Every error state needs a filename that is stable *for that state* but distinct from any good render.

`/api/log` helps diagnose after the fact but cannot help here — there is no push channel, so a silent device cannot be prodded.

#### Two clocks, and the server only knows one of them

Most of the confusion here comes from conflating two different ages:

1. **How old is the data?** When OneBusAway generated these predictions. The server knows this exactly.
2. **How old is the glass?** When the panel was last repainted with anything. **The server cannot know this.** It knows when it last *served* a response, not whether the device woke, fetched, decoded, or painted it — and after any outage it has no idea how long the sign has been showing something old.

The "Updated at" stamp works because it converts (1) into a physical property of the image at render time. Whatever is on the glass then carries its own honesty with it, with no server, no network, and no power required. That is the entire reason it is load-bearing rather than a nicety.

**Take the timestamp from OneBusAway's `currentTime`, not from our own clock at render time.** If OBA serves us stale or cached predictions, our render time overstates freshness — the sign would claim data is fresher than it is, which is the exact failure the stamp exists to prevent.

#### Five ways stale data reaches the glass, and which are fixable

| # | How | Server can detect? | Defense |
| --- | --- | --- | --- |
| 1 | Worker down, device polls and fails | **No** — it is the thing that failed | On-image "Updated at" only |
| 2 | Device offline, asleep, or WiFi-dead | **No** | On-image "Updated at" only |
| 3 | Firmware's own error paths are slow or silent | No | On-image "Updated at" only |
| 4 | OBA down or empty while the Worker is up | Yes | Degraded screen with a distinct `filename` |
| 5 | Real-time missing for some routes only | Yes | Per-row "Scheduled" label |

Rows 1-3 are why the stamp is not optional. **Note how bad row 3 is specifically:** three failure modes — malformed body, wrong `Content-Type`, out of memory — draw *nothing, ever*, and the device settles into 900 s polls showing stale departures indefinitely. And the firmware tracks no staleness of any kind, so it will never volunteer that anything is old.

#### The countdown is the most dangerous element on the sign

It is the largest, most prominent number, and it decays fastest. On a frozen panel "**4** min" is not merely stale, it is **actively false and maximally visible** — it will still read "4 min" tomorrow. A clock time is self-correcting by comparison: "4:26 pm" is still accurately labeled 4:26 pm forever, and a human reads it against the room's own sense of time.

Real Connectpoint signs show countdowns because they are wired, monitored, and replaced when they break. This one is none of those. So:

- **Refuse to render a countdown when the data is older than the threshold.** Fall back to the clock time for that row.
- **Never let the countdown be more prominent than the as-of stamp is legible.** If someone can read "4 min" from the doorway, they must be able to read the staleness cue from the doorway too.
- Row 5 is a different lie from rows 1-4: a **scheduled** time is not stale, it is unverified. Label it as such. An unlabeled scheduled time claims a bus exists that may have been cancelled.

#### The board design — see `src/render/CLAUDE.md`

The design record — sample stops, the two-stop band layout, the Connectpoint reference, the real-time vs scheduled treatment, the format ladder, and the partial-failure treatment — lives in `src/render/CLAUDE.md`, which loads automatically when working under that directory. Read it before changing anything the sign draws.

**Two rules from it apply everywhere and stay here.** Mockups use the downtown Seattle sample stops, **never the stop this sign actually points at** — do not name that stop, its cross-streets, its routes, or its neighborhood in any tracked file, and never commit a render of it. And use real route numbers and headsigns in mockups; invented ones hide width problems.

#### The refresh schedule and the overnight rest screen — decided 2026-08-01

**Two states, not three.** Awake from `ACTIVE_START` to `ACTIVE_END` — 06:30 to 21:30 Pacific — polling at `REFRESH_ACTIVE_SECONDS`. Outside that, one sleep until the window reopens. The earlier plan's middle tier (60s during commute windows, ~15 min the rest of the day) was dropped because there are no commute windows to describe: the sign polls at one rate the whole time it is on. `REFRESH_IDLE_SECONDS` was deleted rather than left unconsumed, on the same reasoning that removed `HEADER_TEXT`.

**Outside the window the Worker never calls OneBusAway.** The rest screen is built from config alone. That is not a quota optimisation, it is what makes it impossible for an upstream outage at 9:30 pm to pin an error screen to the glass for nine hours — there is no request to fail.

**Daylight saving is the whole of the difficulty, and it lives in one function.** `refresh_rate` is a duration, so the active cadence cannot be affected: 60 seconds is 60 seconds in March as in July. The entire exposure is "seconds until the next 6:30 am local", and the obvious form of it is wrong — `( activeStartMinutes + 1440 - nowMinutes ) * 60` assumes every night is 24 hours, while spring-forward is 23 and fall-back is 25. JavaScript converts an instant to local wall-clock time but not the reverse, so `nextOccurrenceMs()` projects the naive delta, formats the result back in the configured zone, and shifts by however far off it is. Bounded loop, and `src/schedule.test.js` pins both 2026 transitions.

A wake margin of 60 seconds puts the morning wake just inside the window. A device whose timer drifts early is self-correcting anyway — the next opening is a minute away, not tomorrow's — but the margin keeps that off the normal path.

**The rest screen is a moon in the route badge, and deliberately says nothing.** Metro logo, the badge centred, the stamp bottom left. No headline: any sentence about service would be false, because the sign has finished for the day and the buses have not, and "service resumes at 6:30 am" is exactly the wrong claim. It is not a failure screen and must not read as one.

The badge is the sign's signature element — a filled rounded rectangle with a white glyph, where a route number goes — so putting the moon there says "off duty" in the vocabulary the board already taught the reader, rather than borrowing an icon from outside it. The header carries the logo alone: the word `Departures` is on a board because it is listing some. The footer's right-hand slot, where a board names its stop, is empty; a board names the stop in every band all day, and repeating it on a screen that says nothing else is noise.

**The moon's optical shift is applied outside its rotation, and that ordering is the whole of the vertical centring.** A crescent occupies only the left part of the disc it is cut from, so it has to move right to sit on its own point — and inside the rotation that horizontal nudge becomes a diagonal one and lifts the moon visibly off the plate's centre line.

**The footer says `Back at 6:30 am`, not `Updated at 9:30 pm`, and nothing is lost by the swap.** On a board the stamp is an observation — OneBusAway's own `currentTime` — and it is the whole defence against a silently frozen panel. On this screen it never was: every time here comes from config, so an `Updated at` line would read the same thing every night whatever had happened, which is a freshness claim that cannot be false and therefore cannot be informative. The opening time is what a reader standing in front of it actually wants, and a moon on the glass at noon is its own alarm without help.

**Every time on it comes from config rather than the clock.** `formatMinuteOfDay()` renders a configured wall-clock time with no `Intl` call, because there is no instant to format. Two consequences, both intended:

- It reads `6:30 am`, never a minute either side, whichever second the device's wake lands on.

- The image is a pure function of config, so it is byte-identical every time it is served and the content half of its `filename` never moves. The epoch half still advances with `stableEpoch()`, whose 12-hour bucket rolls at about 02:00 Pacific — deliberately inside the sleep window, where nothing is awake to see it.

**One consequence of `/image` rebuilding the current screen rather than looking up a stored one:** for the few seconds around `ACTIVE_END` or `ACTIVE_START`, `/api/display` can land one side of the boundary and the device's image fetch the other, so the bytes it downloads are the other screen. Nothing fails — `src/byos/image.js` ignores the requested filename by design — but the visual delta is a whole screen rather than a minute of clock movement, which is the same accepted drift `src/oba/memo.js` documents, at its widest. Twice a day, for the length of one HTTP round trip.

No clock and no weekday or date in the header — on a board they catch a panel frozen since yesterday, but here they would name a moment this screen outlives by design, and a moon still on the glass at noon is already its own alarm.

**A malformed URL outranks the schedule.** `chooseScreen()` checks the bad-path case first, because pairing happens whenever the owner is standing at the sign, including at 10pm, and a moon in place of the diagnostic turns a two-second fix into a mystery until morning.

**The chosen layout is `badge-moon-inverse-stars`** — an inked panel, the moon plate reversed to paper, white stars, the header and footer rules but no bar, and `Wakes at 6:30 am` in the footer. Set as `DEFAULT_OVERNIGHT_VARIANT` in `src/render/overnight.js`, 2026-08-01.

**`Wakes at`, never `Back at`.** The subject has to be the sign: "back at 6:30" invites the reading that Metro is not running until then, which is false — the buses keep going all night and only this panel stops. The whole screen exists to avoid making that claim, so its one line must not make it either.

**The variants that lost are kept, not deleted**, and render at **`/_preview/parked`** rather than on the main sheet — a contact sheet that mixes what the sign draws with what it never will stops being a picture of the sign. Each draws the whole panel rather than dropping a glyph into a shared frame, because they differ in the header and the background as well as the middle. `LIVE_OVERNIGHT_VARIANTS` is what splits the two pages. The runner-up, `first-departures-inverse-moon`, lost on data rather than on taste: it needs `schedule-for-stop`, which nothing calls yet.

#### Accepted risk, decided 2026-08-01

**Stale data on the glass is an accepted risk, on the condition that an "Updated at" stamp is always present and verifiable at a glance.** This is a deliberate call by the owner of the sign, not an oversight. It means:

- **No hard staleness threshold is required.** The earlier plan to refuse countdowns past some age is downgraded from a requirement to an option. The stamp is the mechanism; arithmetic on the user's part is the fallback.
- **The stamp's legibility becomes the load-bearing requirement.** "At a glance" is the whole condition being relied on, so the stamp must be readable from wherever the departures are readable. In the current mockups it is footer-sized, which is very likely not enough — treat sizing it as a real design task, not a caption.
- The stamp must be unambiguous: include am/pm, and consider a day or date cue, since "Updated at 4:22" is meaningless if the panel froze yesterday.

**One consequence worth understanding rather than just accepting.** An as-of stamp makes *clock times* self-verifying and does much less for *countdowns*:

- "Updated at 4:22 pm" next to "4:26 pm" — one glance confirms both the departure and the freshness. If the panel froze, the row is still a true statement about a bus that has since left.
- "Updated at 4:22 pm" next to "**4** min" — the reader has to do arithmetic to check it, and on a frozen panel the row is simply false, in the largest type on the sign.

So the countdown remains the weakest element even with the stamp. It stays because it is the signature element of the Connectpoint design, but it is the first thing to reconsider if the sign ever misleads anyone in practice.

#### Degraded screens must be obvious across the room

An error state that looks like a normal board with small print is a failure. Someone glancing from the doorway must see immediately that the sign is not currently telling them when the bus comes. Small print at the bottom does not achieve that; a visibly different layout does.

Every degraded state needs a `filename` that is **stable for that state** (so it does not flicker while the condition persists) but **distinct from every good render** (so the cache cannot suppress it). `FILENAME_TAGS` in `src/filename.js` exists for exactly this.

### Access control

`/api/setup` is unauthenticated by design (that is how enrollment works), so anyone who finds the URL can enroll and burn the OneBusAway quota. A shared secret therefore rides in the URL path, held in a Worker secret, never in source.

**Base URL shape — decided 2026-08-01:**

```
https://<worker>/token/<token>/agency/<agency>/stop/<stopId>[,<stopId>]
```

giving `/token/<token>/agency/<agency>/stop/<stopId>/api/display`. **Token first** so a bad token short-circuits before any parsing or upstream call. Compare in constant time, and give a bad token the same response as a bad path — byte-identical status, headers and body. **Timing is the one deliberate exception**, and only in one direction: see the tarpit rules below.

**The stop segment is one or two comma-separated IDs — never more.** One is a single-direction sign; two is any two stops under that agency, which need not be a street pair. Opposite directions of one street is the common case, but two stops a few blocks apart is equally valid and is what the sample board uses — the layout names each stop in its own band rather than assuming they share one. Reject three or more with the same response as any other bad path rather than truncating silently, and render in the order given. A comma is a legal unencoded sub-delimiter in a path segment, and OBA stop IDs never contain one, so no escaping is needed.

Labelled segments rather than the earlier `/t/<token>/s/<agency>_<stopId>`, for two reasons. It is legible when read off a captive-portal field on a phone, and it keeps the agency out of the stop segment — OneBusAway stop IDs are not opaque integers and routinely contain their own underscores and hyphens (`40_E15-T1`, `40_S_KS_T3`, `96_SCM`), so a single `<agency>_<stopId>` segment is a split waiting to be written wrong. Reassemble as `<agency>_<stopId>` only at the point the OBA URL is built.

Everything the device fetches lives under that prefix, `image_url` included — the firmware's auth test is a raw `strncmp` against the stored base URL, so an image URL that diverges before the end of the prefix silently loses its `Access-Token`.

**The token will appear in request logs and analytics** — log a hash or a redacted path, never the raw URL, or the secret lands exactly where people paste when debugging.

#### Opaque before auth, helpful after — the rule the gate implements

Decided 2026-08-01, and it resolves what otherwise reads as a contradiction between "never distinguish a bad token from a bad path" and "a misconfigured stop must be diagnosable":

- **Before the token matches, be maximally opaque.** Every rejection is the same 404. Nothing reveals which half of the URL was right.
- **After the token matches, be maximally helpful.** A caller holding 32 random bytes is the owner or the owner's device, and there is nothing left to protect from them. `diagnosePath()` in `src/abuse.js` returns *why* a path failed, and that reason is only ever reachable past the token check.

404 rather than 403 for every rejection, which also matches the reference BYOS server — Terminus answers an unknown device key with a 404. The status line barely matters to the device in any case, since it reads `status` from the JSON body; it matters entirely to a scanner, and 404 tells a scanner nothing exists.

#### The tarpit is keyed on path shape, never on token validity

**The obvious design is wrong here and costs an afternoon.** Delaying every auth failure, the way a login form does, breaks the device: its read timeout is 15 seconds, the first three failed polls draw *nothing at all* on a 15/30/60 second backoff, and only the fourth reaches an error screen — roughly seven minutes. So any delay a real device can reach is indistinguishable from the server being down.

That case is not hypothetical, it is the pairing runbook: a token typed into the captive portal with one character wrong produces exactly a well-shaped path with a bad token. A shorter delay is no better, because the radio stays on for its duration and wake count is the whole battery budget.

So:

- **Unshaped path** (fails `extractToken()`) → 25 s tarpit, then 404. A `*.workers.dev` scanner hitting `/`, `/api/display`, `/wp-login.php` lives here, and the device cannot reach it by construction, since every URL the firmware builds starts from a base URL carrying the token.
- **Well-shaped path, bad token** → **fast 404, no delay.** The pairing typo.
- **`/stats` wrong password** → tarpit. Human-typed, brute-forceable, no radio involved.
- **`/robots.txt` and `/favicon.ico`** → answered immediately, specifically so neither is tarpitted. A browser requests the favicon unprompted on every `/stats` visit, and a compliant crawler is trying to ask permission.

**Never gate on `User-Agent`.** The firmware's is undocumented and unverified, and on a 5 GHz access point the device switches to an entirely different HTTP implementation over ESP-AT whose headers nobody has observed. That is the same class of mistake as the WOFF font — a plausible assumption that fails silently and completely.

**Do not port a KV rate limiter.** KV's free write quota is 1000 a day and this sign alone polls ~1440 times a day, so per-request bookkeeping would exhaust it on legitimate traffic before an attacker existed. Enforcement is deliberately absent; observation is the whole mechanism.

### The stats page — see `src/stats/CLAUDE.md`

`/stats`, HTTP Basic on `STATS_PASSWORD`, matched **before** the token gate because it carries no path secret and would otherwise 404 as an unshaped path. Everything else — the positional, append-only Analytics Engine schema, the 20-blob/20-double per-row ceiling that cost a day of data, the separate device-telemetry dataset, and the "no device has polled" state — is in `src/stats/CLAUDE.md`, which loads automatically when working under that directory.

### Pointing the device at this Worker

Only via the **WiFi captive portal** — its `server` field, POSTed as JSON to `/connect`. There is no dashboard setting and no usable build flag (`include/config.h`'s `API_BASE_URL` define is unguarded, so `-D` loses to it). The URL is persisted **only if the WiFi credentials also succeed**, so a wrong WiFi password silently discards the server URL and looks like "the sign ignored my server."

Usefully, **changing the base URL wipes the stored `api_key` and `friendly_id`**, forcing a clean re-pair. That is the supported way to re-point a device, not a corrupt state.

**No Developer Edition or BYOD license is needed for BYOS** — per `docs.trmnl.com/go/diy/`, buying their device and pointing it at your own server is free for all customers. Dev Edition is a hosted-platform feature flag (private plugins, API keys, debug logs); irrelevant here. So the Clarity Kit is worth buying for the battery, not for the dev edition.

## Data source

OneBusAway Puget Sound: `https://api.pugetsound.onebusaway.org/api/where/arrivals-and-departures-for-stop/{agency}_{stopId}.json`

**The stop is never hardcoded.** It implies a home address, and one deploy should serve any stop. It travels in a **path segment of the device's base URL**, so it lives only in the device's NVS.

A query param cannot work: the firmware does `baseUrl + "/api/display"` with no URL parsing, so `?stop=X` would land before the path and mangle both. Path segment only. Normalize a trailing slash server-side — the firmware doesn't, and you would get `//api/display`.

**The stop is never written down in this repo.** It lives in `.dev.vars` as `DEV_STOP_ID` for local work (see `.dev.vars.example`), and in the device's NVS in production. The development stop has been verified live against the API and serves exactly three routes, which is few enough that route filtering may turn out to be unnecessary — but do not name the stop, its cross-streets, its routes, or its neighborhood in any tracked file. Any one of those identifies the address.

- **One deployment covers the whole region — 11 agencies, one key, one endpoint.** Queried live 2026-08-01 via `agencies-with-coverage.json`: `1` Metro Transit, `3` Pierce, `19` Intercity, `20` Kitsap, `23` City of Seattle (streetcar), `29` Community, `40` Sound Transit (Link *and* ST Express), `51` Amtrak, `95` WA State Ferries, `96` Monorail, `97` Everett. No second integration is ever needed to add Sound Transit.
- **A stop's agency prefix is who owns the pole, not who serves it.** Verified downtown 2026-08-01: stops prefixed `1_` return arrivals for **36 Metro routes and 8 Sound Transit routes**. So a single Metro stop ID already yields Metro buses *and* ST Express buses with no extra work. Link is the exception — stations are their own `40_` stops, so showing Link alongside a bus stop needs a second, cross-agency stop ID.
- The agency prefix is the first underscore-delimited field and every agency ID is numeric; **the rest of the ID is opaque and may contain its own underscores and hyphens** (`40_E15-T1`, `40_S_KS_T3`, `96_SCM`). Split on the *first* underscore only. Never split on the last, and never assume the remainder is digits.
- The `TEST` key is aggressively rate-limited and returns HTTP 429 under any real use. Retry with backoff during development, and do not build anything that depends on its throughput.
- Requires an API key — a Worker secret. **Sound Transit is the only issuer, confirmed against the operator's own page** (`pugetsound.onebusaway.org/wiki/Developers` points at `soundtransit.org/Open-Transit-Data` and nowhere else). There is no key to get "from OneBusAway" — OBA is open-source software, and each regional deployment runs its own server and issues its own keys; `developer.onebusaway.org` documents the API shape, not credentials. It is a request form, not self-serve. `TEST` has historically worked for low-volume personal use; fine for development, do not ship on it.
- **One fetch per stop, not two.** `arrivals-and-departures-for-stop` already returns `data.references.stops` and `data.references.routes`, so route short names, long names and colours ride along with the predictions. A separate `/stop/{id}.json` call is only needed for distance/bearing from a lat/lon origin, which a fixed-stop sign has none of.
- Departures are `predictedArrivalTime` minus now, sorted ascending, filtered to the routes shown. **Dedup by `tripId`** — one stop can return the same trip more than once — and drop anything already in the past.
- When real-time is missing, fall back to `scheduledArrivalTime` and **label it** — that is what Metro's own signs do, and an unlabeled scheduled time is a lie about a bus that may not exist.
- Opposite directions are **two separate stop IDs**, not a field on one stop. `stop.direction` is a compass string (`N`, `NE`, `E`, …) in the same response.
- `Intl.DateTimeFormat` with `timeZone: "America/Los_Angeles"` works under workerd. The "Updated at h:mm" stamp needs no tz library and no bundled tz data.

## Configuration — nothing is hardcoded

**Treat every deployment-specific value as configuration, without exception.** Someone else should be able to fork this, point it at a different stop in a different city with different hours, and change nothing but config. The privacy rule that keeps the stop out of the repo is the narrow case of a general one: if a value describes *this particular sign*, it does not belong in a source file.

Concretely, none of these may be literals in the code — and the list is illustrative, not exhaustive:

- **Stop IDs and agency.** Also the number of stops shown.
- **Wake and sleep times.** The start and end of the active day.
- **Timezone.** `America/Los_Angeles` is this sign's, not the code's.
- **Refresh rates**, both the commute-window rate and the off-peak one, plus the commute windows themselves.
- **Route filtering**, if any.
- **The staleness threshold** past which countdowns are refused.
- **Row count**, which follows from panel size and type scale.
- **The OneBusAway base URL.** Another region means another deployment; only Puget Sound has been tested.
- ~~**The header text.**~~ Withdrawn 2026-08-01. `HEADER_TEXT` existed so a non-Metro agency could relabel the header bar, and it was never consumed: bus boards draw the Metro logo as an embedded asset, and rail draws its own lockup from the board data. Both agencies this sign serves get a logo rather than a word, so the var was config for a case that does not arise. **A different agency is a fork's problem, not a var's** — it needs its own logo asset, which no string could have supplied.

### Where each kind of value lives, and why

Three homes, chosen by what the value *is* rather than by convenience:

| Kind | Home | Why |
| --- | --- | --- |
| Secrets — `DEVICE_TOKEN`, `OBA_API_KEY` | `wrangler secret put`, `.dev.vars` locally | Never in the repo, never in the dashboard Variables UI (`wrangler deploy` wipes those) |
| Privacy-sensitive and per-device — agency, stop IDs | A path segment of the device's base URL | Lives only in device NVS, so it is never written down anywhere, including here |
| Privacy-sensitive but needed server-side — `DIRECTION_OVERRIDES` | With the secrets: `.dev.vars`, `wrangler secret put` | Keyed by stop ID, so a committed map names this sign's stop. Not a credential — this is the fourth case, found 2026-08-01 |
| Everything else — schedule, timezone, thresholds, labels | `[vars]` in `wrangler.toml` | Not secret and not private, so a forker edits one committed file and redeploys |

Read `[vars]` only through `readConfig()` in `src/config.js`. Two things it exists to absorb: the same name arrives as a **number** from `[vars]` and as a **string** from `.dev.vars` or a secret, and a malformed value must fall back rather than throw, because `/api/display` runs ~1440 times a day and must never fail over a label or a refresh rate.

**A query parameter can never be used for any of this.** The firmware builds request URLs as `baseUrl + "/api/display"` with no URL parsing, so anything after a `?` in the base URL lands before the path and mangles both. Path segments only.

**Defaults are allowed; hardcoded values are not.** A sensible fallback when a var is unset is good — silently baking this sign's hours into a comparison is not.

## Conventions

- **Verify against primary sources, not memory.** The BYOS spec is evolving and the reference docs have been wrong twice already. Check the GPLv3 firmware at `github.com/usetrmnl/trmnl-firmware` and `usetrmnl/terminus` when the contract is ambiguous. Appending `.md` to a `docs.trmnl.com` path returns raw markdown; `usetrmnl.com` docs URLs now 301 to `trmnl.com`.
- Run the test suite and linter when a change is done, and fix what they report.
- **Regenerate `assets/bus.png` and `assets/light-rail.png` whenever the rendered design changes**, from `/_preview` or by driving `sampleBoards()` through the renderer directly. They are the README's screenshots, and its alt text describes them down to the row count — both went stale once already, first when the direction labels changed and again at three rows per direction. Update the alt text in the same commit.
- **No repo `.gitignore`, deliberately.** `~/.gitignore_global` already covers every relevant path — `.dev.vars`, `.cloudflare.env`, `.wrangler`, `.npm-cache`, `.claude` (confirmed with `git check-ignore`). Add a repo `.gitignore` only if something appears that is genuinely specific to this repo and not already covered.
- **`docs/TODO.md` is a work queue, not a record.** Finished items are deleted, not checked off — so anything worth keeping moves here, into the relevant doc, or into a code comment *before* the entry goes.
- **`docs/todo-someday.md` is its overflow.** An item belongs there rather than in `TODO.md` when it is not going to be started soon — blocked on a decision nobody needs to make yet, or explicitly not being built. The test is intent, not size: a small item that will never be picked up goes there, and a large one that is next stays in the queue.
- **Stack: plain JS, not TypeScript, and no framework.** One Worker, vitest for tests, eslint flat config. Do not add React; there is no SPA and there is not going to be one.
- **The layout preview needs no build tooling.** Earlier notes reserved the option of adding Vite for it. That turned out to be unnecessary: the Worker already renders the PNG, so `src/dev/preview.js` just serves a page of `<img>` tags pointing at its own render route. One process, no bundler, no second dev server. **Do not add Vite.**
- `vitest.config.js` aliases `.wasm` and `.ttf` to `vitest.binary-stub.js`, because vitest tries to parse binary modules as JavaScript. The alias pattern must span the whole specifier — Vite substitutes only the matched portion, so anchoring on the extension splices the stub path onto the original.
- **Never write a wasm glob inside a block comment.** `**` followed by `/*` closes the comment early and the rest of the file parses as garbage, with an error pointing at the end of the file rather than the comment. Say "a wasm glob" in prose instead.

### Sandbox notes for this environment

Two commands need their state redirected out of denied paths, or they fail with `EPERM`:

- `npm install` → `export npm_config_cache="$PWD/.npm-cache"` (`~/.npm/_cacache` is denied).
- `wrangler dev` → `export XDG_CONFIG_HOME=...` and friends, plus `WRANGLER_LOG_PATH` (`~/Library/Preferences/.wrangler` is denied). An agent doing this leaves a `.wrangler-home/` directory in the repo; it is disposable and safe to delete.

Neither is a workaround for a deliberate restriction — they are cache/log locations, not the protected content.

**An agent cannot run `npm install` at all here**, redirect or no: writes to `node_modules/` inside this tree are denied and it fails on `mkdir`. Any change to `package.json` dependencies has to be handed back with the command for the human to run. Script-only changes are fine — those need no install.

**`npx wrangler ...` is also denied.** Add the subcommand to `package.json` scripts and call it through `npm run` instead. That is why `dev`, `deploy`, `test` and `lint` all exist as scripts.

