/**
 * A short-lived, isolate-local cache of OneBusAway responses, keyed by stop.
 *
 * ## Why this exists at all
 *
 * The device makes **two** requests per wake, and they must agree. `/api/display` builds the board,
 * hashes the SVG into `filename`, and hands that name back; the device then fetches
 * `/image/<filename>`, which rebuilds the same screen from scratch because nothing is stored. Fetch
 * OneBusAway twice and the two renders disagree — different predictions, and a different `currentTime`
 * driving the "Updated at" stamp — so the bytes on the glass are not the bytes the name was hashed
 * over. Sharing one response makes them identical, and halves upstream traffic from ~2880 calls a
 * day to ~1440 while it is at it.
 *
 * ## Why a plain `Map` and not the Cache API or KV
 *
 * The two requests land seconds apart and almost always in the same isolate, so module scope is
 * enough. A miss simply refetches, which is the behaviour we would have had anyway — there is no
 * correctness cliff, only a missed optimisation. KV is ruled out for the same reason it is ruled out
 * for rate limiting: its free write quota is 1000 a day against this sign's ~1440 polls. The Cache
 * API might work, but whether `caches.default` is honoured on a `workers.dev` subdomain is exactly
 * the kind of thing that fails silently here, and it is not worth a spike for a 60-second cache.
 *
 * ## Failures expire faster than successes, deliberately
 *
 * Caching a failure for a full minute would keep a recovered upstream invisible for up to a minute,
 * turning a one-second blip into a minute of degraded screen. But it still has to outlast the gap
 * between a wake's two requests, or the pair disagrees in the other direction: `/api/display` fails
 * and hands back an `obafail-` filename, `/image` refetches, succeeds, and the device caches a
 * perfectly good board under a name that says the upstream was down. So the failure TTL is set to
 * comfortably span that gap on a slow radio, and kept well under the refresh interval so the next
 * poll always asks again.
 */

/** Long enough to span a wake's two requests, short enough that nothing on the glass goes stale. */
const SUCCESS_TTL_MS = 60000;

/** Spans the pair even on a slow link, and still expires before the next poll. See the note above. */
const FAILURE_TTL_MS = 20000;

/** `stopId` → `{ expiresAt, result }`. Isolate-local; a cold isolate simply starts empty. */
const entries = new Map();

/** `stopId` → the last result that succeeded, with no expiry. See `lastGood()`. */
const lastGoodResults = new Map();

/**
 * @param {string} stopId Full OneBusAway stop ID.
 * @param {number} nowMs
 * @returns {object|undefined} The cached result, or undefined when absent or expired.
 */
export function readMemo( stopId, nowMs ) {
	const entry = entries.get( stopId );

	if ( ! entry ) {
		return undefined;
	}

	if ( entry.expiresAt <= nowMs ) {
		entries.delete( stopId );

		return undefined;
	}

	return entry.result;
}

/**
 * @param {string}  stopId
 * @param {object}  result  As returned by `fetchStop()`.
 * @param {number}  nowMs
 */
export function writeMemo( stopId, result, nowMs ) {
	entries.set( stopId, {
		expiresAt: nowMs + ( result?.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS ),
		result,
	} );

	if ( result?.ok ) {
		lastGoodResults.set( stopId, result );
	}
}

/**
 * The most recent successful result for a stop, however old.
 *
 * Only `/image` should reach for this, and only after a fresh fetch has failed. The alternative is
 * worse than stale data: `/api/display` has already handed the device a `departs` filename, so an
 * error board served under that name paints a failure screen the device will then cache as though it
 * were a good board. Repeating the last good render keeps the bytes close to what the name promised,
 * and the "Updated at" stamp on it is the honest cue that it is not current.
 *
 * @param {string} stopId
 * @returns {object|undefined}
 */
export function lastGood( stopId ) {
	return lastGoodResults.get( stopId );
}

/** Tests only. Module state would otherwise leak between cases. */
export function clearMemo() {
	entries.clear();
	lastGoodResults.clear();
}
