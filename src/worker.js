/**
 * TRMNL BYOS server for the departures sign.
 *
 * **The BYOS endpoints are still deliberately unimplemented.** A partially built `/api/display` is
 * more dangerous than none at all: a response missing `refresh_rate` parses as 0 and hot-loops the
 * device until the battery is flat, and a body of `{"status": 500}` factory-resets it. A bare 404
 * is inert, so the device falls back to its own error screen instead of acting on a half-response.
 * `/api/setup`, `/api/display` and `/api/log` only become safe when implemented together.
 *
 * Everything above the 404 is in `src/gate.js`: token comparison, the bot tarpit, outcome recording,
 * and the `/stats` page. This file is deliberately only the seam between them — when the BYOS
 * endpoints land, they replace the final branch below and nothing else here needs to change.
 *
 * The renderer is not part of that contract. It is reachable only from the local design preview,
 * which cannot exist on a deployed Worker — see `src/dev/preview.js`.
 */

import { readConfig } from './config.js';
import { handlePreview } from './dev/preview.js';
import { gate } from './gate.js';

const NOT_FOUND = () =>
	new Response( 'Not found', {
		status: 404,
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	} );

export default {
	async fetch( request, env ) {
		const preview = await handlePreview( request, env );

		if ( preview ) {
			return preview;
		}

		const config = readConfig( env );
		const { response, classification, recordOutcome } = await gate( request, env, config );

		if ( response ) {
			return response;
		}

		// Authorized, well-formed, and still a 404 — the three BYOS endpoints go in together or not at
		// all. `classification` carries the parsed agency, stops and route, plus a rejection reason when
		// the path was malformed, so the handlers that replace this branch have everything they need.
		//
		// `recordOutcome()` must be called exactly once per authorized request; see `src/gate.js`.
		recordOutcome( { outcome: classification.outcome } );

		return NOT_FOUND();
	},
};
