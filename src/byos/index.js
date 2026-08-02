/**
 * Dispatch for the four device routes.
 *
 * **Authentication is not here.** `gate()` owns the URL token — one comparison, in one place, with
 * the tests covering the unset and empty `DEVICE_TOKEN` cases that would otherwise leave the
 * endpoint open. By the time anything below runs the caller is the owner, and the rule flips from
 * "be maximally opaque" to "be maximally helpful": a mistyped base URL gets a board naming the wrong
 * segment instead of the byte-identical 404 that everything unauthenticated gets.
 *
 * ## The `Access-Token` header, and why it cannot live in the gate
 *
 * `/api/setup` issues an `api_key` that the device sends back as `Access-Token`. Checking it is
 * defence in depth rather than a second factor — the key is derived from the same shared secret
 * that is already a segment of the URL the caller used, so anyone able to reach these routes could
 * mint it themselves from `/api/setup`. What it buys is a leaked header not reading as a URL, and a
 * loud signal when a device is holding a stale key.
 *
 * **Two of the four routes cannot carry it, for different reasons, and that is why the check is
 * per-route rather than in `gate()`.** `/api/setup` is enrollment, so the device has no key yet.
 * `/image` is the one that costs an afternoon: the firmware applies auth headers to the image fetch
 * on the `/api/display` path (`bl.cpp:1822`), but the *setup logo* download never calls
 * `applyHeaders` at all (`device_setup.cpp:123`). Requiring the header there fails that download,
 * and a failed setup image replaces the friendly-ID screen with an error screen at the exact moment
 * someone is pairing the sign.
 *
 * ## Outcome recording
 *
 * `recordOutcome()` is called exactly once, by whichever branch actually ran, with the outcome slug
 * and — for the two routes that draw something — the filename tag of the screen served. The gate
 * deliberately does not record authorized requests itself, because which board state went out is not
 * knowable there. Request headers are already captured by the gate, so nothing here logs them again.
 */

import { OUTCOMES } from '../abuse.js';
import { ROUTES } from '../routing.js';
import { accessTokenMatches } from './credentials.js';
import { handleDisplay } from './display.js';
import { handleImage } from './image.js';
import { handleLog } from './log.js';
import { handleSetup } from './setup.js';

/** Headers are case-insensitive on the wire; `Headers.get()` handles that, so do not hand-roll it. */
function accessToken( request ) {
	return request.headers.get( 'Access-Token' ) ?? '';
}

/**
 * The base URL to build an `image_url` from when the path did not parse.
 *
 * The firmware compares an image URL against the base URL it stored with a raw `strncmp`, and on
 * this path that stored base is whatever was mistyped. So the image URL has to reproduce the same
 * mistake or the device will not fetch it — which is why this strips the route off the *raw*
 * pathname rather than rebuilding anything.
 */
function fallbackTarget( pathname, reason ) {
	const segments = pathname.split( '/' ).filter( ( segment ) => segment !== '' );
	const asPath = ( parts ) => `/${ parts.join( '/' ) }`;

	if ( segments.length >= 2 && segments[ segments.length - 2 ] === ROUTES.image ) {
		return { reason, route: ROUTES.image, basePath: asPath( segments.slice( 0, -2 ) ) };
	}

	const tail = segments.slice( -2 ).join( '/' );

	if ( tail === ROUTES.setup || tail === ROUTES.display || tail === ROUTES.log ) {
		return { reason, route: tail, basePath: asPath( segments.slice( 0, -2 ) ) };
	}

	// No recognisable suffix, so treat it as a display poll: that is the request the device makes
	// 1440 times a day, and it is the one that can carry an explanation to the glass.
	return { reason, route: ROUTES.display, basePath: asPath( segments ) };
}

/**
 * Dispatches an authorized request.
 *
 * @param {Request}  request
 * @param {object}   env
 * @param {object}   classification  From `gate()`: `{ outcome, parsed }`, or `{ outcome, reason }`
 *                                   when the path would not parse.
 * @param {Function} recordOutcome   Called exactly once with `{ outcome, filenameTag }`.
 * @returns {Promise<Response>}
 */
export async function dispatchByos( request, env, classification, recordOutcome = () => {} ) {
	const { pathname } = new URL( request.url );
	const parsed = classification.parsed;

	// A malformed path still gets a real answer, because the caller proved they hold the secret. The
	// outcome stays the gate's `bad-request` rather than a route-specific one: what is interesting
	// about it is that the URL is wrong, not which endpoint the wrong URL happened to name.
	const target = parsed
		? { parsed, basePath: parsed.basePath }
		: fallbackTarget( pathname, classification.reason );

	const route = parsed ? parsed.route : target.route;
	const outcomeFor = ( byosOutcome ) => ( parsed ? byosOutcome : OUTCOMES.badRequest );

	if ( route === ROUTES.setup ) {
		// Pairing is allowed to succeed even on a mistyped URL, deliberately. Failing setup shows a
		// generic firmware error; succeeding and then drawing "Check the sign URL" on the board says
		// exactly what is wrong, which is the difference between a five-second fix and an afternoon.
		recordOutcome( { outcome: outcomeFor( OUTCOMES.byosSetup ) } );

		return handleSetup( request, target.basePath, env );
	}

	if ( route === ROUTES.image ) {
		const { response, tag } = await handleImage( request, target, env );

		recordOutcome( { outcome: outcomeFor( OUTCOMES.byosImage ), filenameTag: tag } );

		return response;
	}

	if ( ! ( await accessTokenMatches( accessToken( request ), env?.DEVICE_TOKEN ) ) ) {
		recordOutcome( { outcome: OUTCOMES.byosBadAccessToken } );

		return new Response( 'Not found', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		} );
	}

	if ( route === ROUTES.log ) {
		recordOutcome( { outcome: outcomeFor( OUTCOMES.byosLog ) } );

		return handleLog( request, parsed, env );
	}

	const { response, tag } = await handleDisplay( request, target, env );

	recordOutcome( { outcome: outcomeFor( OUTCOMES.byosDisplay ), filenameTag: tag } );

	return response;
}
