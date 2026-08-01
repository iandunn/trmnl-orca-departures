# How it works

TRMNL devices normally talk to TRMNL's own servers. This project uses **BYOS** (Bring Your Own Server) instead: the device is pointed at a Worker that implements the three endpoints its firmware expects.

**There is no plugin here, and that is not an omission.** A TRMNL can get its image one of two ways, and they are mutually exclusive:

- **Hosted platform.** The device talks to `trmnl.app`, you configure *plugins* in their dashboard, and their servers render your data into an image. Plugins can be public or private — private ones are not a marketplace thing — but either way the rendering happens on their infrastructure.
- **BYOS, which is this.** The device talks to our Worker. It asks what image to show and how long to sleep; we answer. No dashboard, no playlist, no templates, no TRMNL account involved.

So there is nothing to convert into a plugin. Pointing the device's server URL at the Worker *is* how this loads.

BYOS was chosen because the hosted path cannot express the things this sign depends on: a content-hash `filename` (the whole flicker and error-screen design), a server-controlled `refresh_rate` (commute windows and overnight sleep), and keeping the stop out of anyone else's account. [initial-plan.md](initial-plan.md) records that comparison in full.

- `GET /api/setup` — first contact; issues the device an API key.
- `GET /api/display` — the workhorse. Returns the image URL, a cache-key filename, and the number of seconds to sleep before polling again.
- `POST /api/log` — device diagnostics. The only window into a device that renders nothing.

The image is a content hash away from freezing: the device caches by the `filename` field and skips the repaint entirely when it is unchanged. That is a feature — an unchanged render costs zero flicker — but it means an error screen must carry a filename distinct from the last good render, or it will never be shown.

Because e-paper holds its last image indefinitely with no power and no server, every render carries a visible "as of" timestamp. A sign that cannot reach the server keeps showing yesterday's departures otherwise, and no amount of server-side code can fix that from the other side of an outage.
