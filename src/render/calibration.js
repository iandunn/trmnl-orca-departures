/**
 * A test pattern for finding which columns at the panel's left and right edges are actually visible.
 *
 * Each row carries two black bars, one touching each side edge but inset by the row's number of
 * pixels. Where the panel shows every column, row 0's bar meets the bezel and row 1's leaves a
 * one-pixel gap. Where it hides some, every row up to the hidden width looks the same, flush with the
 * bezel, and the first row with a visible white gap reads off how many columns are lost. A 1px gap is
 * at the edge of what the eye resolves at 227 PPI, so read the first row where the gap is clear, not
 * the first where it is suspected.
 *
 * Served only while `CALIBRATION_SCREEN` is set, in place of everything but the malformed-URL screen.
 * Pure.
 */

import { PANEL_HEIGHT, PANEL_WIDTH, text } from './board.js';

const ROWS = 16;
const ROW_HEIGHT = Math.floor( PANEL_HEIGHT / ROWS );
const ROW_GAP = 14;
const BAR_LENGTH = 520;
const LABEL_SIZE = 48;

export function buildCalibrationSvg() {
	let rows = '';

	for ( let inset = 0; inset < ROWS; inset++ ) {
		const top = inset * ROW_HEIGHT + ROW_GAP / 2;
		const height = ROW_HEIGHT - ROW_GAP;
		const baseline = Math.round( top + height / 2 + LABEL_SIZE * 0.35 );

		rows +=
			`<rect x="${ inset }" y="${ top }" width="${ BAR_LENGTH - inset }" height="${ height }" fill="#000"/>` +
			`<rect x="${ PANEL_WIDTH - BAR_LENGTH }" y="${ top }" width="${ BAR_LENGTH - inset }" height="${ height }" fill="#000"/>` +
			text( PANEL_WIDTH / 2, baseline, LABEL_SIZE, `${ inset } px`, { anchor: 'middle' } );
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }">` +
		`<rect width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }" fill="#fff"/>` +
		rows +
		'</svg>'
	);
}
