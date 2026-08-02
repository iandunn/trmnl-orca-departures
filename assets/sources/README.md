# Source material

Reference material the design was built against. **Nothing here is loaded at runtime** — the images the Worker draws are pre-processed into data URIs in `src/assets/`, so this folder is a record rather than a dependency. It is in eslint's ignore list for the same reason.

None of this artwork is ours. See the note on affiliation in the [top-level README](../../README.md).

## `connectpoint-photos/`

Photographs and screenshots of King County Metro's real Connectpoint signs — the thing this display is imitating. `connectpoint-0407pm-blog.jpg` is the clearest and is the one the layout was matched against.

**Named by the clock in each sign's own header**, because that is what makes them evidence rather than decoration: every photo shows a real board at a known time, so every row on it is a data point about how Metro formats a departure. The `Now` / `N min` / clock-time thresholds in `src/oba/format.js` were measured off these rather than chosen.

`connectpoint-unidentified-*` are photos nobody has catalogued yet. The name says so deliberately — a plausible-looking filename on an uninspected photo is worse than an honest one.

`link-signpost.png` is the odd one out: a Sound Transit **Link** station signpost, not a Connectpoint sign, so it carries no departure rows and no clock. It is here as the reference for how Link brands itself — the tram glyph in a rounded outline over the word `Link` — which is what `tramGlyph()` was drawn from and what the "use the Sound Transit logo at a rail stop" item in `docs/TODO.md` would need.

## `design-variants/`

Renders of designs that were considered and rejected, `variant-1` through `variant-15`, kept as a record of what was tried. **`CLAUDE.md` cites several by number**, so renaming them breaks those references.

The script that generated them is gone. They are output, not a reproducible build — the design has lived in `src/` since 2026-08-01 and is reproducible from there, so anything still worth having should be re-rendered from `/_preview` rather than regenerated from here.

## `metro-brand/`

The Metro lockup in both polarities, as raster and vector.

- `metro-logo-reversed-200x75.png` — the white artwork actually embedded in `src/assets/metro-logo.js`. This is the only file here the sign depends on, indirectly.
- `metro-logo-reversed.svg` — the same reversed lockup as vector, 450x216, every fill `#FFFFFF`.
- `metro-logo-1280.png` — the **positive** lockup, 1280x458, dark marks on transparent. This is what any light-panel design needs, and being a PNG it can be embedded as a data URI directly, the way `metro-logo.js` already handles the reversed one — no SVG re-framing step.
- `metro-logo-seeklogo.svg` — the positive lockup as vector, `#231f20` rather than true black, and 38 Inkscape/sodipodi references deep. Only worth the cleanup if a light design needs to scale it past what the 1280px raster gives.

The brand standards PDF is **not** kept here. One thing from it worth remembering: the Verdana it specifies applies to stationery address blocks, **not** to the signage face — the face on the real signs is a Connectpoint choice and is still unidentified.

## `one-bus-away-logos/`

OneBusAway's logo, all four as published.

- `onebusaway-vehicles-only.svg` — just the three vehicles, no backing plate. The one `src/assets/oba-mark.js` was derived from, because the artwork's own plate is square while the vehicles are far wider than tall.
- `onebusaway-logo.svg` — the full mark, vehicles on their green plate.
- `onebusaway-logo-full-bleed.svg` — the same with the plate run to the edges.
- `onebusaway-app-icon.png` — 512x512 raster.

The mark is no longer drawn on the sign; see `CLAUDE.md` for why the derived asset was kept in source anyway, and for the two-step recolour it needs, which is the part that would be expensive to work out a second time.
