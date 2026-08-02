import { describe, expect, it } from 'vitest';
import { ROUTES, extractToken, parsePath, redactPath, toOneBusAwayId, tokensMatch } from './routing.js';

const TOKEN = 'a'.repeat( 64 );
const BASE = `/token/${ TOKEN }/agency/1/stop/1550`;

describe( 'extractToken', () => {
	it( 'pulls the token from a well-formed path', () => {
		expect( extractToken( `${ BASE }/api/display` ) ).toBe( TOKEN );
	} );

	it( 'works before the rest of the path is valid, so a bad token short-circuits first', () => {
		expect( extractToken( `/token/${ TOKEN }/complete/garbage/!!!` ) ).toBe( TOKEN );
	} );

	it( 'tolerates the doubled slash a trailing-slash base URL produces', () => {
		// The firmware concatenates `baseUrl + "/api/display"` without normalizing.
		expect( extractToken( `//token//${ TOKEN }//api//display` ) ).toBe( TOKEN );
	} );

	it.each( [ '/', '', '/api/display', '/token', '/token/', '/nope/abc' ] )(
		'returns null for %o',
		( pathname ) => {
			expect( extractToken( pathname ) ).toBeNull();
		}
	);

	it( 'rejects an absurdly long token rather than hashing it', () => {
		expect( extractToken( `/token/${ 'a'.repeat( 5000 ) }/api/display` ) ).toBeNull();
	} );

	it( 'returns null for non-string input', () => {
		expect( extractToken( undefined ) ).toBeNull();
	} );
} );

describe( 'tokensMatch', () => {
	it( 'accepts an exact match', async () => {
		await expect( tokensMatch( TOKEN, TOKEN ) ).resolves.toBe( true );
	} );

	it( 'rejects a near miss', async () => {
		await expect( tokensMatch( TOKEN, `${ 'a'.repeat( 63 ) }b` ) ).resolves.toBe( false );
	} );

	it( 'rejects a prefix of the real token', async () => {
		await expect( tokensMatch( 'a'.repeat( 32 ), TOKEN ) ).resolves.toBe( false );
	} );

	describe( 'unset secret', () => {
		// A deployed Worker where `env.DEVICE_TOKEN` is undefined must not degenerate into an open
		// endpoint. This is why both secrets are set before the first deploy, not after.
		it.each( [ undefined, null, '', 0, false ] )( 'never matches when expected is %o', async ( expected ) => {
			await expect( tokensMatch( TOKEN, expected ) ).resolves.toBe( false );
		} );

		it( 'does not match an empty provided token against an empty secret', async () => {
			await expect( tokensMatch( '', '' ) ).resolves.toBe( false );
		} );
	} );

	it( 'rejects non-string provided values', async () => {
		await expect( tokensMatch( undefined, TOKEN ) ).resolves.toBe( false );
		await expect( tokensMatch( { toString: () => TOKEN }, TOKEN ) ).resolves.toBe( false );
	} );
} );

describe( 'parsePath', () => {
	it.each( Object.values( { setup: ROUTES.setup, display: ROUTES.display, log: ROUTES.log } ) )(
		'parses the %s route',
		( route ) => {
			expect( parsePath( `${ BASE }/${ route }` ) ).toEqual( {
				token: TOKEN,
				agency: '1',
				stopIds: [ '1550' ],
				basePath: BASE,
				route,
			} );
		}
	);

	it( 'parses the image route with its filename', () => {
		expect( parsePath( `${ BASE }/image/departs-3f9x1a-1785564693` ) ).toEqual( {
			token: TOKEN,
			agency: '1',
			stopIds: [ '1550' ],
			basePath: BASE,
			route: ROUTES.image,
			filename: 'departs-3f9x1a-1785564693',
		} );
	} );

	it( 'normalizes doubled and trailing slashes', () => {
		expect( parsePath( `${ BASE }//api/display/` ) ).toMatchObject( { route: ROUTES.display } );
		expect( parsePath( `${ BASE }/api/display/` ) ).toMatchObject( { route: ROUTES.display } );
	} );

	describe( 'stop IDs', () => {
		it( 'accepts one', () => {
			expect( parsePath( `${ BASE }/api/display` ).stopIds ).toEqual( [ '1550' ] );
		} );

		it( 'accepts two, preserving order', () => {
			const parsed = parsePath( `/token/${ TOKEN }/agency/1/stop/1550,1551/api/display` );

			expect( parsed.stopIds ).toEqual( [ '1550', '1551' ] );
		} );

		it( 'rejects three rather than silently truncating', () => {
			// Dropping one would render half a board with nothing indicating a stop was missing.
			expect( parsePath( `/token/${ TOKEN }/agency/1/stop/1,2,3/api/display` ) ).toBeNull();
		} );

		it( 'accepts the underscores and hyphens real OBA stop IDs contain', () => {
			const parsed = parsePath( `/token/${ TOKEN }/agency/40/stop/S_KS_T3,E15-T1/api/display` );

			expect( parsed.stopIds ).toEqual( [ 'S_KS_T3', 'E15-T1' ] );
		} );

		it.each( [ '', ',', '1550,', ',1550', 'has space', 'semi;colon', 'a'.repeat( 40 ) ] )(
			'rejects the malformed stop segment %o',
			( stops ) => {
				expect( parsePath( `/token/${ TOKEN }/agency/1/stop/${ stops }/api/display` ) ).toBeNull();
			}
		);
	} );

	describe( 'rejections', () => {
		it.each( [
			[ 'a missing token label', `/${ TOKEN }/agency/1/stop/1550/api/display` ],
			[ 'a missing agency label', `/token/${ TOKEN }/1/stop/1550/api/display` ],
			[ 'a missing stop label', `/token/${ TOKEN }/agency/1/1550/api/display` ],
			[ 'a non-numeric agency', `/token/${ TOKEN }/agency/metro/stop/1550/api/display` ],
			[ 'an unknown route', `${ BASE }/api/whatever` ],
			[ 'no route at all', BASE ],
			[ 'an image with no filename', `${ BASE }/image` ],
			[ 'an image with extra segments', `${ BASE }/image/a/b` ],
			[ 'a bare root', '/' ],
			[ 'a malformed percent-escape', `/token/${ TOKEN }/agency/1/stop/%E0%A4%A/api/display` ],
			[ 'path traversal in the stop', `/token/${ TOKEN }/agency/1/stop/../../etc/api/display` ],
		] )( 'returns null for %s', ( _label, pathname ) => {
			expect( parsePath( pathname ) ).toBeNull();
		} );

		it( 'returns null for non-string input', () => {
			expect( parsePath( undefined ) ).toBeNull();
		} );
	} );
} );

describe( 'toOneBusAwayId', () => {
	it( 'rejoins agency and stop', () => {
		expect( toOneBusAwayId( '1', '1550' ) ).toBe( '1_1550' );
	} );

	it( 'round-trips a stop ID that contains its own underscores', () => {
		const parsed = parsePath( `/token/${ TOKEN }/agency/40/stop/S_KS_T3/api/display` );

		expect( toOneBusAwayId( parsed.agency, parsed.stopIds[ 0 ] ) ).toBe( '40_S_KS_T3' );
	} );
} );

describe( 'redactPath', () => {
	it( 'never contains the token', async () => {
		await expect( redactPath( `${ BASE }/api/display` ) ).resolves.not.toContain( TOKEN );
	} );

	it( 'never contains the stop, which implies a home address', async () => {
		const redacted = await redactPath( `${ BASE }/api/display` );

		expect( redacted ).not.toContain( '1550' );
	} );

	it( 'keeps the route and agency, which are useful and not sensitive', async () => {
		const redacted = await redactPath( `${ BASE }/api/display` );

		expect( redacted ).toContain( 'api/display' );
		expect( redacted ).toContain( 'agency/1' );
	} );

	it( 'is stable, so requests can be correlated across log lines', async () => {
		const first = await redactPath( `${ BASE }/api/display` );
		const second = await redactPath( `${ BASE }/api/display` );

		expect( first ).toBe( second );
	} );

	it( 'distinguishes different tokens', async () => {
		const other = await redactPath( `/token/${ 'b'.repeat( 64 ) }/agency/1/stop/1550/api/display` );

		expect( other ).not.toBe( await redactPath( `${ BASE }/api/display` ) );
	} );

	it( 'leaks nothing from an unparseable path', async () => {
		const redacted = await redactPath( `/token/${ TOKEN }/garbage` );

		expect( redacted ).not.toContain( TOKEN );
		expect( redacted ).toContain( 'unparseable' );
	} );
} );
