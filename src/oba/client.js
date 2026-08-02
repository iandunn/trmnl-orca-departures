/**
 * Fetching arrivals from OneBusAway.
 *
 * One request per stop, and only one: `arrivals-and-departures-for-stop` already carries
 * `references.routes`, `references.stops` and `references.agencies` alongside the predictions, so
 * route names, stop names, bearings and modes all ride along. A separate `/stop/{id}.json` call is
 * only needed for distance and bearing from a lat/lon origin, which a sign bolted to a wall does not
 * have.
 *
 * **Nothing here throws.** `/api/display` runs ~1440 times a day and a thrown error there costs the
 * device its `refresh_rate`, which flattens the battery. Every failure — network, timeout, HTTP
 * status, an error code inside a 200 body, unparseable JSON — comes back as a result object naming
 * which one it was.
 *
 * **The API key never leaves this module.** It is a query parameter, so the request URL is a secret;
 * no failure path may put the URL, the key, or the raw response into a log line.
 */

import { lastGood, readMemo, writeMemo } from './memo.js';

/**
 * Why a stop's data is unavailable. Each maps to something a human could act on, which is the whole
 * point of naming them rather than collapsing everything into a boolean.
 */
export const OBA_FAILURE_REASONS = {
	/** The request never completed — DNS, TLS, connection reset. */
	unreachable: 'unreachable',
	/** It took longer than a device poll can afford to wait. */
	timeout: 'timeout',
	/** A non-200 HTTP status, including the 429 the shared `TEST` key earns under any real use. */
	httpStatus: 'http-status',
	/** HTTP 200 carrying an error `code`, which is how OneBusAway reports an unknown stop. */
	upstreamError: 'upstream-error',
	/** A 200 whose body is not the shape we parse. */
	malformed: 'malformed',
	/** No key configured. A deploy without `OBA_API_KEY` set, which is a setup error, not an outage. */
	notConfigured: 'not-configured',
};

/**
 * How long to wait for OneBusAway before giving up on it.
 *
 * The device's own read timeout is 15 seconds, and it must get a complete response with a valid
 * `refresh_rate` well inside that. Two stops are fetched concurrently, so this is the worst case for
 * the pair rather than for each. A degraded board delivered promptly beats a correct one delivered
 * after the device has stopped listening.
 */
const REQUEST_TIMEOUT_MS = 6000;

function failure( stopId, reason, detail ) {
	return { ok: false, stopId, reason, ...( detail === undefined ? {} : { detail } ) };
}

/**
 * One stop, straight from the API with no caching.
 *
 * @param {object}   options
 * @param {string}   options.baseUrl  `obaBaseUrl` from `readConfig()`.
 * @param {string}   options.apiKey   `env.OBA_API_KEY`. Never logged, never returned.
 * @param {string}   options.stopId   Full OneBusAway stop ID, e.g. `1_600`.
 * @param {Function} [options.fetchImpl] Injected so tests need no network.
 * @returns {Promise<object>} `{ ok: true, stopId, currentTime, entry, references }` or a failure.
 */
export async function fetchStop( { baseUrl, apiKey, stopId, fetchImpl = fetch } ) {
	if ( typeof apiKey !== 'string' || apiKey.trim() === '' ) {
		return failure( stopId, OBA_FAILURE_REASONS.notConfigured );
	}

	const url = `${ baseUrl }/arrivals-and-departures-for-stop/${ encodeURIComponent(
		stopId
	) }.json?key=${ encodeURIComponent( apiKey ) }`;

	let response;

	try {
		response = await fetchImpl( url, {
			signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
			headers: { Accept: 'application/json' },
		} );
	} catch ( error ) {
		const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';

		// The name only, never the message: a `fetch` TypeError routinely quotes the URL it failed on,
		// and the URL carries the API key.
		return failure(
			stopId,
			timedOut ? OBA_FAILURE_REASONS.timeout : OBA_FAILURE_REASONS.unreachable,
			error?.name
		);
	}

	if ( ! response.ok ) {
		return failure( stopId, OBA_FAILURE_REASONS.httpStatus, response.status );
	}

	let body;

	try {
		body = await response.json();
	} catch {
		return failure( stopId, OBA_FAILURE_REASONS.malformed );
	}

	// OneBusAway reports an unknown stop as HTTP 200 with a non-200 `code` in the body, so the status
	// line alone is not enough to know the request worked.
	if ( body?.code !== 200 ) {
		return failure( stopId, OBA_FAILURE_REASONS.upstreamError, body?.code );
	}

	const entry = body?.data?.entry;

	if ( ! entry || ! Array.isArray( entry.arrivalsAndDepartures ) ) {
		return failure( stopId, OBA_FAILURE_REASONS.malformed );
	}

	return {
		ok: true,
		stopId,
		// The stamp on the glass must come from upstream's clock, not ours. If OneBusAway serves
		// cached predictions, our render time would claim they are fresher than they are — the exact
		// lie the "Updated at" stamp exists to expose.
		currentTime: body.currentTime,
		entry,
		references: body?.data?.references ?? {},
	};
}

/**
 * One stop, through the isolate-local memo.
 *
 * @param {object}  options            As `fetchStop()`, plus:
 * @param {number}  options.nowMs      Our clock, for expiry only.
 * @param {boolean} [options.allowStale] When a fresh fetch fails, fall back to the last good result
 *                                       for this stop rather than reporting the failure. Only
 *                                       `/image` sets this — see `lastGood()` for why.
 * @returns {Promise<object>}
 */
export async function loadStop( { nowMs, allowStale = false, ...options } ) {
	const cached = readMemo( options.stopId, nowMs );

	if ( cached ) {
		return cached;
	}

	const result = await fetchStop( options );

	writeMemo( options.stopId, result, nowMs );

	if ( ! result.ok && allowStale ) {
		return lastGood( options.stopId ) ?? result;
	}

	return result;
}
