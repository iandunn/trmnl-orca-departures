import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './worker.js';
import busNorth from './oba/fixtures/1_600.json';
import { clearMemo } from './oba/memo.js';
import { deriveApiKey } from './byos/credentials.js';

/**
 * The image route is stubbed because rasterising needs the real wasm, and `vitest.config.js` aliases
 * every `.wasm` and `.ttf` import to an empty stub so the suite can import these modules at all.
 * What is worth asserting here is routing and response shape; the pixels are verified by fetching
 * the PNG from `wrangler dev` and looking at it.
 */
vi.mock( './byos/image.js', () => ( {
	handleImage: async () => ( {
		tag: 'noservc',
		response: new Response( 'png bytes', { headers: { 'Content-Type': 'image/png' } } ),
	} ),
} ) );

/**
 * Every environment here sets `TARPIT_MS: 0`. Without it the unshaped-path cases would each hold for
 * the real 25 seconds and the suite would take minutes — the delay itself is exercised in
 * `src/gate.test.js` with a duration a test can afford.
 */
const TOKEN = 'f'.repeat( 64 );
const env = { DEVICE_TOKEN: TOKEN, TARPIT_MS: 0 };
const BASE = `/token/${ TOKEN }/agency/1/stop/590,430`;

const fetchPath = ( path, environment = env, init ) =>
	worker.fetch( new Request( `https://example.test${ path }`, init ), environment );

const authed = async ( path, environment = env ) =>
	fetchPath( path, environment, { headers: { 'Access-Token': await deriveApiKey( TOKEN ) } } );

describe( 'unauthenticated requests', () => {
	it( 'returns 404 for every unshaped path', async () => {
		for ( const path of [ '/', '/api/setup', '/api/display', '/api/log', '/wp-login.php' ] ) {
			expect( ( await fetchPath( path ) ).status ).toBe( 404 );
		}
	} );

	it( 'returns 404 for every route when the token is wrong', async () => {
		const wrong = '/token/nope/agency/1/stop/590';

		for ( const route of [ 'api/setup', 'api/display', 'api/log', 'image/departs-abc123-1785564693' ] ) {
			expect( ( await fetchPath( `${ wrong }/${ route }` ) ).status ).toBe( 404 );
		}
	} );

	// The reason the secrets go in before the first deploy rather than after: an unset DEVICE_TOKEN
	// must not make the comparison degenerate into an open endpoint.
	it( 'returns 404 when DEVICE_TOKEN is unset, whatever the caller presents', async () => {
		for ( const environment of [ { TARPIT_MS: 0 }, { DEVICE_TOKEN: '', TARPIT_MS: 0 } ] ) {
			expect( ( await fetchPath( `${ BASE }/api/setup`, environment ) ).status ).toBe( 404 );
		}
	} );

	it( 'answers robots.txt with a disallow rather than a 404', async () => {
		const response = await fetchPath( '/robots.txt' );

		expect( response.status ).toBe( 200 );
		expect( await response.text() ).toContain( 'Disallow: /' );
	} );
} );

describe( 'the dev preview', () => {
	it( 'is served only when the flag is set', async () => {
		expect( ( await fetchPath( '/_preview/stats' ) ).status ).toBe( 404 );
		expect( ( await fetchPath( '/_preview/stats', { ...env, DEV_PREVIEW: '1' } ) ).status ).toBe( 200 );
	} );

	// The failure worth guarding is the reverse of the usual one: enabling the preview locally must
	// not open or alter a device route.
	it( 'cannot reach a BYOS path with a bad token', async () => {
		const withPreview = { ...env, DEV_PREVIEW: '1' };

		for ( const path of [ '/api/display', '/token/nope/agency/1/stop/590/api/display' ] ) {
			expect( ( await fetchPath( path, withPreview ) ).status ).toBe( 404 );
		}
	} );
} );

describe( '/api/setup', () => {
	it( 'puts 200 in the body, which is the opposite of /api/display', async () => {
		const body = await ( await fetchPath( `${ BASE }/api/setup` ) ).json();

		// Verified against `parse_response_api_setup.cpp:25`: anything but 200 fails enrollment with
		// nothing on the glass to say why.
		expect( body.status ).toBe( 200 );
		expect( body.api_key ).toMatch( /^[0-9a-f]{64}$/ );
		expect( body.friendly_id ).toMatch( /^[2-9A-HJ-NP-Z]{6}$/ );
		expect( body.image_url ).toBe( `https://example.test${ BASE }/image/setup` );
	} );

	// Enrollment cannot present a key, and the setup logo download sends no headers at all.
	it( 'does not require an Access-Token, and neither does the image', async () => {
		expect( ( await fetchPath( `${ BASE }/api/setup` ) ).status ).toBe( 200 );
		expect( ( await fetchPath( `${ BASE }/image/setup` ) ).status ).toBe( 200 );
	} );
} );

describe( '/api/display', () => {
	const displayBody = async ( environment = env ) =>
		( await authed( `${ BASE }/api/display`, environment ) ).json();

	// Every value other than 0, 202 and 500 falls through the firmware's dispatch switch and the
	// whole response is discarded — including 200, which is the obvious thing to write.
	it( 'puts status 0 in the body', async () => {
		expect( ( await displayBody() ).status ).toBe( 0 );
	} );

	// Absent parses as 0, is written to NVS, and hot-loops the device flat across power cycles.
	it( 'always sends a refresh_rate of at least one second', async () => {
		for ( const bad of [ undefined, '0', '-5', 'soon', '' ] ) {
			const body = await displayBody( { ...env, REFRESH_ACTIVE_SECONDS: bad } );

			expect( body.refresh_rate ).toBeGreaterThanOrEqual( 1 );
			expect( Number.isInteger( body.refresh_rate ) ).toBe( true );
		}
	} );

	// `reset_firmware` clears the WiFi credentials, api key and cached filename and reboots into the
	// captive portal. Both default to false when absent, so not sending them is how a typo is
	// prevented from becoming a factory reset.
	it( 'never sends the two destructive fields, and never a 500 status', async () => {
		const body = await displayBody();

		expect( body ).not.toHaveProperty( 'reset_firmware' );
		expect( body ).not.toHaveProperty( 'update_firmware' );
		expect( body.status ).not.toBe( 500 );
	} );

	// The firmware tests the image URL against the stored base URL with a raw `strncmp`. Anything
	// diverging before the end of the prefix silently loses its auth headers.
	it( 'serves the image from under the device base URL', async () => {
		const body = await displayBody();

		expect( body.image_url ).toBe( `https://example.test${ BASE }/image/${ body.filename }` );
	} );

	it( 'requires an Access-Token', async () => {
		expect( ( await fetchPath( `${ BASE }/api/display` ) ).status ).toBe( 404 );
	} );

	describe( 'the filename it issues', () => {
		// Pinned inside the active window, because every tag below is a *departures* tag and the sign
		// does not draw departures at night. Without this the suite passes all day and fails after
		// `ACTIVE_END` — a test that depends on when it is run is worse than no test.
		beforeEach( () => {
			vi.useFakeTimers();
			vi.setSystemTime( Date.parse( '2026-08-01T12:00:00-07:00' ) );
		} );

		afterEach( () => {
			vi.useRealTimers();
		} );

		it( 'satisfies all three firmware shape rules', async () => {
			const { filename } = await displayBody();

			// Trailing 10 digits, or the purge reads a timestamp of 0 and deletes every cached image
			// before each write. Exactly 31 copies without a NUL terminator. The first 13 characters are
			// what the purge compares, so they must not carry the hash.
			expect( filename ).toMatch( /\d{10}$/ );
			expect( filename.length ).toBe( 29 );
			expect( filename.slice( 7, 13 ) ).toBe( '-sign-' );
			expect( filename.length ).not.toBe( 31 );
		} );

		// A degraded screen whose filename collides with a good render is suppressed by the cache and
		// never reaches the glass.
		// The test environment configures no `OBA_API_KEY`, so every stop fails to load and the board
		// drops to the upstream-failure notice. That is the tag being asserted here.
		it( 'carries the state tag', async () => {
			expect( ( await displayBody() ).filename.startsWith( 'obafail-' ) ).toBe( true );
		} );

		// The other half of the same rule, and the one that proves the tags are actually reachable: a
		// board with departures on it must not share a filename shape with the notice that replaces it.
		it( 'carries the departures tag once OneBusAway answers', async () => {
			clearMemo();
			vi.stubGlobal( 'fetch', async () => Response.json( busNorth ) );

			try {
				const response = await authed( `${ BASE }/api/display`, { ...env, OBA_API_KEY: 'test-key' } );

				expect( ( await response.json() ).filename.startsWith( 'departs-' ) ).toBe( true );
			} finally {
				vi.unstubAllGlobals();
				clearMemo();
			}
		} );

		// Minute accuracy on the "Updated at" stamp is the requirement this trades flicker for: the
		// name is hashed over the rendered SVG, so it moves exactly when the visible stamp moves.
		it( 'changes when the displayed minute changes', async () => {
			vi.useFakeTimers();

			try {
				vi.setSystemTime( new Date( '2026-08-01T16:22:10-07:00' ) );
				const first = ( await displayBody() ).filename;

				vi.setSystemTime( new Date( '2026-08-01T16:22:50-07:00' ) );
				expect( ( await displayBody() ).filename ).toBe( first );

				vi.setSystemTime( new Date( '2026-08-01T16:23:10-07:00' ) );
				expect( ( await displayBody() ).filename ).not.toBe( first );
			} finally {
				vi.useRealTimers();
			}
		} );
	} );
} );

describe( '/api/log', () => {
	const post = async ( body ) =>
		fetchPath( `${ BASE }/api/log`, env, {
			method: 'POST',
			headers: { 'Access-Token': await deriveApiKey( TOKEN ), 'Content-Type': 'application/json' },
			body,
		} );

	it( 'answers 204 with no body', async () => {
		const response = await post(
			JSON.stringify( { logs: [ { message: 'hello', source_path: 'src/bl.cpp', source_line: 2235 } ] } )
		);

		expect( response.status ).toBe( 204 );
		expect( await response.text() ).toBe( '' );
	} );

	// A device that cannot frame its own diagnostics must not conclude the server is broken and start
	// backing off.
	it( 'still answers 204 when the body is not JSON', async () => {
		expect( ( await post( 'not json' ) ).status ).toBe( 204 );
	} );

	it( 'still answers 204 when the logs field is the wrong shape', async () => {
		expect( ( await post( JSON.stringify( { logs: 'oops' } ) ) ).status ).toBe( 204 );
	} );

	it( 'requires an Access-Token', async () => {
		const response = await fetchPath( `${ BASE }/api/log`, env, {
			method: 'POST',
			body: JSON.stringify( { logs: [] } ),
		} );

		expect( response.status ).toBe( 404 );
	} );
} );

// The other half of "opaque before auth, helpful after": the most likely mistake the owner can make
// is a typo in the base URL typed into the captive portal, and a 404 there is a sign that does
// nothing for seven minutes with no clue why.
describe( 'an authorized request whose path will not parse', () => {
	const BAD = `/token/${ TOKEN }/agency/one/stop/590`;

	it( 'serves a display response rather than a 404', async () => {
		const response = await authed( `${ BAD }/api/display` );
		const body = await response.json();

		expect( response.status ).toBe( 200 );
		expect( body.status ).toBe( 0 );
		expect( body.refresh_rate ).toBeGreaterThanOrEqual( 1 );
		expect( body.filename.startsWith( 'badpath-' ) ).toBe( true );
	} );

	// The stored base URL is the mistyped one, so the image URL has to reproduce the same mistake or
	// the firmware's `strncmp` fails and it never fetches the explanation.
	it( 'points the image URL at the mistyped base', async () => {
		const body = await ( await authed( `${ BAD }/api/display` ) ).json();

		expect( body.image_url ).toBe( `https://example.test${ BAD }/image/${ body.filename }` );
	} );

	// Failing setup shows a generic firmware error; succeeding and then drawing "Check the sign URL"
	// says exactly what is wrong.
	it( 'still lets pairing succeed, so the board can carry the explanation', async () => {
		const body = await ( await fetchPath( `${ BAD }/api/setup` ) ).json();

		expect( body.status ).toBe( 200 );
		expect( body.image_url ).toBe( `https://example.test${ BAD }/image/setup` );
	} );

	// No recognisable route suffix at all, which is what a base URL with a typo *after* the stop
	// produces. It is treated as a display poll, because that is the request the device makes 1440
	// times a day and the only one that can carry an explanation to the glass.
	it( 'answers a path with no recognisable suffix as a display poll', async () => {
		const nonsense = `${ BAD }/nonsense`;
		const body = await ( await authed( nonsense ) ).json();

		expect( body.status ).toBe( 0 );
		expect( body.refresh_rate ).toBeGreaterThanOrEqual( 1 );
		expect( body.filename.startsWith( 'badpath-' ) ).toBe( true );
		// The whole mistyped path is the base the device stored, so the image URL has to extend it.
		expect( body.image_url ).toBe( `https://example.test${ nonsense }/image/${ body.filename }` );
	} );
} );
