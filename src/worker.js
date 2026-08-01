/**
 * TRMNL BYOS server for the departures sign.
 *
 * **The BYOS endpoints are still deliberately unimplemented.** A partially built `/api/display` is
 * more dangerous than none at all: a response missing `refresh_rate` parses as 0 and hot-loops the
 * device until the battery is flat, and a body of `{"status": 500}` factory-resets it. A bare 404
 * is inert, so the device falls back to its own error screen instead of acting on a half-response.
 * `/api/setup`, `/api/display` and `/api/log` only become safe when implemented together.
 *
 * The renderer below is not part of that contract. It is reachable only from the local design
 * preview, which cannot exist on a deployed Worker — see `src/dev/preview.js`.
 */

import { handlePreview } from './dev/preview.js';

const NOT_FOUND = () =>
	new Response( 'Not found', {
		status: 404,
		headers: { 'Content-Type': 'text/plain' },
	} );

export default {
	async fetch( request, env ) {
		const preview = await handlePreview( request, env );

		if ( preview ) {
			return preview;
		}

		return NOT_FOUND();
	},
};
