/**
 * `GET /api/setup` — first contact, and the only endpoint the device calls before it has a key.
 *
 * **`status` must be exactly 200 here, which is the opposite of `/api/display`.** Read from source
 * rather than the reference docs, which do not say this: `parse_response_api_setup.cpp:25` bails to
 * `StatusError` unless the body's `status` is 200, and `device_setup.cpp:82` checks it a second
 * time. Sending the `0` that `/api/display` requires makes enrollment fail with nothing on the glass
 * to say why. The two endpoints genuinely want different values.
 *
 * `friendly_id` is required and is easy to miss — the reference field list omits it. The firmware
 * persists it (`device_setup.cpp:92`) and draws it on the setup screen, which is how a person
 * confirms the pairing worked.
 *
 * Unauthenticated by BYOS design — enrollment is how a device gets its key, so it cannot present one
 * — but still behind the path token, which is the whole reason the token is in the URL.
 *
 * ## The setup image is a logo, not a board
 *
 * `image_url` here is downloaded and stored as the setup screen's logo, and the two radio paths
 * disagree about what it may be. On 2.4 GHz the firmware sniffs PNG magic bytes and accepts it
 * (`device_setup.cpp:189`). On the X's 5 GHz modem path it accepts **only** a BMP of exactly 48062
 * bytes — an 800x480 1bpp bitmap, the OG's panel size — and logs a download failure otherwise.
 *
 * That asymmetry is not solvable: the only format both paths accept is one that is broken elsewhere
 * on this hardware. It is also not worth solving, because `api_key` is persisted *before* the image
 * is fetched, so enrollment succeeds either way and the cost is a missing logo on a screen shown
 * once. We serve a PNG, which is right for 2.4 GHz and merely cosmetic on 5 GHz.
 */

import { deriveApiKey, deriveFriendlyId } from './credentials.js';
import { imageUrl } from './display.js';

/**
 * @param {Request} request
 * @param {string}  basePath The device's stored base URL path, which the image URL must extend.
 * @param {object}  env
 * @returns {Promise<Response>}
 */
export async function handleSetup( request, basePath, env ) {
	const [ apiKey, friendlyId ] = await Promise.all( [
		deriveApiKey( env?.DEVICE_TOKEN ),
		deriveFriendlyId( env?.DEVICE_TOKEN ),
	] );

	return new Response(
		JSON.stringify( {
			status: 200,
			api_key: apiKey,
			friendly_id: friendlyId,
			image_url: imageUrl( request, basePath, 'setup' ),
			message: 'Paired with the departures sign.',
		} ),
		{ headers: { 'Content-Type': 'application/json' } }
	);
}
