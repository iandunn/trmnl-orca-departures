/**
 * An approximation of how a render's colours look on the X's glass, for pictures of the sign rather
 * than for the sign itself.
 *
 * E-paper has no true white or black: an image's white shows as the panel's grey-white paper and its
 * black as a slightly soft ink. A render shown on a monitor as-is overstates light tints, which is what
 * `/_preview` and the README screenshots exist to judge.
 *
 * Colour only. The panel's off-centre placement — `GLASS_HIDDEN_LEFT` and `GLASS_STRIP_RIGHT` in
 * `render/board.js` — is deliberately not drawn, so pictures of the sign show the whole design rather
 * than one unit's hardware quirk.
 *
 * Never used on anything the device receives. Pure.
 */

export const EPAPER_PAPER = [ 218, 217, 210 ];
export const EPAPER_INK = [ 38, 38, 38 ];

/**
 * Takes the device's own 4-bit scanlines rather than the raw render, so a tint too light to survive
 * the device's 16 grey levels shows as white here too — the same input `/_preview` filters.
 *
 * @param {Uint8Array} scanlines As `quantizeToScanlines()` in `render/png.js` returns them: a filter
 *                               byte per row, then two 4-bit pixels per byte.
 * @param {number}     width
 * @param {number}     height
 * @returns {Uint8Array} 3 bytes per pixel, the same size as the render.
 */
export function inEpaperColours( scanlines, width, height ) {
	const out = new Uint8Array( width * height * 3 );
	const stride = ( width >> 1 ) + 1;

	for ( let y = 0; y < height; y++ ) {
		for ( let x = 0; x < width; x++ ) {
			const packed = scanlines[ y * stride + 1 + ( x >> 1 ) ];
			const value = ( ( x & 1 ? packed & 0x0f : packed >> 4 ) * 255 ) / 15;
			const dst = ( y * width + x ) * 3;

			for ( let channel = 0; channel < 3; channel++ ) {
				out[ dst + channel ] = Math.round(
					EPAPER_INK[ channel ] + ( ( EPAPER_PAPER[ channel ] - EPAPER_INK[ channel ] ) * value ) / 255
				);
			}
		}
	}

	return out;
}
