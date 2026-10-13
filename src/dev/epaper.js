/**
 * An approximation of how a render looks on the X's glass, for pictures of the sign rather than for
 * the sign itself.
 *
 * E-paper has no true white or black: an image's white shows as the panel's grey-white paper and its
 * black as a slightly soft ink. And the first X places the image a few pixels left of the glass, so
 * some columns are lost on the left and a strip of bare paper shows on the right. A render shown on a
 * monitor as-is overstates light tints and hides both edges, which is what `/_preview` and the README
 * screenshots exist to judge.
 *
 * Never used on anything the device receives. Pure.
 */

import { GLASS_HIDDEN_LEFT, GLASS_STRIP_RIGHT, PANEL_WIDTH } from '../render/board.js';

export const EPAPER_PAPER = [ 218, 217, 210 ];
export const EPAPER_INK = [ 38, 38, 38 ];

/** The visible glass, in image pixels. */
export const GLASS_WIDTH = PANEL_WIDTH - GLASS_HIDDEN_LEFT + GLASS_STRIP_RIGHT;

/**
 * Takes the device's own 4-bit scanlines rather than the raw render, so a tint too light to survive
 * the device's 16 grey levels shows as white here too — the same input `/_preview` filters.
 *
 * @param {Uint8Array} scanlines As `quantizeToScanlines()` in `render/png.js` returns them: a filter
 *                               byte per row, then two 4-bit pixels per byte.
 * @param {number}     width     The panel's width.
 * @param {number}     height
 * @returns {{ rgb: Uint8Array, width: number, height: number }} The visible glass, 3 bytes per pixel.
 */
export function onGlass( scanlines, width, height ) {
	const out = new Uint8Array( GLASS_WIDTH * height * 3 );
	const stride = ( width >> 1 ) + 1;

	for ( let y = 0; y < height; y++ ) {
		for ( let x = 0; x < GLASS_WIDTH; x++ ) {
			const source = x + GLASS_HIDDEN_LEFT;
			const dst = ( y * GLASS_WIDTH + x ) * 3;
			const packed = source < width ? scanlines[ y * stride + 1 + ( source >> 1 ) ] : 0xff;
			const value = ( ( source & 1 ? packed & 0x0f : packed >> 4 ) * 255 ) / 15;

			for ( let channel = 0; channel < 3; channel++ ) {
				out[ dst + channel ] = Math.round(
					EPAPER_INK[ channel ] + ( ( EPAPER_PAPER[ channel ] - EPAPER_INK[ channel ] ) * value ) / 255
				);
			}
		}
	}

	return { rgb: out, width: GLASS_WIDTH, height };
}
