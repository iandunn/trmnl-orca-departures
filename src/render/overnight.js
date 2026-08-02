/**
 * The screen the sign shows between `ACTIVE_END` and the next `ACTIVE_START`.
 *
 * **This is not a failure screen, and it must not read as one.** Nothing is wrong: the sign has
 * finished for the day and the buses have not. So there is no sentence about service — a line like
 * "service resumes at 6:30 am" says the wrong thing, because service never stopped — and no headline
 * at all. A moon in the route badge says the sign is resting, in the layout's own grammar.
 *
 * The badge is the sign's signature element: a filled rounded rectangle with a white glyph, where a
 * route number goes. Putting the moon there says "off duty" using the vocabulary the board already
 * taught the reader, rather than borrowing an icon from outside it.
 *
 * ## Every time on it comes from config, not from the clock
 *
 * The footer prints `Wakes at 6:30 am`, from `ACTIVE_START`, and the header carries no clock or date
 * at all — a date drawn at 9:30 pm is wrong by midnight, and this screen holds the glass until
 * morning. Two things follow, and both are the point:
 *
 * - **It always reads the same time**, whichever second the device's wake drifts to.
 *
 * - **The subject is the sign, not the service.** `Wakes at` rather than `Back at`, decided
 *   2026-08-01: "back at 6:30" invites the reading that Metro is not running until then, which is
 *   false — the buses keep going all night and only this panel stops. The whole screen exists to
 *   avoid making that claim, so the one line on it must not make it either.
 * - **The image is a pure function of config**, so it is byte-identical every time it is served, and
 *   the content half of its `filename` never moves. The epoch half still advances with
 *   `stableEpoch()`, which rolls at about 02:00 and 14:00 Pacific — so a device power-cycling before
 *   the 02:00 roll re-requests a name it already has and skips the download, and one waking after it
 *   downloads the same bytes under a new name. Harmless either way: a power cycle clears the RTC
 *   buffer, so it repaints regardless of what the name says.
 *
 * The footer's right-hand slot is empty here, where a board names its stop. The stop is on every
 * board all day; repeating it on a screen that says nothing else is noise.
 *
 * Pure, like `board.js` and `notice.js`: takes data, returns markup, touches no wasm and no fonts.
 */

import { METRO_LOGO_DATA_URI } from '../assets/metro-logo.js';
import { routeBadge } from '../route-badge.js';
import { PANEL_HEIGHT, PANEL_WIDTH, text } from './board.js';

const INK = '#111';
const GREY = '#6b6b6b';
const PAPER = '#fff';

const HEADER_HEIGHT = 102;
const FOOTER_RULE_Y = 1288;
const LEFT = 60;
const RIGHT = 1812;

const CENTRE_X = PANEL_WIDTH / 2;
const CENTRE_Y = Math.round( ( HEADER_HEIGHT + FOOTER_RULE_Y ) / 2 );

/** The badge's own proportions, from `board.js`. Every plate below is this shape, scaled. */
const BADGE_RATIO = 94 / 152;
const BADGE_CORNER = 26 / 94;

/** The Metro lockup's aspect, from the placement `board.js` uses in the header. */
const LOGO_RATIO = 62 / 164;

/** Four is what fits beside a moon plate large enough to still be the subject of the panel. */
const MAX_FIRST_DEPARTURES = 4;

/** Row pitch for tomorrow's departures. Shared so the bottom anchoring and the drawing agree. */
const ROW_PITCH = 150;

const round = ( value ) => Math.round( value );

/**
 * A crescent: a disc, with a second disc in the backdrop colour painted over it.
 *
 * **Neither fill rule can express this, which is worth stating because both look like they can.**
 * `evenodd` over two circle subpaths is a symmetric difference, so it fills the offset disc's far
 * side as well and the result is two crescents facing each other across a lens — an eclipse, not a
 * moon. `nonzero` with opposite winding fills that same far side. Subtraction needs a mask, a clip,
 * or paint order, and paint order is the one that stays legible.
 *
 * The cost is that the caller has to know what is behind the glyph. That is always true here, and it
 * is a cheaper thing to get wrong than an arc flag, because getting it wrong is visible rather than
 * subtly misshapen.
 *
 * **The optical shift is applied outside the rotation, and that ordering is the whole of the
 * vertical centring.** The crescent occupies only the left part of the disc it is cut from, so it
 * has to move right to sit on its own point; inside the rotation that horizontal nudge becomes a
 * diagonal one and lifts the moon visibly off the plate's centre line.
 */
export function moonGlyph( cx, cy, radius, fill = INK, backdrop = PAPER ) {
	const optical = round( ( radius * ( 1 - 0.46 / 2 ) ) / 2 );

	return (
		`<g transform="translate(${ optical } 0)">` +
		`<g transform="rotate(-25 ${ round( cx ) } ${ round( cy ) })">` +
		`<circle cx="${ round( cx ) }" cy="${ round( cy ) }" r="${ round( radius ) }" fill="${ fill }"/>` +
		`<circle cx="${ round( cx + radius * 0.46 ) }" cy="${ round( cy ) }" r="${ round( radius ) }" fill="${ backdrop }"/>` +
		`</g></g>`
	);
}

/**
 * The route badge with a moon where the number goes.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} width      Plate width. Height and corner radius follow the badge's proportions.
 * @param {string} [plate]    Plate fill.
 * @param {string} [crescent] Moon fill, which must be the plate's opposite.
 */
export function moonBadge( cx, cy, width, plate = INK, crescent = PAPER ) {
	const height = round( width * BADGE_RATIO );

	return (
		`<rect x="${ round( cx - width / 2 ) }" y="${ round( cy - height / 2 ) }" width="${ round( width ) }" ` +
		`height="${ height }" rx="${ round( height * BADGE_CORNER ) }" fill="${ plate }"/>` +
		moonGlyph( cx, cy, round( height * 0.34 ), crescent, plate )
	);
}

/** The Metro lockup is the reversed, white artwork, so it needs ink behind it wherever it is drawn. */
function metroLogo( x, y, width ) {
	return `<image href="${ METRO_LOGO_DATA_URI }" x="${ round( x ) }" y="${ round( y ) }" width="${ round( width ) }" height="${ round( width * LOGO_RATIO ) }"/>`;
}

/**
 * The header bar, carrying the Metro logo and nothing else.
 *
 * Identical placement to the board's own lockup, so the two headers line up when the sign switches
 * between them. The word "Departures" is dropped: the board says it because it is listing some, and
 * this screen is not.
 */
function header( right = '' ) {
	return (
		`<rect width="${ PANEL_WIDTH }" height="${ HEADER_HEIGHT }" fill="${ INK }"/>` +
		metroLogo( 56, 16, 164 ) +
		right
	);
}

/** A hairline where the black header bar would have ended, for the variants that have no bar. */
function headerRule( stroke ) {
	return `<line x1="0" y1="${ HEADER_HEIGHT }" x2="${ PANEL_WIDTH }" y2="${ HEADER_HEIGHT }" stroke="${ stroke }" stroke-width="2"/>`;
}

/**
 * The rule, and the opening time.
 *
 * **`Wakes at 6:30 am` rather than `Updated at 9:30 pm`, and nothing is lost by the swap.** On a board
 * the stamp is an observation — OneBusAway's own `currentTime` — and it is the whole defence against a
 * silently frozen panel. Here it never was: this screen's times come from config, so an `Updated at`
 * line would read 9:30 pm every night whatever happened, which is a freshness claim that cannot be
 * false and therefore cannot be informative. The opening time is the thing a reader standing in front
 * of it actually wants, and a moon on the glass at noon is its own alarm without help.
 *
 * **Every variant carries it**, by decision on 2026-08-01: whichever one is chosen, the opening time
 * has to be on the glass. Two variants say it a second time — `badge-moon-row` in the time column and
 * `badge-moon-header-time` in the header — which makes those two candidates for the *placement* of
 * that line rather than additions to it. The parameter stays optional so a future variant can put it
 * somewhere else without the rule losing its footer.
 */
function footer( label, ink = GREY, rule = '#c0c0c0' ) {
	return (
		`<line x1="0" y1="${ FOOTER_RULE_Y }" x2="${ PANEL_WIDTH }" y2="${ FOOTER_RULE_Y }" stroke="${ rule }" stroke-width="2"/>` +
		( label ? text( LEFT, 1362, 38, `Wakes at ${ label }`, { weight: 400, fill: ink } ) : '' )
	);
}

function panel( background, contents ) {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }">` +
		`<rect width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" fill="${ background }"/>` +
		contents +
		`</svg>`
	);
}

/** Logo, badge, opening time. Everything else is a variation on this. */
function badgeMoon( { resumeLabel } ) {
	return panel( PAPER, header() + moonBadge( CENTRE_X, CENTRE_Y, 620 ) + footer( resumeLabel ) );
}

/** A row's separator rules, at the board's own weight. */
function rowRules( top, bottom, stroke ) {
	return (
		`<line x1="${ LEFT }" y1="${ top }" x2="${ RIGHT }" y2="${ top }" stroke="${ stroke }" stroke-width="2"/>` +
		`<line x1="${ LEFT }" y1="${ bottom }" x2="${ RIGHT }" y2="${ bottom }" stroke="${ stroke }" stroke-width="2"/>`
	);
}

/**
 * The row, with the time column set the way a *scheduled* departure is.
 *
 * The board stacks three lines in that column — `Scheduled` over the value over the unit — which is
 * Metro's own answer to "this number needs a qualifier". `Wakes at` is the same kind of qualifier, so
 * it goes in the same place rather than inventing a label somewhere else on the panel.
 */
function rowScheduled( { resumeClock, resumeMeridiem } ) {
	return panel(
		PAPER,
		header() +
			rowRules( CENTRE_Y - 110, CENTRE_Y + 110, '#d8d8d8' ) +
			moonBadge( LEFT + 76, CENTRE_Y, 152 ) +
			text( RIGHT, CENTRE_Y - 44, 34, 'Wakes at', { fill: GREY, anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 34, 96, resumeClock, { weight: 400, anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 92, 44, resumeMeridiem, { fill: GREY, anchor: 'end' } ) +
			footer( '' )
	);
}

/**
 * The row under a direction band, using all three of the band's own slots.
 *
 * A board's band carries the heading on the left and the stop code on the right. Here it carries the
 * state and the time — the same two-ended shape, so the panel keeps the rhythm of a real group even
 * with a single row under it.
 */
function rowBand( { resumeLabel } ) {
	const bandY = CENTRE_Y - 190;

	return panel(
		PAPER,
		header() +
			`<rect x="0" y="${ bandY }" width="${ PANEL_WIDTH }" height="58" fill="#e6e6e6"/>` +
			text( LEFT, bandY + 41, 34, 'RESTING', { spacing: 2 } ) +
			text( RIGHT, bandY + 41, 32, `Wakes at ${ resumeLabel }`, { weight: 400, fill: GREY, anchor: 'end' } ) +
			rowRules( CENTRE_Y - 60, CENTRE_Y + 160, '#d8d8d8' ) +
			moonBadge( LEFT + 76, CENTRE_Y + 50, 152 ) +
			footer( '' )
	);
}

/**
 * The full row: badge, destination column, time column.
 *
 * The only variant that fills the destination column, which on a board is the widest thing on the
 * panel and is empty on every other candidate here. Whether a row that reads `Wakes at — 6:30 am`
 * looks deliberate or looks like a board with one entry left is the thing to judge.
 */
function rowDestination( { resumeClock, resumeMeridiem } ) {
	return panel(
		PAPER,
		header() +
			rowRules( CENTRE_Y - 110, CENTRE_Y + 110, '#d8d8d8' ) +
			moonBadge( LEFT + 76, CENTRE_Y, 152 ) +
			text( 252, CENTRE_Y + 21, 62, 'Wakes at', {} ) +
			text( RIGHT, CENTRE_Y + 8, 96, resumeClock, { weight: 400, anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 68, 44, resumeMeridiem, { fill: GREY, anchor: 'end' } ) +
			footer( '' )
	);
}

/** The scheduled-column row on the inked panel, with stars. */
function rowScheduledInverse( { resumeClock, resumeMeridiem } ) {
	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			// Above the row, which spans the full width and has nowhere to hide a star.
			nightSky( CENTRE_Y - 200, SKY_ABOVE ) +
			rowRules( CENTRE_Y - 110, CENTRE_Y + 110, '#3a3a3a' ) +
			moonBadge( LEFT + 76, CENTRE_Y, 152, PAPER, INK ) +
			text( RIGHT, CENTRE_Y - 44, 34, 'Wakes at', { fill: '#9a9a9a', anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 34, 96, resumeClock, { weight: 400, fill: PAPER, anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 92, 44, resumeMeridiem, { fill: '#9a9a9a', anchor: 'end' } ) +
			footer( '', '#9a9a9a', '#3a3a3a' )
	);
}

/**
 * The badge in a departure row, with the opening time in the time column.
 *
 * The strongest version of "say it in the board's grammar": the badge sits at the row's own x, the
 * rules above and below are the row separators, and the time is set the way a clock-time departure is
 * set — value over unit, right-aligned. A reader who has looked at this sign before already knows how
 * to read it, and it answers the only question the moon leaves open without a sentence.
 */
/**
 * Tomorrow's first departures, under a moon plate.
 *
 * The one variant that answers the question a person standing here at 11pm actually has. Clock times
 * only and never a countdown — a countdown on a screen about tomorrow would be the most dangerous
 * thing this sign could draw — and the moon plate above the rows is what stops the whole screen being
 * read as "a bus is coming".
 *
 * **The rows here are illustrative and the times are placeholders.** Wiring this to real data is not
 * a detail: `arrivals-and-departures-for-stop` only answers about now, so first-trip times need
 * `schedule-for-stop`, which means calling OneBusAway overnight — and not calling it overnight is
 * precisely what stops an outage at 9:30 pm pinning an error screen to the glass until morning. That
 * trade has to be made deliberately. The route names and headsigns are real, taken from the public
 * sample stops, on the same footing as `edge-case-boards.js`.
 */
/**
 * Tomorrow's first departures as board rows, in whichever polarity the panel is.
 *
 * `ink` is the panel's own background and `paper` is what shows against it, so the light and inked
 * versions are the same call with the two swapped rather than two copies of the geometry.
 */
/**
 * The band that says these are tomorrow's.
 *
 * **Without it the screen is a board, and a board means buses are coming.** Three rows of route,
 * destination and clock time is the most legible thing this sign ever draws, so a reader takes it at
 * face value — the moon plate above is a cue and not a sentence, and cues lose to rows.
 *
 * It goes in the direction band, which is where a board already puts "what this group is", set the
 * same way: full width, uppercase, left margin. Nothing new is being invented for it.
 */
function tomorrowBand( y, { fill, ink } ) {
	return (
		`<rect x="0" y="${ y }" width="${ PANEL_WIDTH }" height="58" fill="${ fill }"/>` +
		text( LEFT, y + 41, 34, 'FIRST DEPARTURES TOMORROW', { fill: ink, spacing: 2 } )
	);
}

function firstDepartureRows( rows, { ink, paper, rule, quiet, top = CENTRE_Y - 90 } ) {
	const rowHeight = ROW_PITCH;

	return rows
		.slice( 0, MAX_FIRST_DEPARTURES )
		.map( ( row, index ) => {
			const y = top + index * rowHeight;
			// Through `routeBadge()`, exactly as the board does it, or `D Line` overflows the plate.
			const label = routeBadge( row.badge );

			return (
				`<line x1="${ LEFT }" y1="${ round( y - rowHeight / 2 ) }" x2="${ RIGHT }" y2="${ round( y - rowHeight / 2 ) }" stroke="${ rule }" stroke-width="2"/>` +
				`<rect x="${ LEFT }" y="${ round( y - 47 ) }" width="152" height="94" rx="26" fill="${ paper }"/>` +
				text( LEFT + 76, y + 21, label.length > 2 ? 50 : 58, label, { fill: ink, anchor: 'middle' } ) +
				text( 252, y + 21, 58, row.to, { fill: paper } ) +
				text( RIGHT, y + 8, 68, row.clock, { weight: 400, fill: paper, anchor: 'end' } ) +
				text( RIGHT, y + 56, 34, row.meridiem, { fill: quiet, anchor: 'end' } )
			);
		} )
		.join( '' );
}

const TOMORROW_BAND_Y = 460;

/**
 * The plate above a fixed band, centred in the space by construction rather than by a chosen y.
 *
 * Both were eyeballed first and both were wrong: the plate sat with more air above it than below, and
 * a gap that is nearly-but-not-quite symmetric reads as a mistake in a way a large one does not.
 * Deriving the centre and the width from the same two edges makes the margins equal and lets the
 * plate take the room it actually has.
 */
const TOMORROW_PLATE_CENTRE = round( ( HEADER_HEIGHT + TOMORROW_BAND_Y ) / 2 );
const TOMORROW_PLATE_WIDTH = round( ( TOMORROW_BAND_Y - HEADER_HEIGHT - 72 ) / BADGE_RATIO );

function firstDepartures( { resumeLabel, rows = [] } ) {
	return panel(
		PAPER,
		header() +
			moonBadge( CENTRE_X, TOMORROW_PLATE_CENTRE, TOMORROW_PLATE_WIDTH ) +
			tomorrowBand( TOMORROW_BAND_Y, { fill: '#e6e6e6', ink: INK } ) +
			firstDepartureRows( rows, { ink: PAPER, paper: INK, rule: '#e2e2e2', quiet: GREY } ) +
			footer( resumeLabel )
	);
}

/**
 * The inked version with the moon taking whatever the rows leave.
 *
 * **The moon scales to the space rather than sitting at a fixed size**, the same way `rowMetrics()`
 * derives row height on a board: one first departure leaves room for a plate that dominates the
 * panel, four squeezes it down to something closer to a badge. That keeps the composition full at
 * every density instead of leaving a dead band above the rows when there is little to say.
 *
 * No `Wakes at` line. Tomorrow's actual first departure is a better answer to "when does this thing
 * come back" than the sign's own opening time, and printing both invites the reader to work out why
 * they differ — which is because the sign wakes at `ACTIVE_START` and the buses do not care.
 */
function firstDeparturesInverseMoon( { rows = [] } ) {
	const shown = rows.slice( 0, MAX_FIRST_DEPARTURES );
	const count = Math.max( shown.length, 1 );

	// **The rows sit on the footer rule and the moon takes everything above them**, rather than the
	// rows following a fixed plate. Anchoring the other way round leaves a pool of dead panel under a
	// single departure, which reads as a board that failed to finish drawing — and the plate is the
	// one element here that can absorb space without looking stretched.
	const rowsBottom = FOOTER_RULE_Y - 40;
	const rowsTop = rowsBottom - ( count - 0.5 ) * ROW_PITCH;
	const bandY = rowsTop - ROW_PITCH / 2 - 58;

	// The plate takes what is left, up to a ceiling — past that it stops reading as a badge and starts
	// reading as a poster with a caption under it. The ceiling is roughly the size it lands on at four
	// rows, so a sparse board looks like the same design rather than a different one.
	//
	// **Spare space goes to the sky instead.** Stars cost nothing, fill the panel without competing
	// with anything, and are the one element here that can scale without a proportion to keep.
	const region = bandY - HEADER_HEIGHT;
	const plateWidth = Math.min( 700, round( ( region - 96 ) / BADGE_RATIO ) );
	const plateCentre = HEADER_HEIGHT + region / 2;
	const sky = region > 700 ? [ ...SKY_AROUND, ...SKY_SPARSE_EXTRA ] : SKY_ABOVE;

	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			nightSky( plateCentre, sky ) +
			moonBadge( CENTRE_X, plateCentre, plateWidth, PAPER, INK ) +
			tomorrowBand( bandY, { fill: '#2c2c2c', ink: PAPER } ) +
			firstDepartureRows( shown, {
				ink: INK,
				paper: PAPER,
				rule: '#3a3a3a',
				quiet: '#9a9a9a',
				top: rowsTop,
			} ) +
			footer( '', '#9a9a9a', '#3a3a3a' )
	);
}

/** The same rows on the inked panel, which is the polarity the moon plate reads best in. */
function firstDeparturesInverse( { resumeLabel, rows = [] } ) {
	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			moonBadge( CENTRE_X, TOMORROW_PLATE_CENTRE, TOMORROW_PLATE_WIDTH, PAPER, INK ) +
			tomorrowBand( TOMORROW_BAND_Y, { fill: '#2c2c2c', ink: PAPER } ) +
			firstDepartureRows( rows, { ink: INK, paper: PAPER, rule: '#3a3a3a', quiet: '#9a9a9a' } ) +
			footer( resumeLabel, '#9a9a9a', '#3a3a3a' )
	);
}

function badgeMoonRow( { resumeClock, resumeMeridiem, resumeLabel } ) {
	const top = CENTRE_Y - 110;
	const bottom = CENTRE_Y + 110;
	const rule = ( y ) =>
		`<line x1="${ LEFT }" y1="${ y }" x2="${ RIGHT }" y2="${ y }" stroke="#d8d8d8" stroke-width="2"/>`;

	return panel(
		PAPER,
		header() +
			rule( top ) +
			moonBadge( LEFT + 76, CENTRE_Y, 152 ) +
			text( RIGHT, CENTRE_Y + 6, 96, resumeClock, { weight: 400, anchor: 'end' } ) +
			text( RIGHT, CENTRE_Y + 68, 44, resumeMeridiem, { fill: GREY, anchor: 'end' } ) +
			rule( bottom ) +
			footer( resumeLabel )
	);
}

/**
 * The opening time in the header's stacked slot, where a board puts the weekday and date.
 *
 * **This argues with the instinct to leave the header bare, and the argument is worth seeing.** The
 * reason to drop the date is that it goes wrong by midnight; the opening time does not, because it
 * comes from `ACTIVE_START` rather than from a clock. So the one slot on this screen that could carry
 * a true fact all night is exactly the slot being left empty.
 */
function badgeMoonHeaderTime( { resumeLabel } ) {
	const stacked =
		text( RIGHT, 40, 28, 'Wakes at', { weight: 400, fill: '#b8b8b8', anchor: 'end' } ) +
		text( RIGHT, 78, 34, resumeLabel, { fill: PAPER, anchor: 'end' } );

	// No footer copy: the header already says it, and the same line twice on a panel this empty reads
	// as a mistake rather than as emphasis.
	return panel( PAPER, header( stacked ) + moonBadge( CENTRE_X, CENTRE_Y, 620 ) + footer( '' ) );
}

/**
 * Inked panel, everything reversed out.
 *
 * The one idea here that does not come from the board at all: night is dark, and a panel that goes
 * dark says so before any glyph on it is resolved. It is also the most unambiguously different thing
 * the sign can do — no board is ever mostly black, so this cannot be misread as departures from
 * across a room.
 *
 * Two costs worth weighing against that, neither measurable without the device. E-paper holds a large
 * black field indefinitely at no power, but it is the shape most likely to ghost into the next
 * render, and the deep clear that would remove the ghost only runs every eighth update.
 */
function badgeMoonInverse( { resumeLabel } ) {
	return panel(
		INK,
		// No header bar — the panel is already ink — but the rule stays, because it is the bar's own
		// bottom edge and without it the logo floats rather than sitting in a header.
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			moonBadge( CENTRE_X, CENTRE_Y, 620, PAPER, INK ) +
			footer( resumeLabel, '#9a9a9a', '#3a3a3a' )
	);
}

/**
 * The inked panel with stars and both rules drawn.
 *
 * Stars only work here. On paper they were three black discs on white and read as dust on the glass;
 * reversed out of ink they read as sky, which is the same shape doing a different job entirely.
 *
 * The two hairlines stand in for the header bar and the footer rule, so the panel keeps the sign's
 * proportions instead of becoming a poster.
 */
/**
 * Stars, reversed out of the panel.
 *
 * Fixed positions rather than anything generated, because the render has to be a pure function of
 * config — a random sky would change the bytes on every build and take the `filename` with it.
 */
const SKY_AROUND = [
	[ 386, -232, 16 ],
	[ 300, -300, 10 ],
	[ 452, -318, 7 ],
	[ -430, 210, 12 ],
	[ -330, 290, 7 ],
	[ 620, 120, 9 ],
	[ -600, -180, 8 ],
];

/** Added to `SKY_AROUND` when the rows leave enough panel that the plate alone cannot fill it. */
const SKY_SPARSE_EXTRA = [
	[ -750, -300, 10 ],
	[ 760, -290, 7 ],
	[ -180, -390, 9 ],
	[ 180, 380, 8 ],
	[ -720, 340, 6 ],
	[ 700, 350, 11 ],
];

/** Every star above its anchor, for panels whose lower half is rows. */
const SKY_ABOVE = [
	[ 386, -150, 14 ],
	[ 300, -218, 9 ],
	[ 452, -236, 7 ],
	[ -430, -110, 12 ],
	[ -330, -196, 7 ],
	[ 620, -60, 9 ],
	[ -600, -60, 8 ],
];

/**
 * @param {number} cy    What the offsets are measured from.
 * @param {Array}  stars One of the two fields above. **Pick the one that misses the content** — a
 *                       star landing inside a headsign reads as a rendering fault, and the rows on
 *                       these panels are full width, so there is nowhere in the lower half to hide.
 */
function nightSky( cy = CENTRE_Y, stars = SKY_AROUND ) {
	return stars
		.map(
			( [ dx, dy, r ] ) =>
				`<circle cx="${ round( CENTRE_X + dx ) }" cy="${ round( cy + dy ) }" r="${ r }" fill="${ PAPER }"/>`
		)
		.join( '' );
}

function badgeMoonInverseStars( { resumeLabel } ) {
	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			nightSky() +
			moonBadge( CENTRE_X, CENTRE_Y, 620, PAPER, INK ) +
			footer( resumeLabel, '#9a9a9a', '#3a3a3a' )
	);
}

/**
 * The lockup on the badge plate, centred, with the header carrying it as well.
 *
 * The plate is doing two jobs. It is the sign's own shape, so the lockup arrives in the same object a
 * route number would — and it is what makes the lockup drawable at all, because the artwork we have
 * is the *reversed* white version that a black header bar needs. On a light panel with no plate under
 * it, a white logo is invisible.
 *
 * Saying it twice is deliberate: the header is where the logo lives on every other screen the sign
 * draws, and dropping it here made this the one panel whose top edge did not match the rest.
 */
function logoPlate( { resumeLabel } ) {
	return panel( PAPER, header() + logoOnPlate( 900, INK ) + footer( resumeLabel ) );
}

/**
 * The same object on the inked panel, with the plate in mid grey.
 *
 * **Not paper, and not ink.** The lockup is the reversed white artwork, so it needs something dark
 * behind it — a paper plate erases everything but the emblem's own black square — and an ink plate on
 * an ink panel is a plate nobody can see. Mid grey is the only fill that keeps both the shape and the
 * logo, which the panel's 16 levels make available for free. `logo-plate-inverse-white` renders the
 * paper version so that claim can be checked rather than taken on trust.
 */
function logoPlateInverse( { resumeLabel } ) {
	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			logoOnPlate( 900, '#4a4a4a' ) +
			footer( resumeLabel, '#9a9a9a', '#3a3a3a' )
	);
}

/** The white-plate version, kept only until it has been looked at. See the note above. */
function logoPlateInverseWhite( { resumeLabel } ) {
	return panel(
		INK,
		metroLogo( 56, 16, 164 ) +
			headerRule( '#3a3a3a' ) +
			logoOnPlate( 900, PAPER ) +
			footer( resumeLabel, '#9a9a9a', '#3a3a3a' )
	);
}

function logoOnPlate( width, plate ) {
	const height = round( width * BADGE_RATIO );
	const logoWidth = round( width * 0.72 );

	return (
		`<rect x="${ round( CENTRE_X - width / 2 ) }" y="${ round( CENTRE_Y - height / 2 ) }" width="${ width }" ` +
		`height="${ height }" rx="${ round( height * BADGE_CORNER ) }" fill="${ plate }"/>` +
		metroLogo( CENTRE_X - logoWidth / 2, CENTRE_Y - ( logoWidth * LOGO_RATIO ) / 2, logoWidth )
	);
}

/**
 * Each variant draws the whole panel, rather than an icon dropped into a shared frame.
 *
 * They differ in the header and the background as well as the middle, so a shared frame would have
 * grown a flag per variant. These are design candidates: the one that is chosen stays and the rest
 * are deleted, so keeping them independent costs less than keeping them factored.
 */
export const OVERNIGHT_VARIANTS = Object.freeze( {
	'badge-moon': badgeMoon,
	'badge-moon-header-time': badgeMoonHeaderTime,
	'badge-moon-inverse': badgeMoonInverse,
	'badge-moon-inverse-stars': badgeMoonInverseStars,
	'badge-moon-row': badgeMoonRow,
	'row-scheduled': rowScheduled,
	'row-scheduled-inverse': rowScheduledInverse,
	'row-band': rowBand,
	'row-destination': rowDestination,
	'logo-plate': logoPlate,
	'logo-plate-inverse': logoPlateInverse,
	'logo-plate-inverse-white': logoPlateInverseWhite,
	'first-departures': firstDepartures,
	'first-departures-inverse': firstDeparturesInverse,
	'first-departures-inverse-moon': firstDeparturesInverseMoon,
} );

/**
 * Variants that deliberately do not print the opening time.
 *
 * Every other one carries it, by decision on 2026-08-01 — whichever is chosen, that line has to be on
 * the glass. The exception is the variant that lists tomorrow's actual first departures instead,
 * which is a better answer to the same question. Named rather than inferred so a new variant cannot
 * quietly join them: `overnight.test.js` asserts this set exactly.
 */
export const VARIANTS_WITHOUT_OPENING_TIME = Object.freeze( [ 'first-departures-inverse-moon' ] );

export const OVERNIGHT_VARIANT_NAMES = Object.freeze( Object.keys( OVERNIGHT_VARIANTS ) );

/**
 * Chosen 2026-08-01: the inked panel with stars, both rules, and the opening time in the footer.
 *
 * The rest stay in the file and render at `/_preview/parked` rather than being deleted, because the
 * choice is provisional until the panel has been seen at 227 PPI — and the runner-up,
 * `first-departures-inverse-moon`, is blocked on `schedule-for-stop` rather than on taste.
 */
export const DEFAULT_OVERNIGHT_VARIANT = 'badge-moon-inverse-stars';

/** The one the sign actually draws. Everything else in `OVERNIGHT_VARIANTS` is parked. */
export const LIVE_OVERNIGHT_VARIANTS = Object.freeze( [ DEFAULT_OVERNIGHT_VARIANT ] );

/**
 * @typedef  {object} Overnight
 * @property {string} [variant]        One of `OVERNIGHT_VARIANT_NAMES`. An unknown name falls back
 *                                     rather than throwing — this screen is what the sign shows for
 *                                     nine hours a night, and a typo must not be able to blank it.
 * @property {string} resumeClock      `ACTIVE_START` as `h:mm`.
 * @property {string} resumeMeridiem
 * @property {string} resumeLabel      `ACTIVE_START` as `h:mm am`, which the footer prints.
 * @property {Array<{ badge: string, to: string, clock: string, meridiem: string }>} [rows]
 *           Tomorrow's first departures. Only `first-departures` draws them, and nothing produces
 *           them yet outside the preview — see that variant for what wiring it would cost.
 */

/**
 * @param {Overnight} overnight
 * @returns {string} SVG markup at native panel resolution.
 */
export function buildOvernightSvg( overnight ) {
	const draw =
		OVERNIGHT_VARIANTS[ overnight.variant ] ?? OVERNIGHT_VARIANTS[ DEFAULT_OVERNIGHT_VARIANT ];

	return draw( overnight );
}
