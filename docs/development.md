# Working on the code

For standing up your own sign — API key, stop IDs, secrets, deploying, pairing the device — see [deploying.md](deploying.md). This file is about changing the code.

## Getting started

```bash
nvm use         # .nvmrc pins lts/iron
npm install
npm run dev     # wrangler dev on localhost:8788
npm test        # or npm run test:watch
npm run lint
```

Plain JavaScript, no framework, no bundler. One Worker, vitest, eslint flat config. There is no SPA and there is not going to be one, so `npm run dev` stays a single process.

Local values go in `.dev.vars` — copy `.dev.vars.example`, which documents each one. That file is gitignored and `wrangler deploy` never uploads it.

**Nothing above needs Cloudflare credentials**, and that is deliberate. `npm run dev`, `npm test`, `npm run lint` and `npm run deploy:check` all work on a fresh clone with no `.cloudflare.env` at all — `wrangler dev` runs unauthenticated in local mode and `--dry-run` never calls the API.

Every script that *does* touch the account — `deploy`, `tail`, `whoami`, `secret`, `secret:list` — loads `.cloudflare.env` itself. **Never run a bare `wrangler` command that writes**, and never `wrangler login`: ambient OAuth credentials are silently preferred over the ones in that file, and on a machine with more than one Cloudflare account that can deploy somewhere unintended while printing a perfectly normal success message.

So the split is by whether a command reaches the account, not by tidiness. `npm run secret:list` is the check that proves credentials resolve correctly; `npm run whoami` does **not**, because it only lists the accounts a token can reach and passes even when an operation would target a different one.

Every BYOS endpoint currently answers **404 on purpose**, so `npm run dev` returning 404 on `/api/display` is correct rather than broken. A partial `/api/display` is worse than none: a response missing `refresh_rate` parses as `0` and hot-loops the device until the battery is flat, and a body of `{"status": 500}` factory-resets it. The endpoint only becomes safe once `refresh_rate`, `filename` and `status: 0` are all correct together.

## What lives where

| | |
| --- | --- |
| `src/worker.js` | Entry point, and deliberately nothing but the seam between the gate and the BYOS handlers. |
| `src/gate.js` | The shell every request passes through. Returns a finished response, or an authorized classification to dispatch on. |
| `src/abuse.js` | Request classification, the bot tarpit, and the outcome vocabulary. |
| `src/stats/` | The `/stats` page: `schema.js` (the Analytics Engine row), `analytics.js` (writes), `device-logs.js` (`/api/log` history), `query.js` (SQL reads), `render.js` (pure HTML), `handler.js` (auth). |
| `src/config.js` | `readConfig()` — the only reader of `env` for a display or scheduling value. |
| `src/clock.js` | `formatBoardTime()` — the header fields and the "Updated at" stamp, in the configured timezone. |
| `src/routing.js` | Path parsing and the constant-time token comparison. |
| `src/filename.js` | The content-hash cache key the device caches images by. |
| `src/render/board.js` | The board as SVG, data-driven. Pure. |
| `src/render/png.js` | Quantise and 4-bit greyscale PNG encoder. Pure. |
| `src/render/index.js` | resvg wiring — the only module that touches wasm or fonts. |
| `src/assets/` | Logos, pre-cleaned and pre-recoloured at author time so nothing is reprocessed per render. |
| `src/dev/` | The sample boards and the preview page. |

Tests sit beside the file they cover. `vitest.config.js` aliases `.wasm` and `.ttf` to a stub, because vitest tries to parse binary modules as JavaScript; nothing that depends on those contents is asserted.

## Design preview

With `DEV_PREVIEW=1` in `.dev.vars`, `npm run dev` serves a contact sheet at **http://localhost:8788/_preview** — every sample board rendered at native 1872x1404 in 4-bit greyscale, shown at 50%, re-rendered on each reload, with a download link per image.

This is **local only, and structurally so.** The flag lives in `.dev.vars`, which `wrangler dev` reads and `wrangler deploy` never uploads, so on a deployed Worker the variable does not exist and the routes 404 like everything else. Do not move it into `[vars]` in `wrangler.toml` — that block *is* deployed, and it would expose the render cost to anyone who found the URL.

The sample boards are in `src/dev/sample-boards.js`. Their route numbers, headsigns, stop codes and directions are all real, verified against OneBusAway, and deliberately drawn from busy public downtown stops rather than the stop the sign actually points at — so no committed image can leak an address. Invented data also hides width problems: real Metro headsigns concatenate destination and via-point, so they run far longer than anything a person would make up.

They carry their own `SAMPLE_DIRECTION_OVERRIDES` rather than reading the deployment's `DIRECTION_OVERRIDES`, for the same reason — those stop IDs are public, so they can be written down. See [deploying.md](deploying.md#direction-labels-and-overriding-them-per-stop) for what the override does.

Below the two reference boards, the sheet carries a set of **edge cases** from `src/dev/edge-case-boards.js`: route names against the badge slot in both bus and rail modes, the headsigns that must collapse and the ones that must not, the longest stop name in the region, a stop that reports no compass bearing, and a sparse board rendered at the row-height ceiling. Every name on them is real OneBusAway data; what is synthetic is the co-location, since these routes do not call at one stop, and each group says so where a real board puts the stop name.

They are worth looking at after any change to the row or band. One failure they show appears only at an extreme and is easy to miss: a destination collides with the time column when the board is *sparse* enough for rows to draw at full height, which is the opposite of where anyone looks for an overflow.

Boards render at a fixed reference instant so the departure times stay consistent with the header. Append **`?now=live`** to render at the real clock instead — that is what exercises the timezone from config, and it is where a bad `Intl` part shows up in the header block.

**Look at the image, not just the status code.** A textless render is a valid PNG of a plausible size, and a font that fails to load produces exactly that. More than one afternoon has gone to a 200 that drew nothing.

## Stats page preview

The same flag serves the stats page against mock data at **http://localhost:8788/_preview/stats**, through the identical `renderStatsHtml()` the real route uses. That matters because the page's most important states are the ones you cannot conveniently produce on demand — a second network appearing, a fuel gauge returning `-1`, one panel's query failing while the rest of the page survives. `buildMockStatsData()` in `src/stats/render.js` fabricates them, including an HTML-injection payload so the escaping stays exercised.

**Escaping is not optional in that file.** It renders user agents and probe paths straight from whoever sent them. `src/dev/preview.js` builds its HTML without escaping because its inputs are fixtures; the stats page cannot follow that precedent, and `render.test.js` asserts it does not.

## Reading the device's logs

The device POSTs its own diagnostics to `/api/log`, and that is the **only** channel back from it — there is no push channel, so a device that renders nothing cannot be prodded, and the firmware tracks no staleness of any kind. Three of its failure paths (malformed body, wrong `Content-Type`, out of memory) draw nothing at all and then settle into 900-second polls, so a blank panel may be the only symptom you ever see.

Those payloads are kept **two** ways, deliberately, because they answer different questions:

```bash
npm run tail          # live stream from the deployed Worker
```

`wrangler tail` is live-only — it shows requests as they happen and nothing from before you attached. That is the right tool when you are standing at the sign with a USB cable. The Cloudflare dashboard's **Workers Logs** view covers the recent past, because `[observability.logs]` is enabled in `wrangler.toml`, but retention there is **3 days on the Free plan** (7 on Paid).

For history, `recordDeviceLogs()` in `src/stats/device-logs.js` writes every entry to its own Analytics Engine dataset, and the **Device logs** panel on `/stats` reads it back with roughly 90 days of retention. Three reasons that is not redundant with the console:

- The entries that matter arrive **during a failure**, which is exactly when nobody is watching a tail.
- It sits in the same store as the request outcomes, so the device's own account of a failure can be read against what the server was answering at the time. Workers Logs cannot be joined against that.
- 3 days is thinner than it sounds for a wall-mounted object. A sign that misbehaves while you are away is a week gone.

The dataset keeps `source_path` and `source_line` — together they name the exact line of the GPLv3 firmware that produced the entry, rather than a guess — plus `free_heap_size` and `max_alloc_size`, which are the only signal for the out-of-memory path. One request is capped at 64 persisted entries so a misbehaving device cannot spend the daily write quota; anything dropped is counted rather than discarded silently.

Both `npm run tail` and `npm run deploy` need Cloudflare credentials in the environment, which is still an open question — `.cloudflare.env` holds them and nothing loads it yet.

**Never log a raw request path.** The device token is a path segment, so a logged URL puts the shared secret straight into the log stream, which is exactly where people paste when debugging. `redactPath()` in `src/routing.js` hashes both the token and the stop and exists for this.

## Things that will bite you

Each of these fails silently, and each is verified against the GPLv3 firmware rather than assumed.

- **`Content-Type` must be exactly `image/png`.** The firmware picks its decode path by string-comparing that header, not by magic bytes. A perfect PNG served as `application/octet-stream` displays nothing, with no error.
- **`refresh_rate` must be on every response**, and `"status": 0` must be in every JSON body. Absent `refresh_rate` parses as 0 and hot-loops the device; a status the dispatch switch does not handle makes it discard the whole response, and `{"status": 500}` factory-resets it.
- **`filename` is a cache key.** It must change when the image bytes change and must not change when they don't — a constant filename freezes the panel while the server serves perfect JSON, and a filename that changes every poll costs a download and a visible flash every time. It also has hard shape rules: the last 10 characters must be ASCII digits, and the total length must never be exactly 31. `src/filename.js` satisfies all of them by construction.
- **Never redirect**, and never serve images from another host. Redirect handling differs per endpoint and drops auth headers in some paths.
- **Never call resvg's `asPng()`.** It encodes RGBA — the wrong format for the panel and by far the most expensive step. Take `render().pixels` and encode 4-bit greyscale directly.
- **Fonts must be TTF or OTF.** resvg parses raw sfnt and cannot decompress a WOFF container; a `.woff` is rejected with no error and every text element vanishes while rects and badges draw normally.
- **A block comment containing a wasm glob breaks the build.** The `*` `*` `/` `*` sequence closes the comment early and the rest of the file parses as garbage, with the error pointing at the end of the file.

`CLAUDE.md` carries the full firmware research behind each of these, including the source lines.
