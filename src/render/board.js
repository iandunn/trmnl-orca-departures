/**
 * Builds the departures board as an SVG string.
 *
 * Pure: takes data, returns markup. No wasm, no fonts, no I/O — so it is cheap to test and the
 * expensive rasterisation stays in `index.js`.
 *
 * The layout follows King County Metro's real Connectpoint signs, matched against photographs in
 * `assets/sources/connectpoint-photos/`. `CLAUDE.md` records what was kept, what was dropped, and
 * the two things we add that Metro does not need — the "Updated at" stamp and the direction bands.
 */

import { METRO_LOGO_DATA_URI } from '../assets/metro-logo.js';
import { SOUND_TRANSIT_LOGO_DATA_URI } from '../assets/sound-transit-logo.js';
import { collapseRepeatedPhrases } from '../headsign.js';
import { destinationWithRoute, routeBadge } from '../route-badge.js';
import {
	OBA_TRAM_RATIO,
	OBA_TRAM_VIEWBOX,
	OBA_VEHICLES_LIGHT,
	OBA_VEHICLES_RATIO,
	OBA_VEHICLES_VIEWBOX,
} from '../assets/oba-mark.js';

export const PANEL_WIDTH = 1872;
export const PANEL_HEIGHT = 1404;

/**
 * Fira Sans. Of six open faces compared against the reference photo it is the only one that draws
 * the **open-top `4`** the real sign uses; Inter, Source Sans 3, Public Sans, Archivo and Mulish
 * all close it. Frutiger and Myriad, which the sign most resembles, are commercial.
 */
export const SIGN_FONT = 'Fira Sans';

/** Meaningful mid grey, and a lighter one that only ever means de-emphasis. */
const GREY = '#6b6b6b';
const FAINT = '#a6a6a6';
const INK = '#111';

/**
 * Fira Sans Bold's cap height as a fraction of its font size, measured off the TTF: 693 of 1000 units
 * per em. Its lining figures reach the same height — `4` tops out at 693 and `0` at 690 — so the one
 * ratio places the numerals as well as the words. Regular is 689, close enough to share it.
 *
 * Centring goes through the cap rather than the em box, which is padded by ascender and descender
 * space no glyph on this sign reaches: type centred on its em box sits visibly high, and the cap is
 * what a reader takes for the top of a line.
 */
const CAP_RATIO = 0.693;

/**
 * The baseline that puts a line of type's cap height on `centre`.
 *
 * SVG places text by its baseline, so every vertical centring on the sign comes through here. A
 * descender hanging below `centre` is deliberate: `pm` and the `p` of `Departures` read as centred
 * when their caps are, and balancing the descender instead lifts the whole line.
 */
function capCentredBaseline( centre, size ) {
	return Math.round( centre + ( size * CAP_RATIO ) / 2 );
}

export const HEADER_HEIGHT = 102;
const BAND_HEIGHT = 58;
const GROUP_GAP = 30;
const LEFT = 60;
const RIGHT = 1812;

const HEADER_CENTRE_Y = HEADER_HEIGHT / 2;

/**
 * The header's word baseline — `Departures`, and the agency name that may precede it.
 *
 * One baseline for both sizes, because a lockup reads as one line: cap-centring the smaller name
 * separately would step it up off the word it belongs to.
 */
export const HEADER_WORD_SIZE = 58;
export const HEADER_WORD_BASELINE = capCentredBaseline( HEADER_CENTRE_Y, HEADER_WORD_SIZE );

const HEADER_CLOCK_BASELINE = capCentredBaseline( HEADER_CENTRE_Y, 60 );

const HEADER_DATE_SIZE = 28;
const HEADER_DATE_LEADING = 34;

/**
 * Where the day and date end, which is what sets their distance from the clock.
 *
 * **Measured off a render rather than estimated**, by scanning the header's ink columns — the first
 * estimate of the clock's width was out by half. The clock is right-anchored, so its left edge moves
 * with the hour: this leaves about 40px of gap at the widest clock the day contains (`10:44`, the `1`
 * being narrow in ink but not in advance) and about 70px at a single-digit hour, which is most of the
 * active window. Sized against the tight case, since that is the one that could crowd.
 */
const HEADER_DATE_RIGHT = 1580;

/**
 * The day and date are centred as a two-line block — the first line's cap top to the second line's
 * baseline — which is what half the leading above the centre line expresses.
 */
const HEADER_DATE_BASELINE = capCentredBaseline(
	HEADER_CENTRE_Y - HEADER_DATE_LEADING / 2,
	HEADER_DATE_SIZE
);

/**
 * The Metro lockup's placement, centred on the bar. Exported because `overnight.js` draws the same
 * logo in the same slot, and its own comment promises the two headers line up when the sign switches
 * between them.
 */
export const METRO_LOGO_BOX = {
	x: 56,
	y: Math.round( HEADER_CENTRE_Y - 62 / 2 ),
	width: 164,
	height: 62,
};

/**
 * The footer band: the rule, and the "Updated at" stamp centred in the space below it.
 *
 * 84px deep. It was 116 until 2026-08-03, which was more white than one line of type asks for and
 * height the rows could use — the eight-row board gains 4px a row. Do not take it below about 80: the
 * stamp is the sign's only staleness defence, and sizing it up at physical size is still open.
 */
export const FOOTER_RULE_Y = 1320;

/**
 * The stamp's size. Grown a step on 2026-08-03, with the room the shorter band freed.
 *
 * It is the sign's only defence against a silently frozen panel and the whole of the accepted risk
 * rests on it being readable "at a glance", so it is the one thing on the footer that should be
 * larger than the layout strictly needs. Whether this is enough is a judgement at physical size —
 * 227 PPI on a 10.3" panel cannot be assessed on a monitor — and the band has room for about 52.
 */
export const FOOTER_TEXT_SIZE = 42;
export const FOOTER_BASELINE = capCentredBaseline( ( FOOTER_RULE_Y + PANEL_HEIGHT ) / 2, FOOTER_TEXT_SIZE );

/**
 * The tallest a row may get, the size the type scale is drawn at 1:1, and the box everything in a row
 * is centred in.
 *
 * The accepted board — four departures in each of two directions — comes in under this and is scaled
 * down to fit. The ceiling matters for the sparser cases: a single-direction sign, or a stop with
 * only a couple of departures left in the day, would otherwise stretch its rows across the panel.
 */
const ROW_HEIGHT = 158;

/**
 * Breathing room the clamp must leave between the last row and the footer rule.
 *
 * Without it the densest board that fits lands its bottom edge exactly on the rule. That reads as
 * fitting, but it is fitting by arithmetic coincidence: shave a few pixels off the header or a band
 * later and the row's lowest ink punches through the rule while every assertion still passes. The
 * gutter makes the space deliberate.
 *
 * It was originally sized against `pm` descenders sitting a few pixels off the rule. Centring the row
 * in 2026-08-03 lifted the unit well clear of the row's bottom edge, so the margin is now larger than
 * the case that set it — the constant stays because the reasoning does, not because it is measured.
 */
const FOOTER_CLEARANCE = 12;

/**
 * Below this a row stops being readable across a room, so it is the floor that decides how many
 * departures a board may ask for.
 *
 * The accepted eight-row board lands at 132, which is the measurement this is set just under rather
 * than a round number picked first.
 */
const MIN_ROW_HEIGHT = 120;

/**
 * How many departures each group may show, derived from the space the layout actually has.
 *
 * Row count is not configuration — `CLAUDE.md` is explicit that it follows from the data, bounded by
 * what fits — so the bound has to come from the geometry rather than from a number someone chose. Two
 * groups get four each, which is the density the design was accepted at; a single-direction sign gets
 * more, because it is not paying for a second band and a gap.
 *
 * @param {number} groupCount
 * @returns {number}
 */
export function maxRowsPerGroup( groupCount ) {
	const count = Math.max( groupCount, 1 );
	const bands = count * BAND_HEIGHT + ( count - 1 ) * GROUP_GAP;
	const available = FOOTER_RULE_Y - HEADER_HEIGHT - bands - FOOTER_CLEARANCE;

	return Math.max( Math.floor( available / MIN_ROW_HEIGHT / count ), 1 );
}

/**
 * Row geometry, the only thing on the board that varies with how many departures it carries.
 *
 * Rows are **clamped** to the reference height rather than stretched to fill, so a board with space
 * to spare keeps the proportions the design was judged at and only a board that would otherwise
 * overrun the footer shrinks.
 *
 * Everything inside a row scales by that same factor, so a denser board is the same layout seen
 * smaller rather than a separately tuned one. That is what makes comparing densities meaningful —
 * any difference you can see is the density, not a hand adjustment that came with it.
 *
 * Horizontal metrics deliberately do not scale. Width is not the constraint, and holding the badge
 * slot fixed is what keeps the destination column in the same place across modes and densities.
 *
 * @param {Group[]} groups
 * @returns {{height: number, bottom: number, scaled: (value: number) => number}} `bottom` is where
 *          the last row ends, which is the number the clamp exists to keep above `FOOTER_RULE_Y`.
 */
export function rowMetrics( groups ) {
	// A group with nothing to draw still occupies `reserved` rows' worth of panel. That is what keeps
	// a half-failed board's surviving direction the same size it would be on a healthy one.
	const rows = groups.reduce( ( total, group ) => total + ( group.rows.length || group.reserved || 0 ), 0 );
	const bands = groups.length * BAND_HEIGHT + Math.max( groups.length - 1, 0 ) * GROUP_GAP;
	const available = FOOTER_RULE_Y - HEADER_HEIGHT - bands - FOOTER_CLEARANCE;
	const height = rows > 0 ? Math.min( ROW_HEIGHT, Math.floor( available / rows ) ) : ROW_HEIGHT;
	const scale = height / ROW_HEIGHT;

	return {
		height,
		bottom: HEADER_HEIGHT + bands + rows * height,
		scaled: ( value ) => Math.round( value * scale ),
	};
}

/**
 * OneBusAway reports a compass bearing, never a word. Spelling it out is the only rule that is
 * correct for every stop in the region without a lookup table.
 *
 * Collapsing `NW` to "Northbound" was considered and rejected: whether north or west dominates
 * depends on the street's orientation, which the API does not give us, so it would be confidently
 * wrong on some stops. Verbose and right beats idiomatic and sometimes wrong.
 *
 * The four cardinals close up — "Northbound" is the word, and it is what Metro prints — while the
 * diagonals stay spaced, because "Northwestbound" is not a word anyone writes. That is a spelling
 * rule, not a semantic one: it is why a plain north-south stop needs no override at all, and an
 * override map is left to carry only the stops where the *bearing itself* misleads.
 */
const COMPASS_WORDS = {
	N: 'Northbound',
	NE: 'Northeast bound',
	E: 'Eastbound',
	SE: 'Southeast bound',
	S: 'Southbound',
	SW: 'Southwest bound',
	W: 'Westbound',
	NW: 'Northwest bound',
};

/**
 * @param {string} bearing   OneBusAway `stop.direction`.
 * @param {object} overrides Keyed by full OBA stop ID, for the handful of stops where the derived
 *                           label is technically right but not what anyone says. Never a
 *                           region-wide table — deriving it is what makes unconfigured stops work.
 * @param {string} stopId
 * @returns {string}
 */
export function directionLabel( bearing, stopId, overrides = {} ) {
	if ( overrides[ stopId ] ) {
		return overrides[ stopId ];
	}

	return COMPASS_WORDS[ bearing ] ?? '';
}

/** SVG text is markup, and headsigns come from an upstream API. */
export function escapeText( value ) {
	return String( value )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

export function text( x, y, size, content, { weight = 700, fill = INK, anchor, spacing } = {} ) {
	return (
		`<text x="${ x }" y="${ y }" font-family="${ SIGN_FONT }" font-weight="${ weight }" font-size="${ size }" fill="${ fill }"` +
		( anchor ? ` text-anchor="${ anchor }"` : '' ) +
		( spacing ? ` letter-spacing="${ spacing }"` : '' ) +
		`>${ escapeText( content ) }</text>`
	);
}

function nestedMark( x, y, height, viewBox, ratio ) {
	return `<svg x="${ x }" y="${ y }" width="${ height * ratio }" height="${ height }" viewBox="${ viewBox }" preserveAspectRatio="xMidYMid meet">${ OBA_VEHICLES_LIGHT }</svg>`;
}

/**
 * The OneBusAway mark on its own backing plate.
 *
 * The source artwork's plate is square while the vehicles are far wider than tall, so we draw the
 * plate instead and let its proportion follow the artwork, padding the sides more than the ends.
 *
 * **Not currently drawn.** The footer credited OneBusAway until the stamp beside it became the plain
 * "Updated at" line; kept here, along with the pre-cleaned assets it needs, because putting it back
 * is a one-line change and re-deriving the recolouring is not.
 */
export function obaMark( x, y, height ) {
	const padX = height * 0.3;
	const padY = height * 0.2;
	const artHeight = height - padY * 2;
	const width = artHeight * OBA_VEHICLES_RATIO + padX * 2;

	return (
		`<rect x="${ x }" y="${ y }" width="${ width }" height="${ height }" rx="${ height * 0.22 }" fill="${ INK }"/>` +
		nestedMark( x + padX, y + padY, artHeight, OBA_VEHICLES_VIEWBOX, OBA_VEHICLES_RATIO )
	);
}

/**
 * Bus badge and rail badge occupy the same 152-wide slot so the destination column never shifts
 * between modes. Rail is a true circle centred in that slot — a different shape category, which is
 * what makes it readable at a glance; a merely rounder rectangle is not.
 */
const BADGE_WIDTH = 152;
const BADGE_HEIGHT = 94;
const BADGE_TEXT_SIZE = 58;

/** A three-character route number has to come down a step to fit the same box. */
const BADGE_TEXT_SIZE_LONG = 50;

/** Where the destination column starts, immediately right of the badge slot. */
const DESTINATION_LEFT = 252;

/**
 * Room reserved at the right of a row for the countdown or clock time.
 *
 * Wide enough for `4:47` at the row's own type scale plus a gap, since the time is right-aligned on
 * `RIGHT` and the destination is the only thing that can run into it.
 */
const TIME_COLUMN_WIDTH = 220;

/**
 * Average advance per character of Fira Sans Bold, as a fraction of font size.
 *
 * An estimate, and deliberately a pessimistic one. resvg does the shaping and the font is only
 * loaded in `index.js`, so nothing here can measure a string — but the destinations are all Latin
 * place names of similar case mix, which makes an average behave. Calibrated against a render:
 * `Pioneer Square Chinatown International District Waterfront`, the longest headsign the region
 * returns at 58 characters, measures about 0.46 per character. Rounding up to 0.5 buys roughly 8%
 * of slack, which costs a slightly smaller type size on the few rows that need shrinking at all and
 * protects against a headsign with wider letterforms than the one it was measured on.
 */
const AVERAGE_ADVANCE = 0.5;

/** Below this the destination is no longer readable across a room, so it is allowed to overrun. */
const MIN_DESTINATION_SIZE = 40;

const DESTINATION_SIZE = 58;

/**
 * A row's vertical layout, every part of it measured from the row's own centre line.
 *
 * **Centred rather than hung off the top, since 2026-08-03.** The offsets used to be distances from
 * the top of the row, tuned when a row was the height of its tallest possible stack, and the result
 * sat high — a row carrying no `Scheduled` label had that reserved space showing above it, and the
 * value-over-unit pair pushed a fifth of a row below the badge beside it.
 */
const ROW_CENTRE = ROW_HEIGHT / 2;

/**
 * The one baseline the badge numeral and the destination share.
 *
 * Metro's signs put them on a single line — it is visible in every photograph in
 * `assets/sources/connectpoint-photos/` — and it is what makes a badge and the place it goes read as
 * one statement instead of two columns. Derived from the destination's **ceiling** size rather than
 * its fitted one, so it holds still when `destinationSize()` steps the type down: a baseline that
 * drifted with the longest headsign on the board would break this alignment on exactly the boards
 * that stress the layout.
 */
const ROW_BASELINE = capCentredBaseline( ROW_CENTRE, DESTINATION_SIZE );

const VALUE_SIZE = 76;
const UNIT_SIZE = 36;

/** Value baseline to unit baseline. */
const UNIT_OFFSET = 34;

/** A value with no unit under it — `Now` — is centred on its own. */
const VALUE_ALONE_BASELINE = capCentredBaseline( ROW_CENTRE, VALUE_SIZE );

/**
 * The value and its unit are centred as one block, not one at a time: the same arithmetic, lifted by
 * half the gap the unit hangs in.
 *
 * **The two baselines are a deliberate split, judged by looking at renders of both.** Putting every
 * value on the paired baseline keeps the right-hand column perfectly regular and leaves a `Now`
 * floating above the badge and destination it belongs to, which is the worse fault: a reader takes a
 * row as one line first and the column as a column second, and only the handful of `Now` rows differ.
 */
const VALUE_PAIRED_BASELINE = VALUE_ALONE_BASELINE - Math.round( UNIT_OFFSET / 2 );
const UNIT_BASELINE = VALUE_PAIRED_BASELINE + UNIT_OFFSET;

const SCHEDULED_SIZE = 32;

/**
 * `Scheduled` sits above the value's cap instead of joining the centred block, for the same reason:
 * including it would move the value whenever a row's prediction was not live. It ends up close to the
 * rule above it, which is where the real signs put it too.
 */
const SCHEDULED_BASELINE = VALUE_PAIRED_BASELINE - Math.round( VALUE_SIZE * CAP_RATIO ) - 5;

/**
 * One destination size for the whole board, set by whichever destination needs the most room.
 *
 * **Per board rather than per row, deliberately.** Fitting each row independently produces a board
 * with two type sizes in it, and that reads as a rendering fault rather than as a fit — the eye sees
 * the mismatch long before it sees the reason for it. Sizing every row to the longest keeps the
 * column looking like one column, at the cost of a slightly smaller size on rows that would have
 * fitted at full size anyway.
 *
 * Long destinations only collide on a **sparse** board, which is the counter-intuitive part:
 * `rowMetrics()` clamps rather than stretches, so a board with two departures left in the day draws
 * them at full height and full type size, and the longest headsign then runs straight through the
 * time. A dense board scales the same string down until it fits on its own.
 *
 * @param {string[]} labels
 * @param {Function} scaled
 * @returns {number}
 */
function destinationSize( labels, scaled ) {
	const ceiling = scaled( DESTINATION_SIZE );
	const longest = labels.reduce( ( most, label ) => Math.max( most, label.length ), 0 );

	if ( ! longest ) {
		return ceiling;
	}

	const available = RIGHT - scaled( TIME_COLUMN_WIDTH ) - DESTINATION_LEFT;
	const fitted = Math.floor( available / ( longest * AVERAGE_ADVANCE ) );

	return Math.max( Math.min( ceiling, fitted ), scaled( MIN_DESTINATION_SIZE ) );
}

/**
 * @param {number}   x         Left edge of the badge slot.
 * @param {number}   rowTop    The row's own top, since the plate is placed against the row's centre.
 * @param {string}   shortName
 * @param {string}   mode
 * @param {Function} scaled
 */
function badge( x, rowTop, shortName, mode, scaled ) {
	const label = routeBadge( shortName );

	// 39 routes region-wide have no short name — every ferry route, and Amtrak Cascades. Drawing the
	// plate anyway would put an empty black block where a route number belongs, which reads as a
	// rendering fault. The slot is simply left blank; the destination column is a fixed x, so nothing
	// shifts and the rows stay aligned with every other row on the board.
	if ( ! label ) {
		return '';
	}

	const height = scaled( BADGE_HEIGHT );
	const top = rowTop + scaled( ROW_CENTRE - BADGE_HEIGHT / 2 );
	const centre = x + BADGE_WIDTH / 2;
	const shape =
		mode === 'rail'
			? `<circle cx="${ centre }" cy="${ top + height / 2 }" r="${ height / 2 }" fill="${ INK }"/>`
			: `<rect x="${ x }" y="${ top }" width="${ BADGE_WIDTH }" height="${ height }" rx="${ scaled( 26 ) }" fill="${ INK }"/>`;

	// Three-character route numbers need to come down a step to fit the same box. They keep the row's
	// shared baseline rather than being re-centred in the plate — the numeral belongs to the line it
	// reads on, and the 2px it sits below the plate's centre is invisible at 152px wide.
	const size = scaled( String( label ).length > 2 ? BADGE_TEXT_SIZE_LONG : BADGE_TEXT_SIZE );

	return (
		shape +
		text( centre, rowTop + scaled( ROW_BASELINE ), size, label, { fill: '#fff', anchor: 'middle' } )
	);
}

const BAND_TEXT_SIZE = 32;

/** Everything in the band sits on this one baseline, cap-centred in the band's own height. */
const BAND_BASELINE = capCentredBaseline( BAND_HEIGHT / 2, BAND_TEXT_SIZE );

/**
 * Direction and stop name on one baseline, flowed rather than placed.
 *
 * `tspan` does the flowing because the name has to start wherever the direction ends, and text width
 * is not knowable here — the font is only loaded in `index.js`. A fixed x would have to clear
 * "Northwest bound", which is the longest label, and would leave a gap after every short one.
 */
function headingWithName( x, y, heading, name ) {
	if ( ! name ) {
		return text( x, y, BAND_TEXT_SIZE, heading, { fill: '#333', spacing: 3 } );
	}

	// OneBusAway leaves `stop.direction` empty for a fair number of stops — 24 of the 515 seen while
	// surveying, one of them a Link platform — and `directionLabel()` honestly returns nothing for
	// those. The name then takes the whole slot rather than sitting indented behind an empty label.
	if ( ! heading ) {
		return text( x, y, BAND_TEXT_SIZE, name, { weight: 400, fill: GREY } );
	}

	return (
		`<text x="${ x }" y="${ y }" font-family="${ SIGN_FONT }" font-size="${ BAND_TEXT_SIZE }" fill="#333">` +
		`<tspan font-weight="700" letter-spacing="3">${ escapeText( heading ) }</tspan>` +
		`<tspan dx="26" font-weight="400" fill="${ GREY }">${ escapeText( name ) }</tspan>` +
		`</text>`
	);
}

/**
 * Every group names its own stop, even when both groups name the same one.
 *
 * The footer carried it once while a board was assumed to be one street in both directions. That
 * assumption does not hold: the two stops may be blocks apart, and even a true across-the-street
 * pair can carry different names when the cross streets differ. Naming the stop in every band is
 * right in all of those cases and costs a repeated line in only one, so the band is the single place
 * a reader ever looks for it.
 */
function directionBand( group, y ) {
	return (
		`<rect x="0" y="${ y }" width="${ PANEL_WIDTH }" height="${ BAND_HEIGHT }" fill="#e6e6e6"/>` +
		headingWithName( LEFT, y + BAND_BASELINE, group.heading.toUpperCase(), group.name ) +
		text( RIGHT, y + BAND_BASELINE, BAND_TEXT_SIZE, group.stop, { weight: 400, fill: GREY, anchor: 'end' } )
	);
}

/** Light-rail glyph, for a mixed board. Unused while bus and rail stops stay separate. */
export function tramGlyph( x, y, height ) {
	return nestedMark( x, y, height, OBA_TRAM_VIEWBOX, OBA_TRAM_RATIO );
}

const METRO_LOCKUP =
	`<image href="${ METRO_LOGO_DATA_URI }" x="${ METRO_LOGO_BOX.x }" y="${ METRO_LOGO_BOX.y }" width="${ METRO_LOGO_BOX.width }" height="${ METRO_LOGO_BOX.height }"/>` +
	text( 258, HEADER_WORD_BASELINE, HEADER_WORD_SIZE, 'Departures', { fill: '#fff' } );

/** As `agencyName()` in `src/oba/departures.js` reports it — OneBusAway's own name, uppercased. */
const SOUND_TRANSIT = 'SOUND TRANSIT';

/**
 * Sound Transit's own lockup, in the same slot Metro's occupies.
 *
 * Natural artwork is 1218x185, one line rather than Metro's two, so matching Metro's 62px block
 * height would set the wordmark half again as tall as `Departures` and let the agency shout over the
 * word the sign is actually for. It is sized by its cap height instead, judged against a render.
 *
 * **A deliberate divergence from their brand standards**, which the header bar cannot honour: clear
 * space is specified as the height of the `S` in the mark, and 102px of bar has nowhere near that
 * above and below. Everything else is followed — the official white artwork on a dark field,
 * unaltered proportions, symbol and typography never separated.
 */
const SOUND_TRANSIT_LOGO_HEIGHT = 46;

const SOUND_TRANSIT_LOCKUP =
	`<image href="${ SOUND_TRANSIT_LOGO_DATA_URI }" x="56" y="${ Math.round(
		HEADER_CENTRE_Y - SOUND_TRANSIT_LOGO_HEIGHT / 2
	) }" width="303" height="${ SOUND_TRANSIT_LOGO_HEIGHT }"/>` +
	text( 397, HEADER_WORD_BASELINE, HEADER_WORD_SIZE, 'Departures', { fill: '#fff' } );

/**
 * Whatever OneBusAway calls the operator, for a rail agency we hold no artwork for.
 *
 * One line sharing the `Departures` baseline, set smaller and letterspaced so the two read as a
 * lockup rather than as a sentence. It carried a second line naming the service — `LINK LIGHT RAIL`,
 * hardcoded — until the Sound Transit logo landed, at which point the only agencies still reaching
 * here were the ones that line was wrong for. Nothing in the data names a service, so it went.
 */
function textLockup( agency ) {
	const size = 44;
	const spacing = 2;

	// `Departures` clears the name rather than sitting at a fixed x, because the name can be long and
	// nothing here can measure a string. **Uppercase runs far wider than the 0.5 `AVERAGE_ADVANCE` the
	// rows use**: `CITY OF SEATTLE` measures 0.50 per character and `COMMUNITY TRANSIT` measures 0.56,
	// because one is mostly `I`s and spaces and the other is mostly `M`s and `O`s. 0.62 covers both,
	// and slack costs nothing on a bar with 1300px to spare — at 0.5 the longer name ran straight
	// through the word.
	const estimated = agency.length * ( size * 0.62 + spacing );

	return (
		text( 56, HEADER_WORD_BASELINE, size, agency, { fill: '#fff', spacing } ) +
		text( Math.round( Math.max( 430, 56 + estimated + 38 ) ), HEADER_WORD_BASELINE, HEADER_WORD_SIZE, 'Departures', {
			fill: '#fff',
		} )
	);
}

/**
 * The right-hand end of the header bar: the stacked day and date, then the clock with its smaller,
 * heavier meridiem on the clock's own baseline.
 *
 * Shared with `notice.js`, which draws the identical block — a notice screen frozen since yesterday
 * has to be as detectable as a frozen board, so the two headers must not drift apart. Metro's stacked
 * date does double duty for us: it is theirs, and it is the cue that catches a stale panel.
 *
 * @param {{weekday: string, date: string, clock: string, meridiem: string}} time
 */
export function headerTimeBlock( { weekday, date, clock, meridiem } ) {
	return (
		text( HEADER_DATE_RIGHT, HEADER_DATE_BASELINE, HEADER_DATE_SIZE, weekday, {
			weight: 400,
			fill: '#e0e0e0',
			anchor: 'end',
		} ) +
		text( HEADER_DATE_RIGHT, HEADER_DATE_BASELINE + HEADER_DATE_LEADING, HEADER_DATE_SIZE, date, {
			weight: 400,
			fill: '#e0e0e0',
			anchor: 'end',
		} ) +
		text( 1752, HEADER_CLOCK_BASELINE, 60, clock, { weight: 400, fill: '#fff', anchor: 'end' } ) +
		text( RIGHT, HEADER_CLOCK_BASELINE, 34, meridiem, { fill: '#fff', anchor: 'end' } )
	);
}

/**
 * The two agencies this sign can draw get their logo; anyone else gets their name.
 *
 * Gated on the agency rather than on the mode, because `boardMode()` answers "are all these routes
 * rail", which the Seattle Streetcar and the Monorail also are. A logo is a claim about who runs the
 * service, so it may only be drawn where the name would have said the same thing.
 */
function headerLockup( board, mode ) {
	if ( mode !== 'rail' ) {
		return METRO_LOCKUP;
	}

	return board.agency === SOUND_TRANSIT ? SOUND_TRANSIT_LOCKUP : textLockup( board.agency );
}

/**
 * @typedef  {object} Departure
 * @property {string}  badge Route short name, as OneBusAway reports it.
 * @property {string}  [routeName] Route long name. Only consulted when there is no short name, which
 *                                 is every ferry route and Amtrak Cascades.
 * @property {string}  to    Trip headsign.
 * @property {string}  value `Now`, a minute count, or a clock time.
 * @property {string}  unit  `min`, `pm`, or empty for `Now`.
 * @property {boolean} live  False when this fell back to `scheduledArrivalTime`.
 *
 * @typedef  {object} Group
 * @property {string}      heading
 * @property {string}      stop
 * @property {string}      name  This group's own stop name, drawn in its band. Two groups may name
 *                               the same stop; they are not assumed to.
 * @property {Departure[]} rows
 *
 * @typedef  {object} Board
 * @property {'bus'|'rail'} mode
 * @property {string}       agency Header lockup text. Metro gets its logo instead.
 * @property {Group[]}      groups
 * @property {string}       weekday
 * @property {string}       date
 * @property {string}       clock
 * @property {string}       meridiem
 * @property {string}       asOf
 */

/**
 * @param {Board} board
 * @returns {string} SVG markup at native panel resolution.
 */
export function buildBoardSvg( board ) {
	const { mode = 'bus', groups = [] } = board;
	const { height: rowHeight, scaled } = rowMetrics( groups );

	const withDestination = ( row ) => ( {
		...row,
		destination: destinationWithRoute( row.badge, row.routeName, collapseRepeatedPhrases( row.to ) ),
	} );

	// Resolved before anything is drawn, because the type size depends on the longest of them.
	const prepared = groups.map( ( group ) => ( {
		...group,
		rows: group.rows.map( withDestination ),
	} ) );
	const destinationFontSize = destinationSize(
		prepared.flatMap( ( group ) => group.rows.map( ( row ) => row.destination ) ),
		scaled
	);

	let body = '';
	let y = HEADER_HEIGHT;

	prepared.forEach( ( group, groupIndex ) => {
		// Negative space before the direction switches, so the groups read as separate boards
		// rather than one long list that happens to have a label in the middle.
		if ( groupIndex > 0 ) {
			y += GROUP_GAP;
		}

		body += directionBand( group, y );

		y += BAND_HEIGHT;

		// A direction with nothing to show says so in its own space rather than disappearing. A group
		// that vanished would leave a reader unable to tell a direction with no service left from one
		// the server could not ask about — and on a two-stop board, unable to tell that a direction is
		// missing at all.
		if ( group.rows.length === 0 ) {
			const span = ( group.reserved || 1 ) * rowHeight;

			// Centred and set large, because the alternative was tried and looked wrong: a row-sized
			// line at the left margin reads as a caption someone forgot to finish, floating in a void
			// the reader then has to interpret. Centred in the space it explains, it reads as the
			// deliberate answer to "why is half this sign empty".
			//
			// This band also listed tomorrow's first departures under the sentence until 2026-08-02,
			// when it was removed because nothing ever produced the data. `docs/todo-someday.md` has
			// what it looked like and what putting it back would need.
			const messageSize = scaled( 64 );
			const messageY = capCentredBaseline( y + span / 2, messageSize );

			body += text( PANEL_WIDTH / 2, messageY, messageSize, group.message ?? '', {
				weight: 400,
				fill: GREY,
				anchor: 'middle',
			} );

			y += span;

			return;
		}

		group.rows.forEach( ( row, rowIndex ) => {
			body +=
				badge( LEFT, y, row.badge, mode, scaled ) +
				text( DESTINATION_LEFT, y + scaled( ROW_BASELINE ), destinationFontSize, row.destination );

			// Metro's own answer to the real-time question: the word above the time, small and
			// grey, only on scheduled rows. It needs no legend and costs no contrast.
			if ( ! row.live ) {
				body += text( RIGHT, y + scaled( SCHEDULED_BASELINE ), scaled( SCHEDULED_SIZE ), 'Scheduled', {
					weight: 400,
					fill: GREY,
					anchor: 'end',
				} );
			}

			const valueBaseline = row.unit ? VALUE_PAIRED_BASELINE : VALUE_ALONE_BASELINE;

			body += text( RIGHT, y + scaled( valueBaseline ), scaled( VALUE_SIZE ), row.value, {
				anchor: 'end',
			} );

			// Units are set heavier than their size implies. That is what keeps them legible at
			// distance, and it is what the official sign does.
			if ( row.unit ) {
				body += text( RIGHT, y + scaled( UNIT_BASELINE ), scaled( UNIT_SIZE ), row.unit, {
					anchor: 'end',
				} );
			}

			if ( rowIndex < group.rows.length - 1 ) {
				body += `<line x1="${ LEFT }" y1="${ y + rowHeight }" x2="${ RIGHT }" y2="${ y + rowHeight }" stroke="#c0c0c0" stroke-width="2"/>`;
			}

			y += rowHeight;
		} );
	} );

	const lockup = headerLockup( board, mode );

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }">` +
		`<rect width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" fill="#fff"/>` +
		`<rect width="${ PANEL_WIDTH }" height="${ HEADER_HEIGHT }" fill="${ INK }"/>` +
		lockup +
		headerTimeBlock( board ) +
		body +
		`<line x1="0" y1="${ FOOTER_RULE_Y }" x2="${ PANEL_WIDTH }" y2="${ FOOTER_RULE_Y }" stroke="#c0c0c0" stroke-width="2"/>` +
		// The whole defence against a silently frozen panel. Metro's signs are wired and monitored;
		// ours can fail with no way to say so, and this is the only cue that survives that. It starts
		// at the left margin rather than clearing a logo, so the words get the full footer width.
		text( LEFT, FOOTER_BASELINE, FOOTER_TEXT_SIZE, `Updated at ${ board.asOf }`, {
			weight: 400,
			fill: GREY,
		} ) +
		`</svg>`
	);
}

export { FAINT, GREY };
