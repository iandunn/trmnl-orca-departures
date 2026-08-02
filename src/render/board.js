/**
 * Builds the departures board as an SVG string.
 *
 * Pure: takes data, returns markup. No wasm, no fonts, no I/O — so it is cheap to test and the
 * expensive rasterisation stays in `index.js`.
 *
 * The layout follows King County Metro's real Connectpoint signs, matched against photographs in
 * `.claude/tmp/cpu-spike/metro official/`. `CLAUDE.md` records what was kept, what was dropped, and
 * the two things we add that Metro does not need — the "Updated at" stamp and the direction bands.
 */

import { METRO_LOGO_DATA_URI } from '../assets/metro-logo.js';
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

const HEADER_HEIGHT = 102;
const BAND_HEIGHT = 58;
const GROUP_GAP = 30;
const LEFT = 60;
const RIGHT = 1812;

export const FOOTER_RULE_Y = 1288;

/**
 * The tallest a row may get, and the size the type scale is drawn at 1:1.
 *
 * The accepted board — four departures in each of two directions — comes in under this and is scaled
 * down to fit. The ceiling matters for the sparser cases: a single-direction sign, or a stop with
 * only a couple of departures left in the day, would otherwise stretch its rows across the panel.
 */
const ROW_HEIGHT = 158;

/**
 * Breathing room the clamp must leave between the last row and the footer rule.
 *
 * Without it the densest board that fits lands its bottom edge exactly on the rule, and descenders —
 * the `p` of `pm` — come within a few pixels of crossing it. That reads as fitting, but it is fitting
 * by arithmetic coincidence: shave a few pixels off the header or a band later and descenders punch
 * through the rule while every assertion still passes. The gutter makes the space deliberate.
 */
const FOOTER_CLEARANCE = 12;

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
	const rows = groups.reduce( ( total, group ) => total + group.rows.length, 0 );
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
function escapeText( value ) {
	return String( value )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

function text( x, y, size, content, { weight = 700, fill = INK, anchor, spacing } = {} ) {
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
	const ceiling = scaled( 58 );
	const longest = labels.reduce( ( most, label ) => Math.max( most, label.length ), 0 );

	if ( ! longest ) {
		return ceiling;
	}

	const available = RIGHT - scaled( TIME_COLUMN_WIDTH ) - DESTINATION_LEFT;
	const fitted = Math.floor( available / ( longest * AVERAGE_ADVANCE ) );

	return Math.max( Math.min( ceiling, fitted ), scaled( MIN_DESTINATION_SIZE ) );
}

function badge( x, top, shortName, mode, scaled ) {
	const label = routeBadge( shortName );

	// 39 routes region-wide have no short name — every ferry route, and Amtrak Cascades. Drawing the
	// plate anyway would put an empty black block where a route number belongs, which reads as a
	// rendering fault. The slot is simply left blank; the destination column is a fixed x, so nothing
	// shifts and the rows stay aligned with every other row on the board.
	if ( ! label ) {
		return '';
	}

	const height = scaled( BADGE_HEIGHT );
	const centre = x + BADGE_WIDTH / 2;
	const baseline = top + scaled( 68 );
	const shape =
		mode === 'rail'
			? `<circle cx="${ centre }" cy="${ top + height / 2 }" r="${ height / 2 }" fill="${ INK }"/>`
			: `<rect x="${ x }" y="${ top }" width="${ BADGE_WIDTH }" height="${ height }" rx="${ scaled( 26 ) }" fill="${ INK }"/>`;

	// Three-character route numbers need to come down a step to fit the same box.
	const size = scaled( String( label ).length > 2 ? 50 : 58 );

	return shape + text( centre, baseline, size, label, { fill: '#fff', anchor: 'middle' } );
}

/**
 * Direction and stop name on one baseline, flowed rather than placed.
 *
 * `tspan` does the flowing because the name has to start wherever the direction ends, and text width
 * is not knowable here — the font is only loaded in `index.js`. A fixed x would have to clear
 * "Northwest bound", which is the longest label, and would leave a gap after every short one.
 */
function headingWithName( x, y, heading, name ) {
	if ( ! name ) {
		return text( x, y, 32, heading, { fill: '#333', spacing: 3 } );
	}

	// OneBusAway leaves `stop.direction` empty for a fair number of stops — 24 of the 515 seen while
	// surveying, one of them a Link platform — and `directionLabel()` honestly returns nothing for
	// those. The name then takes the whole slot rather than sitting indented behind an empty label.
	if ( ! heading ) {
		return text( x, y, 32, name, { weight: 400, fill: GREY } );
	}

	return (
		`<text x="${ x }" y="${ y }" font-family="${ SIGN_FONT }" font-size="32" fill="#333">` +
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
		headingWithName( LEFT, y + 40, group.heading.toUpperCase(), group.name ) +
		text( RIGHT, y + 41, 32, group.stop, { weight: 400, fill: GREY, anchor: 'end' } )
	);
}

/** Light-rail glyph, for a mixed board. Unused while bus and rail stops stay separate. */
export function tramGlyph( x, y, height ) {
	return nestedMark( x, y, height, OBA_TRAM_VIEWBOX, OBA_TRAM_RATIO );
}

const METRO_LOCKUP =
	`<image href="${ METRO_LOGO_DATA_URI }" x="56" y="16" width="164" height="62"/>` +
	text( 258, 68, 58, 'Departures', { fill: '#fff' } );

function textLockup( agency, mode ) {
	return (
		text( 56, 44, 30, agency, { fill: '#fff', spacing: 2 } ) +
		text( 56, 82, 30, mode, { weight: 400, fill: '#b8b8b8', spacing: 2 } ) +
		text( 430, 68, 58, 'Departures', { fill: '#fff' } )
	);
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

	// Resolved before anything is drawn, because the type size depends on the longest of them.
	const prepared = groups.map( ( group ) => ( {
		...group,
		rows: group.rows.map( ( row ) => ( {
			...row,
			destination: destinationWithRoute( row.badge, row.routeName, collapseRepeatedPhrases( row.to ) ),
		} ) ),
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

		group.rows.forEach( ( row, rowIndex ) => {
			body +=
				badge( LEFT, y + scaled( 26 ), row.badge, mode, scaled ) +
				text( DESTINATION_LEFT, y + scaled( 94 ), destinationFontSize, row.destination );

			// Metro's own answer to the real-time question: the word above the time, small and
			// grey, only on scheduled rows. It needs no legend and costs no contrast.
			if ( ! row.live ) {
				body += text( RIGHT, y + scaled( 40 ), scaled( 32 ), 'Scheduled', {
					weight: 400,
					fill: GREY,
					anchor: 'end',
				} );
			}

			body += text( RIGHT, y + scaled( 106 ), scaled( 76 ), row.value, { anchor: 'end' } );

			// Units are set heavier than their size implies. That is what keeps them legible at
			// distance, and it is what the official sign does.
			if ( row.unit ) {
				body += text( RIGHT, y + scaled( 144 ), scaled( 36 ), row.unit, { anchor: 'end' } );
			}

			if ( rowIndex < group.rows.length - 1 ) {
				body += `<line x1="${ LEFT }" y1="${ y + rowHeight }" x2="${ RIGHT }" y2="${ y + rowHeight }" stroke="#c0c0c0" stroke-width="2"/>`;
			}

			y += rowHeight;
		} );
	} );

	const lockup = mode === 'rail' ? textLockup( board.agency, 'LINK LIGHT RAIL' ) : METRO_LOCKUP;

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }">` +
		`<rect width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" fill="#fff"/>` +
		`<rect width="${ PANEL_WIDTH }" height="${ HEADER_HEIGHT }" fill="${ INK }"/>` +
		lockup +
		// Metro's stacked date, which for us also catches a panel frozen since yesterday.
		text( 1560, 36, 28, board.weekday, { weight: 400, fill: '#e0e0e0', anchor: 'end' } ) +
		text( 1560, 70, 28, board.date, { weight: 400, fill: '#e0e0e0', anchor: 'end' } ) +
		text( 1752, 68, 60, board.clock, { weight: 400, fill: '#fff', anchor: 'end' } ) +
		text( RIGHT, 68, 34, board.meridiem, { fill: '#fff', anchor: 'end' } ) +
		body +
		`<line x1="0" y1="${ FOOTER_RULE_Y }" x2="${ PANEL_WIDTH }" y2="${ FOOTER_RULE_Y }" stroke="#c0c0c0" stroke-width="2"/>` +
		// The whole defence against a silently frozen panel. Metro's signs are wired and monitored;
		// ours can fail with no way to say so, and this is the only cue that survives that. It starts
		// at the left margin rather than clearing a logo, so the words get the full footer width.
		text( LEFT, 1362, 38, `Updated at ${ board.asOf }`, { weight: 400, fill: GREY } ) +
		`</svg>`
	);
}

export { FAINT, GREY };
