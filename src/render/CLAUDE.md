# The board design — `src/render/`

Loaded when working under `src/render/`. Split out of the root `CLAUDE.md` on 2026-08-02; the root file keeps the privacy rule about the real stop and the `assets/*.png` regeneration convention, because both apply outside this directory.

## Sample stops for mockups — downtown Seattle, never the real one

All verified live against OneBusAway. **Never use the stop this sign actually points at** — these exist so no render or committed image can leak it.

| Pair | Stops | Name | Directions | Notes |
| --- | --- | --- | --- | --- |
| **Bus, default** | `1_600` / `1_430` | 3rd Ave & Virginia St / 3rd Ave & Pine St | `NW` / `SE` | **Not a matched pair** — two stops 313 m apart, chosen independently. The standard sample; see below for why. |
| Bus, matched pair | `1_590` / `1_430` | 3rd Ave & Pine St | `NW` / `SE` | 16 and 13 routes. The former default, kept for the two-sides-of-one-street case. |
| Bus, denser | `1_600` / `1_420` | 3rd Ave & Virginia St | `NW` / `SE` | 21 routes each, all four RapidRide lines on both sides. Use when the layout needs stressing. |
| **Light rail** | `40_621` / `40_623` | Int'l District/Chinatown | `N` / `S` | 1 Line and 2 Line. |
| Light rail, alt | `40_1121` / `40_1108` | Westlake | `NE` / `SW` | Same two lines; ID/Chinatown is preferred. |

**The default bus sample is deliberately two unrelated stops, decided 2026-08-01.** 3rd Ave interleaves two stop zones — the "south end" routes (`7`, `13`-downtown-only, `14`, `36`, `4`, `70`) call at Pine, Union, Marion and James, while the West Seattle and south-county routes (`H`, `C`, `21`, `125`, `124`, `131`, `132`) call at Pike, Seneca and Columbia. Verified against `stops-for-route` for all of them: **the `7` signed for Rainier Beach shares no stop anywhere in the system with `125`, `C`, or `H` signed for Burien**, and the `D` to Ballard overlaps it only at `1_515`, which has no same-named counterpart. So no matched pair can show both a southbound `7` → Rainier Beach and a northbound `D` → Ballard, and picking the two stops independently is the only way to demo both.

That is a real configuration rather than a cheat: `/token/<token>/agency/1/stop/1_600,1_430` is two arbitrary stop IDs under one agency, which the URL shape already allows, and a sign serves whichever stops its owner actually walks to.

**International District is the right rail sample, not Westlake.** It is where the two lines diverge, and northbound *both* lines show the identical destination "Lynnwood City Center" — so the line number is the only thing separating those rows. Any badge design has to survive that. Southbound splits properly: `1 Line` → Federal Way Downtown, `2 Line` → Downtown Redmond.

**Bus stops and rail stops never mix.** Light rail has its own platforms, so a board is one mode or the other and the two badge styles never appear together. The renderer still has to handle both.

Use real route numbers and headsigns in mockups. Invented ones hide width problems — `570` and `131` are wider than the `40` early renders were tuned against, and real headsigns are far longer than anything invented.

**Fixtures keep the raw headsign; the renderer shortens it.** `collapseRepeatedPhrases()` in `src/headsign.js` drops one copy of a back-to-back repeat, so `Mount Baker Mount Baker Transit Center` draws as `Mount Baker Transit Center`. Metro concatenates destination with via-point and no separator, so the stutter is what OneBusAway actually returns — pre-shortening it in a fixture would hide the problem rather than solve it, which is what an earlier sample did.

**Badges come from the API too, and `D Line` does not fit a 152px box.** `routeBadge()` in `src/route-badge.js` strips ` Line` when a single character precedes it — 13 routes region-wide, and they are the ones a Seattle sign is most likely to show: all eight RapidRide lines, both Link lines, Tacoma Link's `T Line` and both Sounder lines. None of those has a route number; the letter *is* the designation, and both agencies print it that way, so this matches their signage rather than inventing an abbreviation.

**The badge slot holds an official designation or nothing** — a number, a number with an express suffix like Intercity Transit's `9X`, or a single letter. **Fitting is necessary but not sufficient**: `STCL` and `TA034` are short enough to draw and still do not belong there, because they read as internal codes rather than as the route a rider asks for. A route that fails the test gets a **blank slot**, and its name moves to the head of the destination instead — `Swift Blue: Shoreline North/185th Station`, `STCL: Stream TDS / Spanaway TC`, via `destinationWithRoute()`. The row is the only place with horizontal room, and the alternative was a row saying where a vehicle goes without saying which vehicle. A colon rather than a middle dot or em dash, so it survives font subsetting.

The rejected alternatives, since each looks reasonable until measured: a font-size ladder reaches about five characters and does nothing for a thirty-character name; widening the badge breaks the fixed destination column that keeps rows aligned across modes; and initials would invent signage nobody prints, with three Sound Transit routes all named `Shuttle` colliding anyway.

**The destination shrinks to fit rather than running into the time column, and the whole board shrinks together.** `destinationSize()` in `render/board.js` caps the type at the row's own scale and steps it down when the longest string on the board is too long for the space between the badge slot and the time. **Per board, not per row** — fitting each row independently puts two type sizes in one column, and that reads as a rendering fault rather than as a fit. The cost is that a short destination is drawn smaller because a different row is long. The failure it fixes is counter-intuitive and was invisible for a long time: `rowMetrics()` clamps rather than stretches, so a board with **two** departures draws them at full size and the region's longest headsign — `Pioneer Square Chinatown International District Waterfront` — ran straight through `4:47 pm`, while the same string on an eight-row board fitted comfortably. The overlap appeared when the sign had least on it.

Nothing here can measure a string — resvg does the shaping and the font is only loaded in `render/index.js` — so the fit uses an average advance per character, calibrated against a render of that longest headsign at 0.46 and rounded up to 0.5 for slack. That is an estimate and is documented as one; it costs a slightly smaller size on the few rows that need shrinking and protects against wider letterforms than the string it was measured on.

**A route with no short name at all falls back to its long name, but only when that is a service name.** 39 routes have no `shortName` — every Washington State Ferries route, and Amtrak Cascades. The split in `longName` is exact and worth knowing: Amtrak's is `Amtrak Cascades`, a service, so the row reads `Amtrak Cascades: Portland`; all 38 ferry routes are endpoint pairs like `Bainbridge Island - Seattle`, and prefixing one would produce `Bainbridge Island - Seattle: To Seattle`, restating the destination to say nothing. So a ferry row is a blank slot and a bare destination, which is accepted — a ferry has no route number, and `To Seattle` is verbatim what OneBusAway returns for that direction.

Drawing the plate for a nameless route would put a black block where a number belongs, which reads as a rendering fault; the destination column is a fixed x, so a blank slot keeps every row aligned.

**The awkward cases are all rendered side by side at `/_preview`**, built by `src/dev/edge-case-boards.js` — badge overflow in both bus and rail, the headsigns that must and must not collapse, the longest stop name, a stop with no compass bearing, and a sparse board at the row-height ceiling. Real names throughout; the co-location is synthetic and each group says so on itself.

**The rule is adjacency, never word frequency, and that distinction is the whole design.** `Seattle Pacific University Seattle Center W` and `Rainier Beach Via Rainier Ave S` each repeat a word while naming two different places; collapsing either would destroy the destination rather than shorten it. Only an immediate repeat is a stutter. `src/headsign.test.js` pins every one of those live headsigns as unchanged, which is the regression guard for anything cleverer added later.

Two reasons this is the standing choice, and both matter:

- They are **busy public downtown stops that reveal nothing** — the opposite of the stop this sign actually points at, which must never appear in a tracked file or a committed image.
- They are genuinely **two stops on one board**, which is exactly the case the layout has to solve. A single-stop sample would hide the problem.

Real routes there: northbound `H Line, 5, 17, 21, 24, 27, 28, 33, 40, 56, 57, 62, 124, 131, 132, 570`; southbound `1, 2, 3, 4, 7, 13, 14, 17, 36, 40, 62, 70, 570`.

## Two stops on one board — the layout, variant 9

`assets/sources/design-variants/variant-9-two-stops.png`. The groups are separated by a **light grey band** holding the direction, the stop name and the stop code. Four departures per direction, accepted 2026-08-01 after comparing against three — three left a visible dead band above the footer rule, and four fills the panel without the rows reading as cramped. The band is our invention — Metro's signs serve one stop, so they have no equivalent.

**The stop name lives in the band, on every group, always — revised 2026-08-01.** It was in the footer once, which assumed a board is one street in both directions. That assumption does not hold: the two stops may be blocks apart and chosen independently, and even a true across-the-street pair can carry different names when the cross streets differ. So each band names its own stop, and a board whose groups happen to name the same one says it twice. The repetition is the point — the band is the single place a reader ever looks for the stop, rather than a place the name moves to depending on data the reader cannot see. The footer is now the "Updated at" stamp alone.

Direction and name share one baseline through a `<tspan dx>` rather than a second `<text>` at a fixed x, because the name has to begin wherever the direction ends and text width is not knowable in `render/board.js` — the font is only loaded in `render/index.js`. **Spaces do not work for the gap**: SVG collapses runs of whitespace, so `"St   Stop No."` renders as `"St Stop No."` and the two read as one phrase. Verified by looking at the render, not by trusting a 200.

**Row height is derived, not a constant — added 2026-08-01 when four rows landed.** `rowMetrics()` in `render/board.js` divides the space between the header and the footer rule by however many departures the board carries, and every size inside a row scales by that one factor. Three things about it are deliberate:

- **It clamps to a 158px ceiling rather than stretching to fill.** A sparse board — one direction, or a stop with two departures left in the day — would otherwise stretch its rows across the whole panel. The accepted eight-row board comes in at 128 and is genuinely scaled; a two-row board hits the ceiling and is not.
- **Horizontal metrics never scale.** Width is not the constraint, and holding the 152px badge slot fixed is what keeps the destination column in the same place across bus, rail, and any density.
- **The clamp reserves a 12px gutter above the footer rule.** Without it the densest board that fits lands its bottom edge exactly on the rule and `pm` descenders come within a few pixels of crossing — fitting by arithmetic coincidence, and a later pixel shaved off the header would push them through with every test still passing.

Row count still is **not** configuration. It follows from how many departures the data has, bounded by what fits.

**Direction wording — decided 2026-08-01. Spell the bearing out, and allow a per-stop override.**

OneBusAway reports a compass bearing (`N`, `NE`, `NW`, …), never a word. The default is to spell it out and append "bound": `N` → **"Northbound"**, `NW` → **"Northwest bound"**. That is correct for every stop in the county with no lookup table, which is the property that matters — the sign has to work for a stop nobody has configured.

**The four cardinals close up; the diagonals stay spaced.** Revised 2026-08-01, after the first pass emitted "North bound" for every cardinal. "Northbound" is the word, and it is what Metro prints, while "Northwestbound" is not a word anyone writes. This is a spelling rule, not a semantic one, and the payoff is that a plain north-south stop needs **no override at all** — which is what an override map should look like. `COMPASS_WORDS` in `render/board.js` now holds the full label per bearing rather than a stem plus a suffix.

A small `DIRECTION_OVERRIDES` map, keyed by full OBA stop ID, replaces the label where the **bearing itself misleads** — 3rd Ave runs diagonally, so its stops report `NW`/`SE` while every rider and every Metro timetable says northbound (`1_600` → "Northbound"). Intended for a handful of personal stops. **Never a county-wide table** — that would defeat the point of deriving it.

The deployment's map lives with the secrets, never in `[vars]`; the sample boards carry their own public one in `src/dev/sample-boards.js`. See `docs/deploying.md`.

Collapsing `NW` to "Northbound" was considered and rejected: whether north or west dominates depends on the street's orientation, which the API does not give us, so it would be confidently wrong on some stops. Being verbose and right beats being idiomatic and sometimes wrong.

## The layout follows Metro's real Connectpoint sign — variant 8 is the reference

Decided 2026-08-01 against photographs of the real signs, kept in `assets/sources/connectpoint-photos/`. The `connectpoint-0407pm-blog.jpg` photo is the clearest and is the one being matched; `assets/sources/design-variants/variant-8-metro-blog.png` is our render of it.

**Kept from the official sign:**

- Black header bar: reversed King County Metro logo, then **Departures**, then the day and date stacked small, then the clock with a smaller heavier meridiem.
- **Route badge** as a filled rounded rect with a white numeral, destination in bold beside it.
- **The right column stacks three lines**: `Scheduled` (only when it applies) over the value over the unit. This is Metro's own answer to the real-time question and it is better than any pill or colour treatment — it needs no legend and costs no contrast.
- **Format follows time distance, not data source**: `Now` for imminent, minutes for near, clock time for far. A scheduled departure two minutes out still shows "2 min" on the real sign.
- Thin rules between rows, footer rule, stop number and cross-streets in the footer.
- **Small text is set heavier than the numerals.** `min`, `pm` and the meridiem all carry more weight than their size suggests, which is what keeps them legible at distance.

**Deliberately not kept:**

- **`connectpoint` branding.** It was replaced by the OneBusAway mark for a while; the footer now credits nobody. See the asset note below — the mark is still in source, just not drawn.
- **Their two-column grid**, which is a 16:9 strip showing four departures with no destinations. We are 4:3 with room for eight rows *and* destinations.
- **The comma after the weekday.**
- **Their service-alert block.** Not needed now; see the TODO.

**Added because our sign can fail in ways theirs cannot:**

- **The "Updated at" stamp**, bottom left, starting at the left margin now that no logo sits beside it. Metro's signs are wired, monitored and replaced when broken. Ours can freeze silently, so this is the only thing that makes a stale panel self-evident. The wording is deliberate: "Updated at 4:22 pm" states what happened, where the earlier "as of 4:22 pm" read as a hedge.
- The stacked **day and date** in the header does double duty here — it is Metro's, but for us it is also the cue that catches a panel frozen since yesterday.

## The rail header is Sound Transit's own logo — 2026-08-02

**A rail board draws the official reversed lockup where a bus board draws Metro's, and neither says its mode.** It used to set the agency name and `LINK LIGHT RAIL` as two lines of type. The word was a stand-in for artwork we did not have; now we have it, and the bus board was already logo-plus-`Departures` and nothing else.

**Sized by cap height, not by block height.** Their horizontal lockup is 6.58:1 against Metro's 2.67:1 — one line of type against two — so matching Metro's 62px block would set the wordmark half again as tall as `Departures` and let the operator shout over the word the sign is for. At 46px tall the two wordmarks read at the same size, which is what the headers were compared side by side to settle.

**One deliberate divergence from their standards**, and only one: clear space is specified as the height of the `S` in the mark, which a 102px header bar cannot give above and below at any usable size. Everything else is followed — their own white artwork on a dark field, unaltered proportions, symbol and typography never separated.

**The logo is gated on the agency, never on the mode.** `boardMode()` answers "is every departing route rail", which the Seattle Streetcar and the Monorail also are, and Sounder is Sound Transit while its stations are not Link. A logo is a claim about who runs the service, so it may only be drawn where the name would have said the same thing; anything else gets `textLockup()` and its own name.

**That gate is only as honest as the name behind it, and the name was not.** `agencyName()` returned the first entry of `references.agencies`, which is not the operator — the *Metro* stop `1_600` lists Sound Transit first. It now reads the agency off the routes actually departing, and falls back to the agency whose stop was requested. Position one happened to be right on the rail fixtures, which is exactly why this was worth fixing before a wrong word became a wrong picture.

**Asset notes.** The reversed (white) Metro logo comes from `cdn.kingcounty.gov/-/media/king-county/depts/metro/logo-art/metro/metro-logo-reversed-200x75` and is embedded as a base64 PNG in an `<image>` element. Brand rules are at `projects.seattletransitmap.com/library/King County Metro/Graphic Standards/7.0.2-p-Logo.pdf` — note that the Verdana it specifies applies to stationery address blocks, **not** to the signage face.

The Sound Transit lockup comes from the official `web-brand-logo-horizontal-rgb-png.zip` at `soundtransit.org/get-to-know-us/our-brand/logos`, which ships black, blue and white versions; all three are kept in `assets/sources/sound-transit/` and the **white** one is what their guidelines call for on a dark field. `src/assets/sound-transit-logo.js` is that file recoded from RGBA to greyscale-plus-alpha, which halves the bytes and loses nothing a greyscale panel could have shown. Natural size 1218x185, already its own bounding box — no padding to trim, and no re-framing or recolouring of the kind the OneBusAway mark needed. **Resizing it smaller makes the file bigger**, because the artwork's alpha is nearly binary and resampling fills it with intermediate values; keep it at natural size and let resvg scale it down.

**The OneBusAway mark is no longer drawn, decided 2026-08-01.** The footer is now just the "Updated at" stamp and the stop name, and the stamp starts at the left margin instead of clearing a logo. `obaMark()` and the pre-cleaned assets stay in `src/render/board.js` and `src/assets/` — putting the mark back is a one-line change, and the notes below are why re-deriving it would not be. Keep them.

**The OneBusAway mark needs three fixes, not one.** Draw the backing plate ourselves rather than using the artwork's: the source plate is square while the vehicles inside it are far wider than tall, so a square wastes height and crowds the sides. Use `assets/sources/one-bus-away-logos/onebusaway-vehicles-only.svg`, size the plate to the artwork's ~566:348 ratio, and pad the sides more than the top and bottom.

Recolouring needs a **two-step swap through a sentinel**. The bodies are `#000000` and the windows `#ffffff`; replacing black→white and then white→dark runs the first result through the second and flattens both to one colour. Bodies must end white and windows dark, or the windows dissolve into the body.

**The OneBusAway mark must be recoloured for greyscale.** Its brand green quantizes to a mid grey and the vehicles on it are black, which collapses into a smudge at footer size. Swap the square to black and the vehicles to white — same silhouette, full contrast. The source SVGs are Inkscape files; stripping the outer `<svg>` to re-frame them also strips the namespace declarations, and resvg rejects the whole document over an undeclared `inkscape:` prefix rather than ignoring it, so those attributes have to be removed too.

**Typeface: Fira Sans**, chosen 2026-08-01. The real sign's face is a Connectpoint choice and is not in Metro's brand standards, but its **open-top `4`** places it in the humanist-signage family that Frutiger and Myriad belong to. Both are commercial; of six open candidates compared at native resolution against the blog photo, **Fira Sans is the only one that opens the 4** — Inter, Source Sans 3, Public Sans, Archivo and Mulish all close it.

Judge glyph shapes at a large size. An earlier pass called Source Sans 3 open from a row-sized specimen and was wrong; the aperture is a few pixels at 76px. `variant-10-fonts` now sets a 150px `4` for exactly this reason.

## Real-time vs scheduled — the per-row treatment, decided 2026-08-01

Five variants were rendered at native 1872x1404 and compared as images rather than described. All are kept in `assets/sources/design-variants/variant-*.png`. The script that generated them is gone — they are a record of what was tried, not a reproducible build; the design has lived in `src/` since 2026-08-01 and re-renders from `/_preview`.

**Variant E wins: no greying anywhere. A hollow route badge marks scheduled, plus an outlined `SCHED` pill.**

- **Live rows:** filled black badge, white numeral.
- **Scheduled rows:** outlined badge, black numeral on white, and a `SCHED` pill before the time.
- **Everything else stays full black on every row** — destination, time, all of it.

The filled-vs-hollow badge is a **shape and weight** difference rather than a tonal one, which is why it survives distance: at a glance the eye picks out solid black blocks versus outlines without reading anything. The pill confirms it up close.

**Why the greying variants lost, which is the part worth remembering.** Greying a scheduled row dims the one thing the reader came for. A scheduled 4:31 is not an error and not stale — it is the best available answer for that bus, and it should be as legible as any other. Variants A, B and C all degraded real information in order to signal uncertainty about it. Variant D was the halfway house (grey the badge and destination, keep the time black) and read as though the row had failed to render rather than as a deliberate signal.

Also rejected: labelling every row `LIVE`/`SCHED` (variant B) spends ink and horizontal space on the majority case to restate what the badge already says, and stacking a `SCHEDULED` word above the time (variant A) crowded the numerals at native resolution.

**A consequence worth keeping: grey now carries no meaning in the row area at all.** It is only de-emphasis — the footer, the `min`/`pm` units. That removes the conflict the greying variants would have created, where the same tone had to mean both "unverified" and "less important". Two distinct greys are defined in the spike for this reason: a mid grey for anything meaningful, a light grey for de-emphasis. With E, only the light one is used.

## The format ladder — thresholds read off the real signs, 2026-08-01

`Now` under a minute, `N min` through **10**, clock time from **11**. In `src/oba/format.js`, and nowhere else — the mapper emits a `departsAtMs` and a `live` flag, so revisiting the ladder is a change to that one file.

The numbers were **measured, not chosen.** Every photograph in `assets/sources/connectpoint-photos/` carries the current time in its header, which makes every row a data point:

| Photo | Header | Largest `N min` | Smallest clock time |
| --- | --- | --- | --- |
| `connectpoint-0652am` | 6:52 am | **9 min** | — |
| `connectpoint-0411pm` | 4:11 pm | 8 min | — |
| `connectpoint-0650am` | 6:50 am | 8 min | 7:03 am (13 min) |
| *(not kept)* | 3:51 pm | 7 min | 4:03 pm (12 min) |
| *(not kept)* | 5:03 pm | 2 min | 5:14 pm (**11 min**) |
| `connectpoint-0407pm-blog` | 4:07 pm | 4 min | 4:26 pm (19 min) |
| `connectpoint-0250pm-rapidride` | 2:50 pm | 5 min | 3:10 pm (20 min) |

**Two of those photos are no longer in `assets/sources/connectpoint-photos/`**, including the 5:03 pm one that supplies the `11 min` observation — the single row that fixes the top of the ladder. The readings were taken when the photos were present and are kept here because this table *is* the record; they are simply no longer re-checkable from the repo. Do not treat their absence as a reason to re-derive the thresholds, and do not delete the rows to tidy the table.

So Metro counts minutes to at least 9 and is showing clock times by 11; 10 was the owner's call on the one boundary the photos do not settle. **Do not re-derive this from an assumption** — the first guess in this project was 20, and the photos disprove it.

Two more things the same photographs settle, both free:

- **`Scheduled` rows use the identical ladder.** `Scheduled 2 min`, `Scheduled 4 min` and `Scheduled 8 min` all appear on real signs. Whether a prediction is live changes the label above the time and never the format of the time.
- **A departure slightly in the past is `Now`, not gone.** `NOW_GRACE_MS` is 60 seconds. The first departure in every captured fixture is a bus already at the kerb with a prediction a minute old; dropping those would blank the most useful row on the board exactly when it matters.

Minutes are **floored**, not rounded: understating the wait sends someone to the kerb early, and overstating it lets them watch the bus leave.

## A stop that answers and a stop that does not — 2026-08-01

Two stops fail independently, so half a board failing is the ordinary shape of an outage rather than a rare one.

- **One stop answering is enough for a board.** The failed group keeps its band and says `Departure data unavailable` where its rows would be. Only when *every* stop fails does the sign drop to the full-panel `obafail` notice.
- **A stop with no service left is a different sentence** — `No more departures today` — and stays a board, tagged `noservc`. "We could not ask" is a fault and "nothing is coming" is an answer, and a reader has to be able to tell them apart.
- **An empty group keeps its full share of the panel.** `reserved` on the group, honoured by `rowMetrics()`. Without it the surviving direction's rows grow to fill the gap, and a partial failure renders as a different design rather than as a missing half. The message is centred in that space, large: left-aligned at row size it was tried first and read as a caption someone forgot to finish.
- **Row count comes from `maxRowsPerGroup()` in `render/board.js`**, which divides the panel by a legibility floor. Two stops get four each, which is the density the design was accepted at; a single-direction sign gets more, because it pays for one band instead of two and a gap. This is how row count stays derived rather than configured.

