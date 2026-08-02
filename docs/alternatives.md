# Alternatives considered

Every option here works, and several are less code than what this repo does. They were rejected for reasons specific to *this* sign, not because they are bad — so the reasoning is written down rather than left to be rediscovered.

One thread runs through all of it. The stated top risk of this design is that **an unreachable server leaves stale departures on the glass, and no server-side code can fix that** — a server that is down cannot send an error screen. E-paper holds its last image with no power and no network, so a frozen sign looks exactly like a working one. Every trade below is scored against that first.

## The three ways a TRMNL can get its image

Not two. The first branch is well known; the second is the one that gets missed.

1. **The hosted platform.** The device talks to `trmnl.app`, you configure plugins in their dashboard, and their servers render your data.

2. **BYOS, running [Terminus](https://github.com/usetrmnl/terminus)** — the official reference server, self-hosted.

3. **BYOS, running your own server.** This repo.

2 and 3 are the same contract to the device: the same three endpoints, the same `filename` cache key, the same `refresh_rate`. They differ entirely in what has to be running for the sign to work.

## Running Terminus instead of this Worker

Verified against the Terminus repository on 2026-08-01, not assumed.

**What it would give us, and it is a lot.** Playlists, a device dashboard, a log viewer, firmware OTA hosting, auto-provisioning and sensors — all built, all maintained by the people who make the device. `doc/extensions.adoc` marks both **Import (Core)** and **Recipes** as supported, so the entire plugin and recipe ecosystem comes across natively: no proxying, no re-rendering, no `access-token` juggling. If the goal were a general-purpose TRMNL that shows several things, this would be the obvious answer and this repo would be reinventing it badly.

It also gets the hard part right. Terminus derives `filename` from a content hash (`<name>-<md5>.png`, `app/structs/screen.rb`) and deliberately pins a constant filename for its error screen — the same mechanism this project's whole flicker and error design hangs off. That is where the contract was confirmed from in the first place.

**What it would cost.**

- **It cannot be serverless.** The `Gemfile` requires PostgreSQL, Valkey, Sidekiq, Puma, ImageMagick, and `ferrum` — which needs a real Chromium binary. That means a home server, a Pi, or a VPS. See [the Pi section](#a-raspberry-pi-or-a-vps) for why that is the decisive loss.

- **Screens are pre-built on a cron.** `app/aspects/screens/rotator.rb` hands back an existing `item.screen` rather than rendering on request, so freshness becomes build schedule ∩ poll schedule. On a departures board that is a second staleness window layered on top of the one already being defended against.

- **It is either/or.** One device, one base URL. Terminus is not something to run alongside this; it replaces it.

**Its resolution handling is fine, and an earlier draft of this doc claimed otherwise.** Terminus defines the X as `width: 1872, height: 1404, scale_factor: 1.8` and passes the ratio to the renderer as `--pixel-ratio`. Authoring in CSS pixels at 1872 ÷ 1.8 = 1040 wide is not drawing small and scaling up — it is the same deviceScaleFactor mechanism a retina display uses, and Chromium rasterizes text and vectors at the full 1872x1404. The only exposure is a plugin author supplying 1x raster assets, which is theirs rather than Terminus's. Recorded because the mistake is an easy one to make twice.

**Why it lost.** The trade is the whole shape of the project, not a feature toggle, and it fails on the axis this design cares most about: a box in a closet is the component most likely to die quietly. Everything Terminus adds is worth having on a device that shows several things and is tended to. This one shows departures, hangs on a wall, and has to keep being right when nobody is looking at it.

**The middle path is real, though.** Keep this Worker as the sign and pull plugin *data* from `trmnl.com` through the Private API, rendering it ourselves. That brings the ecosystem in without giving up serverless or the render. It is tracked in `TODO.md`.

## A hosted TRMNL plugin

TRMNL's cloud does the rendering; the Worker survives as a JSON endpoint only. This is not hypothetical — [`blueset/trmnl-recipes/transit`](https://github.com/blueset/trmnl-recipes/tree/master/transit) is a shipped Puget Sound OneBusAway board built exactly this way, and several of its decisions were adopted here.

It removes any CPU question entirely, since we stop rendering. It costs four things, and all four are load-bearing:

- **`filename`.** The content-hash cache key is the only flicker defense on the X, and the mechanism every error screen depends on. A hosted plugin cannot reach it.

- **`refresh_rate` scheduling.** The active window and the overnight sleep go with it. That is the entire battery budget.

- **Distinct-filename error screens.** Without them a degraded state is silently suppressed by the device's own cache — the panel keeps showing stale departures while the server serves perfectly correct JSON.

- **The stop's privacy.** The stop ID lives in device NVS precisely so it is never written down anywhere. Plugin settings live on someone else's account.

## A Raspberry Pi or a VPS

No CPU ceiling at all, no platform limits to design around, and it is what Terminus requires. The original objection — that it puts the server on the wrong network — turned out to be wrong, since the sign and the rack are on the same network anyway.

The real cost is different and worse. It is a box to maintain, and a sign that goes down whenever the home network, the power, or the box does. Against a design whose primary unfixable failure is "the server is unreachable and the glass is lying," adding a physical dependency in a closet is the wrong direction. A Worker has no host to patch, no disk to fill, and no UPS to forget about.

## GitHub or GitLab Pages

**Start with what Pages genuinely can do, because it is more than it looks.** A `404.html` catches every unmatched path, so arbitrary token-and-stop URLs need no file generated per path — that is real routing, and it is how single-page apps live on Pages. The device also barely inspects the HTTP status line, reading `status` from the JSON body instead, so a static file returning HTTP 404 with a JSON body would very likely parse.

**None of that helps, because routing was never the blocker.** Two things kill it:

- **The half of the `404.html` trick that does the work is client-side JavaScript**, reacting to `location.pathname`. The device is not a browser and has no JS engine. It performs one HTTP GET and parses the bytes.

- **The response is byte-identical for every request**, since a static host serves a static file. A fixed `refresh_rate` is survivable — it costs the overnight sleep, which is the whole battery budget. A fixed `filename` is not: the device caches on it and skips the repaint, so the panel freezes permanently while the server keeps answering correctly. The board has to be computed per request from live predictions and the current time, and that is the one thing a static host cannot do by definition.

The way out is to regenerate on a schedule so the content hash moves, which is the hybrid worth naming: the Worker serves the JSON and Pages hosts the PNG bytes. Structurally possible, since cross-host images need no auth, only public fetchability. Two things kill that too. GitHub Actions cron has a **5-minute floor** and habitually slips 10–30 minutes, which makes the countdown row actively wrong, and that row is the signature element of the design. And unlimited Actions minutes require a **public repo**, which publishes the stop ID — roughly, where the sign's owner lives.

## Withdrawn when the CPU number turned out to be stale

For two sessions the design was distorted by the claim that Workers Free allows 10 ms of CPU per invocation. Measured against the real account, the ceiling is **~1000 ms** and one full render costs **~58 ms** — about 17x headroom. Everything below was solving a problem that did not exist, and is recorded only so it is not proposed again:

- **Workers Paid at $5/mo.** Nothing to buy.

- **Rendering off Cloudflare** on Vercel Hobby, Deno Deploy or similar. Two deployables and two failure domains, for no gain.

- **A hand-rolled glyph blitter** instead of resvg. At 2.6 M pixels it was never clearly cheaper, and it costs antialiasing and hand-written text layout.

- **Slicing the render across subrequests** in bands, each with its own budget. Genuinely clever, genuinely fragile.

- **Dropping back to the TRMNL OG.** Costs the resolution, the greyscale depth, and the battery.

Antialiasing stays on, and the render stays at native resolution, for the same reason: there is no budget to concede to.

## What the chosen approach costs

Listed here so this reads as a comparison rather than a defence. None of these were free:

- **There is no dashboard, no playlist and no plugin ecosystem**, and there is not going to be one. Terminus has all three. Adding a second thing for this sign to show means writing it.

- **We own the renderer.** Fonts, PNG encoding, quantisation and layout are all hand-built here, and every firmware trap that fails silently is ours to have found. Terminus would have supplied all of it.

- **Cloudflare is still a third party that can go down**, so "serverless" removes a box in a closet without removing the unreachable-server failure. It makes it rarer and someone else's to fix; it does not make the "Updated at" stamp optional. Nothing does.

- **Platform limits are a permanent design input.** They are not binding today — a render is ~58 ms against ~1000 ms — but the ceiling exists, and a Pi's would not.

The trade taken is fewer features and more of our own code, in exchange for nothing to maintain and nothing to power. On a single-purpose sign that has to stay right while unattended, that is the right side of it.
