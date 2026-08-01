import { describe, expect, it } from 'vitest';
import { OUTCOMES } from './abuse.js';
import { readConfig } from './config.js';
import { gate } from './gate.js';
import { BLOB_FIELDS } from './stats/schema.js';

const TOKEN = 'a'.repeat( 64 );

/**
 * A stand-in for the Analytics Engine binding that keeps the rows it is handed, so the tests can
 * assert on what was recorded rather than only on what was returned. The real binding is
 * fire-and-forget with no readback, which is exactly why the row builder is a pure function.
 */
function recordingEnv( overrides = {} ) {
	const rows = [];

	return {
		rows,
		env: {
			DEVICE_TOKEN: TOKEN,
			STATS_PASSWORD: 'correct-horse',
			TARPIT_MS: 0,
			ANALYTICS: { writeDataPoint: ( row ) => rows.push( row ) },
			...overrides,
		},
	};
}

const blobOf = ( row, name ) => row.blobs[ BLOB_FIELDS.findIndex( ( field ) => field.name === name ) ];

const run = ( path, { env } ) => gate( new Request( `https://example.test${ path }` ), env, readConfig( env ) );

describe( 'gate', () => {
	describe( 'what it answers itself', () => {
		it( 'answers robots.txt immediately so a compliant crawler is not held', async () => {
			const context = recordingEnv();
			const { response } = await run( '/robots.txt', context );

			expect( response.status ).toBe( 200 );
			expect( await response.text() ).toContain( 'Disallow: /' );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( OUTCOMES.robots );
		} );

		// A browser requests this unprompted on every `/stats` visit. Tarpitting it would leave the tab
		// spinner going for 25 seconds after the owner's own page had finished rendering.
		it( 'answers favicon.ico immediately rather than treating it as a scanner', async () => {
			const context = recordingEnv();
			const { response } = await run( '/favicon.ico', context );

			expect( response.status ).toBe( 404 );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( OUTCOMES.favicon );
		} );
	} );

	describe( 'rejections', () => {
		it( 'records an unshaped path and holds it', async () => {
			const context = recordingEnv( { TARPIT_MS: 2 } );
			const started = performance.now();
			const { response } = await run( '/wp-login.php', context );

			expect( response.status ).toBe( 404 );
			expect( performance.now() - started ).toBeGreaterThanOrEqual( 1 );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( OUTCOMES.unshapedPath );
			expect( blobOf( context.rows[ 0 ], 'authorized' ) ).toBe( '0' );
		} );

		// The row is written before the delay, so a flood is visible on the stats page while it is
		// happening rather than one row per 25 seconds after the fact. Observed by checking partway
		// through the delay rather than synchronously, since the token comparison awaits first.
		it( 'records the outcome before waiting out the tarpit', async () => {
			const context = recordingEnv( { TARPIT_MS: 300 } );
			const pending = run( '/.env', context );

			await new Promise( ( resolve ) => setTimeout( resolve, 60 ) );

			expect( context.rows ).toHaveLength( 1 );

			await pending;
		} );

		it( 'gives a bad token the same status as an unshaped path', async () => {
			const context = recordingEnv();
			const bad = await run( `/token/${ 'b'.repeat( 64 ) }/agency/1/stop/590/api/display`, context );
			const unshaped = await run( '/nope', context );

			expect( bad.response.status ).toBe( unshaped.response.status );
			expect( await bad.response.text() ).toBe( await unshaped.response.text() );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( OUTCOMES.badToken );
		} );

		it( 'records a token fingerprint rather than the token itself', async () => {
			const context = recordingEnv();

			await run( `/token/${ TOKEN }/agency/1/stop/590/api/display`, context );

			const row = context.rows[ 0 ] ?? { blobs: [] };

			expect( row.blobs.join( '|' ) ).not.toContain( TOKEN );
		} );

		it( 'never records a raw path for an authorized request', async () => {
			const context = recordingEnv();
			const { recordOutcome } = await run( `/token/${ TOKEN }/agency/1/stop/590/api/display`, context );

			recordOutcome();

			const row = context.rows[ 0 ];

			expect( blobOf( row, 'probePath' ) ).toBe( '' );
			expect( row.blobs.join( '|' ) ).not.toContain( TOKEN );
		} );
	} );

	describe( 'authorized requests', () => {
		it( 'hands back a classification instead of a response', async () => {
			const context = recordingEnv();
			const result = await run( `/token/${ TOKEN }/agency/1/stop/590,430/api/display`, context );

			expect( result.response ).toBeUndefined();
			expect( result.classification.authorized ).toBe( true );
			expect( result.classification.parsed.stopIds ).toEqual( [ '590', '430' ] );
		} );

		// The gate deliberately does not log these, because the interesting outcome is not knowable
		// until a handler has run. Logging here as well would double-count every request the sign makes.
		it( 'records nothing until the caller calls recordOutcome', async () => {
			const context = recordingEnv();
			const { recordOutcome } = await run( `/token/${ TOKEN }/agency/1/stop/590/api/display`, context );

			expect( context.rows ).toHaveLength( 0 );

			recordOutcome( { outcome: 'display', filenameTag: 'departs' } );

			expect( context.rows ).toHaveLength( 1 );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( 'display' );
			expect( blobOf( context.rows[ 0 ], 'filenameTag' ) ).toBe( 'departs' );
			expect( blobOf( context.rows[ 0 ], 'authorized' ) ).toBe( '1' );
		} );

		it( 'records the stop IDs in full, which is a deliberate decision', async () => {
			const context = recordingEnv();
			const { recordOutcome } = await run( `/token/${ TOKEN }/agency/1/stop/590,430/api/display`, context );

			recordOutcome();

			expect( blobOf( context.rows[ 0 ], 'stopIds' ) ).toBe( '590,430' );
			expect( blobOf( context.rows[ 0 ], 'agency' ) ).toBe( '1' );
		} );

		it( 'classifies an unusable stop as a bad request with a reason, not a bad token', async () => {
			const context = recordingEnv();
			const result = await run( `/token/${ TOKEN }/agency/1/stop/590,430,600/api/display`, context );

			expect( result.classification.outcome ).toBe( OUTCOMES.badRequest );
			expect( result.classification.authorized ).toBe( true );
			expect( result.classification.reason ).toBe( 'too-many-stops' );
		} );
	} );

	describe( 'the stats page', () => {
		it( 'prompts without penalty when no credentials are offered', async () => {
			const context = recordingEnv();
			const { response } = await run( '/stats', context );

			expect( response.status ).toBe( 401 );
			expect( response.headers.get( 'WWW-Authenticate' ) ).toContain( 'Basic' );

			// A first load is not an attack and is not worth a row.
			expect( context.rows ).toHaveLength( 0 );
		} );

		it( 'records and holds a wrong password', async () => {
			const context = recordingEnv( { TARPIT_MS: 2 } );
			const request = new Request( 'https://example.test/stats', {
				headers: { Authorization: `Basic ${ btoa( 'admin:wrong' ) }` },
			} );

			const { response } = await gate( request, context.env, readConfig( context.env ) );

			expect( response.status ).toBe( 401 );
			expect( blobOf( context.rows[ 0 ], 'outcome' ) ).toBe( OUTCOMES.statsAuthFailed );
		} );

		// An unset password must lock the page rather than unlock it — the comparison refuses empty
		// strings rather than degenerating into a match.
		it( 'refuses an empty password even when the caller sends one', async () => {
			const context = recordingEnv( { STATS_PASSWORD: '', TARPIT_MS: 0 } );
			const request = new Request( 'https://example.test/stats', {
				headers: { Authorization: `Basic ${ btoa( 'admin:' ) }` },
			} );

			const { response } = await gate( request, context.env, readConfig( context.env ) );

			expect( response.status ).toBe( 401 );
		} );

		it( 'is matched before the token gate, so it is not an unshaped path', async () => {
			const context = recordingEnv();
			const { response } = await run( '/stats', context );

			expect( response.status ).not.toBe( 404 );
		} );
	} );

	it( 'does not throw when there is no analytics binding', async () => {
		const env = { DEVICE_TOKEN: TOKEN, TARPIT_MS: 0 };
		const { response } = await gate(
			new Request( 'https://example.test/whatever' ),
			env,
			readConfig( env )
		);

		expect( response.status ).toBe( 404 );
	} );
} );
