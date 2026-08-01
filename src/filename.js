/**
 * Builds the `filename` field the device caches on.
 *
 * This is the most load-bearing pure function in the project. The device uses `filename` as a
 * cache key in two independent places — a flash existence check that gates the download, and an
 * RTC string compare that gates the repaint — so the name must change when the image bytes change
 * and must not change when they don't. Each direction fails differently: a name that never changes
 * freezes the panel forever while the server serves perfectly fresh JSON, and a name that changes
 * every poll costs a download plus a visible full-panel flash every time.
 *
 * Three firmware rules constrain the shape, all documented in `CLAUDE.md`:
 *
 * 1. The last 10 characters must be ASCII digits forming a plausible recent epoch. The purge that
 *    runs before every image write extracts them as a timestamp and deletes anything over 24h old
 *    — and a name that doesn't end in 10 digits extracts as 0, which always reads as stale. A
 *    trailing `.png` alone is enough to trigger this, which is why these names carry no extension.
 * 2. The total length must never be exactly 31. At 31 the firmware copies without writing a NUL
 *    terminator, so the cache key ends in stack garbage and stops being deterministic.
 * 3. Over 31 characters the middle is discarded, keeping only the first 7 and last 17.
 *
 * The fixed 7 + 6 + 10 layout plus two separators is always 25 characters, which satisfies all
 * three by construction rather than by checking. Keep it that way — the tag length is validated
 * precisely so the total cannot drift toward 31.
 *
 * None of these numbers are covered by upstream tests and HEAD is itself a filesystem refactor, so
 * treat 31 / 7 / 17 / 86400 as liable to move.
 */

const TAG_LENGTH = 7;
const HASH_LENGTH = 6;
const HASH_RADIX = 36;
const HASH_SPACE = HASH_RADIX ** HASH_LENGTH;

/** 10-digit epoch seconds. Covers 2001-09-09 through 2286-11-20. */
const MIN_EPOCH_SECONDS = 1000000000;
const MAX_EPOCH_SECONDS = 9999999999;

/**
 * The epoch component advances in 12-hour steps rather than tracking the clock.
 *
 * The two halves of the filename do different jobs, and conflating them is the trap. The hash
 * already changes exactly when the image changes, so the epoch does not need to — its only job is
 * to satisfy the firmware's purge, which reads the trailing 10 digits as a timestamp and deletes
 * anything over 24h old. Quantizing means no persistence is needed to answer "when did this
 * content first appear", which would otherwise be a storage write on nearly every poll.
 *
 * 12 hours specifically, not a rounder number:
 *
 * - It leaves a wide margin under the 24h purge threshold, so the current image is never near
 *   deletion. A 24h bucket would sit exactly on the threshold just before rolling over.
 * - It puts one of the two daily boundaries inside the overnight sleep window, where a rollover
 *   costs nothing because the device is not awake to see it and repaints on waking anyway.
 *
 * The offset lands boundaries at 09:00 and 21:00 UTC — roughly 2am and 2pm Pacific. DST shifts
 * that by an hour, which does not matter; the target is "somewhere in the middle of the night",
 * not a precise time. The cost is at most one otherwise-unnecessary repaint per day, in the early
 * afternoon.
 *
 * Do not "simplify" this to `Math.floor( now / 3600 )`. Every boundary crossing is a full-panel
 * flash on a board whose content may not have changed, and hourly buckets would spend 24 of them
 * a day to save nothing.
 */
const EPOCH_BUCKET_SECONDS = 12 * 60 * 60;
const EPOCH_BUCKET_OFFSET_SECONDS = 9 * 60 * 60;

/**
 * Every state the sign can be in needs its own tag, because an error screen whose filename matches
 * the last good render is suppressed by the cache and never reaches the glass.
 *
 * Exactly `TAG_LENGTH` characters each, lowercase alphanumeric.
 */
export const FILENAME_TAGS = {
	departures: 'departs',
	noDepartures: 'noservc',
	upstreamFailed: 'obafail',
	renderFailed: 'rnderrs',
};

const TAG_PATTERN = /^[a-z0-9]{7}$/;

const encoder = new TextEncoder();

/**
 * FNV-1a, 32-bit. Chosen over `crypto.subtle` because that is async and this needs to stay a pure
 * synchronous function; the hash only has to distinguish one render from the next, not resist an
 * adversary.
 */
function hash32( bytes ) {
	let hash = 0x811c9dc5;

	for ( let i = 0; i < bytes.length; i++ ) {
		hash ^= bytes[ i ];
		hash = Math.imul( hash, 0x01000193 );
	}

	return hash >>> 0;
}

function shortHash( content, salt ) {
	const bytes = typeof content === 'string' ? encoder.encode( content ) : content;
	const salted = salt ? hash32( encoder.encode( `${ hash32( bytes ) }:${ salt }` ) ) : hash32( bytes );

	return ( salted % HASH_SPACE ).toString( HASH_RADIX ).padStart( HASH_LENGTH, '0' );
}

/**
 * @param {object}             options
 * @param {string}             options.tag           One of `FILENAME_TAGS`. Identifies which state
 *                                                   is being shown, so degraded screens never
 *                                                   collide with a good render.
 * @param {string|Uint8Array}  options.content       The rendered bytes, or any value that changes
 *                                                   exactly when the image does.
 * @param {number}             options.epochSeconds  When this content **first appeared** — not the
 *                                                   current time. Passing `Date.now() / 1000` on
 *                                                   every request defeats the cache entirely and
 *                                                   flashes the panel on every poll.
 * @param {string}             [options.salt]        Perturbs the name for identical content. Pass a
 *                                                   recovery generation here after any outage:
 *                                                   firmware-drawn error screens never update the
 *                                                   device's cached filename, so a recovered server
 *                                                   returning its previous name leaves the error
 *                                                   screen on the glass indefinitely.
 * @returns {string} A 25-character cache key, e.g. `departs-3f9x1a-1785564693`.
 */
/**
 * The epoch component to pass to `buildFilename`, quantized per `EPOCH_BUCKET_SECONDS`.
 *
 * **This is not a recovery mechanism, despite looking like one.** A boundary crossing does change
 * the filename and so does force a repaint, which happens to clear a firmware error screen that
 * the cache would otherwise leave on the glass forever. That covers the server-outage case within
 * 12 hours. It does **not** cover the WiFi case: after 4 consecutive WiFi failures the device
 * sleeps with no timer armed and never wakes on its own, so no filename we generate reaches it.
 * Recovery from a known outage still needs the `salt` parameter and real state behind it.
 *
 * @param {number} nowSeconds Current time in epoch seconds.
 * @returns {number} A 10-digit epoch, stable for up to 12 hours.
 */
export function stableEpoch( nowSeconds ) {
	if ( ! Number.isFinite( nowSeconds ) ) {
		throw new TypeError( `stableEpoch needs epoch seconds, got ${ JSON.stringify( nowSeconds ) }` );
	}

	const shifted = Math.floor( nowSeconds ) - EPOCH_BUCKET_OFFSET_SECONDS;

	return Math.floor( shifted / EPOCH_BUCKET_SECONDS ) * EPOCH_BUCKET_SECONDS + EPOCH_BUCKET_OFFSET_SECONDS;
}

export function buildFilename( { tag, content, epochSeconds, salt = '' } ) {
	if ( ! TAG_PATTERN.test( tag ) ) {
		throw new TypeError(
			`filename tag must be ${ TAG_LENGTH } lowercase alphanumeric characters, got ${ JSON.stringify( tag ) }`
		);
	}

	if ( ! Number.isInteger( epochSeconds ) || epochSeconds < MIN_EPOCH_SECONDS || epochSeconds > MAX_EPOCH_SECONDS ) {
		throw new RangeError(
			`filename epoch must be a 10-digit integer of epoch seconds, got ${ JSON.stringify( epochSeconds ) }`
		);
	}

	return `${ tag }-${ shortHash( content, salt ) }-${ epochSeconds }`;
}
