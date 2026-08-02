/**
 * Classifying an incoming request, and slowing down the ones that are obviously hostile.
 *
 * The governing rule is a pair, and the two halves pull in opposite directions:
 *
 * - **Before the token matches, be maximally opaque.** Every rejection is a byte-identical 404, so
 *   nothing distinguishes a bad token from a bad path from a path that was never ours.
 * - **After the token matches, be maximally helpful.** A caller holding the shared secret is the
 *   owner or the owner's device, and there is nothing left to protect from them. A misconfigured
 *   stop should say so rather than 404 into silence.
 *
 * ## Why the tarpit cannot be applied to a well-shaped path
 *
 * The obvious design — delay every authentication failure, the way a login form does — is wrong
 * here, and wrong in a way that costs an afternoon of standing in front of a blank sign.
 *
 * The device's read timeout is 15 seconds. On a failed `/api/display` the firmware sleeps and
 * retries on a 15 / 30 / 60 second ladder, and the first three failures never draw anything at all
 * — only the fourth reaches an error screen, roughly seven minutes in. So any delay longer than
 * 15 s that a real device can reach is indistinguishable from the server being down, and the
 * symptom is a sign that does nothing for seven minutes with no clue why.
 *
 * That case is not hypothetical: it is the pairing runbook. A token typed into the captive portal
 * with one character wrong produces exactly a well-shaped path with a bad token. Tarpitting it
 * would make the single most likely setup mistake the hardest one to diagnose. A shorter delay is
 * no better — the radio stays on for its duration, and wake time is the whole battery budget.
 *
 * So the tarpit is keyed on **path shape, not token validity**. A `*.workers.dev` subdomain scanner
 * hits `/`, `/api/display`, `/wp-login.php`; none of those survive `extractToken()`, and the device
 * never sends one. That gives a discriminator that cannot touch the device by construction.
 *
 * Deliberately *not* used as a discriminator: the `User-Agent`. The firmware's is undocumented and
 * unverified, and on a 5 GHz access point the device switches to an entirely different HTTP
 * implementation over ESP-AT whose headers nobody here has observed. Gating on it would be the same
 * class of mistake as the WOFF font — a plausible assumption that fails silently and completely.
 */

import { extractToken, parsePath, tokensMatch } from './routing.js';

/**
 * How long a hostile request is held before its 404.
 *
 * 25 seconds is chosen to sit above the device's 15 s read timeout, so the number itself is a
 * reminder that nothing on this path may ever be reachable by the device, and comfortably below
 * Cloudflare's edge connection timeout, so the held request is not killed before it is answered.
 *
 * **The tradeoff is concurrency, and it is real.** A held request occupies a Worker invocation for
 * the duration. Wall-clock time is not billed CPU, so this costs nothing against the CPU budget,
 * but a large enough flood of scanner traffic could occupy enough concurrent invocations to crowd
 * out the device's own poll. If the sign ever fails during an observable scan, lower this or drop
 * the tarpit entirely — it is a courtesy penalty on bots, not a security control, and nothing else
 * depends on it.
 *
 * Because of that tradeoff the duration is deployment configuration, read from `TARPIT_MS` through
 * `readConfig()`, where 0 disables the delay outright. This constant is only the fallback for a
 * direct call; changing the deployed behaviour means changing the var, not this.
 */
export const TARPIT_MS = 25000;

/**
 * Every outcome a request can have, and the single most important thing about this object: **these
 * strings are written into Analytics Engine as the index column and are therefore permanent.**
 * Renaming one orphans every historical row that carries the old value. Add new ones freely;
 * rename none.
 */
export const OUTCOMES = {
	/** Not even shaped like our URL. Scanners live here, and only here is the tarpit applied. */
	unshapedPath: 'unshaped-path',

	/** Well-shaped path, wrong token. Fast 404 — this is the pairing typo, see the note above. */
	badToken: 'bad-token',

	/**
	 * Valid token, path will not parse. Carries a `REJECTION_REASONS` value, which `/api/display` now
	 * turns into a board naming the wrong segment rather than a 404 — see `src/byos/screens.js`.
	 */
	badRequest: 'bad-request',

	/**
	 * **Retired 2026-08-01, and kept only because it is already in the dataset.** It meant "valid
	 * token, valid path, endpoint deliberately not built yet", which stopped being reachable when the
	 * four device routes landed. Nothing emits it now; rows carrying it are from before that.
	 */
	byosUnimplemented: 'byos-unimplemented',

	/** A browser asking for its icon. Answered immediately so it never drags a tarpit. */
	favicon: 'favicon',

	/** A compliant crawler. Answered immediately so it can read the disallow and leave. */
	robots: 'robots',

	/** Someone found `/stats` and guessed at the password. Tarpitted, and worth knowing about. */
	statsAuthFailed: 'stats-auth-failed',

	/** Enrollment. Rare by nature — more than a handful means the device keeps losing its key. */
	byosSetup: 'byos-setup',

	/** The workhorse. Roughly everything, at one row per poll. */
	byosDisplay: 'byos-display',

	/** An image fetch, which only happens when the `filename` changed since the last poll. */
	byosImage: 'byos-image',

	/** The device filed diagnostics. Worth watching for on its own — it only logs when unhappy. */
	byosLog: 'byos-log',

	/**
	 * Right URL token, wrong `Access-Token` header. Means the device holds a key derived from a
	 * previous `DEVICE_TOKEN` and needs a re-pair, which is otherwise invisible: the sign just does
	 * nothing for seven minutes and then draws its own error screen.
	 */
	byosBadAccessToken: 'byos-bad-access-token',
};

/**
 * Why a path failed to parse, once we already know the caller is authorised.
 *
 * These exist to be turned into a sentence on a rendered error board. They are never revealed to an
 * unauthenticated caller — that would leak which half of the URL was right.
 *
 * Written into Analytics Engine like `OUTCOMES`, so the same rule applies: append, never rename.
 */
export const REJECTION_REASONS = {
	missingAgency: 'missing-agency-segment',
	invalidAgency: 'invalid-agency',
	missingStop: 'missing-stop-segment',
	invalidStopId: 'invalid-stop-id',
	tooManyStops: 'too-many-stops',
	malformedEscape: 'malformed-escape',
	unknownRoute: 'unknown-route',
};

/** Held requests are answered with the identical 404 an unheld one gets. */
export function tarpit( milliseconds = TARPIT_MS ) {
	return new Promise( ( resolve ) => setTimeout( resolve, milliseconds ) );
}

/**
 * @typedef  {object} Classification
 * @property {string}      outcome     One of `OUTCOMES`.
 * @property {boolean}     tarpit      Whether to hold the request before answering.
 * @property {boolean}     authorized  Whether the shared secret matched. Gates every helpful reply.
 * @property {string}      [reason]    One of `REJECTION_REASONS`, for `badRequest`.
 * @property {object}      [parsed]    The `ParsedPath`, present only when authorized and parseable.
 */

/**
 * Decides what a request is, in the one order that keeps the opacity rule true.
 *
 * The sequence matters: the token is compared before the path is parsed, so an unauthenticated
 * caller never reaches the parser and cannot learn anything from how it fails. Everything after the
 * token check is allowed to be informative.
 *
 * @param   {string} pathname
 * @param   {object} env
 * @returns {Promise<Classification>}
 */
export async function classifyRequest( pathname, env ) {
	const token = extractToken( pathname );

	// No token segment at all. This is the only outcome the tarpit applies to, and the device cannot
	// reach it — every URL the firmware builds starts from a base URL that carries the token.
	if ( token === null ) {
		return { outcome: OUTCOMES.unshapedPath, tarpit: true, authorized: false };
	}

	if ( ! ( await tokensMatch( token, env?.DEVICE_TOKEN ) ) ) {
		return { outcome: OUTCOMES.badToken, tarpit: false, authorized: false };
	}

	const diagnosis = diagnosePath( pathname );

	if ( ! diagnosis.ok ) {
		return {
			outcome: OUTCOMES.badRequest,
			tarpit: false,
			authorized: true,
			reason: diagnosis.reason,
		};
	}

	// Authorized, well-formed, and pointed at a real route. The outcome here is a **placeholder**: the
	// gate cannot know how the request ended — which board state was served, whether OneBusAway
	// answered — so every BYOS branch overrides it when it calls `recordOutcome()`. A row that still
	// carries this value in the dataset either predates the endpoints landing on 2026-08-01, or means
	// a handler returned without recording, which would be a bug.
	return {
		outcome: OUTCOMES.byosUnimplemented,
		tarpit: false,
		authorized: true,
		parsed: diagnosis.parsed,
	};
}

/**
 * `parsePath()` with the reason it failed.
 *
 * Kept separate from `parsePath()` rather than replacing it, because the two have genuinely
 * different audiences: `parsePath()` returns a bare null precisely so a caller cannot accidentally
 * leak a reason to someone who has not authenticated, and this returns the reason precisely so an
 * authenticated caller can be told what is wrong. Wrapping is what keeps the safe default safe.
 *
 * @param   {string} pathname
 * @returns {{ok: true, parsed: object}|{ok: false, reason: string}}
 */
export function diagnosePath( pathname ) {
	const parsed = parsePath( pathname );

	if ( parsed ) {
		return { ok: true, parsed };
	}

	return { ok: false, reason: reasonFor( pathname ) };
}

/**
 * Re-walks a path that already failed, to say which segment was wrong.
 *
 * Deliberately a second pass rather than threading a reason out of `parsePath()`: this runs only on
 * the error path, where an extra split costs nothing, and it leaves the hot, security-critical
 * function unchanged.
 */
function reasonFor( pathname ) {
	const segments = String( pathname ?? '' )
		.split( '/' )
		.filter( ( segment ) => segment !== '' );

	if ( segments[ 2 ] !== 'agency' ) {
		return REJECTION_REASONS.missingAgency;
	}

	if ( ! /^\d{1,4}$/.test( segments[ 3 ] ?? '' ) ) {
		return REJECTION_REASONS.invalidAgency;
	}

	if ( segments[ 4 ] !== 'stop' || ! segments[ 5 ] ) {
		return REJECTION_REASONS.missingStop;
	}

	let stops;

	try {
		stops = decodeURIComponent( segments[ 5 ] ).split( ',' );
	} catch {
		return REJECTION_REASONS.malformedEscape;
	}

	if ( stops.length > 2 ) {
		return REJECTION_REASONS.tooManyStops;
	}

	if ( ! stops.every( ( stopId ) => /^[A-Za-z0-9_-]{1,32}$/.test( stopId ) ) ) {
		return REJECTION_REASONS.invalidStopId;
	}

	return REJECTION_REASONS.unknownRoute;
}
