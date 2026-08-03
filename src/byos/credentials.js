/**
 * The `api_key` and `friendly_id` that `/api/setup` issues, derived rather than stored.
 *
 * Terminus persists a random key per device. We have no storage at all yet, and deliberately so —
 * the one genuinely stateful piece in the design (the recovery generation) is still an open question
 * in `docs/todo-someday.md`, and enrollment should not be what forces that decision. Deriving
 * both values from the shared secret keeps this piece stateless.
 *
 * **This grants no access that the caller did not already have.** The path token is the real gate,
 * and anyone who can reach `/api/setup` already holds it, because it is a segment of the URL they
 * used to get there. The `Access-Token` header the device sends back is therefore a second copy of a
 * secret its holder already has, not a new credential. What derivation buys is that the two are not
 * the *same string* on the wire, so a leaked header does not immediately read as a URL.
 *
 * The derivation is HMAC rather than a plain hash so the token cannot be recovered from a leaked
 * key, and it is domain-separated per purpose so `api_key` and `friendly_id` can never collide.
 */

const encoder = new TextEncoder();

/** Terminus shows a six-character human-readable handle; matching that shape keeps the screen sane. */
const FRIENDLY_ID_LENGTH = 6;

/**
 * Base32-ish, digits and uppercase letters with the four that misread on a panel removed. The setup
 * screen is meant to be read off the glass and typed, so `0`/`O` and `1`/`I` cannot both be in it.
 */
const FRIENDLY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

async function hmac( secret, message ) {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode( secret ),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[ 'sign' ]
	);

	return new Uint8Array( await crypto.subtle.sign( 'HMAC', key, encoder.encode( message ) ) );
}

function hex( bytes ) {
	return Array.from( bytes, ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}

/**
 * @param {string} deviceToken The shared secret from `env.DEVICE_TOKEN`.
 * @returns {Promise<string>} A 64-character hex key.
 */
export async function deriveApiKey( deviceToken ) {
	return hex( await hmac( deviceToken, 'trmnl-orca-departures/api-key' ) );
}

/**
 * @param {string} deviceToken
 * @returns {Promise<string>} Six characters from `FRIENDLY_ALPHABET`.
 */
export async function deriveFriendlyId( deviceToken ) {
	const bytes = await hmac( deviceToken, 'trmnl-orca-departures/friendly-id' );

	return Array.from( bytes.slice( 0, FRIENDLY_ID_LENGTH ), ( byte ) => FRIENDLY_ALPHABET[ byte % FRIENDLY_ALPHABET.length ] ).join( '' );
}

/**
 * Constant-time comparison of the `Access-Token` header against the derived key.
 *
 * Both sides are fixed-length hex here, so unlike `tokensMatch()` in `routing.js` there is no length
 * to leak — but the loop still runs to completion rather than returning early, because the position
 * of the first differing byte is the other half of that leak.
 *
 * An unset `deviceToken` must never match. The whole reason the secrets go in before the first
 * deploy is that a Worker where `env.DEVICE_TOKEN` is `undefined` would otherwise authenticate
 * everyone.
 *
 * @returns {Promise<boolean>}
 */
export async function accessTokenMatches( provided, deviceToken ) {
	if ( typeof provided !== 'string' || typeof deviceToken !== 'string' || deviceToken === '' ) {
		return false;
	}

	const expected = await deriveApiKey( deviceToken );

	if ( provided.length !== expected.length ) {
		return false;
	}

	let difference = 0;

	for ( let i = 0; i < expected.length; i++ ) {
		difference |= provided.charCodeAt( i ) ^ expected.charCodeAt( i );
	}

	return difference === 0;
}
