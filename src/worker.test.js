import { describe, expect, it } from 'vitest';
import worker from './worker.js';

/**
 * Every environment here sets `TARPIT_MS: 0`. Without it the unshaped-path cases would each hold for
 * the real 25 seconds and the suite would take minutes — the delay itself is exercised in
 * `src/gate.test.js` with a duration a test can afford.
 */
const TOKEN = 'f'.repeat( 64 );
const env = { DEVICE_TOKEN: TOKEN, TARPIT_MS: 0 };

const fetchPath = ( path, environment = env ) =>
	worker.fetch( new Request( `https://example.test${ path }` ), environment );

describe( 'worker', () => {
	it( 'returns 404 for every path while the BYOS endpoints are unimplemented', async () => {
		const paths = [ '/', '/api/setup', '/api/display', '/api/log' ];

		for ( const path of paths ) {
			expect( ( await fetchPath( path ) ).status ).toBe( 404 );
		}
	} );

	it( 'returns 404 for an authorized request too, since the endpoints go in together', async () => {
		const paths = [
			`/token/${ TOKEN }/agency/1/stop/590/api/setup`,
			`/token/${ TOKEN }/agency/1/stop/590/api/display`,
			`/token/${ TOKEN }/agency/1/stop/590,430/api/display`,
			`/token/${ TOKEN }/agency/1/stop/590/api/log`,
		];

		for ( const path of paths ) {
			expect( ( await fetchPath( path ) ).status ).toBe( 404 );
		}
	} );

	// The failure mode actually worth guarding: the preview is gated on a variable that only exists
	// locally, and a mistake there would expose the render cost publicly. It must not open a BYOS path
	// even when it is switched on.
	it( 'still 404s the BYOS paths when the dev preview is enabled', async () => {
		const withPreview = { ...env, DEV_PREVIEW: '1' };

		for ( const path of [ '/api/display', `/token/${ TOKEN }/agency/1/stop/590/api/display` ] ) {
			expect( ( await fetchPath( path, withPreview ) ).status ).toBe( 404 );
		}
	} );

	it( 'serves the preview only when the flag is set', async () => {
		expect( ( await fetchPath( '/_preview/stats' ) ).status ).toBe( 404 );
		expect( ( await fetchPath( '/_preview/stats', { ...env, DEV_PREVIEW: '1' } ) ).status ).toBe( 200 );
	} );

	it( 'answers robots.txt with a disallow rather than a 404', async () => {
		const response = await fetchPath( '/robots.txt' );

		expect( response.status ).toBe( 200 );
		expect( await response.text() ).toContain( 'Disallow: /' );
	} );
} );
