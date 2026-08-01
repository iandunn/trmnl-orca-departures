/**
 * Builds the departures board as an SVG string.
 *
 * Pure: takes data, returns markup. No wasm, no fonts, no I/O — so it is cheap to test and the
 * expensive rasterisation stays in `index.js`.
 *
 * The layout follows King County Metro's real Connectpoint signs, matched against photographs in
 * `.claude/tmp/cpu-spike/metro official/`. `CLAUDE.md` records what was kept, what was dropped, and
 * the two things we add that Metro does not need — the "as of" stamp and the direction bands.
 */

import { METRO_LOGO_DATA_URI } from '../assets/metro-logo.js';
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
const ROW_HEIGHT = 158;
const GROUP_GAP = 30;
const FOOTER_RULE_Y = 1288;
const LEFT = 60;
const RIGHT = 1812;

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
 */
function obaMark( x, y, height ) {
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

function badge( x, top, label, mode ) {
	const centre = x + BADGE_WIDTH / 2;
	const baseline = top + 68;
	const shape =
		mode === 'rail'
			? `<circle cx="${ centre }" cy="${ top + BADGE_HEIGHT / 2 }" r="${ BADGE_HEIGHT / 2 }" fill="${ INK }"/>`
			: `<rect x="${ x }" y="${ top }" width="${ BADGE_WIDTH }" height="${ BADGE_HEIGHT }" rx="26" fill="${ INK }"/>`;

	// Three-character route numbers need to come down a step to fit the same box.
	const size = String( label ).length > 2 ? 50 : 58;

	return shape + text( centre, baseline, size, label, { fill: '#fff', anchor: 'middle' } );
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
 * @property {string}  to    Trip headsign.
 * @property {string}  value `Now`, a minute count, or a clock time.
 * @property {string}  unit  `min`, `pm`, or empty for `Now`.
 * @property {boolean} live  False when this fell back to `scheduledArrivalTime`.
 *
 * @typedef  {object} Group
 * @property {string}      heading
 * @property {string}      stop
 * @property {Departure[]} rows
 *
 * @typedef  {object} Board
 * @property {'bus'|'rail'} mode
 * @property {string}       agency   Header lockup text. Metro gets its logo instead.
 * @property {Group[]}      groups
 * @property {string}       stopName Shown once in the footer; both groups share it.
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
	let body = '';
	let y = HEADER_HEIGHT;

	groups.forEach( ( group, groupIndex ) => {
		// Negative space before the direction switches, so the groups read as separate boards
		// rather than one long list that happens to have a label in the middle.
		if ( groupIndex > 0 ) {
			y += GROUP_GAP;
		}

		body +=
			`<rect x="0" y="${ y }" width="${ PANEL_WIDTH }" height="${ BAND_HEIGHT }" fill="#e6e6e6"/>` +
			text( LEFT, y + 40, 32, group.heading.toUpperCase(), { fill: '#333', spacing: 3 } ) +
			text( RIGHT, y + 41, 32, group.stop, { weight: 400, fill: GREY, anchor: 'end' } );

		y += BAND_HEIGHT;

		group.rows.forEach( ( row, rowIndex ) => {
			body += badge( LEFT, y + 26, row.badge, mode ) + text( 252, y + 94, 58, row.to );

			// Metro's own answer to the real-time question: the word above the time, small and
			// grey, only on scheduled rows. It needs no legend and costs no contrast.
			if ( ! row.live ) {
				body += text( RIGHT, y + 40, 32, 'Scheduled', { weight: 400, fill: GREY, anchor: 'end' } );
			}

			body += text( RIGHT, y + 106, 76, row.value, { anchor: 'end' } );

			// Units are set heavier than their size implies. That is what keeps them legible at
			// distance, and it is what the official sign does.
			if ( row.unit ) {
				body += text( RIGHT, y + 144, 36, row.unit, { anchor: 'end' } );
			}

			if ( rowIndex < group.rows.length - 1 ) {
				body += `<line x1="${ LEFT }" y1="${ y + ROW_HEIGHT }" x2="${ RIGHT }" y2="${ y + ROW_HEIGHT }" stroke="#c0c0c0" stroke-width="2"/>`;
			}

			y += ROW_HEIGHT;
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
		obaMark( LEFT, 1318, 62 ) +
		// The whole defence against a silently frozen panel. Metro's signs are wired and monitored;
		// ours can fail with no way to say so, and this is the only cue that survives that.
		text( 196, 1362, 38, `as of ${ board.asOf }`, { weight: 400, fill: GREY } ) +
		text( RIGHT, 1362, 38, board.stopName, { weight: 400, fill: GREY, anchor: 'end' } ) +
		`</svg>`
	);
}

export { FAINT, GREY };
