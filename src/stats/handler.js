/**
 * The `/stats` page: authentication, and turning a query into a response.
 *
 * ## Why this route sits outside the token prefix
 *
 * Everything the device fetches lives under `/token/<token>/…`, because the firmware's auth test is a
 * raw `strncmp` against the stored base URL. This page is the deliberate exception: it is typed into
 * a browser by a person, and a browser cannot be asked to send a path secret it does not know. So it
 * lives at a bare path and authenticates with HTTP Basic, which browsers prompt for natively.
 *
 * That means it must be matched **before** the token gate, or it would fail `extractToken()` and 404
 * like any other unshaped path.
 *
 * A wrong password is tarpitted. Unlike the device paths, there is no cost to being slow here — no
 * radio is being held on, and a human retyping a password waits once. It is also the only
 * brute-forceable secret in the project, since the device token is 32 random bytes and this is
 * something a person can remember.
 */

import { tokensMatch } from '../routing.js';
import { OUTCOMES } from '../abuse.js';
import { buildStatsData, resolveRange } from './query.js';
import { renderStatsHtml } from './render.js';

export const STATS_PATH = '/stats';

export function isStatsRequest( pathname ) {
	return pathname === STATS_PATH || pathname === `${ STATS_PATH }/`;
}

/**
 * The password half of an `Authorization: Basic` header.
 *
 * The username is deliberately ignored. There is exactly one person who should reach this page, so a
 * username would be a second thing to remember that protects nothing.
 */
function basicAuthPassword( header ) {
	if ( typeof header !== 'string' || ! header.startsWith( 'Basic ' ) ) {
		return null;
	}

	try {
		const decoded = atob( header.slice( 6 ) );
		const separator = decoded.indexOf( ':' );

		return separator === -1 ? '' : decoded.slice( separator + 1 );
	} catch {
		// A malformed base64 payload is a failed attempt, not a crash.
		return null;
	}
}

function authenticationPrompt() {
	return new Response( 'Authentication required', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Sign stats"',
			'Content-Type': 'text/plain; charset=utf-8',
			'X-Robots-Tag': 'noindex',
		},
	} );
}

/**
 * @typedef  {object}   StatsResult
 * @property {Response} response
 * @property {string}   outcome   The outcome to log, or an empty string to log nothing.
 * @property {boolean}  tarpit    Whether the caller should hold the request before answering.
 */

/**
 * Authenticates and renders the page.
 *
 * @param   {Request} request
 * @param   {object}  env
 * @param   {object}  config  From `readConfig()`, for the expected-volume comparison.
 * @returns {Promise<StatsResult>}
 */
export async function handleStats( request, env, config ) {
	const header = request.headers.get( 'Authorization' );

	// No credentials yet is the normal first load, not an attack — prompt without penalty. Only a
	// wrong password is tarpitted, and only that is worth recording.
	if ( ! header ) {
		return { response: authenticationPrompt(), outcome: '', tarpit: false };
	}

	if ( ! ( await tokensMatch( basicAuthPassword( header ), env?.STATS_PASSWORD ) ) ) {
		return {
			response: authenticationPrompt(),
			outcome: OUTCOMES.statsAuthFailed,
			tarpit: true,
		};
	}

	const url = new URL( request.url );
	const range = resolveRange( url.searchParams.get( 'range' ) );
	const data = await buildStatsData( env, config, range.key );

	return {
		response: new Response( renderStatsHtml( data ), {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',

				// Belt and braces with the page's own `<meta name="robots">`: this URL is guessable and
				// the page prints the sign's stop IDs, so it must not be indexable if it ever leaks.
				'X-Robots-Tag': 'noindex, nofollow',
				'Cache-Control': 'no-store',
			},
		} ),

		// A successful view is not logged. It would only ever record the owner looking at their own
		// page, which is noise in the very dataset being looked at.
		outcome: '',
		tarpit: false,
	};
}
