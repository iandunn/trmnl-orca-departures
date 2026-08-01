import { describe, expect, it } from 'vitest';
import { readConfig } from '../config.js';
import { handleStats, isStatsRequest } from './handler.js';

const env = { STATS_PASSWORD: 'correct-horse-battery-staple' };
const config = readConfig( env );

const statsRequest = ( { password, header, url = 'https://example.test/stats' } = {} ) => {
	const headers = {};

	if ( header !== undefined ) {
		headers.Authorization = header;
	} else if ( password !== undefined ) {
		headers.Authorization = `Basic ${ btoa( `ignored:${ password }` ) }`;
	}

	return new Request( url, { headers } );
};

describe( 'isStatsRequest', () => {
	it.each( [ [ '/stats' ], [ '/stats/' ] ] )( 'matches %s', ( path ) => {
		expect( isStatsRequest( path ) ).toBe( true );
	} );

	it.each( [ [ '/stats/extra' ], [ '/Stats' ], [ '/statistics' ], [ '/' ] ] )( 'does not match %s', ( path ) => {
		expect( isStatsRequest( path ) ).toBe( false );
	} );
} );

describe( 'handleStats', () => {
	it( 'prompts with no penalty and no log line when credentials are absent', async () => {
		const result = await handleStats( statsRequest(), env, config );

		expect( result.response.status ).toBe( 401 );
		expect( result.response.headers.get( 'WWW-Authenticate' ) ).toBe( 'Basic realm="Sign stats"' );
		expect( result.tarpit ).toBe( false );
		expect( result.outcome ).toBe( '' );
	} );

	it( 'tarpits and records a wrong password', async () => {
		const result = await handleStats( statsRequest( { password: 'wrong' } ), env, config );

		expect( result.response.status ).toBe( 401 );
		expect( result.tarpit ).toBe( true );
		expect( result.outcome ).toBe( 'stats-auth-failed' );
	} );

	// The username half is deliberately ignored: one person reaches this page, so a username would be
	// a second thing to remember that protects nothing.
	it( 'ignores the username', async () => {
		const anyUser = `Basic ${ btoa( `somebody-else:${ env.STATS_PASSWORD }` ) }`;
		const result = await handleStats( statsRequest( { header: anyUser } ), env, config );

		expect( result.response.status ).toBe( 200 );
	} );

	it( 'accepts a password containing a colon', async () => {
		const password = 'has:colons:in:it';
		const result = await handleStats( statsRequest( { password } ), { STATS_PASSWORD: password }, config );

		expect( result.response.status ).toBe( 200 );
	} );

	it.each( [
		[ 'a malformed scheme', 'Bearer something' ],
		[ 'unparseable base64', 'Basic !!!not-base64!!!' ],
		[ 'an empty credential', 'Basic ' ],
	] )( 'rejects %s', async ( _label, header ) => {
		const result = await handleStats( statsRequest( { header } ), env, config );

		expect( result.response.status ).toBe( 401 );
	} );

	// An unset secret must lock the page rather than unlock it. This is the same degenerate-comparison
	// hazard the device token has, and `tokensMatch` refuses empty strings on both sides for it.
	it.each( [ [ {} ], [ { STATS_PASSWORD: '' } ] ] )( 'never authenticates against %o', async ( emptyEnv ) => {
		for ( const password of [ '', 'anything' ] ) {
			const result = await handleStats( statsRequest( { password } ), emptyEnv, config );

			expect( result.response.status ).toBe( 401 );
		}
	} );

	describe( 'the rendered page', () => {
		// No Analytics Engine credentials here, so every query fails and the page reports that rather
		// than throwing. That is the behaviour worth pinning: a missing token must not 500 the route.
		it( 'renders and marks itself unindexable even when every query fails', async () => {
			const result = await handleStats( statsRequest( { password: env.STATS_PASSWORD } ), env, config );

			expect( result.response.status ).toBe( 200 );
			expect( result.response.headers.get( 'Content-Type' ) ).toBe( 'text/html; charset=utf-8' );
			expect( result.response.headers.get( 'X-Robots-Tag' ) ).toContain( 'noindex' );
			expect( result.response.headers.get( 'Cache-Control' ) ).toBe( 'no-store' );

			const html = await result.response.text();

			expect( html ).toContain( '<!doctype html>' );

			// The account ID is checked first, so it is the message a Worker with neither credential
			// reports. Either way the point is that a missing credential explains itself on the page
			// rather than 500ing the route.
			expect( html ).toContain( 'query failed: CLOUDFLARE_ACCOUNT_ID is not set' );
		} );

		it( 'is not logged when it succeeds', async () => {
			const result = await handleStats( statsRequest( { password: env.STATS_PASSWORD } ), env, config );

			expect( result.outcome ).toBe( '' );
		} );

		it( 'falls back to the default range for an unknown one', async () => {
			const url = 'https://example.test/stats?range=nonsense';
			const request = statsRequest( { password: env.STATS_PASSWORD, url } );
			const html = await ( await handleStats( request, env, config ) ).response.text();

			expect( html ).toContain( 'Last 14 days' );
		} );
	} );
} );
