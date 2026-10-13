# Running your own sign

This repo is one person's sign pointed at one stop. There is no shared service to sign up for — **you run your own backend**, and the stop is never stored here. Forking and standing up your own copy is the supported path.

For changing the code, the design, or the sample boards, see [development.md](development.md).

## 1. Get a OneBusAway API key

Sound Transit is the only issuer for the Puget Sound region — request one at [Open Transit Data](https://www.soundtransit.org/Open-Transit-Data). OneBusAway is open-source software rather than a hosted service, so there is no central key authority; each regional deployment issues its own. The literal key `TEST` works for development but is heavily rate-limited and returns HTTP 429 under any real load.

Outside Puget Sound you also need to change `OBA_BASE_URL` to your region's deployment. Only Puget Sound has been tested.

## 2. Find your stop IDs

Search [pugetsound.onebusaway.org](https://pugetsound.onebusaway.org/) and note the ID, which looks like `1_1550`. The number before the first underscore is the agency:

| | | | |
| --- | --- | --- | --- |
| `1` King County Metro | `3` Pierce | `19` Intercity | `20` Kitsap |
| `23` Seattle streetcar | `29` Community | `40` Sound Transit | `51` Amtrak |
| `95` WA State Ferries | `96` Monorail | `97` Everett | |

One key covers all of them. A stop's agency is whoever owns the pole, not who serves it — a Metro stop returns Sound Transit routes calling there too, so you usually do not need a second agency to see ST Express buses. Link light rail is the exception, since stations are their own `40_` stops.

Opposite directions of a street are **two different stop IDs**, not one stop with a direction field. Pass both to show both.

## 3. Create your own Cloudflare Worker

A free account is enough — a full render costs about 58 ms of CPU against a ~1000 ms per-invocation ceiling, roughly 17x headroom.

```bash
git clone <your fork> && cd trmnl-orca-departures
nvm use && npm install
cp .dev.vars.example .dev.vars     # fill in your stop, token and API key
```

Pick a Worker name in `wrangler.toml` — it becomes your public `*.workers.dev` subdomain, so it must be globally unique. Generate a device token with `openssl rand -hex 32`.

**Enable Analytics Engine once, before the first deploy.** It backs the `/stats` page, and it is off by default on a new account: `wrangler deploy` fails with "You need to enable Analytics Engine" (error code `10089`) until you turn it on at dash.cloudflare.com under Workers, Analytics Engine. It is free on the Workers Free plan.

Then set the secrets and deploy, **in that order**:

```bash
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put OBA_API_KEY
npx wrangler secret put STATS_PASSWORD
npx wrangler secret put ANALYTICS_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npm run deploy
```

Order matters. A deployed Worker where `env.DEVICE_TOKEN` is `undefined` makes the token comparison degenerate, which leaves the endpoint open to anyone who finds the URL and burns your OneBusAway quota.

The last three are only needed for `/stats`. Skip them and the sign works normally; the page just explains what is missing.

**There are two different Cloudflare API tokens here, and Cloudflare's UI calls both the same thing.** Crossing them is the easiest mistake on this page:

| Value | Who reads it | Where it lives | Scope |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | the wrangler CLI, at deploy time | `.cloudflare.env` | `Workers Scripts: Edit` |
| `ANALYTICS_API_TOKEN` | the Worker, on every `/stats` load | `wrangler secret put` | `Account Analytics: Read` |
| `CLOUDFLARE_ACCOUNT_ID` | the Worker, to build the SQL URL | `wrangler secret put` | not a credential |

A read-only deploy token fails with `Authentication error [code: 10000]`. Wrangler owns the Worker — never paste code into the Cloudflare dashboard, since a deploy overwrites it.

`CLOUDFLARE_ACCOUNT_ID` must name **the account the Worker is actually deployed to**. If it names a different one, `/stats` queries an account the data was never written to and renders an empty page that looks perfectly healthy. It is held as a secret only for portability — it is not sensitive, but `wrangler.toml` is committed and a fork needs its own value.

`npm run deploy` and `npm run tail` load `.cloudflare.env` themselves. **Do not run `source .cloudflare.env && npx wrangler deploy`** — `source` sets shell variables, not environment variables, so wrangler never receives the token and silently falls back to whatever account `wrangler login` last stored. That deploys to the wrong account with no error at all.

### Two things about secrets that only surface later

**`wrangler secret list` proves a secret exists, not what it holds.** Nothing will tell you that the deployed `DEVICE_TOKEN` and the one in your `.dev.vars` have drifted apart, and they can — re-running `secret put` against the wrong name, pasting a value a character short, or piping one in with a trailing newline all succeed and all compare unequal. `tokensMatch()` is an exact comparison with no trimming.

The symptom is specific enough to diagnose from a browser. If **every** URL carrying the token returns 404 while `https://<your-worker>.workers.dev/robots.txt` still returns 200, the Worker is up and healthy and the token is what is wrong. Time the 404 to tell which mistake it is: an **immediate** one is a rejected token, and a **25-second** one is the bot tarpit answering a path that never parsed, which means the error is in the part of the URL *after* the token. Secrets are write-only, so there is nothing to read back and compare — set it again from the value you know is right.

**A freshly set secret takes a minute or two to reach every edge.** Immediately after `wrangler secret put`, some requests are still answered by isolates holding the old value — roughly one in five at first, falling to none. It looks exactly like a fix that did not take. Re-test over a couple of minutes before concluding anything from a single failure.

Once it is deployed, `npm run tail` streams the Worker's logs live, including the diagnostics the device POSTs to `/api/log`. That is the only channel back from a sign that is rendering nothing, so it is the first place to look. See [development.md](development.md#reading-the-devices-logs).

To confirm the deployment answers correctly before you pair anything to it, [manual-testing.md](manual-testing.md) walks the four requests the device makes as `curl` commands, with what each response has to contain.

## 4. Point your TRMNL at it

The device's WiFi captive portal is the only way to set the server URL — there is no dashboard setting and no build flag. Settings on trmnl.com, such as its refresh rate, do not apply either: in BYOS mode TRMNL's own server is never contacted, and the device sleeps for whatever `refresh_rate` this Worker returns.

To reach the portal on a TRMNL X that is already set up, put it into WiFi pairing mode: hold both ends of the touch bar until the screen blinks, then hold the middle. Join the TRMNL network it broadcasts from a phone, open **Advanced**, set **Custom Server** to **Yes**, and enter:

```
https://<your-worker>.workers.dev/token/<your-token>/agency/<agency>/stop/<stopId>[,<stopId>]
```

The stop segment takes one or two comma-separated IDs, without the agency prefix. Three or more is rejected rather than truncated.

The two need not be opposite directions of one street. Whichever two stops you actually walk to is a valid pairing — the board names each one in its own band, so a pair a few blocks apart reads correctly. That is what the sample board does, and it is often the only way to get the routes you care about onto one screen: a street's two stop zones can carry different route sets entirely.

### Typing that URL into the portal

The portal field is labelled for a bare server and its placeholder reads *"Enter your custom server without a trailing / (e.g. `https://trmnl.app`)"*, which makes a URL with five path segments on the end look wrong. It is not. Checked against the firmware rather than the wording:

- **A path is fine.** The field is a plain `<input type="url">` (`lib/wificaptive/portal/index.html`), and the value is stored verbatim — `WebServer.cpp` reads `data["server"]` straight out of the JSON and `WifiCaptive::saveApiServer()` writes it to NVS with no parsing, no validation and no normalisation. Nothing in the firmware ever inspects the URL beyond concatenating onto it, which is exactly why the token and stop can live in it at all.
- **The comma needs no escaping.** It is a legal sub-delimiter in a path segment, and OneBusAway stop IDs never contain one.
- **Heed the "no trailing slash" advice, even though we survive one.** The firmware builds requests as `baseUrl + "/api/display"` with no normalisation, so a trailing slash yields `//api/display`. This server filters empty path segments and parses it correctly, but it is one more thing to be wrong about and it lengthens the base URL that the image auth check compares against.
- **Never a query string.** Same concatenation: anything after a `?` lands before the path and mangles both. This is why the stop is a path segment in the first place.
- **Type it exactly, including the scheme.** `type="url"` means the browser rejects the field outright without one, which reads as the form simply refusing to submit.

The URL is saved **only if the WiFi credentials also succeed**, so a wrong WiFi password silently discards it and looks like the sign ignoring your server. Changing this URL later wipes the device's stored `api_key` and `friendly_id` (`WifiCaptive.cpp:459`) and forces a clean re-pair — that is the supported way to move it to a different stop or server, not a fault.

### What a successful pairing looks like

`/api/setup` answers with a six-character `friendly_id`, drawn from an alphabet with no `0`/`O` or `1`/`I` so it can be read off the glass, and the device shows it on its setup screen. Seeing it is the confirmation that the token, the path and the WiFi are all right.

**A missing logo on that screen is expected and harmless.** The setup response also carries an image, and the two radio paths disagree about what they will accept: on 2.4 GHz the firmware sniffs PNG magic bytes and takes ours, while on 5 GHz it accepts only a BMP of exactly 48062 bytes — an 800x480 1bpp bitmap, the older device's panel size, which is a format that is broken elsewhere on the X. The `api_key` is persisted *before* that download either way, so pairing succeeds regardless; on 5 GHz the log records a download failure and the screen draws without the logo.

Everything the device fetches lives under that prefix, images included: the firmware's auth check is a raw string compare against the stored base URL, so an image URL that diverges from it silently loses its token header.

## Configuration

**The stop is not stored in this repository, and should not be.** It travels in the path segment above, so it lives only in the device's own memory. The three homes are chosen by what a value *is*, not by convenience:

| Kind | Home |
| --- | --- |
| Secrets — `DEVICE_TOKEN`, `OBA_API_KEY`, `STATS_PASSWORD`, `ANALYTICS_API_TOKEN` | `npm run secret -- NAME`, or `.dev.vars` locally |
| Neither secret nor publishable — `DIRECTION_OVERRIDES`, `CLOUDFLARE_ACCOUNT_ID` | Same as secrets |
| Privacy-sensitive — agency, stop IDs | A path segment of the device's base URL |
| Everything else — schedule, timezone, panel fit | `[vars]` in `wrangler.toml` |

The `[vars]` block is committed, so a fork edits one file and redeploys. Each var is commented in place; in brief:

| Var | What it sets |
| --- | --- |
| `TIMEZONE` | The IANA zone everything is displayed and scheduled in |
| `ACTIVE_START`, `ACTIVE_END` | The daily window the sign is awake; outside it, one sleep until morning |
| `REFRESH_ACTIVE_SECONDS` | Seconds between polls while awake |
| `REFRESH_WAKE_LEAD_SECONDS` | How long your device spends waking, downloading and painting; subtracted so polls land just after each minute. Measured at ~12 on a TRMNL X over 2.4 GHz |
| `OBA_BASE_URL` | The regional OneBusAway deployment |
| `TARPIT_MS` | How long scanner traffic is held before its 404 |
| `CALIBRATION_SCREEN` | `"true"` replaces the board with the edge test pattern |
| `ANALYTICS_DATASET` and friends | Analytics Engine dataset names; must match the bindings below them |

Nothing deployment-specific is a literal in the code; `readConfig()` in `src/config.js` is the only reader, and it coerces and range-checks every value, falling back to a default rather than throwing — `/api/display` runs about 1440 times a day, and a config error there is a flat battery rather than a 500 someone notices.

### Checking how the image sits on your panel

The first TRMNL X drew the image a few pixels left of the glass: about 3 columns were hidden under the bezel, and a strip about 4px wide showed down the right edge. Nothing can fill the right strip — an image wider than the panel crash-loops the device — so the layout starts its full-width shapes at `BLEED_LEFT` in `src/render/board.js`, 7px in, which shows a matching gap of about 4px on the left. It is the sum of `GLASS_HIDDEN_LEFT` and `GLASS_STRIP_RIGHT` beside it; if your panel sits differently, change those two, judging the right strip by eye, since no test pattern can reach it. To see how yours sits:

1. During the sign's active hours, set `CALIBRATION_SCREEN = "true"` and deploy. On the next poll the sign shows rows of black bars at both side edges, each row's bars inset by the number of pixels on its label.
2. On each side, read the first row with a clear white gap between bar and bezel. Row 1 on both sides means the image is centred. A first gap at row *n* on the left, with a gap even on row 0 on the right, means the image is shifted *n* pixels left.
3. Set `CALIBRATION_SCREEN = "false"` and deploy again.

### Direction labels, and overriding them per stop

The band above each group says which way the buses are going. OneBusAway supplies only a compass bearing for a stop — `N`, `NW`, `SE` — never a word, so the label is derived: `N` becomes **"Northbound"**, `NW` becomes **"Northwest bound"**. The cardinals close up because that is the word Metro prints; the diagonals stay spaced because "Northwestbound" is not a word anyone writes. That rule is correct for every stop in the region with no lookup table, which is the property that matters — the sign has to work at a stop nobody has configured.

What it cannot fix is a bearing that is accurate and still misleading. 3rd Ave runs diagonally through downtown, so its stops report `NW` and `SE` while every rider and every Metro timetable says northbound and southbound. `DIRECTION_OVERRIDES` replaces the label for exactly those stops — a JSON map keyed by full OneBusAway stop ID, agency prefix included:

```
DIRECTION_OVERRIDES={"1_600":"Northbound","1_430":"Southbound"}
```

Most stops need no entry. Keep it to the handful where the bearing misleads; a region-wide table would defeat the point of deriving the label at all. Malformed JSON degrades to no overrides rather than failing a render.

This is the one display value that cannot live in `wrangler.toml`, because it is keyed by stop ID and your entry would put your stop — and so roughly your address — in a committed file. It goes in `.dev.vars` locally and `npx wrangler secret put DIRECTION_OVERRIDES` in production. Not because it is a credential, but because that is the only home for a value that is neither secret nor publishable.

The sample boards do **not** read it; see [development.md](development.md#design-preview).

## Monitoring the sign

`https://<your-worker>.workers.dev/stats` is a single page showing what is working and what is not. It prompts for a password over HTTP Basic — the username is ignored, only `STATS_PASSWORD` matters.

It answers four questions, in the order they matter:

**Is anyone else using my URL?** The Device identity panel at the top is an alarm, not a table. Normally it is one calm line: one network, one firmware version, no enrollments. Because the shared token travels in a URL, a leak — a screenshot, a debugging paste, a request log — lets someone else authenticate successfully, and a change of network is the only signal that would ever exist. Two networks, an unexpected `/api/setup` call, or a second firmware version all mean something is wrong.

**Is the panel actually repainting?** The `Image-Cached` figure is the device reporting whether it skipped the download because `filename` was unchanged. That is the flicker rate, and the whole design bets on it — flicker avoidance comes entirely from that cache no-op, not from partial refresh. The header reports the *previous* wake, not the current one.

**How is the battery holding up?** All six battery headers are recorded, and every one reads `-1` when the fuel gauge failed to initialise, which the page shows as no data rather than plotting a false zero.

**Is something misconfigured?** A valid token with an unusable stop ID lands in the Configuration errors panel with the reason and the stop, which is the fastest way to catch a typo made at the captive portal.

**What did the device itself say?** The Device logs panel keeps everything the sign POSTs to `/api/log`, including the `source_path` and `source_line` that name the exact line of firmware that failed, and the free-heap figure that catches the out-of-memory path — one of the modes that draws nothing at all, forever. `npm run tail` shows the same entries live, which is what you want while standing at the sign; this panel is what you want on Thursday when you are asking what happened on Tuesday.

### When the sign stops updating

The first real device stalled for about five minutes at a time, a few times an hour, with every request that reached the Worker answered normally. What that looks like, and what was ruled out, so the next diagnosis starts further along:

- **The device's own log names it.** A Device logs entry reading `HTTP GET failed after 5 attempts ... connection refused(-1)` from `src/services/http_retry_request.cpp`, with `wifi_status: connected`. The ESP32 HTTP client reports `-1` for any failure to open a connection — DNS, TCP or TLS — so "refused" is not literal.
- **The next successful poll reports a long `Wake-Time`.** It is the milliseconds the device was awake before that request; 10-13 seconds is normal, and ~290,000 is a wake spent retrying.
- **Ruled out:** signal (RSSI -64 to -70 on 2.4 GHz throughout) and DNS filtering (Cloudflare's filtering resolvers `1.1.1.2` and `1.1.1.3` both resolve the Worker normally).
- **Unconfirmed suspect:** a router rule forcing specific DNS servers. With it disabled the stalls stopped, but they had not returned 50 minutes after it was turned back on, so the evidence is thin either way. Router features that throttle new connections are the other candidate. Cloudflare also served this network from London (`colo=LHR` in `/cdn-cgi/trace`) rather than Seattle, which adds latency but did not stop a laptop on the same network connecting cleanly.

Two things worth knowing about the data:

- **It records stop IDs in full, deliberately**, because "which stop was this failing request for" is the question the page exists to answer. The stop never enters the repository, but it *is* printed on this page — so a screenshot of `/stats` carries roughly your address. Treat it like the URL itself.
- **The device token is never recorded**, only a short hash of it, which is enough to tell forty attempts at one wrong token from forty different guesses.

Wrong password attempts are tarpitted for 25 seconds and recorded as `stats-auth-failed`, so they show up on the page they were trying to reach.
