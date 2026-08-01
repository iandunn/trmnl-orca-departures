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

Every BYOS endpoint currently answers **404 on purpose**, so `npm run dev` returning 404 on `/api/display` is correct rather than broken. A partial `/api/display` is worse than none: a response missing `refresh_rate` parses as `0` and hot-loops the device until the battery is flat, and a body of `{"status": 500}` factory-resets it. The endpoint only becomes safe once `refresh_rate`, `filename` and `status: 0` are all correct together.

## What lives where

| | |
| --- | --- |
| `src/worker.js` | Entry point. Routes the dev preview and otherwise 404s. |
| `src/config.js` | `readConfig()` — the only reader of `env` for a display or scheduling value. |
| `src/clock.js` | `formatBoardTime()` — the header fields and the "as of" stamp, in the configured timezone. |
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

Boards render at a fixed reference instant so the departure times stay consistent with the header. Append **`?now=live`** to render at the real clock instead — that is what exercises the timezone from config, and it is where a bad `Intl` part shows up in the header block.

**Look at the image, not just the status code.** A textless render is a valid PNG of a plausible size, and a font that fails to load produces exactly that. More than one afternoon has gone to a 200 that drew nothing.

## Reading the device's logs

The device POSTs its own diagnostics to `/api/log`, and that is the **only** channel back from it — there is no push channel, so a device that renders nothing cannot be prodded, and the firmware tracks no staleness of any kind. Three of its failure paths (malformed body, wrong `Content-Type`, out of memory) draw nothing at all and then settle into 900-second polls, so a blank panel may be the only symptom you ever see.

Those payloads are logged with `console.log`, which is enough for both live and recent-history views. No database, no UI:

```bash
npm run tail          # live stream from the deployed Worker
```

`wrangler tail` is live-only — it shows requests as they happen and nothing from before you attached. For anything older, the Cloudflare dashboard's **Workers Logs** view is queryable and searchable, because `[observability.logs]` is enabled in `wrangler.toml`.

**Retention on the Free plan is 3 days**, with 200,000 logs a day included (Paid is 7 days). That is accepted: a device failing overnight is still readable the next morning, which is the case that matters. Durable storage is deliberately not built — see `docs/TODO.md` if 3 days ever proves too short.

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
