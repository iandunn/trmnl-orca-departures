import { describe, expect, it } from 'vitest';
import { accessTokenMatches, deriveApiKey, deriveFriendlyId } from './credentials.js';

const TOKEN = 'test-device-token';

describe( 'deriveApiKey', () => {
	it( 'is deterministic, so a device paired yesterday still authenticates today', async () => {
		expect( await deriveApiKey( TOKEN ) ).toBe( await deriveApiKey( TOKEN ) );
	} );

	it( 'is not the shared secret itself', async () => {
		expect( await deriveApiKey( TOKEN ) ).not.toContain( TOKEN );
	} );

	it( 'differs per token', async () => {
		expect( await deriveApiKey( TOKEN ) ).not.toBe( await deriveApiKey( `${ TOKEN }x` ) );
	} );
} );

describe( 'deriveFriendlyId', () => {
	it( 'is six characters a person can read off the glass and retype', async () => {
		// No 0/O and no 1/I: the setup screen exists to be read at arm's length.
		expect( await deriveFriendlyId( TOKEN ) ).toMatch( /^[2-9A-HJ-NP-Z]{6}$/ );
	} );

	it( 'is domain-separated from the api key', async () => {
		const key = await deriveApiKey( TOKEN );

		expect( key.startsWith( ( await deriveFriendlyId( TOKEN ) ).toLowerCase() ) ).toBe( false );
	} );
} );

describe( 'accessTokenMatches', () => {
	it( 'accepts the key it issued', async () => {
		expect( await accessTokenMatches( await deriveApiKey( TOKEN ), TOKEN ) ).toBe( true );
	} );

	it( 'rejects a key derived from a different secret', async () => {
		expect( await accessTokenMatches( await deriveApiKey( 'other' ), TOKEN ) ).toBe( false );
	} );

	// The reason the secrets have to be set before the first deploy rather than after: an undefined
	// `DEVICE_TOKEN` must never make the comparison degenerate into an open endpoint.
	it( 'never matches when the deployment has no token set', async () => {
		for ( const secret of [ undefined, null, '' ] ) {
			expect( await accessTokenMatches( 'anything', secret ) ).toBe( false );
			expect( await accessTokenMatches( '', secret ) ).toBe( false );
		}
	} );

	it( 'rejects a non-string header', async () => {
		expect( await accessTokenMatches( undefined, TOKEN ) ).toBe( false );
	} );
} );
