# How it works

TRMNL devices normally talk to TRMNL's own servers. This project uses **BYOS** (Bring Your Own Server) instead: the device is pointed at a CloudFlare Worker that implements the three endpoints TRMNL's firmware expects.

**There is no plugin here, and that is not an omission.** A TRMNL can get its image one of two ways, and they are mutually exclusive:

- **Hosted platform.** The device talks to `trmnl.app`, you configure *plugins* in their dashboard, and their servers render your data into an image. Plugins can be public or private — private ones are not a marketplace thing — but either way the rendering happens on their infrastructure.
- **BYOS, which is this.** The device talks to our Worker. It asks what image to show and how long to sleep; we answer. No dashboard, no playlist, no templates, no TRMNL account involved.

So there is nothing to convert into a plugin. Pointing the device's server URL at the Worker *is* how this loads.

BYOS was chosen because the hosted path cannot express the things this sign depends on: a content-hash `filename` (the whole flicker and error-screen design), a server-controlled `refresh_rate` (commute windows and overnight sleep), and keeping the stop out of anyone else's account. [initial-plan.md](initial-plan.md) records that comparison in full.

- `GET /api/setup` — first contact; issues the device an API key.
- `GET /api/display` — the workhorse. Returns the image URL, a cache-key filename, and the number of seconds to sleep before polling again.
- `POST /api/log` — device diagnostics. The only window into a device that renders nothing.

The image is a content hash away from freezing: the device caches by the `filename` field and skips the repaint entirely when it is unchanged. That is a feature — an unchanged render costs zero flicker — but it means an error screen must carry a filename distinct from the last good render, or it will never be shown.

Because e-paper holds its last image indefinitely with no power and no server, every render carries a visible "Updated at" timestamp. A sign that cannot reach the server keeps showing yesterday's departures otherwise, and no amount of server-side code can fix that from the other side of an outage.

## Getting in, and staying out

`/api/setup` is unauthenticated by design — that is how a device enrolls — so a shared secret rides in the URL path instead, and the stop rides with it. That keeps both out of this repository entirely: they live only in the device's own memory.

Because the URL is the credential, the Worker treats path shape as the dividing line. Anything that is not even shaped like the sign's URL is a scanner, and gets held for 25 seconds before its 404. Anything well-shaped but wrong is answered immediately — that case is a typo made while pairing, and a device that hangs for 25 seconds looks identical to a server that is down.

Past the token check the posture inverts: a caller holding the secret is the owner, so a bad stop ID gets told what is wrong rather than a blank 404.

## Knowing whether it works

An e-paper sign fails quietly. It holds its last image with no power and no network, so "working" and "frozen three days ago" look the same from across the room.

Two things address that, and they are different in kind. The **"Updated at" timestamp** is rendered into the image, so it survives the server being unreachable — it is the only defense that works when the thing that failed is the server itself. The **`/stats` page** covers everything the server *can* see: whether the panel is actually repainting, how the battery is holding up, whether a stop is misconfigured, and whether anyone other than the owner has been using the URL. See [deploying.md](deploying.md#monitoring-the-sign).
