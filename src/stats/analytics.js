/**
 * Writing request outcomes into Analytics Engine.
 *
 * Analytics Engine rather than KV, and the reason is worth keeping written down because the obvious
 * alternative has already failed once in a sibling project on this account: KV's free write quota is
 * 1000 a day, and this sign alone polls roughly 1440 times a day. Per-request bookkeeping in KV
 * would exhaust the quota on entirely legitimate traffic before an attacker existed. Analytics
 * Engine is free on the Workers Free plan at 100k writes and 10k read queries a day, and does not
 * touch the KV quota at all.
 *
 * **Expected volume here is roughly 3-5k data points a day against that 100k limit**, so there is no
 * quota question to answer. Stated once, on purpose: this project has twice re-derived a resource
 * limit from a stale published figure and lost sessions to it.
 *
 * Writes are fire-and-forget. `writeDataPoint()` returns nothing to await, and a lost analytics row
 * must never be able to fail a request — `/api/display` runs ~1440 times a day and the sign going
 * dark because a metrics write failed would be the tail wagging the dog.
 */

import { eventFromRequest } from './schema.js';

const encoder = new TextEncoder();

/**
 * A short, stable fingerprint of the presented token.
 *
 * Recorded instead of the token so requests can be correlated — "the same wrong token was tried
 * forty times" is a different story from forty different guesses — without the log becoming a place
 * the shared secret is written down. Four bytes is ample to distinguish the handful of distinct
 * values this will ever see, and far too short to attack.
 *
 * @returns {Promise<string>} Eight hex characters, or an empty string for an absent token.
 */
export async function tokenFingerprint( token ) {
	if ( typeof token !== 'string' || token === '' ) {
		return '';
	}

	const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', encoder.encode( token ) ) );

	return Array.from( digest.slice( 0, 4 ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/**
 * Records one request outcome.
 *
 * Silently does nothing when the binding is absent, which is the normal state under `wrangler dev`
 * — local development should not need an Analytics Engine dataset to exercise the gate.
 *
 * @param {object} env
 * @param {object} options  Passed through to `eventFromRequest`.
 */
export function recordRequest( env, options ) {
	if ( ! env?.ANALYTICS ) {
		return;
	}

	try {
		env.ANALYTICS.writeDataPoint( eventFromRequest( options ) );
	} catch ( error ) {
		// A metrics write is never worth an outage, so the failure is swallowed — but it is **logged**,
		// which it was not until 2026-08-02.
		//
		// The original reasoning was that a rejected write "shows up as a suspiciously empty `/stats`
		// page rather than needing a console line per request". That turned out to be exactly backwards:
		// an empty page is also what a Worker nothing has found looks like, and the page said so in a
		// reassuring banner. A whole day of every request being dropped read as a quiet week.
		//
		// One line per failed write is affordable — the free plan retains 200,000 logs a day and this
		// sign polls under a thousand times — and `npm run tail` is the first place anyone looks.
		console.log(
			JSON.stringify( {
				event: 'analytics-write-failed',
				dataset: 'requests',
				message: error?.message ?? String( error ),
			} )
		);
	}
}
