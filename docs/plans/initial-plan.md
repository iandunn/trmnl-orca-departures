# Archive — the original planning handoff

**This is a record of how the project was planned, not a description of what it is.** It began as a context handoff from a claude.ai planning conversation and was amended through 2026-07-31 and 2026-08-01 as research contradicted it. It stopped being maintained on 2026-08-02.

**For current state read [`../../CLAUDE.md`](../../CLAUDE.md)**, plus `src/render/CLAUDE.md` for the board design and `src/stats/CLAUDE.md` for the Analytics Engine schema. Where this file disagrees with those, those win. Do not re-derive a decision from anything below.

**Why it is kept.** Two bodies of work exist nowhere else and would be expensive to reproduce:

- **The firmware research** — four passes against `[env:TRMNL_X]` at commit `9f3a1eb` and FastEPD at its pinned `855ce9a4`, covering image format, failure behaviour, the HTTP contract and cache gate, and refresh semantics. `CLAUDE.md` carries the conclusions that constrain our code; these sections carry the file-and-line citations behind them, the OG-scoped pass they corrected, and the eight documented beliefs that turned out wrong.
- **The `blueset/trmnl-recipes` prior-art analysis** — the only other Puget Sound OneBusAway board for TRMNL, read in full.

A third part is worth reading rather than skipping: the render-cost sections record a wrong conclusion drawn from correctly measured numbers. Hosting was declared impossible on Workers Free against a 10 ms budget that was never verified and is really ~1000 ms.

Everything else is a snapshot. Roughly half of these decisions were reversed, and the reversals are left in place with their reasoning rather than tidied away, because why something was rejected is the part a rewrite destroys. Read any sentence here as "believed on the date in its heading", never as "true now". Struck text marks a belief its own section later overturned.

-------------------------------

## Goal

Build a wall-mounted e-paper display that shows live King County Metro departures for one stop, styled to match Metro's real Connectpoint stop signs. Hanging in a brightly lit entryway — ambient light is not a design constraint.

**Corrected 2026-08-01: the sign lives in the author's own home.** Earlier revisions of this doc described it as a gift going to someone else's house, and that premise is load-bearing in several rejected options — most importantly the Raspberry Pi, which was rejected *only* because it would have put the server on a different network from the sign. That objection is void. Anyone else wanting one forks the repo and stands up their own backend, so "portable to another person's stop" is a repo property, not a runtime one.

## Hardware — SUPERSEDED (was: TRMNL OG; the X was chosen instead, see Addendum 01)

Ordered: TRMNL OG ($139) + Clarity Kit ($25) = $164. No BYOD license needed.

- Clarity Kit = 2500mAh battery upgrade + Developer edition + charging cable + cloth. Cheaper than buying the battery ($10) and dev edition ($20) separately. Must be added to the device order; cannot be purchased separately.
- Display: 7.5" ePaper, **800 × 480**, 128 PPI, 4 grayscale levels, ~2s refresh. Active area is exactly 6.25" × 3.75". Enclosure 171 × 116 × 10 mm.
- 800x480 is 5:3, which matches the real Connectpoint units. (The 10.3" TRMNL X is 4:3 — wrong aspect, and its FCC/CE/RoHS were listed as pending. Rejected.)
- MCU: ESP32-C3, 400 KB RAM, 4 MB flash. Constrains image size/format.
- Mounting: molded hook recess on the back. No fabrication needed.
- Sleep draw < 0.5 mW (~135 µA), so battery cost is essentially all per-refresh.

## Architecture — decided, BYOS on a Cloudflare Worker

BYOS = Bring Your Own Server (their hardware, our backend). Free — no license. Distinct from BYOD = Bring Your Own Device (our hardware, their cloud, $50).

**Cloudflare Worker, not a Raspberry Pi and not GitHub Pages.**

- GitHub Pages is static and can't call OneBusAway at request time. Actions cron bottoms out at 5 min and is unreliable. Rejected.
- ~~A Pi in the home network rack works technically but puts the server on the wrong network.~~ **This rejection is void as of 2026-08-01** — the sign and the rack are the same network, because the sign lives here. A Pi is now a legitimate option with no CPU ceiling at all. Its real costs are different ones: a box to maintain, and a sign that goes down when the home network or power does.
- Worker: free tier trivially covers ~1440 polls/day, provides HTTPS (device does TLS 1.2), and has no host to maintain.

Every rejected option here — Pages, a Pi, a hosted plugin, and running Terminus — is written up properly in [`../alternatives.md`](../alternatives.md). That doc is current; this one is a record.

### Project scaffolding

This began as a full proposal — `wrangler.toml`, `package.json`, dev dependencies, `.nvmrc`, the secrets procedure, where to persist `/api/log` — and every part of it has since been built and superseded by the committed files. The listings are deleted rather than kept, because a stale copy of a config file is exactly the thing that gets read as authoritative. `CLAUDE.md` carries what is still load-bearing: the two `[[rules]]` corrections, the secrets-before-first-deploy ordering, and why there is no repo `.gitignore`.

Three things from it are worth having as history rather than as instruction:

- **The `wrangler.toml` originally specified here was wrong in two ways, and both failed silently.** It declared a wasm glob as `type = "Data"`, which overrides wrangler's built-in `CompiledWasm` rule and makes `initWasm()` throw `CompileError: Wasm code generation disallowed by embedder` under workerd. And it globbed `**/*.woff`, a format resvg cannot read at all. The second is the more instructive of the two: the original spike verified that the font path *resolved* rather than that text *rendered*, so it confirmed nothing — `@fontsource/inter` really does ship 126 `.woff` files, and resvg really does drop every one of them without an error. Existence was the wrong test. See "Re-measured properly" below.
- **`src/worker.js` shipped as a deliberate 404 stub**, not a placeholder to be filled in one endpoint at a time. A half-built `/api/display` is more dangerous than none: a response missing `refresh_rate` parses as 0 and hot-loops the device until the battery is flat, and a body of `{"status": 500}` factory-resets it. That reasoning survives in `CLAUDE.md` as the rule that the four endpoints change together.
- **Analytics Engine was chosen over KV for `/api/log` at planning time**, because KV's Free write quota is a real constraint for anything written on every device wake and Analytics Engine's is not, nor does it compete with KV's. That call held; `src/stats/CLAUDE.md` documents the schema it grew into.

### Rendering pipeline

Device wants a bitmap, not HTML. Workers can't run headless Chrome on the free tier.

1. Build the SVG **directly in the Worker** — the layout is rects and text, so satori is unnecessary indirection.
2. `resvg-wasm` → PNG.
3. Quantize to 2-bit (4 greys) with 1-bit as the fallback — see below.
4. Bundle a subsetted font (digits + latin). Workers have no system fonts.

#### Spike results, 2026-07-31 — measured, not estimated

**Every millisecond figure in this section and the next one is void**, for two separate reasons established later the same week: the spike rendered no text at all, and the 10 ms budget it was measured against is not the real limit. They are kept because the shape of both errors is the useful part. "Re-measured properly" and "RESOLVED" below are the numbers that held.

Built a throwaway Worker rendering a realistic approximation of the layout (header bar, three rows, badges, rules, footer) with Inter regular + bold bundled as `[[rules]] type = "Data"` wasm/font modules.

- **It works.** `initWasm(resvgWasm)` with a statically imported `.wasm` module runs under workerd, and `new Resvg(svg, { font: { fontBuffers } }).render().asPng()` produced a correct 800x480 PNG (4.5 KB for this layout — nowhere near a RAM problem).
- **Bundle: 2439 KiB raw, 932 KiB gzipped.** Fits both the 3 MB Free and 10 MB Paid script limits, so size is not a constraint. Good.
- **Render cost: ~6 ms per render** on an M-series Mac (20 renders in 122 ms wall, minus ~2 ms request overhead). Cold start, including wasm instantiation, was ~45 ms.

**The binding constraint is CPU time, not bundle size or request count.** Workers Free allows **10 ms CPU per invocation**; Paid allows 30 s (up to 5 min). 6 ms measured on fast local hardware, against a 10 ms edge budget on slower cores, is not a margin worth shipping a gift on — and the ~45 ms cold start would blow it outright. `image_url` is fetched in a separate request from `/api/display`, so the render gets its own budget, but that only buys one 10 ms window, not more headroom.

Also worth noting: Free allows 50 subrequests per invocation, which is ample here.

#### Re-measured for the X — 2026-07-31. Believed at the time to be the project's hardest constraint

The account is on **Workers Free**, and Addendum 01 switches the hardware to the X. Those two facts collide. Re-measured with the same spike, scaling output via resvg's `fitTo`:

| Target | Output pixels | Per render |
| --- | --- | --- |
| OG 800x480, 3 rows | 0.39 M | ~6 ms |
| X 1872x1135, 3 rows | 2.12 M | ~31 ms |
| X 1872x1872, 6 rows | 3.50 M | ~53 ms |

Cost tracks pixel count almost linearly (~14.6 ns/px), so the X's true 1872x1404 with six rows lands at **~40-45 ms**. Against a **10 ms** Free budget.

**Cron Triggers do not escape this.** Free allows 10 ms CPU per Cron Trigger too — the higher 30 s ceiling is Paid-only. So "render on a schedule into KV and serve bytes" does not rescue the free tier. Free does allow 5 cron triggers and a 1-minute minimum interval, which stays useful for other reasons.

**Two caveats on these numbers — neither has been measured, so don't over-trust the table.**

- **~40 ms is a floor, not the real figure.** The spike measures SVG → RGBA raster → PNG encode. The real pipeline adds a **quantization pass** to 1-bit/2-bit, which at 2.6 M pixels is another full sweep. Add it to the spike before it drives a decision.
- **The ~45 ms "cold start" may not count against the request budget at all.** Workers has a **separate 400 ms startup CPU budget**, and a statically imported `.wasm` is compiled at script startup rather than per request. That 45 ms conflates module compile with `initWasm()`. If the compile lands on the startup budget, per-request cost after warm-up is much closer to the 6 ms figure — which would mean **the OG fits Free comfortably** and even the X becomes arguable.

Resolving that second point is the cheapest possible way to discriminate between all the options below: deploy the spike to the real free account under a throwaway name, hit it, and read actual CPU from `wrangler tail` (which surfaces `exceededCpu` directly), then delete it. Until that is done, everything in this section is inference.

#### Rejected: GitHub / GitLab Pages — moved to `docs/alternatives.md`

Asked and answered 2026-07-31; the full reasoning now lives in [`../alternatives.md`](../alternatives.md#github-or-gitlab-pages). In short, a `404.html` handler solves routing but not per-request content, and a content-hash `filename` that never moves freezes the panel permanently.

#### Re-measured properly — 2026-08-01. The ~40 ms figure was wrong twice over

The spike was rebuilt from scratch and this time the output was **inspected as an image**, which is what caught both errors. Everything in the two sections above that quotes a per-render millisecond figure is superseded by this table.

Two bugs in the original spike, each of which silently inflated or invalidated the number:

1. **The font never loaded.** `@fontsource/inter` ships only `.woff` and `.woff2`, and resvg cannot decompress a WOFF container — it drops the font with no error and renders the layout with **no text at all**. The original spike's "correct 800x480 PNG (4.5 KB)" was almost certainly a textless render; 4.5 KB is about right for one. Glyph rasterization is not a rounding error, it is over half the raster cost, so every earlier number was measured on the cheap half of the work.
2. **`asPng()` was the measurement.** resvg's own PNG encoder writes RGBA at full resolution, which is both the wrong format for the panel and the single most expensive thing in the pipeline. It was never needed.

A third bug blocked the spike from running at all until it was fixed, and it was latent in the committed `wrangler.toml`: declaring `**/*.wasm` as `type = "Data"` overrides wrangler's built-in `CompiledWasm` rule, so `initWasm()` receives raw bytes and calls `WebAssembly.instantiate(buffer)` — which workerd forbids outright (`CompileError: Wasm code generation disallowed by embedder`). The `wasm` glob is now removed. The doc previously recorded this as an unresolved "both probably work"; it is resolved, and only the pre-compiled form works.

Measured on an M-series Mac under `wrangler dev`, six-row layout at native 1872x1404 with Inter regular and bold as real TTFs, timed externally over 40 iterations with the single-iteration cost subtracted as request overhead:

| Stage | Cumulative | Marginal |
| --- | --- | --- |
| Build the SVG string | ~0 ms | — |
| + resvg rasterize to RGBA | 12.5 ms | 12.5 ms |
| + quantize to 4-bit greyscale scanlines | 14.25 ms | 1.75 ms |
| + deflate and assemble the PNG | **19 ms** | 4.75 ms |
| `asPng()` instead of the last two rows | 57.5 ms | — |

For scale, the same pipeline with the font silently dropped measures 6 ms raster / 9.75 ms total — that is the shape of the error, and it is why the old table looked survivable at the OG size.

**Output: a 1872x1404 4-bit greyscale non-interlaced PNG, ~42 KB**, verified with `file` and by eye. That is PNG colour type 0 depth 4, exactly the X's native framebuffer format, at 5.6% of the 750000-byte cap.

~~**Verdict: Workers Free is out.**~~ **WRONG — see "RESOLVED" below.** This verdict was reasoning correctly from a stale premise: the 10 ms Free budget recorded throughout this doc is not the real limit. The spike was deployed after all, and Free allows ~1000 ms. The lesson is narrow and worth keeping: *the local measurement was fine, the published platform limit was the thing that needed verifying.* I asserted a deploy was unnecessary because 19 ms vs 10 ms looked like a 2x miss — but a 2x miss against an unverified number is not a margin either.

**Can Free be rescued by rendering worse? Measured, and no.** resvg exposes `shapeRendering: 0` and `textRendering: 0` (both "optimizeSpeed", i.e. antialiasing off), which at 227 PPI would plausibly be invisible. It buys 4 ms of raster and 3.25 ms overall:

| | Antialiased | optimizeSpeed |
| --- | --- | --- |
| Rasterize | 11.5 ms | 7.5 ms |
| Full pipeline | 18.75 ms | **15.5 ms** |

15.5 ms is still over 10 ms with nothing left to give, and it spends the panel's best feature to get there. Not a rescue.

**The remaining Free-tier routes, and why each is worse than $5/mo:** rendering at half resolution and upscaling in the quantize pass lands near ~10 ms but throws away the 227 PPI the X was chosen for; splitting the render into bands across self-`fetch()` subrequests (each gets its own budget) works on paper and is fragile in a gift; a hand-rolled glyph-atlas blitter is plausibly ~8 ms — the quantize pass proves a full-frame integer loop is only 1.75 ms — but costs hand-written text layout, a build-time atlas, and the highest chance of looking subtly wrong on a wall.

**Pages plus a scheduler is dead on CI minutes alone**, separately from the staleness argument recorded above. A 5-minute cadence is 8640 runs/month; GitHub Actions gives 2000 free minutes on a private repo and GitLab 400, so neither is within an order of magnitude. Making the repo public to get unlimited minutes publishes the stop, which is the address.

Worth keeping for whoever revisits this: the hand-written 4-bit encoder is ~3x cheaper than `asPng()` and is production code, not spike code. `CompressionStream('deflate')` emits an RFC1950 zlib stream, which is precisely what a PNG `IDAT` wants, so the whole encoder is a CRC32 table, a one-pass quantize-and-filter loop, and three chunks. The quantize pass the old doc feared would blow the budget costs **1.75 ms**.

### RESOLVED — 2026-08-01. Workers Free fits, with ~17x headroom. The whole hosting problem was based on a stale number

**Everything above about CPU being "the project's hardest constraint" is void.** The blocker was the claim that Workers Free allows 10 ms CPU per invocation. That figure is stale. Measured by deploying a throwaway spike (`orca-cpu-spike`) to the real account, reading `cpuTime` from `wrangler tail`, and deleting it:

| Renders in one invocation | Outcome | Billed CPU |
| --- | --- | --- |
| 1 (cold, includes wasm init) | ok | 71 ms |
| 1 (warm) | ok | 57 ms |
| 2 | ok | 111 ms |
| 8 | ok | 445 ms |
| 16 | ok | 933 ms |
| 17 | ok | 786 ms |
| 18 | **exceededCpu** | killed |
| 20, 22, 24 | **exceededCpu** | killed |

**The real Free ceiling is ~1000 ms per invocation. One full render costs ~58 ms. That is about 17x headroom, on the free plan, for the render we actually want.**

Two things worth carrying forward:

- **Edge cores are ~3x slower than an M-series Mac** — 58 ms edge against 19 ms local for the identical pipeline. Apply that multiplier to any future local benchmark.
- **Cold start is cheap and lands in-budget.** The first invocation billed 71 ms against a warm 57 ms, so wasm instantiation costs ~14 ms, not the ~45 ms the earlier session inferred. The "does module compile hit the 400 ms startup budget or the request budget" question is answered in the only way that matters: either way it fits.

**Consequences.** Every option below is withdrawn — Workers Paid, Vercel, Deno Deploy, DreamHost, a Raspberry Pi, band-splitting across subrequests, a hand-rolled glyph blitter, the hosted-plugin path, and dropping back to the OG. None of them were solving a real problem. The design stays exactly as written: one Worker, Free plan, resvg, real font rendering, antialiasing on, native 1872x1404. **Antialiasing stays on** — the `optimizeSpeed` experiment was only ever a budget concession and there is no budget to concede to.

The six hosting options this section used to enumerate — Workers Paid, rendering off Cloudflare, a hand-rolled glyph blitter, dropping back to the OG, band-splitting across subrequests, and abandoning BYOS for a hosted plugin — are recorded in [`../alternatives.md`](../alternatives.md#withdrawn-when-the-cpu-number-turned-out-to-be-stale) rather than here, since none of them is live.

### BYOS endpoints — VERIFIED 2026-07-31

Contract confirmed against `usetrmnl/terminus` `doc/api.adoc` (the reference BYOS server). `docs.trmnl.com/go/diy/byos` names the three endpoints but documents none of the fields.

- `GET /api/setup` — first contact. Device sends `ID` (MAC). Returns `{ api_key, image_url, message, status }`.
- `GET /api/display` — the workhorse. Device sends `ID` plus telemetry headers: `FW_VERSION`, `MODEL`, `WIDTH`, `HEIGHT`, `RSSI`, `BATTERY_VOLTAGE`, `PERCENT_CHARGED`, `IMAGE_CACHED`, `WAKE_TIME`, `REFRESH_RATE`, `USB_CONNECTED`, and more. Response: `image_url`, `filename`, `refresh_rate`, `image_url_timeout`, `maximum_compatibility`, `special_function`, `reset_firmware`, `update_firmware`, `firmware_url`, `firmware_version`, `temperature_profile`.
- `POST /api/log` — body `{ logs: [...] }` with per-entry `message`, `level`, `battery_voltage`, `free_heap_size`, `wake_reason`, `sleep_duration`, etc. Respond `204`.

#### Auth — CORRECTED. It is token-based, and the reference doc is wrong

`doc/api.adoc` says `ID` (MAC) is the recommended auth header. That is **wrong** at the current commit. `/api/setup` issues an `api_key`; the device sends it back on every `/api/display` call, and Terminus authenticates on that key alone — `app/aspects/devices/synchronizer.rb` looks up by `model.api_key`, no MAC fallback, 404 on a miss. Verified directly against the file, not just the agent's report.

So: authenticate on the issued token, and additionally reject any MAC that isn't the one known device. Nothing else prevents a stray crawler from burning the OBA quota.

#### `filename` is a cache key — the landmine

The device caches by the `filename` field and skips the image download when it hasn't changed. **`filename` must change iff the image bytes change.** Terminus derives it from a content hash (`<name>-<md5>.png`, `app/structs/screen.rb` — verified). Consequences:

- Constant `filename` → permanently frozen panel serving perfectly fresh JSON. Terminus uses precisely this on purpose for its error screen.
- Filename that changes every poll → needless download plus a visible 2s flash every time.
- A content hash gets both right for free: an unchanged render yields an identical name and correctly skips the refresh. This is a flicker-avoidance mechanism, not just a bandwidth one.
- `image_url` and `filename` are independent. Neither derives from the other.

Two mechanics that constrain how the name is built:

- **The cache gate is a filesystem existence check, not a string compare** — and BMPs are always written to the fixed path `/current.bmp`, so **the cache can never fire for a BMP.** A stable BMP filename re-downloads and repaints every single cycle. The zero-flicker no-op is **PNG-only.** This is the strongest argument for choosing PNG over BMP3.
- **Names over 31 chars get their middle discarded** (`filesystem_fix_filename`: first 7 chars + last 17). Uniqueness must live in the first 7 or last 17 characters, or two distinct renders can collide into one cache entry.

Optional: the firmware's own GC expects a trailing 10-digit epoch (`name-abc123-1771674964`) to age files out at 24h. Skipping it only means stale SPIFFS files get purged on the next download instead. Not a correctness issue.

#### Provisioning — captive portal only

The `server` URL is set through the WiFi captive portal, POSTed as JSON to `/connect`. No dashboard route exists, and no build flag works (`include/config.h`'s `API_BASE_URL` is an unguarded `#define`, so `-D` loses to it). **The URL is persisted only if the WiFi credentials also succeed** — a wrong WiFi password silently discards the server URL, which will read as "the sign ignored my server."

**Clarity Kit note:** the Developer Edition it bundles is *not required* for BYOS — `docs.trmnl.com/go/diy/` states plainly that buying their device and pointing it at your own server is free for all customers. Dev Edition is a hosted-platform feature flag (private plugins, API keys, debug logs), irrelevant to this project. The Kit is still worth it for the 2500mAh battery; just don't believe the dev edition is load-bearing.

#### Image format — RESOLVED: PNG, not BMP3

Formats accepted: 1-bit BMP3, PNG (1/2/4/8-bit), and undocumented JPEG. Version thresholds: 1-bit PNG landed in **v1.5.2**, 2-bit/4-grey PNG in **v1.6.0**; current firmware is far past both, so version is not the risk. (The "requires 1.7.6" line in Terminus refers to the four-colour B/W/R/Y OG variant, a different panel with its own build env — not the mono OG.)

**Choose PNG.** It is smaller, it is what Terminus defaults to, it is the only format that gets the flicker-free no-op above, and BMP3's validation is brutally strict — exact 800x480, `biSizeImage` literally 48000 (many writers emit 0), bottom-up rows only, palette at exactly byte 54, and the palette's 8 bytes must match one of two exact patterns. Keep BMP3 for debugging only.

Start at 1-bit to prove the pipeline, then move to 2-bit for the grey "Scheduled" label.

#### Firmware landmines — every one of these is a silent failure

Ranked by how much time each would cost to diagnose:

1. **`Content-Type` must be exactly `image/png`.** The firmware picks the PNG-vs-BMP branch by string-comparing that header, *not* by magic bytes. Serve a perfect PNG as `application/octet-stream` and it takes the BMP path, fails `parseBMPHeader`, and **displays nothing with no error returned.** No charset parameter, no `image/PNG`.
2. **`refresh_rate` is required on every single response.** Absent → parsed as `0` → written to NVS → the device sleeps for 0 µs and hot-loops, **flattening the battery**, and it stays wedged across later cycles because the 0 persisted.
3. **PNG decode errors are swallowed.** A `png_res = PNG_NO_ERR; // DEBUG` line makes the rejection path unreachable, so a PNG that fails to decode still reports success *and gets cached*. A blank or stale panel is the only signal you will ever get.
4. **Never redirect.** 301 is "successfully" parsed as a body, 302 is a hard failure, 307/308 get one manual hop but drop the `Access-Token` on the image request. Serve 200 directly. Any signed-URL scheme that 302s to S3 will not work.
5. **Image auth headers attach only when `image_url` shares the API host prefix** (raw `strncmp`). Images on a separate CDN get no `ID` and no `Access-Token` — they must be publicly fetchable.
6. **Size cap: 90000 bytes on OG** (X-class gets 750000 via PSRAM). Over it, the device shows a "too big" screen.
7. **Don't gzip images** — it sends `Accept-Encoding: identity`.
8. **Avoid returning status 202**; it triggers a 5-second fast-poll loop (50 wakes).
9. `filename: "empty_state"` is a magic string that draws the setup logo. Don't emit it by accident.
10. **TLS is `setInsecure()`** — no cert verification, and plain `http://` works. Self-signed is fine. Not a constraint to design around.

Useful, not a landmine: **changing the base URL wipes the stored `api_key` and `friendly_id`**, which is exactly how you force a clean re-pair against a new server. And the `Image-Cached` header reports the *previous* wake's outcome, so don't trust it as current state.

Exact header names on the wire (they are not the SCREAMING_CASE the reference doc implies): `Access-Token`, `Image-Cached`, `Refresh-Rate`, `FW-Version`, `Battery-Voltage`, `Wake-Time`, `Width`, `Height`, `Model`, `RSSI`, `Update-Source`, and the lone outlier `special_function`.

**Scope caveat:** all of the above was read against the OG build (`BOARD_TRMNL`), deliberately excluding the X code paths. If the X is the final hardware, the size cap, the PNG bit-depth handling, the 800x480 dimension checks, and the refresh-mode logic all need re-verifying against `BOARD_X_CLASS`.

### X-class firmware — VERIFIED 2026-07-31

Read against `[env:TRMNL_X]` in `usetrmnl/trmnl-firmware`. This is a single unified repo — `[env:trmnl]` (OG) and `[env:TRMNL_X]` build the same `src/bl.cpp`, with behavior split by `#ifdef`. So some OG findings above are shared code and some are not; these are the X answers.

**PNG is mandatory. BMP is not merely discouraged on the X — it is broken.** The OG's hard check (`width != 800 || height != 480 || bpp != 1`) lives in an unguarded file, so it compiles for the X and rejects any 10.3"-sized BMP outright. And even if one passed, `BB_EPAPER` is undefined on X, so the code that loads a bitmap into the framebuffer is compiled out entirely. There is no BMP fallback and no debugging-with-BMP option.

**PNG has no dimension check on the X.** The literals `1872` and `1404` appear nowhere in the firmware; geometry is read at runtime from the FastEPD driver. Oversized images are cropped with only a log line, and a width/height swap is treated as a rotation. Nothing rejects a wrong size — which cuts both ways: forgiving, but a layout bug will render silently rather than erroring. (JPEG, by contrast, *does* demand exactly 1872x1404.)

**Use 4-bit greyscale, non-indexed** — PNG colour type 0, bit depth 4. That is the X's native framebuffer format: 16 greys, direct path, no conversion. This is good news for the design; Addendum 01's "render 4-bit, not 1-bit" is correct and natively supported.

Two format hazards worth stating plainly:

- **A 1-bit *indexed* PNG will very likely render all-black.** `ReduceBpp` has cases for 24/32/8/4/2 bpp and none for 1, so the grey value keeps its `0` initialiser for every pixel. The OG firmware special-cases exactly this; the X does not. Use greyscale, never a palette, at low bit depths.
- **RGBA at full width overflows the decoder's line buffer.** `PNG_MAX_BUFFERED_PIXELS` is 14984 on X, but the check tests one line while the code lays out two — at 1872px, RGBA8 needs ~15007 bytes, overflowing by ~24. RGB8 (~11263) is safe. Since we should be emitting 4-bit greyscale anyway, this is a trap to avoid rather than a problem to solve.

Size cap on X is **750000 bytes** (vs 90000 on OG), so payload size is a non-issue.

**Two download paths, different rules.** On 5 GHz the X uses a separate modem path that does no `Content-Type` inspection (magic bytes only), sends no `Accept-Encoding`, and follows no redirects. On 2.4 GHz it uses the standard WiFi path with all the OG traps intact. Satisfy the stricter path and both work.

Redirect handling, corrected: only **307/308** are followed (one hop). **301** is not followed — it is accepted as success and then fails as "No data received". **302** is handled nowhere.

`Model` is the literal string **`x`**. The X sends six extra headers — `Battery-Count`, `Percent-Charged`, `Battery-Health`, `Battery-Current`, `Battery-Temp`, `Battery-Capacity` — all reporting `-1` if the fuel gauge didn't initialise. `Width`/`Height` come from the driver at runtime, so trust the reported values over any assumption.

#### This undercuts Addendum 01's flicker argument — RESOLVED, and it was worse than flagged

Addendum 01 justifies the X substantially on 200ms partial refreshes making a 1-minute cadence invisible. But `load_prev_image()` is a **permanent no-op** — its body is guarded by a `content_size` that is initialised to 0 and never written, so the call does nothing. Its caller *is* live on the X. The consequence is that FastEPD never receives a previous-image buffer on the cached-image path, so the non-flickering partial-update mode cannot engage there.

This does not necessarily mean every refresh is a full flash — the partial path may still work for freshly downloaded images. But the specific mechanism Addendum 01 leans on is not obviously functional, and **this was never verified**. It belongs with the Priority 1 failure questions in the next research pass.

**Answered 2026-07-31 by the refresh pass below: every refresh IS a full flash.** The partial path is commented out, not merely unfed, so the hedge in the paragraph above was too generous. See "X-class refresh semantics" further down.

Consolation: the `filename` cache no-op still skips the panel entirely, so unchanged content costs nothing regardless of refresh mode. The flicker risk is confined to renders that actually change.

### X-class failure behavior — VERIFIED 2026-07-31, and it changes the error design

Read against `[env:TRMNL_X]` (`platformio.ini:461`, flags `-D BOARD_TRMNL_X` / `-D BOARD_X_CLASS`) at firmware `1.8.10`, commit `9f3a1eb`. This closes the Priority 1 question. Two derived guards explain most X-vs-OG divergence: `BB_EPAPER` is defined only when `!BOARD_X_CLASS` (`src/display.cpp:18-19`), and `__BB_EPAPER__` is never defined on X, so every `#ifdef __BB_EPAPER__ … #else` pair in `display.cpp` takes the X branch.

`MAX_IMAGE_SIZE = 750000` on X is now confirmed at `include/config.h:49-50`, not merely claimed.

#### The new landmine: the server can factory-reset the device by accident

**A `200` response whose JSON body contains `{"status": 500}` wipes the device.** It maps to `HTTPS_RESET` (`src/bl.cpp:2274-2279`) → `resetDeviceCredentials()` (`bl.cpp:2710-2723`), which calls `WifiCaptivePortal.resetSettings()` and `preferences.clear()` and then `ESP.restart()`. WiFi credentials, `api_key`, `friendly_id`, cached filename — all gone, and the sign comes back up in the captive portal waiting to be re-provisioned. `reset_firmware: true` does the identical thing (`bl.cpp:2253-2261`).

This is worth restating because the trap is so natural: `status` in the **body** is not the HTTP status line, and the obvious way to signal "something went wrong" in a JSON error response is to echo a 500 into it. Doing that on this device un-provisions a gift hanging on someone else's wall, where the recovery is a captive-portal re-pair. **Our error responses must always carry `status: 0` (or omit it) and must never set `reset_firmware`.** Consider asserting this in a test.

#### What the panel actually does when things fail

The retry ladder is the part that matters, and it is not what the original doc assumed. On a failed `/api/display`, the first three consecutive failures call `display_sleep(); goToSleep();` (`bl.cpp:1418-1443`) — and `goToSleep()` ends in `esp_deep_sleep_start()` and never returns, so **the error-screen switch at `bl.cpp:1485` is unreachable for failures 1, 2 and 3.** The last good render simply stays on the glass. Backoff is **15 s / 30 s / 60 s** (`lib/trmnl/src/refresh_interval.cpp:27-45`). Only the 4th consecutive failure draws `WIFI_INTERNAL_ERROR`, then settles into 900 s polls that repaint that same error screen every cycle. Worst case is roughly **7 minutes** from first failure to a visible error, most of it spent in 15 s connect/read timeouts.

| Failure | What the panel shows | Notes |
| --- | --- | --- |
| Server unreachable / HTTP 500 status line | Last image for 3 cycles, then `WIFI_INTERNAL_ERROR` | 5 in-boot retries 2 s apart, then the cross-boot ladder |
| **Malformed / non-JSON body** | **Nothing, ever** | `HTTPS_JSON_PARSING_ERR` has no `case` in the error switch — silently polls at 900 s forever showing stale departures |
| Wrong `Content-Type` | **Nothing, ever** | Total silent no-op, and it *resets* the retry counter. Confirms the existing warning, now with a citation |
| Out of memory | **Nothing, ever** | No `case` in the switch |
| Image 404 / non-200 | 3 silent cycles, then `API_REQUEST_FAILED` | Or `WIFI_WEAK` if RSSI ≤ -100 |
| Image stalls or truncates | 3 silent cycles, then `WIFI_IMAGE_TIMEOUT` | 15 s inactivity timeout |
| Image over 750 KB | `MSG_TOO_BIG` **immediately** | The one failure that draws on the first occurrence |
| PNG decode failure | Whatever partial garbage decoded | Swallowed by the `png_res = PNG_NO_ERR; // DEBUG` line at `bl.cpp:2004` |

**WiFi failure behaves completely differently, and worse.** It draws `WIFI_FAILED` on the *first* failure, not the fourth (`bl.cpp:1273`), backing off 60 / 180 / 300 s. On the **4th** consecutive WiFi failure it draws `WIFI_RETRY_LIMIT` and calls `goToSleepButtonOnly()` (`bl.cpp:3091-3096`) — **no timer wakeup is armed at all.** The sign is then dead until someone physically touches it. For a gift on a wall this is the single worst outcome in the system, and nothing server-side can prevent or detect it. It is an argument for making sure the WiFi credentials are solid at install time, and for telling the user that the touch bar wakes it.

**A power cycle while the server is unreachable wipes the departures off the glass.** Any non-timer wake paints the logo before making a single network call (`bl.cpp:1043-1051`, `#ifdef BOARD_TRMNL_X`), and on X `storedLogoOrDefault()` always returns `logo_medium` regardless of the requested type. So the failure mode is not "stale board" but "blank logo screen."

#### Staleness tracking: there is none, confirmed

No record of the last *successful* fetch exists anywhere. `time_since_sleep` is written on every sleep regardless of outcome and is only ever logged (`bl.cpp:1346-1357`, `:3112`). Nothing compares an age against a threshold, and nothing marks the display as old. **The rendered "as of h:mm" stamp is not merely the best defense against staleness — it is the only one.** That decision is now load-bearing rather than belt-and-braces.

Likewise, **there is no low-battery screen or behavior of any kind** on X. Battery voltage and the BQ27427 gas gauge feed request headers, the log payload, and the battery icon on the loading screen. No threshold, no warning, no sleep extension. A dying sign just stops.

#### Server-controllable behavior, corrected

- **`temperature_profile` is the one live flicker lever on X.** `"a"` → 1, `"b"` → 2, anything else → 0 (`parse_response_api_display.cpp:34-39`). At `display.cpp:1845` a value `> 0` selects `CLEAR_SLOW` and 0 selects `CLEAR_FAST`. This is a genuine find — it is server-settable per response, and it is the only refresh-mode control we actually have.
- **`maximum_compatibility` does nothing on X.** The line that forces a full refresh is inside `#ifdef BB_EPAPER` (`display.cpp:1794`), so it is OG-only. It is parsed and logged on X and otherwise ignored.
- **`special_function` is never acted on for X.** It is persisted to NVS, but the only read sits inside the OG double-click branch. There is no server-pushable display state.
- **`status: 202`** triggers fast-poll: 5 s sleeps for 50 wakes, then 60 s ×10, 900 s ×10, then 3600 s (`refresh_interval.cpp:69-74`). Avoid, as already documented.
- **HTTP 429 is treated as success** and its body is parsed (`api-client/display.cpp:116`).
- **`image_url_timeout`** is seconds → ms, clamped to 65535 ms, and exceeding it gets logged back to the server (`bl.cpp:1832-1849`).
- `filename: "empty_state"` returns `HTTPS_PLUGIN_NOT_ATTACHED` and triggers fast-poll (`bl.cpp:2190-2214`).

The `filename` cache gate is confirmed identical on X: `filesystem_fix_filename` prepends `/` and keeps first 7 + last 17 when over 31 chars (`src/filesystem.cpp:302-315`), compared against `RTC_DATA_ATTR` state (`src/displayed_image.cpp:9`), returning before any panel call (`bl.cpp:1719-1724`). `refresh_rate` is confirmed unclamped with no zero-check, and an absent field parses to 0 (`parse_response_api_display.cpp:53`).

**Net effect on our design.** The firmware's own error screens are slow (~7 min), only cover transport failures, and are absent entirely for three failure modes. Everything that matters — OBA being down, real-time data missing, a stale board — is invisible to the device. So the degraded-screen-with-a-distinct-filename plan is not one layer of two; it is essentially the whole defense, backed by the on-image timestamp for the cases where the server cannot speak at all.

### X-class HTTP contract and cache gate — VERIFIED 2026-07-31, with seven corrections

Read against `[env:TRMNL_X]` at commit `9f3a1eb`. This pass was aimed at confirming the OG-scoped beliefs recorded above, and it overturned several of them. Recording the corrections explicitly, because each was previously written here as settled.

**Where this doc was wrong:**

1. **"The gate is a filesystem existence check."** There are **two independent gates**. A LittleFS existence check gates the *download* (`bl.cpp:2235`) and survives a power cycle. An RTC `strcmp` gates the *repaint* (`bl.cpp:1719`) and does not. The power-cycle-repaint claim was right but attaches only to the second.
2. **"It is PNG-only."** It is **PNG or JPEG** (`bl.cpp:1989`). BMP is excluded because it writes to a fixed `/current.bmp` rather than the hashed name — the conclusion holds, the stated reason was wrong.
3. **"`empty_state` draws the setup logo."** It draws whatever `image_url` points at, once, gated on an NVS flag, and **also triggers the same 5 s × 50 fast-poll ladder as `status: 202`**. The doc treated those as unrelated hazards; they are one mechanism.
4. **"307/308 get one hop but drop the auth header."** True for the **image** request only. `/api/display` re-applies headers on the hop (`api-client/display.cpp:111`), and **`/api/setup` follows no redirects at all**, silently failing enrollment.
5. **"301 is parsed as a body."** On the image request it yields `HTTPS_WRONG_IMAGE_SIZE` ("No data received"); on the API request, `HTTPS_JSON_PARSING_ERR`. The API path also silently accepts **429** and parses its body.
6. **"Keep the entropy in the first 7 or last 17 characters."** Necessary but not sufficient — see the filename rules below.
7. **`MAX_IMAGE_SIZE = 750000`** is confirmed real for X (`include/config.h:48-52`), no longer "claimed but unverified".

**Two hazards that were not in this doc at all** are the stuck error screen and the 31-character filename; both are written up in `CLAUDE.md` because they constrain every response we send. In short: firmware-drawn error screens never update the RTC filename, so a recovered server returning its previous filename leaves the error screen on the glass forever — perturb the filename after any outage. And a filename of exactly 31 characters produces an unterminated, nondeterministic cache key.

#### The filename convention is stricter than a content hash

`filesystem_purge_old_file` (`filesystem.cpp:110-153`) runs before every image write and deletes any file whose last 10 characters are not a recent epoch — a non-numeric suffix extracts as timestamp `0`, which always reads as stale. **A trailing `.png` is enough to trigger this.** The consequence is that every download wipes the rest of the cache, so the download gate stops working and the device re-fetches images it held moments ago. It also collects `/logo.bmp`, `/logo.png` and `/current.bmp` as collateral.

Bytes 1-13 are the "same plugin" identity, compared with a 14-byte `strncmp`. So the working shape is `<7-char tag>-<6-char content hash>-<10-digit epoch>`, with distinct renders differing in the id field or the epoch. None of this has upstream test coverage, and HEAD is itself a filesystem refactor, so treat these numbers as liable to move.

#### Render geometry is not verifiable from source

**`Width: 1872` / `Height: 1404` is NOT confirmed.** Neither literal appears anywhere in the firmware. The values resolve at runtime through `bbep.width()` → `BB_PANEL_TRMNL_X` inside **FastEPD**, which is a pinned but unvendored build dependency, so the constant lives outside the tree. The only circumstantial support is `PNG_MAX_BUFFERED_PIXELS = 14984` for `[env:TRMNL_X]`, which is about 1872 × 8.

Practically: retail X applies no rotation and no `setPanelSize` override (unlike its Sensoria and Lilygo siblings), so whatever the panel reports is the true unrotated geometry. **Size the render from the `Width`/`Height` request headers rather than compiling 1872x1404 in**, and log them on first contact. Header ordering is safe — `display_init()` runs long before the first `/api/display`, so `Width: 0` cannot occur.

#### Telemetry available to us

25 headers on `/api/display`, in wire order: `ID` (colon-delimited MAC), `Content-Type`, `Update-Source`, `Access-Token`, `Refresh-Rate`, `Battery-Voltage`, `Battery-Charging`, `USB-Connected`, `Battery-Count`, `Percent-Charged`, `Battery-Health`, `Battery-Current`, `Battery-Temp`, `Battery-Capacity`, `FW-Version`, `FW-Commit`, `Model`, `Image-Cached`, `Wake-Time`, `RSSI`, `WiFi-Band`, `Temperature-Profile`, `Width`, `Height`, and `special_function` (the lone lowercase outlier, sent only when set).

`Update-Source` is the useful one for diagnosing the failure modes above — its vocabulary is `powercycle`, `timer`, `button`, `EXT0`, `EXT1`, `touchpad`, `uart`, `wifi`, `unknown`. Combined with the power-cycle repaint behavior, it lets the server distinguish "woke on schedule" from "someone unplugged it," which is exactly when the panel needs a forced repaint. `Wake-Time` is milliseconds awake on the **previous** cycle, same temporal quirk as `Image-Cached`.

`Model` is `"x"` — but **not uniquely**, since `BOARD_TRMNL_X_EPDIY` also reports `"x"`. The six `Battery-*` headers are the reliable retail-X discriminator, as are `Battery-Charging` and `USB-Connected`, which OG omits entirely.

Other endpoints send far less: `/api/setup` sends only `ID`, `Content-Type`, `FW-Version`, `Model` and **no `Access-Token`**; its image download sends no headers at all. `POST /api/log` sends `ID`, `Accept`, `Access-Token`, `Content-Type`, and accepts **200, 301 or 204** as success.

#### Odds and ends worth knowing

- **TLS session resumption never applies to us.** `ResumableWiFiClientSecure` is gated on the URL containing `https://trmnl.app`, so a BYOS host pays a full TLS handshake on every wake. That is awake time and therefore battery.
- **`Accept-Encoding: identity` is sent on the image request only**, and is lost on a 307/308 hop. `/api/display` sends whatever the Arduino core defaults to.
- A gzipped image body fails silently and is *cached as displayed*, so a retry with the same filename is suppressed. Do not gzip.
- `Content-Type` matching is byte-exact, case-sensitive Arduino `String` equality against `image/png` or `image/jpeg`. Any parameter suffix fails. BMP is never selected by `Content-Type` — only by a `BM` magic-byte check.
- Setting the captive portal's server field to empty removes the stored URL entirely and reverts to the TRMNL default.

**Still unverified after this pass:** the actual panel dimensions (above); whether `File::name()` returns a leading slash under LittleFS, which if wrong means the 14-byte purge never fires on X; whether the 24h age rule fires before NTP sync; and the Arduino `HTTPClient` defaults for `User-Agent` and `Host`.

### X-class refresh semantics — VERIFIED 2026-07-31. Addendum 01's flicker argument is dead

Read against `[env:TRMNL_X]` at `9f3a1eb`, plus **FastEPD at `855ce9a4`** — the exact SHA pinned by `platformio.ini:496`, not its HEAD. Reading the pinned dependency is what let this pass settle two things the source-only passes could not.

**The X full-refreshes every time.** The dashboard image path ends in a single `bbep.fullUpdate(iClearMode, false)` (`display.cpp:1847`). The partial path directly above it is **commented out** (`display.cpp:1836-1840`), and it is disabled twice over, because `load_prev_image()` — the helper that seeds the previous-frame buffer partial update requires — is gutted. Partial update survives on X only for the touchbar indicator overlay (`display.cpp:568`), which manually seeds its own buffer.

FastEPD's `partialUpdate` genuinely does pixel-level diffing, but the row range is caller-supplied and never auto-computed, and `fullUpdate` does not diff at all. Since nothing calls `partialUpdate` for server images, **no frame diffing happens on the BYOS path**. Even re-enabled it would not help us: partial requires 1bpp or 2bpp, and the X sets 4bpp for any non-1-bit PNG.

Every 8th render gets `CLEAR_SLOW` instead of `CLEAR_FAST` (`(iUpdateCount & 7) == 0`, `display.cpp:1844-1845`). The counter is `RTC_DATA_ATTR`, so a power cycle resets it and makes the next render a slow clear. It counts *all* renders including the logo screen, so a touch shifts the cadence. Measured in passes rather than time: `CLEAR_SLOW` is 32 row-passes, `CLEAR_FAST` is 16 — the header comments claiming 8 and 10 are stale relative to the implementation.

**This kills the flicker half of Addendum 01's case for the X.** That section justified the device substantially on 200ms partial refreshes making a 1-minute cadence invisible. There are no partial refreshes for our images. No wall-clock figure for a full update exists in either repo — the `SHOW_TIME` instrumentation is not even compiled — so the 1.2s/200ms marketing numbers are unverifiable from source.

What survives is the part that actually matters: **the `filename` cache no-op is confirmed at the brace level to skip the panel entirely while still honoring `refresh_rate`.** `applyServerRate()` runs at `bl.cpp:2251`, outside every cache branch, and the RTC-tier early return at `:1723` precedes `display_show_image` at `:1734`. So poll frequency stays decoupled from flicker — but that mechanism is now the *only* flicker defense we have, which makes the content-hash filename the most load-bearing detail in the design.

#### Correction to the section above: the panel really is 1872x1404

The previous pass could not confirm the dimensions because no literal appears in the firmware. Reading the pinned FastEPD revision resolves it: `BB_PANEL_TRMNL_X` is **1872 x 1404** (`FastEPD.inl:202`), and the firmware never calls `setRotation` (grep-verified), so orientation is fixed. The accelerometer that could have rotated it is dead code — the whole BMA530 init block is commented out.

So the render-cost table and the hosting decision are keyed to a real number after all. Reading `Width`/`Height` from the headers remains cheap insurance, since the constant lives in a third-party dependency, but it is no longer a correctness requirement. Note the firmware **crops rather than scales** an oversize image and auto-rotates based on the PNG's own dimensions, so a width/height swap silently rotates rather than failing.

#### The new landmine: `{"status": 200}` is silently discarded

The body-`status` dispatch handles exactly `0`, `202` and `500`. **Everything else hits `default: break;` and the entire response is thrown away** (`bl.cpp:2166`, `:2282`) — no image, no filename, no `refresh_rate`. Writing `{"status": 200}` because the HTTP response is a 200 is the natural mistake, and it produces a device that appears to be polling correctly and never updates.

`refresh_rate` is confirmed unclamped with no floor, and the absent-parses-as-0 hazard is real and asymmetric: six neighbouring fields in the parse table have `| ""` or `| false` coercion defaults and `refresh_rate` has none (`parse_response_api_display.cpp:53`). The microsecond multiply is explicitly cast to `uint64_t` (`bl.cpp:2773`), so large values like 28800 are safe — the overnight sleep plan holds.

#### Odds and ends

- **`special_function` is completely inert on retail X.** Its only read sits inside the OG double-click branch, which is compiled out. The `special_function` request header is therefore never sent either.
- **The touch bar is not a button.** Retail X has no physical button; `PIN_INTERRUPT` is the IQS323 touch RDY line. Left/right tap or swipe calls `show_cached_image_by_offset()`, which repaints from the local playlist cache with **zero HTTP**. Middle tap triggers a full `/api/display` cycle. Both corners held starts the WiFi reset flow. Wake sources are timer and EXT0 on that pin — nothing else.
- **On a 5 GHz AP the device uses a second, different HTTP implementation** running on the ESP32-C5 over ESP-AT, which synthesizes status codes and **ignores `image_url_timeout`**. On 2.4 GHz the modem is never touched. Whether ESP-AT follows redirects internally is unknown, which is one more reason to never redirect.
- `firmware_url` only ever updates the S3 app partition; the C5 is flashed from a local file.
- OTA is rate-limited 24h **on failure**, and an unsynced clock plus any prior attempt blocks it indefinitely.

## Refresh strategy — decided 2026-07-31, and later simplified

Server controls the sleep interval per response. That's where this logic lives.

**The three-tier schedule below was cut to two states when it was built.** There are no commute windows to describe — the sign polls at one rate the whole time it is on, and sleeps once until morning outside that — so `REFRESH_IDLE_SECONDS` was deleted rather than left unconsumed. `CLAUDE.md` has the shape that shipped, and `src/schedule.js` is the only thing that decides `refresh_rate`.

- 60s during the user's actual leave-the-house windows
- ~15 min outside them
- asleep 10pm–6am

Rationale: 60s everywhere costs ~2–3 weeks of battery on the 2500mAh cell and flashes the panel ~960×/day (2s each) in a room people walk through. Panel is rated around a million refreshes, so continuous 1-min is a few years of life rather than a decade. The windowed approach gets live data when it matters, weeks of battery, and near-zero flicker otherwise.

**RESOLVED — overnight sleep works, and flicker is solvable independently.**

`refresh_rate` has **no clamp of any kind** (`lib/trmnl/src/refresh_interval.cpp` is three lines: store and return). 28800 (8h) is honored exactly; the theoretical ceiling is `UINT32_MAX` seconds, and the µs multiply is correctly widened to `uint64_t`, so there is no overflow trap. Two caveats:

- The interval **persists in NVS**, so the waking request must carry a normal value or the device sleeps another 8 hours.
- The device wakes to *poll*, not on a wall clock, so drift accumulates. Compute "seconds until 6am" fresh on the last evening poll rather than assuming a fixed number.

There is no sentinel value and no server-pushable sleep function. `special_function: "sleep"` is **device-initiated** (a button double-click); a `special_function` in a normal response is only stored for the next button press.

**Separately, a `filename` cache hit is a genuinely free zero-flicker no-op** — it returns before the SPIFFS read and before any panel repaint, so no download, no 2s waveform, nothing. And `refresh_rate` is applied *outside* the cache branch, so cadence stays fully under server control on a no-op response. Conditions: PNG only (see below), and it relies on `RTC_DATA_ATTR` memory that survives deep sleep but not a power cycle — after a power cycle expect exactly one repaint.

Net: return an unchanged content-hash `filename` whenever the data hasn't moved and the panel simply never flashes. That decouples "how often we poll" from "how often the panel flickers," which is what the whole windowing scheme was working around.

## Naming — decided 2026-07-31

**`trmnl-orca-departures`.** ORCA is the Puget Sound fare card — the Seattle-transit reference without spelling out "Metro" — and `departures` is the word on the real sign's own header. The `-worker` suffix from the original candidate was dropped deliberately; use the name exactly as written.

(Superseded: `trmnl-oba-stopsign-worker` was chosen first, then changed.)

The brief was: `trmnl-` prefix, reference Seattle Metro without necessarily spelling it out, reference the real-time-transit / bus-stop-sign format, and reference that it's the service. Runners-up, kept in case of a rename:

1. `trmnl-connectpoint-worker` — Connectpoint is the actual product name on Metro's real-time signs, so one word carries both the agency and the format reference. Shortest option.
2. `trmnl-oba-stopsign-worker` — OBA = OneBusAway, the data source.
3. `trmnl-kcm-signface-worker`
4. `trmnl-emerald-readerboard-worker` — Emerald City; "readerboard" is the transit term.
5. `trmnl-pugetsound-arrivals-svc`
6. `trmnl-rainier-departures-byos` — `byos` names the exact server role.
7. `trmnl-206-departures-edge` — area code, oblique.
8. `trmnl-metro-nextbus-relay`
9. `trmnl-trolley-arrivals-worker` — Metro runs real trolleybuses.

Note the worker name becomes the public `*.workers.dev` subdomain, and the repo/folder name does not have to match it.

## Failure and staleness — decided 2026-07-31

The requirement: the sign must never silently present stale departure times as if they were live. Start from the physics, because it constrains everything else.

**E-paper is persistent.** Whatever was last painted stays on the glass indefinitely, with no power and no server. So when the Worker is unreachable, the last good render remains on the wall looking perfectly authoritative. **No server-side code can fix this**, because a server that is down cannot send anything — not an error screen, not a blank. Any defense that lives only on the server is not a defense against the server being the thing that failed.

Therefore the primary mechanism has to live *inside the rendered image*:

1. **Every render carries a visible "as of h:mm" timestamp.** This is the whole defense against the unfixable case. A panel reading "as of 4:22 pm" at 6:10 pm is self-evidently stale to a human, with no infrastructure required. Real transit signs do exactly this.
2. **Bias toward absolute clock times over countdowns.** A "4 min" countdown becomes a lie within minutes; a "4:26 pm" departure is still correctly labeled 4:26 pm an hour later. The original layout spec already reached this conclusion for row-ordering reasons — staleness is a second, stronger argument for it. If a countdown is shown at all, it must sit next to the as-of timestamp.
3. **Refuse to render countdowns on old data.** If the data is older than a small threshold, drop to clock times only rather than counting down from a stale base.

Then the layers the server *can* detect, from most to least recoverable:

| Failure | Who can detect it | Response |
| --- | --- | --- |
| OBA errors or returns nothing, Worker up | Worker | Render an explicit degraded screen; shorten `refresh_rate` to recover sooner |
| Real-time missing for some routes only | Worker | Per-row "Scheduled" label — already in the layout spec |
| Worker up, render fails | Worker | Explicit error screen, not a silent reuse of the last good image |
| Worker down / device offline / device asleep too long | **Nobody, server-side** | On-image timestamp only |

**The trap in the degraded case:** an error screen must be given a `filename` that differs from the last good render, or the cache no-op will suppress it and the panel will keep showing stale departures. The flicker optimization and the error path are in direct tension — every error render needs a filename that is stable *for that error state* but distinct from any good render.

Open, pending the X firmware research: whether the device draws its own built-in error screen when it cannot reach the server, and after how many retries. If it does, that is a useful second layer — but it is not a substitute for the timestamp, since a device that never wakes never discovers it is offline.

Note `/api/log` gives device-side telemetry, which is useful for diagnosing after the fact, but it cannot help here: there is no push channel, so a silent device cannot be prodded.

## Access control — decided 2026-07-31

A shared secret in the URL path, checked against a Worker variable. Not in source.

The reason it is needed: `/api/setup` is unauthenticated by design — that is how enrollment works — so anyone who finds the URL can enroll and start burning the OneBusAway quota. The device's `Access-Token` only protects `/api/display` *after* pairing.

So: **token first in the path, then the stop.** Same mechanism as the stop — **a query param cannot work**, for the reason described below.

**Settled 2026-08-01** (this replaces the earlier `/t/<token>/s/<agency>_<stopId>` sketch):

```
https://<worker>/token/<token>/agency/<agency>/stop/<stopId>[,<stopId>]
```

Token first so a bad token short-circuits before any parsing or upstream call. Labelled segments because the URL gets typed into a captive-portal field by hand, and because OBA stop IDs carry their own underscores and hyphens — see the blueset findings section for the evidence.

**One or two comma-separated stop IDs, capped at two** (decided 2026-08-01). Two covers the both-directions case; more than two is rejected as a bad path rather than truncated, so the failure is visible instead of silently dropping a stop. Render order follows path order. Commas are legal unencoded in a path segment and never appear in an OBA stop ID, so nothing needs escaping. Both stops share the single `agency` segment, which holds for a street pair; a cross-agency pair would need a different shape and is explicitly out of scope.

- Store it as a Worker secret (`wrangler secret put DEVICE_TOKEN`), never in the repo.
- Compare in constant time, and return the same response for a bad token as for a bad path so the endpoint doesn't confirm which part was wrong.
- **It will appear in request logs and analytics.** Log a hash or a redacted path, not the raw URL — otherwise the secret ends up in exactly the place people paste when debugging.
- It is typed once into the captive portal and then lives in device NVS. HTTPS encrypts the path in transit, so a path secret is not exposed on the wire — but note the firmware uses `setInsecure()`, so it will not detect a MITM presenting a bad cert.

## Stop configuration — never hardcoded

Decided 2026-07-31: the stop must not live in the repo, for privacy (the stop implies a home address) and portability (one deploy should serve any stop).

**It goes in a path segment of the base URL, configured on the device.** The captive portal's `server` field is the only device-side config channel, and the firmware appends endpoint paths to it bare — so a base URL of `https://<worker>.<subdomain>.workers.dev/token/<token>/agency/<agency>/stop/<stopId>` makes the device request `.../stop/<stopId>/api/display`. The stop then lives only in the device's NVS and never in git.

**A query param cannot work.** The firmware does `baseUrl + "/api/display"` with no URL parsing, so a base of `https://host/?stop=<stopId>` produces `https://host/?stop=<stopId>/api/display` — the path becomes `/` and the stop becomes garbage. Path segment only.

Consequences to design around, all confirmed in the firmware research above:

- A trailing slash on the base URL yields `//api/display`. Normalize server-side; the firmware does not.
- **Changing the base URL wipes the stored credentials and forces a clean re-pair**, so re-pointing at a different stop is a supported operation, not a corrupt state.
- The `workers.dev` hostname is public and unauthenticated, so a stop ID in the path is semi-public. Better than committing it, not a secret. If it needs to be fully private, the alternative is a KV map keyed by the device MAC, set once through an admin endpoint — more moving parts, so only worth it if the URL itself must be clean.

Route filtering, timezone, and the commute windows are per-stop config too. Same mechanism, or KV keyed off the same path segment.

## Data source

OneBusAway Puget Sound: `https://api.pugetsound.onebusaway.org/api/where/arrivals-and-departures-for-stop/{agency}_{stopId}.json`

- **Agency coverage, queried live 2026-08-01.** One deployment, one key, 11 agencies: `1` Metro Transit, `3` Pierce, `19` Intercity, `20` Kitsap, `23` City of Seattle, `29` Community, `40` Sound Transit, `51` Amtrak, `95` WA State Ferries, `96` Monorail, `97` Everett. Adding Sound Transit costs nothing — it is the same endpoint and the same key.
- **A stop can serve multiple agencies.** Sampled downtown, stops prefixed `1_` return 36 Metro routes and 8 Sound Transit routes. The prefix identifies the stop's owner, not the routes calling there, so **one Metro stop ID already covers Metro plus ST Express buses**. Link light rail is separate: stations are `40_` stops of their own.
- Needs an API key. Historically `TEST` worked for low-volume personal use — fine for development, don't ship on it. Store the real key as a Worker secret.
- Core logic is `predictedArrivalTime` minus now, sorted ascending, filtered to the routes we care about.
- Fall back to scheduled arrivals when real-time is unavailable, and label them — this is what Metro's own signs do.

### Prior art — `blueset/trmnl-recipes`, read 2026-08-01

Someone has already shipped a Puget Sound OneBusAway board for TRMNL: [`blueset/trmnl-recipes/transit`](https://github.com/blueset/trmnl-recipes/tree/master/transit), with its data layer in [`blueset/trmnl-workers`](https://github.com/blueset/trmnl-workers) under `src/transit/`. Read in full. It is not a competitor to this project — it is a nearby stops board, not a single-stop sign face — but several of its decisions are load-bearing evidence for ours.

**It is not BYOS, and that is the most important thing about it.** It is a hosted TRMNL plugin (`strategy: polling`): TRMNL's own cloud fetches a JSON URL and renders the Liquid/HTML into the image. The author's Cloudflare Worker only normalizes OneBusAway into a clean JSON shape — no rendering, no image, no `filename`. So it never meets the constraint this project is stuck on. See "The hosted-plugin path" below for whether that is an escape hatch or a trap.

What it settles for us:

- **Where the OneBusAway API key comes from** — Sound Transit's Open Transit Data program, `soundtransit.org/help-contacts/business-information/open-transit-data-otd`. That was an open question at the time, with a "where to get it?" note attached. It is a request form, not a self-serve signup, so start it early.
- **One subrequest per stop is enough.** The author makes two calls per stop — `/stop/{id}.json` and then `/arrivals-and-departures-for-stop/{id}.json` — but the arrivals response already carries `data.references.stops` and `data.references.routes`, which is everything the first call returns. They need the extra call only to compute distance and bearing from a lat/lon origin, which a fixed-stop sign has no use for. So: **one fetch per stop**, and the route metadata (short name, long name, colour) rides along free.
- **`Intl.DateTimeFormat` with `timeZone: "America/Los_Angeles"` works in Workers**, used via `formatToParts` to pull hour and minute. The load-bearing "as of h:mm" stamp therefore needs no timezone library and no bundled tz database. Worth knowing before someone reaches for one.
- **Dedup by `tripId`.** A single stop can return the same trip more than once; the author keeps one entry per `tripId` and drops anything already in the past. Both are cheap and both are correctness bugs if skipped.
- **`predictedArrivalTime || scheduledArrivalTime`, with the fallback flagged.** Exactly the rule this doc already specifies, independently arrived at. Their `isPredicted` boolean is what our "Scheduled" label should hang off.
- **Route badge shape carries meaning.** Anything whose short name ends in `Line` (the Link light rail lines) gets a circle; buses get a rounded rectangle. Non-numeric names collapse to initials so they fit the badge. Cheap, and it matches how the region's real signage reads.
- **Route colour maps to grey by WCAG relative luminance**, bucketed into eight steps, with the text flipped to black or white against it. On a 16-grey panel that is a better use of the greys than picking greys by hand, and OBA hands us `route.color` for free.
- **Stop-name segmentation.** Names are `A & B` cross-streets; shared components between nearby stops get dimmed so the differing part reads first. Only relevant to us if the sign shows two stops.

**This answered the open north/south question.** Opposite directions are two distinct OBA stop IDs, and `stop.direction` is a plain compass string (`N`, `NE`, `E`, …) already in the API response. The author's board simply renders multiple stop groups stacked, each with its own header. At 1872x1404 there is room for two groups without any toggling, so the touch-bar toggle idea is unnecessary — and the touch bar's left/right taps repaint from the local playlist cache with zero HTTP anyway, so it could not drive a live toggle even if we wanted one. The open piece is only how a second stop is expressed in the device URL.

**Stop ID shapes to design for**, from the author's own placeholder examples: `40_532`, `1_1550`, `96_SCM`, `40_E15-T1`, `40_S_KS_T3`. Route IDs likewise: `40_100479`, `23_100340`, `40_2LINE`, `51_60`. The agency prefix is the first underscore-delimited field and the rest is opaque — this is what drove the labelled-segment URL decision above.

#### The hosted-plugin path — moved to `docs/alternatives.md`

Because the author's plugin renders on TRMNL's servers, the CPU question does not exist for them, which made "abandon BYOS, ship a private plugin, keep the Worker as a JSON endpoint" a real option. It was rejected: see [`../alternatives.md`](../alternatives.md#a-hosted-trmnl-plugin) for what it costs.

## Layout spec — the OG-sized original, superseded

Written for 800 × 480 and three rows, before the hardware changed. The design that shipped is 1872 × 1404 with four departures in each of two direction bands, and it is documented in `src/render/CLAUDE.md` against photographs of the real signs. What survived from here is the vocabulary — the black header bar, the rounded-rect badge, the stacked number over unit, the thin rules — and the countdown-versus-clock-time reasoning. What did not survive is the row count, the per-row formatting rule below, and the typeface guess.

Match the Connectpoint design at 800 × 480:

- Black header bar: METRO lockup, "Departures", right-aligned day + clock time
- Three departure rows, each: rounded-rect route badge (dark fill, light numeral), destination text, right-aligned arrival
- Thin horizontal rules between rows
- Footer: stop number + stop name + bay

**Key design decision on arrival formatting.** Follow the real sign: row 1 is a countdown ("4" stacked over "min"), rows 2–3 are absolute clock times ("4:26 pm") with a small grey "Scheduled" label above. Clock times don't go stale, so only one row is sensitive to refresh interval. Minutes-away is the preferred display where it's live.

Typeface: the actual Metro face is unidentified. Inter or Archivo gets ~95% there. The recognizable elements are the rounded-rect badge, the stacked number-over-unit, the thin rules, and the black header bar.

## The open questions and the task order

Both lists are deleted. Every item was answered or overtaken, and `docs/TODO.md` is the live queue. One finding from them is worth carrying, because it is about this particular sign rather than about the software: **the development stop serves only three routes**, one of them a RapidRide line running every 10-15 minutes. That is what undercut the addendum's "expand to 5-6 rows" below — with three routes and one that frequent, a long single-stop board is mostly the same route repeated. The two-stop layout that shipped is the answer to it.


-------------------------------

# Metro Departures Sign — Handoff Addendum 01

Supersedes original section above. Read that first; this amends it. Date: 2026-07-31

## Decision reversed: buy the X, not the OG

The original doc rejected the TRMNL X on two grounds. Both were wrong.

1. **"Can't be wall mounted"** — false. Mounting options are kickstand, wall mount, and embedded magnet. The box includes wall mount hardware, a magnetic sticker, and a screwdriver; the wall mount kit is listed as included. Community mounts at github.com/usetrmnl/mounts. Better mounting than the OG's bare hook recess.
2. **"Not a finished product / main board only"** — misreading. That phrase appears only in the humidity rows, describing what has been humidity-tested. The X began assembly and fulfillment March 18 2026 and both warehouses ship all six colors.

Still true: FCC, CE, UKCA and RoHS are all listed as **pending** for the X.

The remaining argument for the OG was aspect ratio, and it's weaker than originally stated. 5:3 is a constraint of Connectpoint's hardware, not a requirement of Metro's layout. See "Layout implications" below.

## X specs (replaces the OG hardware section)

- 10.3" HD ePaper, **1872 × 1404**, 227 PPI, **16 grayscale**, 15:1 contrast
- Refresh **200ms – 1.3s** (1.2s full, 200ms partial) vs OG's ~2s full-only
- Outer: 233 × 193 × 12 mm = **9 3/16" × 7 5/8" × 1/2"** (without dock)
- Active area: **8 1/4" × 6 3/16"** (derived from rounded 227 PPI, ±1/32")
- Weight 365 g single battery / 450 g double
- ESP32-S3 + ESP32-C5, 8MB PSRAM, 2.4 + 5 GHz WiFi, BLE
- Battery 6000 / 12000 mAh (vs OG 2500)
- Accelerometer → portrait or landscape; gesture touch bar; temperature sensor
- IP65 pending; USB-C via magnetic dock; OTG 1.2A 5V out
- $229, ships within 4 business days (nominal — see Timing)

Note: the spec sheet's "Power Consumption (Sleep): 5h / 10h" is a data-entry error. Do not use that row for battery modeling.

## Flicker — the reason this reversal matters

Original doc's main argument against a 60s refresh was 960 full-panel flashes/day. On the X, 200ms partial refreshes are effectively invisible, so that objection mostly dissolves. Combined with 6000–12000 mAh, a 1-minute rate stops being a compromise.

~~**OPEN / VERIFY:**~~ **ANSWERED 2026-07-31 — no.** The firmware does not use partial refresh for server-pushed dashboard images; the code path is commented out and its buffer-seeding helper is gutted. Every changed image is a full refresh. The suspicion in the original text below was correct, and the consequence is that this whole section's argument does not hold. See "X-class refresh semantics" above.

Original text, kept for the reasoning: does the firmware actually use partial refresh for server-pushed dashboard images? Partial refresh needs to know which region changed. If the BYOS pipeline hands the firmware a whole new bitmap, it may take the full-refresh path every time. Only the minutes region changes in our layout, so a diffing implementation is ideal — but that logic is in firmware, not our server. Firmware is GPLv3 at github.com/usetrmnl/trmnl-firmware if it needs patching.

Also expect a periodic forced full refresh to clear accumulated ghosting. Not zero flash, just far less of it.

## Layout implications of 4:3

Original spec was three departure rows at 800 × 480. At 1872 × 1404 either:

- **Preferred:** expand to 5–6 departure rows. Reads as a transit-center departure board rather than a single-stop sign, and is more useful for a leave-now decision. Keep the Connectpoint visual language (black header bar, rounded-rect route badges, thin rules, stop footer) — just more rows.
- Or letterbox a true 5:3 band at 1872 × 1123 and use the remaining ~281px for a secondary strip (weather, next Link departure, service alerts).

Do NOT scale the 800 × 480 design up 2.34×; type and stroke weights won't survive it. Redraw at native resolution.

Other changes from the OG plan:
- 16 grayscale, not 4 — the grey "Scheduled" labels and any rules/dividers have real headroom now. Render 4-bit, not 1-bit.
- Larger payload, but 8MB PSRAM means the RAM ceiling that constrained the C3 is gone.
- Portrait is available via accelerometer. Ignore for now; a departures board is landscape.

## Ordering

- TRMNL X — $229
- Clarity Kit — $25 (battery upgrade + Developer edition + cable + cloth; must be added to the device order, cannot be bought separately)
- No BYOD license. BYOS is free.
- **Avoid the Clear enclosure** — repeatedly out of stock through 2026.
- Color: black is closest to the real Connectpoint housing; white/sage/grey blend into a wall better.

Total ≈ $254.

## Timing

Waiting until ~August is acceptable per the buyer. Caveat: X fulfillment has been a rolling series of supply problems (weak magnets, missing charging docks, packaging foam stuck in EU customs, PCB lead times, a freight package lost by FedEx). As of July 23 the USA warehouse expected to zero out its queue after receiving Clear kickstands/docks. If a hard gift date exists, treat August as an estimate, not a commitment. Order tracker: trmnl.com/order-tracker

**Update from `trmnl.com/blog/model-x-progress`, read 2026-07-31 (post dated July 30):**

- USA warehouse expects Clear kickstands / docks / u-mounts **August 5**; queue "nearly complete."
- Berlin warehouse has **PCBs stuck in customs**; a new batch ships to the USA arriving **August 5**. PCB "long lead times" are the current bottleneck.
- Specs confirmed exactly as the addendum states: 1872x1404, 16 greys, ESP32-S3 (16MB flash, 8MB PSRAM) + ESP32-C5, 6000/12000 mAh, 362g/448g.
- **Firmware for the X is "extended from OG/BYOD versions," on prototypes since September 2025.** So the BYOS contract should carry over — but the OG-specific constants in the research above (90000-byte cap, the hard 800x480 dimension checks) will not.
- Certification: **EC licenses "underway" as of December 2025**; the post mentions no FCC, UKCA or RoHS status at all. Still unresolved, seven months on.

Read: the X is real and close, but every dated milestone in that post is a supply arrival, not a ship confirmation. Nothing here justifies waiting on the X before writing code.

## Unchanged from the original doc

BYOS architecture, Cloudflare Worker, OneBusAway data source and endpoint, the countdown-vs-clock-time formatting decision, time-windowed `refresh_rate` logic, and every open question the original doc carried — the stop ID blocked everything at this point.

The refresh windowing is now less about battery survival and more about avoiding pointless API calls — keep it, but it can be less aggressive.