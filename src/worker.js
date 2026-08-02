/**
 * TRMNL BYOS server for the departures sign.
 *
 * Deliberately nothing but the seam between two pieces. `src/gate.js` is everything above the
 * handlers — token comparison, the bot tarpit, outcome recording, and the `/stats` page — and it
 * returns either a finished response or an authorized classification. `src/byos/` is the four device
 * routes, one file per endpoint, dispatched on that classification.
 *
 * The four went in together rather than one at a time: a partially built `/api/display` is more
 * dangerous than none at all, because a response missing `refresh_rate` parses as 0 and hot-loops
 * the device until the battery is flat, and a body of `{"status": 500}` factory-resets it.
 *
 * The renderer is not part of that contract. Beyond what the handlers draw, it is reachable only
 * from the local design preview, which cannot exist on a deployed Worker — see `src/dev/preview.js`.
 */

import { dispatchByos } from './byos/index.js';
import { readConfig } from './config.js';
import { handlePreview } from './dev/preview.js';
import { gate } from './gate.js';

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

		// Authorized. `classification` carries the parsed agency, stops and route, plus a rejection
		// reason when the path was malformed — which is served as a rendered board rather than a 404,
		// because a caller holding the shared secret has earned an explanation.
		//
		// `recordOutcome()` is called exactly once inside the dispatch, by whichever branch actually
		// ran; see `src/gate.js` for why it cannot be called here instead.
		return dispatchByos( request, env, classification, recordOutcome );
	},
};
