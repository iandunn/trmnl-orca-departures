/**
 * Parsing and authenticating the device's request path.
 *
 * The device's base URL carries both the shared secret and the stop, because the firmware gives us
 * no other channel: it builds request URLs as `baseUrl + "/api/display"` with no URL parsing, so a
 * query string in the base URL would land before the path and mangle both. Path segments only.
 *
 *     /token/<token>/agency/<agency>/stop/<stopId>[,<stopId>]/api/display
 *
 * Two rules shape everything here:
 *
 * - **The token comes first, and is checked before anything else is parsed.** `/api/setup` is
 *   unauthenticated by design — that is how enrollment works — so without a path secret anyone who
 *   finds the URL can enroll and burn the OneBusAway quota.
 * - **A bad token and a bad path return the same response.** Distinguishing them tells an attacker
 *   which half they got right.
 */

const MAX_TOKEN_LENGTH = 128;
const MAX_STOP_ID_LENGTH = 32;
const MAX_STOPS = 2;

const AGENCY_PATTERN = /^\d{1,4}$/;
const STOP_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Routes the device requests, all relative to the configured base URL. */
export const ROUTES = {
	setup: 'api/setup',
	display: 'api/display',
	log: 'api/log',
	image: 'image',
};

const encoder = new TextEncoder();

/**
 * Collapses the doubled slash the firmware produces when the base URL ends in one, since it
 * concatenates without normalizing and we would otherwise see `//api/display`.
 */
function segmentsOf( pathname ) {
	return pathname.split( '/' ).filter( ( segment ) => segment !== '' );
}

/**
 * Pulls the token out with the least work that can possibly identify it, so an unauthenticated
 * caller never reaches the real parser. Deliberately does not validate anything else.
 *
 * @param {string} pathname
 * @returns {string|null} The token segment, or null if the path is not even shaped like ours.
 */
export function extractToken( pathname ) {
	if ( typeof pathname !== 'string' ) {
		return null;
	}

	const segments = segmentsOf( pathname );

	if ( segments[ 0 ] !== 'token' || ! segments[ 1 ] || segments[ 1 ].length > MAX_TOKEN_LENGTH ) {
		return null;
	}

	return segments[ 1 ];
}

async function sha256( value ) {
	return new Uint8Array( await crypto.subtle.digest( 'SHA-256', encoder.encode( value ) ) );
}

/**
 * Constant-time token comparison.
 *
 * Hashing both sides first means the comparison always runs over 32 bytes, so neither the token's
 * length nor the position of the first differing byte is observable. Cloudflare's
 * `crypto.subtle.timingSafeEqual` is deliberately not used: it throws on a length mismatch, which
 * leaks length, and it does not exist under the test runner.
 *
 * An unset `expected` is always a mismatch. That case is the whole reason the secrets must be set
 * before the first deploy — a Worker where `env.DEVICE_TOKEN` is `undefined` would otherwise make
 * this comparison degenerate into an open endpoint.
 *
 * @returns {Promise<boolean>}
 */
export async function tokensMatch( provided, expected ) {
	if ( typeof provided !== 'string' || typeof expected !== 'string' ) {
		return false;
	}

	if ( provided === '' || expected === '' ) {
		return false;
	}

	const [ providedHash, expectedHash ] = await Promise.all( [ sha256( provided ), sha256( expected ) ] );

	let difference = 0;

	for ( let i = 0; i < providedHash.length; i++ ) {
		difference |= providedHash[ i ] ^ expectedHash[ i ];
	}

	return difference === 0;
}

function decodeSegment( segment ) {
	try {
		return decodeURIComponent( segment );
	} catch {
		// A malformed percent-escape is a bad path, not a crash.
		return null;
	}
}

function parseStopIds( segment ) {
	const decoded = decodeSegment( segment );

	if ( decoded === null ) {
		return null;
	}

	const stopIds = decoded.split( ',' );

	// Capped rather than truncated: silently dropping a stop would show half a board with no
	// indication anything was missing.
	if ( stopIds.length < 1 || stopIds.length > MAX_STOPS ) {
		return null;
	}

	for ( const stopId of stopIds ) {
		if ( ! STOP_ID_PATTERN.test( stopId ) || stopId.length > MAX_STOP_ID_LENGTH ) {
			return null;
		}
	}

	return stopIds;
}

/**
 * @typedef  {object}   ParsedPath
 * @property {string}   token
 * @property {string}   agency     Numeric agency ID, e.g. `1` for King County Metro.
 * @property {string[]} stopIds    One or two bare stop IDs, without the agency prefix.
 * @property {string}   route      One of `ROUTES`.
 * @property {string}   [filename] Present only for the image route.
 */

/**
 * @param {string} pathname
 * @returns {ParsedPath|null} Null for anything malformed. Callers must treat null identically to a
 *                            token mismatch.
 */
export function parsePath( pathname ) {
	if ( typeof pathname !== 'string' ) {
		return null;
	}

	const segments = segmentsOf( pathname );

	if ( segments[ 0 ] !== 'token' || segments[ 2 ] !== 'agency' || segments[ 4 ] !== 'stop' ) {
		return null;
	}

	const token = segments[ 1 ];
	const agency = segments[ 3 ];

	if ( ! token || token.length > MAX_TOKEN_LENGTH || ! AGENCY_PATTERN.test( agency ) ) {
		return null;
	}

	const stopIds = parseStopIds( segments[ 5 ] ?? '' );

	if ( ! stopIds ) {
		return null;
	}

	const rest = segments.slice( 6 );
	const route = rest.join( '/' );

	if ( route === ROUTES.setup || route === ROUTES.display || route === ROUTES.log ) {
		return { token, agency, stopIds, route };
	}

	if ( rest[ 0 ] === ROUTES.image && rest.length === 2 ) {
		return { token, agency, stopIds, route: ROUTES.image, filename: rest[ 1 ] };
	}

	return null;
}

/**
 * Recombines a bare stop ID with its agency into the form OneBusAway expects.
 *
 * The URL keeps them apart because OBA stop IDs are not opaque integers — they carry their own
 * underscores and hyphens (`40_S_KS_T3`, `40_E15-T1`), so a single combined segment is a split
 * waiting to be written wrong.
 */
export function toOneBusAwayId( agency, stopId ) {
	return `${ agency }_${ stopId }`;
}

/**
 * A logging-safe rendering of the path.
 *
 * The token and the stop are both redacted to short hashes: the token because it is the shared
 * secret and would otherwise land in request logs and analytics, which is exactly where people
 * paste when debugging, and the stop because it implies a home address. The hashes are stable, so
 * requests can still be correlated across log lines.
 *
 * @returns {Promise<string>}
 */
export async function redactPath( pathname ) {
	const parsed = parsePath( pathname );

	if ( ! parsed ) {
		const shape = segmentsOf( typeof pathname === 'string' ? pathname : '' ).length;

		return `[unparseable path, ${ shape } segments]`;
	}

	const [ tokenHash, stopHash ] = await Promise.all( [
		sha256( parsed.token ),
		sha256( parsed.stopIds.join( ',' ) ),
	] );

	const short = ( bytes ) =>
		Array.from( bytes.slice( 0, 4 ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

	return `/token/[t:${ short( tokenHash ) }]/agency/${ parsed.agency }/stop/[s:${ short( stopHash ) }]/${ parsed.route }`;
}
