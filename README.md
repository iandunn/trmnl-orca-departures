# TRMNL X Orca Departures

An e-paper sign showing live [King County Metro](https://kingcounty.gov/en/dept/metro) and [Sound Transit](https://soundtransit.org/) departures for a one or two stops, styled after Metro's real [Connectpoint](https://www.connectpointinc.com/) stop signs.

A [TRMNL X](https://trmnl.com/) device wakes on an interval and polls a [Cloudflare Worker](https://www.cloudflare.com/products/workers/). The Worker fetches predictions from [OneBusAway](https://pugetsound.onebusaway.org/), renders a `1872x1404` greyscale PNG, and serves it back. All the scheduling and rendering logic lives on the server; the device only displays what it is handed.

It runs entirely serverless on a free Cloudflare Worker. Nothing runs on your home network and nothing runs on your computer — no Pi, no NAS, no always-on box, no container, no port forwarding, and no laptop that has to stay awake for the sign on the wall to keep working. A full render costs about 58 ms of CPU against a ~1000 ms per-invocation ceiling, so [ the free plan](https://developers.cloudflare.com/workers/platform/pricing/) is not a starting tier to grow out of; it is the whole hosting story.

![Bus board: a King County Metro Departures header with the date and time, then eight departures split into a northbound group for 3rd Ave & Virginia St and a southbound group for 3rd Ave & Pine St, each row with a route badge, destination, and countdown or clock time](assets/bus.png)

![Light rail board: a Sound Transit Link Light Rail header, then eight departures split into northbound and southbound groups for Int'l District/Chinatown, with circular 1 Line and 2 Line badges](assets/light-rail.png)


## Documentation

- **[How it works](docs/how-it-works.md)** — why BYOS rather than a plugin or the reference server, the three endpoints, and the two design constraints everything else follows from: the content-hash `filename` and the "Updated at" timestamp.
- **[Alternatives considered](docs/alternatives.md)** — the pros and cons of running Terminus, a hosted plugin, a Raspberry Pi, or GitHub Pages instead, and why each lost for this particular sign.
- **[Deploying](docs/deploying.md)** — running your own sign: OneBusAway key, finding your stop IDs, your own Cloudflare Worker, pairing the device, and every configuration value.
- **[Development](docs/development.md)** — working on the code: local dev, the design preview, what lives where, and the firmware traps that fail silently.
- **[Manual testing](docs/manual-testing.md)** — driving the device's four requests by hand with `curl`, and what to check in each response.


## Not affiliated with any of the organizations it mentions

This is an independent personal project. It is **not** affiliated with, endorsed by, sponsored by, or in any way connected to King County Metro, Sound Transit, Connectpoint, OneBusAway, TRMNL, or Cloudflare. Nothing here is an official product of any transit agency or vendor.

All trademarks, logos and brand marks belong to their respective owners. Agency artwork appears here only to identify the services being displayed and to imitate the look of a real stop sign — not to suggest either agency produced or approved this.

Departure times come from OneBusAway's public API and are provided as-is. They can be wrong, stale, or missing, and this sign adds its own failure modes on top.


## License

GPL v2 or later.
