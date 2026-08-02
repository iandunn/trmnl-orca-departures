/**
 * `POST /api/log` — the device's own diagnostics, and the only channel that runs back to us.
 *
 * Answered `204`: success, empty body, nothing for the device to parse. There is no `status` field
 * to get wrong here because there is no body at all, which makes this the one endpoint that cannot
 * wedge the device. It answers 204 even when the body is garbage, because a device that cannot file
 * a diagnostic must not conclude the server is broken and start backing off.
 *
 * Implemented from the first commit rather than later, because it is the only window into a device
 * that renders nothing. Three of the firmware's failure paths — malformed body, wrong
 * `Content-Type`, out of memory — draw nothing at all and then settle into 900-second polls, so
 * without this the symptom is a blank panel and no explanation anywhere.
 *
 * ## Two sinks, deliberately, and `console.log` is not the durable one
 *
 * The console line reaches `wrangler tail` live and Workers Logs for a few days, which is the right
 * tool for watching a device you are standing next to. It is the wrong tool for "what happened on
 * Tuesday" — the retention is short, it lives in a separate store, and it cannot be queried
 * alongside the request rows that would explain what the device was reacting to. The entries that
 * matter arrive during a failure, which is exactly when nobody is watching a tail.
 *
 * So every entry also goes to the `DEVICE_LOGS` Analytics Engine dataset via `recordDeviceLogs()`,
 * which caps one request at 64 entries so a device cannot spend the daily write quota, never throws,
 * and returns how many it persisted. `/stats` reads them back.
 */

import { recordDeviceLogs } from '../stats/device-logs.js';

/**
 * The `/api/log` body, one console line per entry.
 *
 * Emitted individually rather than as one array, because the dashboard's log view filters on fields
 * of a line — a batch of eight collapsed into one line cannot be searched by `wake_reason`.
 */
function logDeviceEntries( logs ) {
	if ( ! Array.isArray( logs ) ) {
		console.log( JSON.stringify( { event: 'byos-log-malformed', received: typeof logs } ) );

		return;
	}

	for ( const entry of logs ) {
		console.log( JSON.stringify( { event: 'byos-log-entry', entry } ) );
	}
}

/**
 * @param {Request} request
 * @param {object}  parsed  A `ParsedPath`, for the agency and stops that correlate an entry against
 *                          the request rows around it. Absent on a malformed path.
 * @param {object}  env
 * @returns {Promise<Response>}
 */
export async function handleLog( request, parsed, env ) {
	let payload;

	try {
		payload = await request.json();
	} catch ( error ) {
		// A device that cannot even frame its own diagnostics is worth a line of its own.
		console.log( JSON.stringify( { event: 'byos-log-unparseable', message: String( error ) } ) );
		payload = null;
	}

	if ( payload ) {
		logDeviceEntries( payload.logs );

		try {
			recordDeviceLogs( env, payload.logs, { agency: parsed?.agency, stopIds: parsed?.stopIds } );
		} catch ( error ) {
			// `recordDeviceLogs` is documented never to throw, and this is here anyway: losing history
			// is bad, and failing the only diagnostic channel because history failed is worse.
			console.log( JSON.stringify( { event: 'byos-log-persist-failed', message: String( error ) } ) );
		}
	}

	return new Response( null, { status: 204 } );
}
