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

import { rasterize, pngResponse } from '../render/index.js';
import { currentScreen } from './display.js';

/**
 * @param {Request} request
 * @param {object}  target  `{ parsed }` or `{ reason }`.
 * @param {object}  env
 * @returns {Promise<{ response: Response, tag: string }>}
 */
export async function handleImage( request, target, env ) {
	const { screen, svg } = currentScreen( target, env, Date.now() );

	return { tag: screen.tag, response: pngResponse( await rasterize( svg ) ) };
}
