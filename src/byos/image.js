/**
 * `GET /image/<filename>` — the bytes themselves.
 *
 * **The requested filename is ignored, on purpose.** Nothing is stored, so there is nothing to look
 * up: the handler rebuilds the current screen and serves it. That is safe because the device caches
 * on the *name*, not the bytes — it only ever fetches a filename it was just handed by
 * `/api/display`, and it re-fetches precisely when that name changed. Serving "whatever is current"
 * therefore answers the question it is actually asking. Both endpoints build the screen through
 * `currentScreen()` so the two can never disagree about what a given name means.
 *
 * `Content-Type` must be **exactly** `image/png`, which `pngResponse()` exists to guarantee in one
 * place. The firmware picks its decode path by string-comparing that header rather than by sniffing
 * magic bytes, so a perfect PNG served as `application/octet-stream` takes the BMP path, fails, and
 * displays nothing with no error.
 *
 * Never redirect. On the image request the firmware gives 307/308 exactly one hop and **drops the
 * auth headers** doing it, 301 is accepted and then fails as "No data received", and 302 hard-fails.
 * Serve 200 directly.
 */

import { FILENAME_TAGS } from '../filename.js';
import { rasterize, pngResponse } from '../render/index.js';
import { currentScreen } from './display.js';

/**
 * @param {Request} request
 * @param {object}  target  `{ parsed }` or `{ reason }`.
 * @param {object}  env
 * @returns {Promise<{ response: Response, tag: string }>}
 */
export async function handleImage( request, target, env ) {
	// `allowStale` is set here and nowhere else. `/api/display` has already handed the device a
	// filename derived from a board it built successfully; if OneBusAway then fails between the two
	// requests, serving an error board under that name paints a failure the device caches as though it
	// were a good board. Repeating the last good response keeps the bytes close to what the name
	// promised, and the "Updated at" stamp on them is the honest cue that they are not current.
	const { screen, svg } = await currentScreen( target, env, Date.now(), { allowStale: true } );

	try {
		return { tag: screen.tag, response: pngResponse( await rasterize( svg ) ) };
	} catch ( error ) {
		// `currentScreen()` swallows its own throws, so rasterising is the only thing left that can fail
		// here — and it fails for the whole panel, which rules out drawing a notice instead, since that
		// would go through the same rasteriser. A 500 is survivable on this route in a way it is not on
		// `/api/display`: no `refresh_rate` rides on it, so the worst case is a failed download and the
		// panel keeping what it already had. Letting it propagate instead would skip `recordOutcome()`
		// and leave the one endpoint that drew nothing missing from `/stats`.
		console.log( JSON.stringify( { event: 'byos-image-rasterize-failed', message: String( error ) } ) );

		return {
			tag: FILENAME_TAGS.renderFailed,
			response: new Response( 'Render failed', {
				status: 500,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			} ),
		};
	}
}
