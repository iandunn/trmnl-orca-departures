/**
 * Live departures, from a parsed request path to a board the renderer can draw.
 *
 * The one module `src/byos/` talks to. Everything below it is either pure (`departures.js`,
 * `format.js`) or purely I/O (`client.js`, `memo.js`), which is what keeps the mapping rules testable
 * against captured fixtures.
 *
 * **Nothing here throws.** Every failure resolves to `{ ok: false, reason }` and the caller picks a
 * degraded screen. A throw out of `/api/display` costs the device its `refresh_rate`, and a device
 * with no refresh rate hot-loops until the battery is flat.
 */

import { formatBoardTime } from '../clock.js';
import { maxRowsPerGroup } from '../render/board.js';
import { toOneBusAwayId } from '../routing.js';
import { loadStop, OBA_FAILURE_REASONS } from './client.js';
import { dataTimestamp, hasDepartures, stopReference, toBoard } from './departures.js';
import { lastGood } from './memo.js';

/**
 * Why no board could be built. Distinct from a per-stop failure: a board survives one stop failing.
 */
export const BOARD_FAILURE_REASONS = {
	/** No stop returned usable data. */
	upstream: 'upstream',
	/** Data came back without a usable `currentTime`, so nothing can be honestly stamped. */
	untimestamped: 'untimestamped',
};

/**
 * A stop's failure, in one line, so a silent sign can be explained after the fact.
 *
 * The stop ID is logged in the clear, for the same reason `/stats` prints it: "which stop was this
 * failing request for" is the entire question these lines exist to answer, and the alternative is a
 * log that records that something broke without saying what. The *path* is still never logged — that
 * carries the shared secret, which this does not.
 */
function logFailure( result ) {
	console.log(
		JSON.stringify( {
			event: 'oba-fetch-failed',
			stopId: result.stopId,
			reason: result.reason,
			...( result.detail === undefined ? {} : { detail: result.detail } ),
		} )
	);
}

/**
 * The same failures as one short string, for `/stats`.
 *
 * `logFailure()` above is the detailed record and is fine for someone watching a tail. This is the
 * queryable one: `filenameTag` already says a poll ended in `obafail`, which is *that* it failed and
 * never *why*, and 429-because-the-key-is-rate-limited has a fix while a timeout does not.
 *
 * **The HTTP status is folded into the slug** — `http-429`, not `http-status` — because the status is
 * the whole content of that reason. Distinct reasons are joined, so two stops failing differently
 * stay distinguishable, and the values stay short enough to group on.
 *
 * Empty when every stop answered, which is the overwhelming majority of rows.
 *
 * @param {Array} results
 * @returns {string}
 */
function summariseFailures( results ) {
	const reasons = results
		.filter( ( result ) => ! result.ok )
		.map( ( result ) =>
			result.reason === OBA_FAILURE_REASONS.httpStatus && result.detail !== undefined
				? `http-${ result.detail }`
				: result.reason
		);

	return [ ...new Set( reasons ) ].sort().join( ' ' );
}

/**
 * @param {object}  options
 * @param {object}  options.env
 * @param {object}  options.config      From `readConfig()`.
 * @param {object}  options.parsed      From `parsePath()`.
 * @param {number}  options.nowMs       Our clock. Used only for cache expiry — never for the stamp.
 * @param {boolean} [options.allowStale] Passed through to `loadStop()`. `/image` sets it.
 * @returns {Promise<{ ok: true, board: object, complete: boolean, empty: boolean }
 *                  | { ok: false, reason: string }>}
 */
export async function loadBoard( { env, config, parsed, nowMs, allowStale = false } ) {
	const { agency, stopIds } = parsed;

	const results = await Promise.all(
		stopIds.map( ( stopId ) =>
			loadStop( {
				baseUrl: config.obaBaseUrl,
				apiKey: env?.OBA_API_KEY,
				stopId: toOneBusAwayId( agency, stopId ),
				nowMs,
				allowStale,
			} )
		)
	);

	results.filter( ( result ) => ! result.ok ).forEach( logFailure );

	const upstreamReason = summariseFailures( results );

	if ( results.every( ( result ) => ! result.ok ) ) {
		return { ok: false, reason: BOARD_FAILURE_REASONS.upstream, upstreamReason };
	}

	const timestamp = dataTimestamp( results );

	// `formatBoardTime()` throws on a non-finite timestamp, deliberately, and this is the call site
	// that decides what that means. Falling back to our own clock is the tempting fix and the wrong
	// one: it would stamp the board with a time that says nothing about how fresh the predictions
	// are, which is the single claim the stamp exists to make.
	if ( timestamp === null ) {
		return { ok: false, reason: BOARD_FAILURE_REASONS.untimestamped };
	}

	// A stop's name and bearing are facts about the pole rather than about this fetch, so a group whose
	// request just failed can still label its band from whatever the isolate last saw. Only on a cold
	// isolate is there nothing, and then the band falls back to the bare stop ID.
	const knownStops = Object.fromEntries(
		stopIds
			.map( ( stopId ) => toOneBusAwayId( agency, stopId ) )
			.map( ( obaStopId ) => [ obaStopId, stopReference( lastGood( obaStopId ), obaStopId ) ] )
			.filter( ( [ , reference ] ) => reference )
	);

	const board = toBoard( results, {
		agency,
		stopIds,
		knownStops,
		directionOverrides: config.directionOverrides,
		nowMs: timestamp,
		timezone: config.timezone,
		limit: maxRowsPerGroup( stopIds.length ),
		time: formatBoardTime( timestamp, config.timezone ),
	} );

	return {
		ok: true,
		board,
		complete: results.every( ( result ) => result.ok ),
		empty: ! hasDepartures( board ),
		// Recorded on a board that drew, because a partial failure never reaches `obafail` and would
		// otherwise be invisible — which is exactly how a quota problem starts.
		upstreamReason,
	};
}
