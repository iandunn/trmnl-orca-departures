# Source material

Reference material the design was built against. **Nothing here is loaded at runtime** — the images the Worker draws are pre-processed into data URIs in `src/assets/`, so this folder is a record rather than a dependency.

## `connectpoint-photos/`

Photographs and screenshots of King County Metro's real Connectpoint signs — the thing this display is imitating. `connectpoint-0407pm-blog.jpg` is the clearest and is the one the layout was matched against.

**Named by the clock in each sign's own header**, because that is what makes them evidence rather than decoration: every photo shows a real board at a known time, so every row on it is a data point about how Metro formats a departure. The `Now` / `N min` / clock-time thresholds in `src/oba/format.js` were measured off these rather than chosen.

`connectpoint-unidentified-*` are photos nobody has catalogued yet. The name says so deliberately — a plausible-looking filename on an uninspected photo is worse than an honest one.

## `metro-brand/`

The Metro lockup in both polarities, plus the brand standards PDF.

- `metro-logo-reversed-200x75.png` — the white artwork actually embedded in `src/assets/metro-logo.js`.
- `metro-logo-positive.svg` — the dark version, 450x216. Needed by any light-panel design; not yet converted. See `docs/TODO.md`.
- `metro-logo-seeklogo.svg` — the same logo, but 36 Inkscape/sodipodi references deep. Prefer the 2008 files.

Note the brand PDF's Verdana specification applies to stationery address blocks, **not** to the signage face.

## `onebudaway-logos/`

OneBusAway's logo. `onebusaway-vehicles-only.svg` is the one `src/assets/oba-mark.js` was derived from. The mark is no longer drawn on the sign; see `CLAUDE.md` for why it was kept in source anyway.

## `design-variants/`

Renders of designs that were considered and rejected, kept as a record of what was tried. **Filenames are verbatim from the spike** — `CLAUDE.md` cites several by number, so renaming them would break those references.

## `design-spike/`

The throwaway script that produced those renders. Kept because `CLAUDE.md` points at it, not because it still runs — the design has lived in `src/` since 2026-08-01 and is reproducible from there.
