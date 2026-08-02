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
- `src/assets/` — the Metro logo as a data URI and the OneBusAway mark pre-cleaned and pre-recoloured, both generated at author time so nothing is reprocessed per render. The OBA mark is **kept but no longer drawn**; see the asset notes in the layout section.
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

**`vitest.config.js` aliases `.wasm` and `.ttf` to a stub** so modules that transitively import the renderer can still be unit tested; nothing depending on those contents is asserted.

**The four device routes are implemented, in `src/byos/`.** Landed together, 2026-08-01, one file per endpoint: `setup.js`, `display.js`, `log.js`, `image.js`, with `index.js` dispatching on the gate's classification, `credentials.js` deriving the `api_key`, and `screens.js` choosing what to draw. `src/worker.js` is now nothing but the seam between `gate()` and that dispatch. Verified end to end against `wrangler dev` and by looking at the rendered PNG, not just its status code: `Content-Type: image/png` exactly, 1872x1404 4-bit greyscale, and PNG magic bytes on `/image/setup`, which is the URL pairing depends on.

**They show live departures, as of 2026-08-01.** Verified by fetching the rendered PNG from `wrangler dev` and looking at it — a bus board and a rail board, both from real predictions, and the rail one happened to catch a live `429` on one of its two stops, which is how the partial-failure treatment got seen rather than only tested.

Three things about that wiring are worth knowing before changing it:

- **`currentScreen()` is async and is the seam.** It returns either a board or a notice, and `screenSvg()` picks the builder. `/image` calls the same function with `allowStale: true`; nothing else may.
- **`/api/display` and `/image` share one upstream response**, through `src/oba/memo.js`. Without it the device paints bytes rendered from a different fetch than the one its `filename` was hashed over, and OneBusAway gets asked twice per wake instead of once.
- **The board is stamped with OneBusAway's `currentTime`, and with the oldest one when two stops answer.** Our own clock is used only for cache expiry. A board that cannot be honestly stamped is not drawn — `loadBoard()` returns a failure rather than falling back to `Date.now()`, because a stamp taken from our clock says nothing about how fresh the predictions are, which is the one claim it exists to make.

- **Settled design decisions** are written up in the sections below: the Metro-faithful layout, the real-time vs scheduled treatment, Fira Sans, two-stop grouping, light-rail circle badges, the OneBusAway footer mark, and the sample stops.
- **The config surface is done** (2026-08-01). `HEADER_TEXT` was removed rather than wired up; see the configuration section. `REFRESH_IDLE_SECONDS` went the same way when the schedule landed — overnight is a single sleep, so there is no middle tier for it to describe.
- **The request gate and the stats page are done** (2026-08-01), and both things they left classified-but-unserved are now served: an authorized request with an unusable stop renders an error board naming the wrong segment, and the `Access-Token` header is validated on `/api/display` and `/api/log`.
- **Live OneBusAway data is wired in** (2026-08-01), including the format ladder, the mode split, and the per-stop failure treatment. See the two sections below.
**The `refresh_rate` schedule is in, as of 2026-08-01** — `src/schedule.js`, plus the rest screen in `src/render/overnight.js`. Two states, not three: awake between `ACTIVE_START` and `ACTIVE_END` at `REFRESH_ACTIVE_SECONDS`, and one sleep until the window reopens outside it. See the section below.

- **Next:** the failure-mode sweep. See `docs/TODO.md`.

**A block comment containing a glob will silently break the build.** `**` followed by `/*` closes the comment early and the rest of the file parses as garbage. Write "a wasm glob" in prose instead.

The scaffolding notes below remain accurate.

- `package.json`, `wrangler.toml`, `.nvmrc`, `eslint.config.js`, `src/worker.js`, `src/worker.test.js` exist. `npm test`, `npm run lint`, `wrangler deploy --dry-run` and `wrangler dev` were all confirmed working against this exact config.
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

#### Sample stops for mockups — downtown Seattle, never the real one

All verified live against OneBusAway. **Never use the stop this sign actually points at** — these exist so no render or committed image can leak it.

| Pair | Stops | Name | Directions | Notes |
| --- | --- | --- | --- | --- |
| **Bus, default** | `1_600` / `1_430` | 3rd Ave & Virginia St / 3rd Ave & Pine St | `NW` / `SE` | **Not a matched pair** — two stops 313 m apart, chosen independently. The standard sample; see below for why. |
| Bus, matched pair | `1_590` / `1_430` | 3rd Ave & Pine St | `NW` / `SE` | 16 and 13 routes. The former default, kept for the two-sides-of-one-street case. |
| Bus, denser | `1_600` / `1_420` | 3rd Ave & Virginia St | `NW` / `SE` | 21 routes each, all four RapidRide lines on both sides. Use when the layout needs stressing. |
| **Light rail** | `40_621` / `40_623` | Int'l District/Chinatown | `N` / `S` | 1 Line and 2 Line. |
| Light rail, alt | `40_1121` / `40_1108` | Westlake | `NE` / `SW` | Same two lines; ID/Chinatown is preferred. |

**The default bus sample is deliberately two unrelated stops, decided 2026-08-01.** 3rd Ave interleaves two stop zones — the "south end" routes (`7`, `13`-downtown-only, `14`, `36`, `4`, `70`) call at Pine, Union, Marion and James, while the West Seattle and south-county routes (`H`, `C`, `21`, `125`, `124`, `131`, `132`) call at Pike, Seneca and Columbia. Verified against `stops-for-route` for all of them: **the `7` signed for Rainier Beach shares no stop anywhere in the system with `125`, `C`, or `H` signed for Burien**, and the `D` to Ballard overlaps it only at `1_515`, which has no same-named counterpart. So no matched pair can show both a southbound `7` → Rainier Beach and a northbound `D` → Ballard, and picking the two stops independently is the only way to demo both.

That is a real configuration rather than a cheat: `/token/<token>/agency/1/stop/1_600,1_430` is two arbitrary stop IDs under one agency, which the URL shape already allows, and a sign serves whichever stops its owner actually walks to.

**International District is the right rail sample, not Westlake.** It is where the two lines diverge, and northbound *both* lines show the identical destination "Lynnwood City Center" — so the line number is the only thing separating those rows. Any badge design has to survive that. Southbound splits properly: `1 Line` → Federal Way Downtown, `2 Line` → Downtown Redmond.

**Bus stops and rail stops never mix.** Light rail has its own platforms, so a board is one mode or the other and the two badge styles never appear together. The renderer still has to handle both.

Use real route numbers and headsigns in mockups. Invented ones hide width problems — `570` and `131` are wider than the `40` early renders were tuned against, and real headsigns are far longer than anything invented.

**Fixtures keep the raw headsign; the renderer shortens it.** `collapseRepeatedPhrases()` in `src/headsign.js` drops one copy of a back-to-back repeat, so `Mount Baker Mount Baker Transit Center` draws as `Mount Baker Transit Center`. Metro concatenates destination with via-point and no separator, so the stutter is what OneBusAway actually returns — pre-shortening it in a fixture would hide the problem rather than solve it, which is what an earlier sample did.

**Badges come from the API too, and `D Line` does not fit a 152px box.** `routeBadge()` in `src/route-badge.js` strips ` Line` when a single character precedes it — 13 routes region-wide, and they are the ones a Seattle sign is most likely to show: all eight RapidRide lines, both Link lines, Tacoma Link's `T Line` and both Sounder lines. None of those has a route number; the letter *is* the designation, and both agencies print it that way, so this matches their signage rather than inventing an abbreviation.

**The badge slot holds an official designation or nothing** — a number, a number with an express suffix like Intercity Transit's `9X`, or a single letter. **Fitting is necessary but not sufficient**: `STCL` and `TA034` are short enough to draw and still do not belong there, because they read as internal codes rather than as the route a rider asks for. A route that fails the test gets a **blank slot**, and its name moves to the head of the destination instead — `Swift Blue: Shoreline North/185th Station`, `STCL: Stream TDS / Spanaway TC`, via `destinationWithRoute()`. The row is the only place with horizontal room, and the alternative was a row saying where a vehicle goes without saying which vehicle. A colon rather than a middle dot or em dash, so it survives font subsetting.

The rejected alternatives, since each looks reasonable until measured: a font-size ladder reaches about five characters and does nothing for a thirty-character name; widening the badge breaks the fixed destination column that keeps rows aligned across modes; and initials would invent signage nobody prints, with three Sound Transit routes all named `Shuttle` colliding anyway.

**The destination shrinks to fit rather than running into the time column, and the whole board shrinks together.** `destinationSize()` in `render/board.js` caps the type at the row's own scale and steps it down when the longest string on the board is too long for the space between the badge slot and the time. **Per board, not per row** — fitting each row independently puts two type sizes in one column, and that reads as a rendering fault rather than as a fit. The cost is that a short destination is drawn smaller because a different row is long. The failure it fixes is counter-intuitive and was invisible for a long time: `rowMetrics()` clamps rather than stretches, so a board with **two** departures draws them at full size and the region's longest headsign — `Pioneer Square Chinatown International District Waterfront` — ran straight through `4:47 pm`, while the same string on an eight-row board fitted comfortably. The overlap appeared when the sign had least on it.

Nothing here can measure a string — resvg does the shaping and the font is only loaded in `render/index.js` — so the fit uses an average advance per character, calibrated against a render of that longest headsign at 0.46 and rounded up to 0.5 for slack. That is an estimate and is documented as one; it costs a slightly smaller size on the few rows that need shrinking and protects against wider letterforms than the string it was measured on.

**A route with no short name at all falls back to its long name, but only when that is a service name.** 39 routes have no `shortName` — every Washington State Ferries route, and Amtrak Cascades. The split in `longName` is exact and worth knowing: Amtrak's is `Amtrak Cascades`, a service, so the row reads `Amtrak Cascades: Portland`; all 38 ferry routes are endpoint pairs like `Bainbridge Island - Seattle`, and prefixing one would produce `Bainbridge Island - Seattle: To Seattle`, restating the destination to say nothing. So a ferry row is a blank slot and a bare destination, which is accepted — a ferry has no route number, and `To Seattle` is verbatim what OneBusAway returns for that direction.

Drawing the plate for a nameless route would put a black block where a number belongs, which reads as a rendering fault; the destination column is a fixed x, so a blank slot keeps every row aligned.

**The awkward cases are all rendered side by side at `/_preview`**, built by `src/dev/edge-case-boards.js` — badge overflow in both bus and rail, the headsigns that must and must not collapse, the longest stop name, a stop with no compass bearing, and a sparse board at the row-height ceiling. Real names throughout; the co-location is synthetic and each group says so on itself.

**The rule is adjacency, never word frequency, and that distinction is the whole design.** `Seattle Pacific University Seattle Center W` and `Rainier Beach Via Rainier Ave S` each repeat a word while naming two different places; collapsing either would destroy the destination rather than shorten it. Only an immediate repeat is a stutter. `src/headsign.test.js` pins every one of those live headsigns as unchanged, which is the regression guard for anything cleverer added later.

Two reasons this is the standing choice, and both matter:

- They are **busy public downtown stops that reveal nothing** — the opposite of the stop this sign actually points at, which must never appear in a tracked file or a committed image.
- They are genuinely **two stops on one board**, which is exactly the case the layout has to solve. A single-stop sample would hide the problem.

Real routes there: northbound `H Line, 5, 17, 21, 24, 27, 28, 33, 40, 56, 57, 62, 124, 131, 132, 570`; southbound `1, 2, 3, 4, 7, 13, 14, 17, 36, 40, 62, 70, 570`. Use real route numbers and headsigns in mockups — invented ones hide width problems, and `570` / `131` are wider than the `40` that earlier renders were tuned against.

#### Two stops on one board — the layout, variant 9

`assets/sources/design-variants/variant-9-two-stops.png`. The groups are separated by a **light grey band** holding the direction, the stop name and the stop code. Four departures per direction, accepted 2026-08-01 after comparing against three — three left a visible dead band above the footer rule, and four fills the panel without the rows reading as cramped. The band is our invention — Metro's signs serve one stop, so they have no equivalent.

**The stop name lives in the band, on every group, always — revised 2026-08-01.** It was in the footer once, which assumed a board is one street in both directions. That assumption does not hold: the two stops may be blocks apart and chosen independently, and even a true across-the-street pair can carry different names when the cross streets differ. So each band names its own stop, and a board whose groups happen to name the same one says it twice. The repetition is the point — the band is the single place a reader ever looks for the stop, rather than a place the name moves to depending on data the reader cannot see. The footer is now the "Updated at" stamp alone.

Direction and name share one baseline through a `<tspan dx>` rather than a second `<text>` at a fixed x, because the name has to begin wherever the direction ends and text width is not knowable in `render/board.js` — the font is only loaded in `render/index.js`. **Spaces do not work for the gap**: SVG collapses runs of whitespace, so `"St   Stop No."` renders as `"St Stop No."` and the two read as one phrase. Verified by looking at the render, not by trusting a 200.

**Row height is derived, not a constant — added 2026-08-01 when four rows landed.** `rowMetrics()` in `render/board.js` divides the space between the header and the footer rule by however many departures the board carries, and every size inside a row scales by that one factor. Three things about it are deliberate:

- **It clamps to a 158px ceiling rather than stretching to fill.** A sparse board — one direction, or a stop with two departures left in the day — would otherwise stretch its rows across the whole panel. The accepted eight-row board comes in at 128 and is genuinely scaled; a two-row board hits the ceiling and is not.
- **Horizontal metrics never scale.** Width is not the constraint, and holding the 152px badge slot fixed is what keeps the destination column in the same place across bus, rail, and any density.
- **The clamp reserves a 12px gutter above the footer rule.** Without it the densest board that fits lands its bottom edge exactly on the rule and `pm` descenders come within a few pixels of crossing — fitting by arithmetic coincidence, and a later pixel shaved off the header would push them through with every test still passing.

Row count still is **not** configuration. It follows from how many departures the data has, bounded by what fits.

**Direction wording — decided 2026-08-01. Spell the bearing out, and allow a per-stop override.**

OneBusAway reports a compass bearing (`N`, `NE`, `NW`, …), never a word. The default is to spell it out and append "bound": `N` → **"Northbound"**, `NW` → **"Northwest bound"**. That is correct for every stop in the county with no lookup table, which is the property that matters — the sign has to work for a stop nobody has configured.

**The four cardinals close up; the diagonals stay spaced.** Revised 2026-08-01, after the first pass emitted "North bound" for every cardinal. "Northbound" is the word, and it is what Metro prints, while "Northwestbound" is not a word anyone writes. This is a spelling rule, not a semantic one, and the payoff is that a plain north-south stop needs **no override at all** — which is what an override map should look like. `COMPASS_WORDS` in `render/board.js` now holds the full label per bearing rather than a stem plus a suffix.

A small `DIRECTION_OVERRIDES` map, keyed by full OBA stop ID, replaces the label where the **bearing itself misleads** — 3rd Ave runs diagonally, so its stops report `NW`/`SE` while every rider and every Metro timetable says northbound (`1_600` → "Northbound"). Intended for a handful of personal stops. **Never a county-wide table** — that would defeat the point of deriving it.

The deployment's map lives with the secrets, never in `[vars]`; the sample boards carry their own public one in `src/dev/sample-boards.js`. See `docs/deploying.md`.

Collapsing `NW` to "Northbound" was considered and rejected: whether north or west dominates depends on the street's orientation, which the API does not give us, so it would be confidently wrong on some stops. Being verbose and right beats being idiomatic and sometimes wrong.

#### The layout follows Metro's real Connectpoint sign — variant 8 is the reference

Decided 2026-08-01 against photographs of the real signs, kept in `assets/sources/connectpoint-photos/`. The `connectpoint-0407pm-blog.jpg` photo is the clearest and is the one being matched; `assets/sources/design-variants/variant-8-metro-blog.png` is our render of it.

**Kept from the official sign:**

- Black header bar: reversed King County Metro logo, then **Departures**, then the day and date stacked small, then the clock with a smaller heavier meridiem.
- **Route badge** as a filled rounded rect with a white numeral, destination in bold beside it.
- **The right column stacks three lines**: `Scheduled` (only when it applies) over the value over the unit. This is Metro's own answer to the real-time question and it is better than any pill or colour treatment — it needs no legend and costs no contrast.
- **Format follows time distance, not data source**: `Now` for imminent, minutes for near, clock time for far. A scheduled departure two minutes out still shows "2 min" on the real sign.
- Thin rules between rows, footer rule, stop number and cross-streets in the footer.
- **Small text is set heavier than the numerals.** `min`, `pm` and the meridiem all carry more weight than their size suggests, which is what keeps them legible at distance.

**Deliberately not kept:**

- **`connectpoint` branding.** It was replaced by the OneBusAway mark for a while; the footer now credits nobody. See the asset note below — the mark is still in source, just not drawn.
- **Their two-column grid**, which is a 16:9 strip showing four departures with no destinations. We are 4:3 with room for eight rows *and* destinations.
- **The comma after the weekday.**
- **Their service-alert block.** Not needed now; see the TODO.

**Added because our sign can fail in ways theirs cannot:**

- **The "Updated at" stamp**, bottom left, starting at the left margin now that no logo sits beside it. Metro's signs are wired, monitored and replaced when broken. Ours can freeze silently, so this is the only thing that makes a stale panel self-evident. The wording is deliberate: "Updated at 4:22 pm" states what happened, where the earlier "as of 4:22 pm" read as a hedge.
- The stacked **day and date** in the header does double duty here — it is Metro's, but for us it is also the cue that catches a panel frozen since yesterday.

**Asset notes.** The reversed (white) Metro logo comes from `cdn.kingcounty.gov/-/media/king-county/depts/metro/logo-art/metro/metro-logo-reversed-200x75` and is embedded as a base64 PNG in an `<image>` element. Brand rules are at `projects.seattletransitmap.com/library/King County Metro/Graphic Standards/7.0.2-p-Logo.pdf` — note that the Verdana it specifies applies to stationery address blocks, **not** to the signage face.

**The OneBusAway mark is no longer drawn, decided 2026-08-01.** The footer is now just the "Updated at" stamp and the stop name, and the stamp starts at the left margin instead of clearing a logo. `obaMark()` and the pre-cleaned assets stay in `src/render/board.js` and `src/assets/` — putting the mark back is a one-line change, and the notes below are why re-deriving it would not be. Keep them.

**The OneBusAway mark needs three fixes, not one.** Draw the backing plate ourselves rather than using the artwork's: the source plate is square while the vehicles inside it are far wider than tall, so a square wastes height and crowds the sides. Use `assets/sources/one-bus-away-logos/onebusaway-vehicles-only.svg`, size the plate to the artwork's ~566:348 ratio, and pad the sides more than the top and bottom.

Recolouring needs a **two-step swap through a sentinel**. The bodies are `#000000` and the windows `#ffffff`; replacing black→white and then white→dark runs the first result through the second and flattens both to one colour. Bodies must end white and windows dark, or the windows dissolve into the body.

**The OneBusAway mark must be recoloured for greyscale.** Its brand green quantizes to a mid grey and the vehicles on it are black, which collapses into a smudge at footer size. Swap the square to black and the vehicles to white — same silhouette, full contrast. The source SVGs are Inkscape files; stripping the outer `<svg>` to re-frame them also strips the namespace declarations, and resvg rejects the whole document over an undeclared `inkscape:` prefix rather than ignoring it, so those attributes have to be removed too.

**Typeface: Fira Sans**, chosen 2026-08-01. The real sign's face is a Connectpoint choice and is not in Metro's brand standards, but its **open-top `4`** places it in the humanist-signage family that Frutiger and Myriad belong to. Both are commercial; of six open candidates compared at native resolution against the blog photo, **Fira Sans is the only one that opens the 4** — Inter, Source Sans 3, Public Sans, Archivo and Mulish all close it.

Judge glyph shapes at a large size. An earlier pass called Source Sans 3 open from a row-sized specimen and was wrong; the aperture is a few pixels at 76px. `variant-10-fonts` now sets a 150px `4` for exactly this reason.

#### Real-time vs scheduled — the per-row treatment, decided 2026-08-01

Five variants were rendered at native 1872x1404 and compared as images rather than described. All are kept in `assets/sources/design-variants/variant-*.png`. The script that generated them is gone — they are a record of what was tried, not a reproducible build; the design has lived in `src/` since 2026-08-01 and re-renders from `/_preview`.

**Variant E wins: no greying anywhere. A hollow route badge marks scheduled, plus an outlined `SCHED` pill.**

- **Live rows:** filled black badge, white numeral.
- **Scheduled rows:** outlined badge, black numeral on white, and a `SCHED` pill before the time.
- **Everything else stays full black on every row** — destination, time, all of it.

The filled-vs-hollow badge is a **shape and weight** difference rather than a tonal one, which is why it survives distance: at a glance the eye picks out solid black blocks versus outlines without reading anything. The pill confirms it up close.

**Why the greying variants lost, which is the part worth remembering.** Greying a scheduled row dims the one thing the reader came for. A scheduled 4:31 is not an error and not stale — it is the best available answer for that bus, and it should be as legible as any other. Variants A, B and C all degraded real information in order to signal uncertainty about it. Variant D was the halfway house (grey the badge and destination, keep the time black) and read as though the row had failed to render rather than as a deliberate signal.

Also rejected: labelling every row `LIVE`/`SCHED` (variant B) spends ink and horizontal space on the majority case to restate what the badge already says, and stacking a `SCHEDULED` word above the time (variant A) crowded the numerals at native resolution.

**A consequence worth keeping: grey now carries no meaning in the row area at all.** It is only de-emphasis — the footer, the `min`/`pm` units. That removes the conflict the greying variants would have created, where the same tone had to mean both "unverified" and "less important". Two distinct greys are defined in the spike for this reason: a mid grey for anything meaningful, a light grey for de-emphasis. With E, only the light one is used.

#### The format ladder — thresholds read off the real signs, 2026-08-01

`Now` under a minute, `N min` through **10**, clock time from **11**. In `src/oba/format.js`, and nowhere else — the mapper emits a `departsAtMs` and a `live` flag, so revisiting the ladder is a change to that one file.

The numbers were **measured, not chosen.** Every photograph in `assets/sources/connectpoint-photos/` carries the current time in its header, which makes every row a data point:

| Photo | Header | Largest `N min` | Smallest clock time |
| --- | --- | --- | --- |
| `connectpoint-0652am` | 6:52 am | **9 min** | — |
| `connectpoint-0411pm` | 4:11 pm | 8 min | — |
| `connectpoint-0650am` | 6:50 am | 8 min | 7:03 am (13 min) |
| *(not kept)* | 3:51 pm | 7 min | 4:03 pm (12 min) |
| *(not kept)* | 5:03 pm | 2 min | 5:14 pm (**11 min**) |
| `connectpoint-0407pm-blog` | 4:07 pm | 4 min | 4:26 pm (19 min) |
| `connectpoint-0250pm-rapidride` | 2:50 pm | 5 min | 3:10 pm (20 min) |

**Two of those photos are no longer in `assets/sources/connectpoint-photos/`**, including the 5:03 pm one that supplies the `11 min` observation — the single row that fixes the top of the ladder. The readings were taken when the photos were present and are kept here because this table *is* the record; they are simply no longer re-checkable from the repo. Do not treat their absence as a reason to re-derive the thresholds, and do not delete the rows to tidy the table.

So Metro counts minutes to at least 9 and is showing clock times by 11; 10 was the owner's call on the one boundary the photos do not settle. **Do not re-derive this from an assumption** — the first guess in this project was 20, and the photos disprove it.

Two more things the same photographs settle, both free:

- **`Scheduled` rows use the identical ladder.** `Scheduled 2 min`, `Scheduled 4 min` and `Scheduled 8 min` all appear on real signs. Whether a prediction is live changes the label above the time and never the format of the time.
- **A departure slightly in the past is `Now`, not gone.** `NOW_GRACE_MS` is 60 seconds. The first departure in every captured fixture is a bus already at the kerb with a prediction a minute old; dropping those would blank the most useful row on the board exactly when it matters.

Minutes are **floored**, not rounded: understating the wait sends someone to the kerb early, and overstating it lets them watch the bus leave.

#### A stop that answers and a stop that does not — 2026-08-01

Two stops fail independently, so half a board failing is the ordinary shape of an outage rather than a rare one.

- **One stop answering is enough for a board.** The failed group keeps its band and says `Departure data unavailable` where its rows would be. Only when *every* stop fails does the sign drop to the full-panel `obafail` notice.
- **A stop with no service left is a different sentence** — `No more departures today` — and stays a board, tagged `noservc`. "We could not ask" is a fault and "nothing is coming" is an answer, and a reader has to be able to tell them apart.
- **An empty group keeps its full share of the panel.** `reserved` on the group, honoured by `rowMetrics()`. Without it the surviving direction's rows grow to fill the gap, and a partial failure renders as a different design rather than as a missing half. The message is centred in that space, large: left-aligned at row size it was tried first and read as a caption someone forgot to finish.
- **Row count comes from `maxRowsPerGroup()` in `render/board.js`**, which divides the panel by a legibility floor. Two stops get four each, which is the density the design was accepted at; a single-direction sign gets more, because it pays for one band instead of two and a gap. This is how row count stays derived rather than configured.

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

### The stats page

`/stats`, HTTP Basic on `STATS_PASSWORD`, matched **before** the token gate because it carries no path secret and would otherwise 404 as an unshaped path. Backed by Analytics Engine: free on the Workers Free plan at 100k writes and 10k read queries a day, written through a Worker binding and read through an HTTP SQL API that needs `CLOUDFLARE_ACCOUNT_ID` and a token scoped to Account Analytics read. **Expected volume is ~3-5k data points a day against that 100k** — there is no quota question, stated so nobody re-derives one.

**Blob and double positions in `src/stats/schema.js` are permanent.** Analytics Engine rows are positional arrays with no schema, so inserting a field mid-list silently reinterprets every historical row, with no migration and no way to detect it afterwards. **Append only.** Queries reference columns through `blobColumn()` rather than writing `blob14`, so appending cannot shift a query onto the wrong column. `src/stats/schema.test.js` pins the order by absolute position — never as "the last one", which would silently follow a column that moved.

#### Twenty blobs and twenty doubles, and the row is rejected whole past that

**Analytics Engine's per-row ceiling is 20 blobs and 20 doubles.** It is a fixed number of slots, not a schema that grows with what you write — `SELECT * LIMIT 1` returns `double1` through `double20` on a dataset that has only ever been written 10 doubles. A row handed more than 20 of either is **dropped entirely**, not truncated to the first 20.

**This cost a full day of data on 2026-08-02.** Seven device columns and `upstreamReason` were appended to a request schema already at 20, taking it to 28. From that deploy until the split below, **every** write was rejected: no request outcomes, no rejections, no scanner traffic. Nothing surfaced it — `recordRequest()` swallowed the error, `/stats` rendered a reassuring "that is the expected state" banner over an empty dataset, and 739 tests stayed green. The only visible symptom was two panels reporting `unknown column: "blob21"`, which reads like a bad query rather than like a dataset that has stopped accepting rows.

Three things now guard it, and the order matters because the first two are not what you would expect:

- **`assertWithinLimits()` throws at module load** in every file defining a dataset schema. It cannot be swallowed by a write path's catch.
- **`npm test` is what catches that throw. `wrangler deploy --dry-run` is not** — verified by pushing the list to 21 on purpose: the dry-run bundles without executing top-level code and reports a clean upload, while eight test files fail. So `npm run deploy` runs the suite first, and that gate is load-bearing rather than belt and braces.
- **Failed writes are logged** rather than silently swallowed. The original reasoning — that a rejected write "shows up as a suspiciously empty `/stats` page" — was exactly backwards, since an empty page is also what a Worker nothing has found looks like.

The cost of the throw is worth knowing: if an over-long schema ever did ship, module evaluation fails and **every request 500s**, so the sign goes dark rather than merely losing analytics. That is the intended trade — a dead Worker is found in minutes, a silently rejected dataset was not found for a day — but it is why the deploy gate matters.

#### Device telemetry is its own dataset

`src/stats/device-telemetry.js`, dataset `trmnl_orca_departures_devices`, binding `DEVICE_TELEMETRY`. Added 2026-08-02 to fix the overflow above, and right on its own terms: these columns describe a **device**, not a request, and most rows in the requests dataset are scanner traffic where every one of them is empty.

**`deviceId` is the MAC address, from the `ID` header, and it is the only stable per-device key.** Everything else the firmware sends describes a *kind* of device — model, geometry, firmware build — so without it two identical signs are indistinguishable, which is exactly the case the identity alarms exist to catch. **There is no serial number**; the firmware sends none, so the MAC stands in for one.

- **One row per authenticated device request**, written from the same `recordOutcome()` closure in `src/gate.js` as the request row, so the two cannot drift apart.
- **Gated on `identifiesADevice()`** — an `ID` or `Model` header, either alone. The setup-logo download sends no headers at all, and a row for it would be eighteen empty columns claiming a device reported nothing.
- **`upstreamReason` lives here**, not on the request row. An upstream failure only ever happens on a device poll.
- **The request schema was cut back to its original 20**, which is a deletion of slots with *no history behind them* rather than the reorder the append-only rule forbids: `blob21`+ were never successfully written, so nothing was reinterpreted. `clientIp` went with them, so it is now recorded on device rows only.
- The panels reading device facts — firmware, panel health, refresh echo, battery, Devices, upstream failures — all query this dataset. That is what stops the owner's own `curl` from rendering as a device.
- **`BLOB_FIELDS` is now deliberately wider than what `query.js` reads.** `imageCached`, `updateSource`, `wakeTime`, `batteryCapacity` and all ten doubles lost their reader in the move; `route` and `httpProtocol` never had one. They keep their slots and keep being written, because a write that stops announces nothing — a later query would silently span a boundary where the column just goes blank. `model` and `firmwareVersion` are still read here, by the enrollment breakdown, since `/api/setup` is a request and sends both.
- **`identity.networks` still reads the requests dataset, filtered to authenticated**, and that is the one device-shaped panel that deliberately did not move. The leaked-token alarm has to catch an authenticated caller *without* device headers, which is exactly what a stolen URL looks like. A consequence: on an unpaired sign that row can name a network from the owner's own `curl` while the row above it says no device has polled. Odd-looking and correct.

#### "No device has polled" is a state, not an empty panel

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


## Notes on this environment

`npm install` may need its cache redirected on sandboxed setups: `export npm_config_cache="$PWD/.npm-cache"`.

`wrangler dev` may need `XDG_CONFIG_HOME` and `WRANGLER_LOG_PATH` redirected too; that leaves a disposable `.wrangler-home/` in the repo.
