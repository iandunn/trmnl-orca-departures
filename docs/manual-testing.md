# Driving the device routes by hand

The device makes **four** requests, not three: `/api/setup` once at enrollment, then `/api/display` on every wake, the `/image/<filename>` fetch that usually follows it, and `/api/log` whenever it has something to report. This file is how to reproduce each one with `curl`.

**Try [`/_preview/byos`](development.md) first.** With `DEV_PREVIEW=1` in `.dev.vars`, `npm run dev` serves a page that drives all four routes server-side and asserts the contract on each, with the rendered PNGs inlined. It is faster than this, it never puts the token on a command line, and it checks things a human reading `curl` output will skip. Reach for `curl` when you need to vary a header the page does not vary, when you are testing a *deployed* Worker rather than a local one, or when you are reproducing something a real device did.

## Setting up

Everything hangs off one base URL. Fill in your own values — the token is in `.dev.vars` locally and in `wrangler secret` in production, and the stop IDs are whatever this sign points at.

```bash
export ORIGIN='http://localhost:8788'          # or the deployed https://<worker>.workers.dev
export DEVICE_TOKEN='<the DEVICE_TOKEN secret>'
export AGENCY='1'                              # King County Metro
export STOPS='<stopId>[,<stopId>]'             # one or two, bare IDs, no agency prefix

export BASE="$ORIGIN/token/$DEVICE_TOKEN/agency/$AGENCY/stop/$STOPS"
```

To avoid typing a real stop, the public downtown samples work against any deployment: `AGENCY=1` with `STOPS=600,430` is 3rd Ave & Virginia St / 3rd Ave & Pine St. See the sample-stop table in `CLAUDE.md` for the rest, including the light-rail pair.

Rather than exporting the token into your shell, you can source `.dev.vars` for a single command:

```bash
set -a && . ./.dev.vars && set +a && curl -s ".../token/$DEVICE_TOKEN/..."
```

## 1. `GET /api/setup` — enrollment

Takes no `Access-Token`, because the device has no key yet — enrollment is how it gets one. Only `/api/display` and `/api/log` check the header; see step 3 for why `/image` cannot.

```bash
curl -s -H 'ID: AA:BB:CC:DD:EE:FF' -H 'Model: x' -H 'FW-Version: 1.6.1' "$BASE/api/setup"
```

```json
{
  "status": 200,
  "api_key": "<64 hex characters>",
  "friendly_id": "<6 characters>",
  "image_url": "<ORIGIN>/token/<token>/agency/1/stop/<stops>/image/setup",
  "message": "Paired with the departures sign."
}
```

What to check, in rough order of how quietly it fails:

- **`status` is exactly `200`.** Anything else aborts pairing with nothing on the glass to explain it. This is the opposite of `/api/display` — see below.
- `friendly_id` is present. The firmware draws it on the setup screen, and it is how a person confirms the pairing worked.
- `image_url` starts with the same base URL the request used, byte for byte. The firmware's auth test is a raw `strncmp` against the stored base.

The key is derived from `DEVICE_TOKEN` rather than stored, so it is stable and calling this repeatedly is harmless. Capture it for the rest:

```bash
export KEY=$(curl -s "$BASE/api/setup" | jq -r .api_key)
```

## 2. `GET /api/display` — the workhorse

Called on whatever interval the previous response set. All the telemetry rides in request headers; the set below is representative rather than complete, since the firmware sends a different subset per board and per radio path.

```bash
curl -s \
  -H "Access-Token: $KEY" \
  -H 'ID: AA:BB:CC:DD:EE:FF' \
  -H 'Model: x' -H 'Width: 1872' -H 'Height: 1404' \
  -H 'FW-Version: 1.6.1' \
  -H 'Battery-Voltage: 4.05' -H 'RSSI: -55' \
  -H 'Image-Cached: false' -H 'Refresh-Rate: 60' \
  "$BASE/api/display"
```

```json
{
  "status": 0,
  "image_url": "<ORIGIN>/token/<token>/agency/1/stop/<stops>/image/departs-xxxxxx-<10-digit epoch>",
  "filename": "departs-xxxxxx-<10-digit epoch>",
  "refresh_rate": 60
}
```

What to check:

- **`status` is exactly `0`.** The firmware's dispatch handles only `0`, `202` and `500`; everything else hits `default: break;` and the whole response is discarded silently. `200` here — the obvious thing to write — means the device ignores your `image_url`, `filename` and `refresh_rate` completely.
- **`refresh_rate` is present and sane.** Absent parses as `0`, is written to NVS, and the device hot-loops with no sleep until the battery is flat, across power cycles.
- **`filename` ends in 10 ASCII digits** and is not exactly 31 characters long. Both are firmware parsing traps; see the filename rules in `CLAUDE.md`.
- The tag on the front of `filename` tells you which screen you got — `departs` for a board, then `noservc`, `obafail`, `rnderrs`, `badpath` and `layover` for everything else. Poll twice a minute apart and the filename should be *stable* unless the board actually changed.

Outside the active window the response is the overnight screen (`layover` tag) with a `refresh_rate` measured in hours. That is the easiest thing to test by moving `ACTIVE_START` / `ACTIVE_END` in `wrangler.toml` rather than by waiting.

## 3. `GET /image/<filename>` — the bytes

```bash
curl -s -D - -o board.png -H "Access-Token: $KEY" "$BASE/image/<the filename from step 2>"
file board.png
```

**The `Access-Token` is sent but not checked here, and that asymmetry is deliberate rather than an oversight.** The firmware applies auth headers to the image fetch on the `/api/display` path, but the *setup logo* download never applies them at all — so requiring the header would fail that download and replace the friendly-ID screen with an error at the exact moment someone is pairing the sign. Dropping `-H "Access-Token: ..."` from the command above still returns the image. The path token is the gate on this route.

Expect `Content-Type: image/png` exactly, a 200 with no redirect, and:

```
board.png: PNG image data, 1872 x 1404, 4-bit grayscale, non-interlaced
```

What to check:

- **`Content-Type: image/png`, with no charset parameter and no other casing.** The firmware picks its decode path by string-comparing that header rather than by sniffing magic bytes, so a perfect PNG served as `application/octet-stream` takes the BMP path, fails, and displays nothing with no error.
- **4-bit greyscale, non-indexed.** An indexed PNG at 1 bit renders every pixel black on this panel.
- **`Content-Length` under 750000**, the firmware's cap.
- **No redirect.** `curl -D -` shows a bare `HTTP/1.1 200` and nothing else; the firmware drops auth headers across a 307/308 and hard-fails a 302.

**Look at the image, not just the status line.** A textless render is a perfectly valid PNG of plausible size and passes every check above. That exact failure — a WOFF font silently rendering no glyphs — cost this project an afternoon once.

The requested filename is ignored by design: nothing is stored, so the handler rebuilds the current screen. `"$BASE/image/anything"` returns the same bytes. That is safe because the device only ever asks for a name it was just handed.

## 4. `POST /api/log` — diagnostics

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Access-Token: $KEY" -H 'Content-Type: application/json' \
  -d '{"logs":[{"logId":1,"creationTimestamp":1754000000,"logMessage":"test","sourceFile":"bl.cpp","sourceLine":123}]}' \
  "$BASE/api/log"
```

`204`, empty body. It answers `204` even for a malformed body, on purpose — a device that cannot file a diagnostic must not conclude the server is broken and start backing off. Entries land in `wrangler tail` live and in the `DEVICE_LOGS` dataset that `/stats` reads back.

## Testing the rejections

The gate is opaque before the token matches and helpful after it, so these are worth exercising too:

```bash
# Well-shaped path, bad token: fast 404, no delay. This is the pairing typo.
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' \
  "$ORIGIN/token/wrong/agency/$AGENCY/stop/$STOPS/api/display"

# Unshaped path: 404 after the tarpit, `TARPIT_MS` in `wrangler.toml`, 25s by default.
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 40 "$ORIGIN/wp-login.php"

# Answered immediately, specifically so neither is tarpitted.
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' "$ORIGIN/robots.txt"

# Valid token, malformed rest of the path: a real board naming the wrong segment.
curl -s -H "Access-Token: $KEY" \
  "$ORIGIN/token/$DEVICE_TOKEN/agency/$AGENCY/stop/a,b,c/api/display"
```

A missing or stale `Access-Token` on `/api/display` or `/api/log` is a `404` too, byte-identical to the others.

## Before pasting any of this anywhere

Three things in the output are not shareable, and two of them are easy to miss:

- **The token**, which is in every URL you typed and therefore in your shell history and in every `image_url` in a response body.
- **The `api_key`**, which is derived from the token. Leaking it does not hand over the token, but it is a working credential.
- **The stop IDs**, which imply a home address — in the URLs, in `image_url`, and printed on the rendered board itself.

A quick filter for the first one, which also catches it inside response bodies:

```bash
curl -s "$BASE/api/display" | sed "s|$DEVICE_TOKEN|<TOKEN>|g"
```

If you used a real token on a real deployment and it reached somewhere it should not have, rotate it with `npm run secret -- DEVICE_TOKEN` and re-pair the device by re-entering the base URL in the captive portal, which wipes the stored `api_key` and forces a clean enrollment.
