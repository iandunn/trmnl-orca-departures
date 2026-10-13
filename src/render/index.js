/**
 * SVG to a 4-bit greyscale PNG, via resvg.
 *
 * Two things here are load-bearing and both cause plausible-looking failures if changed:
 *
 * - **The wasm must arrive pre-compiled.** `wrangler.toml` must NOT list a wasm glob among its Data
 *   rules; that overrides wrangler's built-in `CompiledWasm` rule, hands `initWasm()` raw bytes, and
 *   workerd throws `CompileError: Wasm code generation disallowed by embedder`. Only the font glob
 *   belongs there.
 * - **Fonts must be TTF or OTF.** resvg parses raw sfnt and cannot decompress a WOFF container, so
 *   a `.woff` is rejected with no error and every `<text>` element silently vanishes while rects
 *   and rules draw normally. A blank-but-valid PNG passes every check short of looking at it.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '../../node_modules/@resvg/resvg-wasm/index_bg.wasm';
import firaSansRegular from '../../node_modules/@expo-google-fonts/fira-sans/400Regular/FiraSans_400Regular.ttf';
import firaSansBold from '../../node_modules/@expo-google-fonts/fira-sans/700Bold/FiraSans_700Bold.ttf';
import { PANEL_HEIGHT, PANEL_WIDTH, SIGN_FONT, buildBoardSvg } from './board.js';
import { buildNoticeSvg } from './notice.js';
import { encodeGreyscalePng } from './png.js';

let wasmReady;

function fontOptions() {
	return {
		font: {
			fontBuffers: [ new Uint8Array( firaSansRegular ), new Uint8Array( firaSansBold ) ],
			defaultFontFamily: SIGN_FONT,
		},
	};
}

/**
 * @param {string} svg
 * @returns {Promise<Uint8Array>} A 4-bit greyscale PNG at panel resolution.
 */
export async function rasterize( svg ) {
	wasmReady ??= initWasm( resvgWasm );
	await wasmReady;

	// `.pixels`, never `.asPng()` — see png.js for why. Always encoded at the panel size, so a render of
	// any other size throws and fails as a 500: an image wider than the panel crash-loops the X.
	const pixels = new Resvg( svg, fontOptions() ).render().pixels;

	return encodeGreyscalePng( pixels, PANEL_WIDTH, PANEL_HEIGHT );
}

/**
 * @param {import('./board.js').Board} board
 * @returns {Promise<Uint8Array>}
 */
export async function renderBoard( board ) {
	return rasterize( buildBoardSvg( board ) );
}

/**
 * @param {import('./notice.js').Notice} notice
 * @returns {Promise<Uint8Array>}
 */
export async function renderNotice( notice ) {
	return rasterize( buildNoticeSvg( notice ) );
}

/**
 * Content-Type must be **exactly** `image/png`. The firmware picks its decode path by string
 * comparison, not magic bytes, so any charset parameter or different casing sends a perfect PNG
 * down the BMP path, where it fails and displays nothing with no error.
 */
export function pngResponse( bytes ) {
	return new Response( bytes, { headers: { 'Content-Type': 'image/png' } } );
}
