/**
 * The screen the sign shows when it cannot show departures.
 *
 * **This deliberately does not look like the board.** `CLAUDE.md`'s requirement is that someone
 * glancing from the doorway sees immediately that the sign is not currently telling them when the
 * bus comes — a normal-looking board with small print at the bottom fails that, because the thing a
 * reader checks for is the shape of the rows, not the words. So there are no rows, no badges and no
 * direction bands here: the panel is mostly empty with one sentence in it, which is unmistakable at
 * distance and cannot be confused with a quiet stop.
 *
 * Sharing the board's header bar is the one piece of continuity that is worth keeping. It carries
 * the day, date and clock, and those are half the staleness defence — a notice screen frozen since
 * yesterday has to be as detectable as a frozen board.
 *
 * Pure, like `board.js`: takes data, returns markup, touches no wasm and no fonts.
 */

import { PANEL_HEIGHT, PANEL_WIDTH, text } from './board.js';

const INK = '#111';
const GREY = '#6b6b6b';

const HEADER_HEIGHT = 102;
const FOOTER_RULE_Y = 1288;
const LEFT = 60;
const RIGHT = 1812;

const CENTRE = PANEL_WIDTH / 2;

/**
 * @typedef  {object} Notice
 * @property {string} headline One short line, set very large. The whole message at a glance.
 * @property {string} detail   A sentence of explanation, for someone standing closer.
 * @property {string} stopName Footer, matching the board so the sign still says which stop it is.
 * @property {string} weekday
 * @property {string} date
 * @property {string} clock
 * @property {string} meridiem
 * @property {string} asOf
 */

const DETAIL_SIZE = 52;
const DETAIL_LINE_HEIGHT = 68;

/**
 * Roughly how wide a character of Fira Sans is, as a fraction of the font size.
 *
 * An estimate, because resvg gives us no text-measurement API — the SVG is a string and nothing
 * measures it until rasterisation, by which point the layout is already decided. Deliberately
 * pessimistic: an over-estimate wraps a line early, which looks slightly loose, while an
 * under-estimate runs the sentence off both edges of the panel with the middle still legible, so it
 * reads as working right up until someone reads the whole line. That is exactly how this was missed
 * the first time, and it is why the wrap is checked against a rendered PNG rather than a unit test.
 */
const CHARACTER_WIDTH_RATIO = 0.54;

const DETAIL_MAX_CHARACTERS = Math.floor( ( RIGHT - LEFT ) / ( DETAIL_SIZE * CHARACTER_WIDTH_RATIO ) );

/**
 * Greedy word wrap. A single word longer than the limit is left to overflow rather than hyphenated —
 * every string that reaches here is ours, so that case means the copy needs shortening, not that the
 * renderer needs a hyphenation algorithm.
 *
 * @param {string} value
 * @param {number} maxCharacters
 * @returns {string[]}
 */
export function wrapText( value, maxCharacters = DETAIL_MAX_CHARACTERS ) {
	const lines = [];
	let current = '';

	for ( const word of String( value ).split( /\s+/ ).filter( Boolean ) ) {
		const candidate = current ? `${ current } ${ word }` : word;

		if ( candidate.length > maxCharacters && current ) {
			lines.push( current );
			current = word;
		} else {
			current = candidate;
		}
	}

	if ( current ) {
		lines.push( current );
	}

	return lines;
}

/**
 * @param {Notice} notice
 * @returns {string} SVG markup at native panel resolution.
 */
export function buildNoticeSvg( notice ) {
	const { headline = '', detail = '', stopName = '' } = notice;

	const detailLines = wrapText( detail )
		.map( ( line, index ) =>
			text( CENTRE, 754 + index * DETAIL_LINE_HEIGHT, DETAIL_SIZE, line, {
				weight: 400,
				fill: GREY,
				anchor: 'middle',
			} )
		)
		.join( '' );

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }">` +
		`<rect width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" fill="#fff"/>` +
		`<rect width="${ PANEL_WIDTH }" height="${ HEADER_HEIGHT }" fill="${ INK }"/>` +
		text( 56, 68, 58, 'Departures', { fill: '#fff' } ) +
		text( 1560, 36, 28, notice.weekday, { weight: 400, fill: '#e0e0e0', anchor: 'end' } ) +
		text( 1560, 70, 28, notice.date, { weight: 400, fill: '#e0e0e0', anchor: 'end' } ) +
		text( 1752, 68, 60, notice.clock, { weight: 400, fill: '#fff', anchor: 'end' } ) +
		text( RIGHT, 68, 34, notice.meridiem, { fill: '#fff', anchor: 'end' } ) +
		// Centred rather than left-aligned, which is the other half of "does not look like a board".
		// Every row on the real layout starts at the left margin; nothing on it is centred.
		//
		// The headline is deliberately not wrapped: at 116px only about 28 characters fit, and a
		// headline that needs two lines is a headline that needs rewriting. Keep them to three or four
		// words — the detail line below is where the sentence goes.
		text( CENTRE, 660, 116, headline, { anchor: 'middle' } ) +
		detailLines +
		`<line x1="0" y1="${ FOOTER_RULE_Y }" x2="${ PANEL_WIDTH }" y2="${ FOOTER_RULE_Y }" stroke="#c0c0c0" stroke-width="2"/>` +
		// No OneBusAway mark here: nothing on this screen came from OneBusAway, and stamping their
		// logo on a screen that exists because we have no data from them would be a small lie.
		text( LEFT, 1362, 38, `Updated at ${ notice.asOf }`, { weight: 400, fill: GREY } ) +
		text( RIGHT, 1362, 38, stopName, { weight: 400, fill: GREY, anchor: 'end' } ) +
		`</svg>`
	);
}
