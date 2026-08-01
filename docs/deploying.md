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

Pick a Worker name in `wrangler.toml` — it becomes your public `*.workers.dev` subdomain, so it must be globally unique. Generate a device token with `openssl rand -hex 32`. Then set the secrets and deploy, **in that order**:

```bash
npx wrangler secret put DEVICE_TOKEN
npx wrangler secret put OBA_API_KEY
npx wrangler deploy
```

Order matters. A deployed Worker where `env.DEVICE_TOKEN` is `undefined` makes the token comparison degenerate, which leaves the endpoint open to anyone who finds the URL and burns your OneBusAway quota.

The Cloudflare API token wrangler uses needs `Workers Scripts: Edit`; a read-only token fails with `Authentication error [code: 10000]`. Wrangler owns the Worker — do not paste code into the Cloudflare dashboard, since a deploy overwrites it.

Once it is deployed, `npm run tail` streams the Worker's logs live, including the diagnostics the device POSTs to `/api/log`. That is the only channel back from a sign that is rendering nothing, so it is the first place to look. See [development.md](development.md#reading-the-devices-logs).

## 4. Point your TRMNL at it

The device's WiFi captive portal is the only way to set the server URL — there is no dashboard setting and no build flag. Enter:

```
https://<your-worker>.workers.dev/token/<your-token>/agency/<agency>/stop/<stopId>[,<stopId>]
```

The stop segment takes one or two comma-separated IDs, without the agency prefix. Three or more is rejected rather than truncated.

The URL is saved **only if the WiFi credentials also succeed**, so a wrong WiFi password silently discards it and looks like the sign ignoring your server. Changing this URL later wipes the device's stored credentials and forces a clean re-pair — that is the supported way to move it to a different stop or server, not a fault.

Everything the device fetches lives under that prefix, images included: the firmware's auth check is a raw string compare against the stored base URL, so an image URL that diverges from it silently loses its token header.

## Configuration

**The stop is not stored in this repository, and should not be.** It travels in the path segment above, so it lives only in the device's own memory. The three homes are chosen by what a value *is*, not by convenience:

| Kind | Home |
| --- | --- |
| Secrets — `DEVICE_TOKEN`, `OBA_API_KEY` | `npx wrangler secret put`, or `.dev.vars` locally |
| Privacy-sensitive — agency, stop IDs | A path segment of the device's base URL |
| Everything else — schedule, timezone, labels | `[vars]` in `wrangler.toml` |

The `[vars]` block holds the timezone, the active window, both refresh rates, the header text and the OneBusAway base URL. It is committed, so a fork edits one file and redeploys. Nothing deployment-specific is a literal in the code; `readConfig()` in `src/config.js` is the only reader, and it coerces and range-checks every value, falling back to a default rather than throwing — `/api/display` runs about 1440 times a day, and a config error there is a flat battery rather than a 500 someone notices.

### Direction labels, and overriding them per stop

The band above each group says which way the buses are going. OneBusAway supplies only a compass bearing for a stop — `N`, `NW`, `SE` — never a word, so the label is derived: `N` becomes **"Northbound"**, `NW` becomes **"Northwest bound"**. The cardinals close up because that is the word Metro prints; the diagonals stay spaced because "Northwestbound" is not a word anyone writes. That rule is correct for every stop in the region with no lookup table, which is the property that matters — the sign has to work at a stop nobody has configured.

What it cannot fix is a bearing that is accurate and still misleading. 3rd Ave runs diagonally through downtown, so its stops report `NW` and `SE` while every rider and every Metro timetable says northbound and southbound. `DIRECTION_OVERRIDES` replaces the label for exactly those stops — a JSON map keyed by full OneBusAway stop ID, agency prefix included:

```
DIRECTION_OVERRIDES={"1_590":"Northbound","1_430":"Southbound"}
```

Most stops need no entry. Keep it to the handful where the bearing misleads; a region-wide table would defeat the point of deriving the label at all. Malformed JSON degrades to no overrides rather than failing a render.

This is the one display value that cannot live in `wrangler.toml`, because it is keyed by stop ID and your entry would put your stop — and so roughly your address — in a committed file. It goes in `.dev.vars` locally and `npx wrangler secret put DIRECTION_OVERRIDES` in production. Not because it is a credential, but because that is the only home for a value that is neither secret nor publishable.

The sample boards do **not** read it; see [development.md](development.md#design-preview).
