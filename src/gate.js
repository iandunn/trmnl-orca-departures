/**
 * The outer shell every request passes through: classify, record, and either answer or hand off.
 *
 * This exists as its own module rather than living in `src/worker.js` so that the request-handling
 * seam is explicit. `gate()` either produces a finished `Response` — for everything unauthenticated,
 * plus the stats page and the two browser conveniences — or it returns an authorized classification
 * for a caller to dispatch on. The BYOS route handlers hang off that second case, and adding them
 * should not require touching anything in here.
 *
 * ## The one contract a caller must honour
 *
 * When `gate()` returns a classification instead of a response, **the caller must call
 * `recordOutcome()` exactly once.** Authenticated requests are deliberately not logged here, because
 * the interesting outcome for one is not knowable yet at this point — which board state was served,
 * whether OneBusAway answered — and logging a placeholder here plus a real row later would
 * double-count every request the sign ever makes. One call, made by whoever actually knows how it
 * ended.
 */

import { OUTCOMES, classifyRequest, tarpit } from './abuse.js';
import { extractToken } from './routing.js';
import { recordRequest, tokenFingerprint } from './stats/analytics.js';
import { handleStats, isStatsRequest } from './stats/handler.js';

/**
 * The response every rejection gets, whatever the reason.
 *
 * Byte-identical across a bad token, an unparseable path and a path that was never ours, because
 * distinguishing them tells a caller which half they got right. 404 rather than 403 for the same
 * reason — 403 confirms something exists here. It also matches the reference BYOS server, which
 * answers an unknown device key with a 404.
 */
function notFound() {
	return new Response( 'Not found', {
		status: 404,
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	} );
}

/**
 * A crawler that asks politely is answered immediately rather than tarpitted.
 *
 * Holding a compliant crawler for 25 seconds wastes both sides' time to achieve nothing: it already
 * intends to ask permission, so telling it to go away is faster and works.
 */
function robots() {
	return new Response( 'User-agent: *\nDisallow: /\n', {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	} );
}

/**
 * @typedef  {object}    GateResult
 * @property {Response}  [response]       Present when the request is fully handled.
 * @property {object}    [classification] Present when authorized; the caller dispatches on it.
 * @property {Function}  [recordOutcome]  Must be called exactly once when `classification` is set.
 */

/**
 * @param   {Request} request
 * @param   {object}  env
 * @param   {object}  config  From `readConfig()`.
 * @returns {Promise<GateResult>}
 */
export async function gate( request, env, config ) {
	const { pathname } = new URL( request.url );

	if ( pathname === '/robots.txt' ) {
		recordRequest( env, { request, classification: { outcome: OUTCOMES.robots, authorized: false } } );

		return { response: robots() };
	}

	// Special-cased purely so it is never tarpitted. A browser requests this unprompted on every
	// visit to `/stats`, and a 25-second pending request hanging off the owner's own page — with the
	// tab spinner still going long after the page has rendered — is a needless mystery.
	if ( pathname === '/favicon.ico' ) {
		recordRequest( env, { request, classification: { outcome: OUTCOMES.favicon, authorized: false } } );

		return { response: notFound() };
	}

	// Before the token gate on purpose: this page carries no path secret, so it would otherwise fail
	// `extractToken()` and 404 like any other unshaped path.
	if ( isStatsRequest( pathname ) ) {
		const result = await handleStats( request, env, config );

		if ( result.outcome ) {
			recordRequest( env, { request, classification: { outcome: result.outcome, authorized: false } } );
		}

		if ( result.tarpit ) {
			await tarpit( config.tarpitMs );
		}

		return { response: result.response };
	}

	const classification = await classifyRequest( pathname, env );

	if ( ! classification.authorized ) {
		const tokenHash = await tokenFingerprint( extractToken( pathname ) ?? '' );

		recordRequest( env, { request, classification, tokenHash } );

		// Recorded before the delay rather than after, so a flood is visible on the stats page while it
		// is still happening rather than 25 seconds per request later.
		if ( classification.tarpit ) {
			await tarpit( config.tarpitMs );
		}

		return { response: notFound() };
	}

	const tokenHash = await tokenFingerprint( classification.parsed?.token ?? extractToken( pathname ) ?? '' );

	return {
		classification,
		recordOutcome: ( { outcome = classification.outcome, filenameTag = '' } = {} ) =>
			recordRequest( env, {
				request,
				classification: { ...classification, outcome },
				tokenHash,
				filenameTag,
			} ),
	};
}
