import { describe, expect, it } from 'vitest';
import {
	OUTCOMES,
	REJECTION_REASONS,
	TARPIT_MS,
	classifyRequest,
	diagnosePath,
	tarpit,
} from './abuse.js';
import { ROUTES, parsePath } from './routing.js';

const TOKEN = 'correct-horse-battery-staple';
const ENV = { DEVICE_TOKEN: TOKEN };
const BASE = `/token/${ TOKEN }/agency/1/stop/590`;

describe( 'classifyRequest', () => {
	describe( 'a path that was never ours', () => {
		// The only bucket the tarpit applies to, and the device cannot reach it: every URL the
		// firmware builds starts from a base URL that already carries the token segment.
		it.each( [ '/', '/api/display', '/wp-login.php', '/.env', '/favicon.ico', '' ] )(
			'tarpits %o',
			async ( pathname ) => {
				const result = await classifyRequest( pathname, ENV );

				expect( result.outcome ).toBe( OUTCOMES.unshapedPath );
				expect( result.tarpit ).toBe( true );
				expect( result.authorized ).toBe( false );
			}
		);

		it( 'tarpits a non-string pathname rather than throwing', async () => {
			const result = await classifyRequest( undefined, ENV );

			expect( result.outcome ).toBe( OUTCOMES.unshapedPath );
			expect( result.tarpit ).toBe( true );
			expect( result.authorized ).toBe( false );
		} );

		// Token extraction is positional, so the correct secret in the wrong slot authenticates
		// nothing. This is also the case `safeProbePath()` exists to keep out of the dataset.
		it( 'tarpits a near-miss prefix even when it carries the correct token', async () => {
			const result = await classifyRequest( `/toke/${ TOKEN }/agency/1/stop/590/api/display`, ENV );

			expect( result.outcome ).toBe( OUTCOMES.unshapedPath );
			expect( result.tarpit ).toBe( true );
			expect( result.authorized ).toBe( false );
		} );
	} );

	describe( 'a well-shaped path with the wrong token', () => {
		/**
		 * The `tarpit: false` assertion below is the regression guard for the whole design.
		 *
		 * A token typed into the captive portal with one character wrong produces exactly this
		 * shape, so it is the single most likely setup mistake. Holding it would exceed the device's
		 * 15 s read timeout, which is indistinguishable from the server being down — the firmware
		 * then retries on a 15 / 30 / 60 s ladder and draws nothing at all until the fourth failure,
		 * roughly seven minutes in. The symptom would be a sign that does nothing for seven minutes
		 * with no clue why.
		 */
		it.each( [
			[ 'a one-character typo', `${ TOKEN.slice( 0, -1 ) }x` ],
			[ 'a prefix of the real token', TOKEN.slice( 0, 12 ) ],
			[ 'an unrelated value', 'hunter2' ],
			[ 'the token with trailing whitespace escaped', `${ TOKEN }%20` ],
		] )( 'answers %s immediately', async ( _label, token ) => {
			const result = await classifyRequest(
				`/token/${ token }/agency/1/stop/590/api/display`,
				ENV
			);

			expect( result.outcome ).toBe( OUTCOMES.badToken );
			expect( result.tarpit ).toBe( false );
			expect( result.authorized ).toBe( false );
		} );
	} );

	describe( 'an unset secret', () => {
		// A deployed Worker where `env.DEVICE_TOKEN` is undefined must not degenerate into an open
		// endpoint. The path is well-shaped on purpose: an unshaped one returns before `env` is
		// ever read, so it would pass without testing anything.
		it.each( [
			[ 'no secret at all', {} ],
			[ 'an empty secret', { DEVICE_TOKEN: '' } ],
			[ 'no env object', undefined ],
		] )( 'authorizes nothing with %s', async ( _label, env ) => {
			const result = await classifyRequest( `${ BASE }/api/display`, env );

			expect( result.outcome ).toBe( OUTCOMES.badToken );
			expect( result.authorized ).toBe( false );
			expect( result.parsed ).toBeUndefined();
		} );
	} );

	describe( 'a valid token', () => {
		it.each( [ ROUTES.setup, ROUTES.display, ROUTES.log ] )(
			'reaches the %s route',
			async ( route ) => {
				const result = await classifyRequest( `${ BASE }/${ route }`, ENV );

				expect( result.outcome ).toBe( OUTCOMES.byosUnimplemented );
				expect( result.tarpit ).toBe( false );
				expect( result.authorized ).toBe( true );
				expect( result.parsed ).toMatchObject( {
					agency: '1',
					stopIds: [ '590' ],
					route,
				} );
			}
		);

		it( 'reaches the image route with its filename', async () => {
			const result = await classifyRequest( `${ BASE }/image/departs-3f9x1a-1785564693`, ENV );

			expect( result.outcome ).toBe( OUTCOMES.byosUnimplemented );
			expect( result.authorized ).toBe( true );
			expect( result.parsed ).toMatchObject( {
				route: ROUTES.image,
				filename: 'departs-3f9x1a-1785564693',
			} );
		} );

		it( 'carries both stops of a two-stop board, in the order given', async () => {
			const result = await classifyRequest(
				`/token/${ TOKEN }/agency/1/stop/590,430/api/display`,
				ENV
			);

			expect( result.parsed.stopIds ).toEqual( [ '590', '430' ] );
			expect( result.parsed.agency ).toBe( '1' );
			expect( result.parsed.route ).toBe( ROUTES.display );
		} );

		// After the token matches there is nothing left to protect from the caller, so a
		// misconfigured stop is authorized and explained rather than 404ing into silence.
		it( 'stays authorized when the rest of the path will not parse', async () => {
			const result = await classifyRequest(
				`/token/${ TOKEN }/agency/1/stop/590,430,600/api/display`,
				ENV
			);

			expect( result.outcome ).toBe( OUTCOMES.badRequest );
			expect( result.tarpit ).toBe( false );
			expect( result.authorized ).toBe( true );
			expect( result.reason ).toBe( REJECTION_REASONS.tooManyStops );
			expect( result.parsed ).toBeUndefined();
		} );
	} );
} );

/**
 * Every path here is anchored on a real token segment, because `diagnosePath()` only ever runs after
 * the token matched. A reason derived from a path that could not have authorized would be describing
 * a case that cannot happen.
 */
const DIAGNOSIS_CASES = [
	[ 'a valid one-stop display path', `${ BASE }/api/display`, true ],
	[ 'a valid two-stop display path', `/token/${ TOKEN }/agency/1/stop/590,430/api/display`, true ],
	[ 'a valid setup path', `${ BASE }/api/setup`, true ],
	[ 'a valid log path', `${ BASE }/api/log`, true ],
	[ 'a valid image path', `${ BASE }/image/departs-3f9x1a-1785564693`, true ],
	[ 'a missing agency label', `/token/${ TOKEN }/1/stop/590/api/display`, false ],
	[ 'a non-numeric agency', `/token/${ TOKEN }/agency/metro/stop/590/api/display`, false ],
	[ 'an over-long agency', `/token/${ TOKEN }/agency/12345/stop/590/api/display`, false ],
	[ 'a missing stop label', `/token/${ TOKEN }/agency/1/590/api/display`, false ],
	[ 'a stop label with no value', `/token/${ TOKEN }/agency/1/stop`, false ],
	[ 'three stops', `/token/${ TOKEN }/agency/1/stop/590,430,600/api/display`, false ],
	[ 'an illegal character in the stop', `/token/${ TOKEN }/agency/1/stop/semi;colon/api/display`, false ],
	[ 'an over-long stop', `/token/${ TOKEN }/agency/1/stop/${ 'a'.repeat( 40 ) }/api/display`, false ],
	[ 'a malformed percent-escape', `/token/${ TOKEN }/agency/1/stop/%zz/api/display`, false ],
	[ 'an unknown route', `${ BASE }/api/whatever`, false ],
	[ 'no route at all', BASE, false ],
];

describe( 'diagnosePath', () => {
	it( 'returns the parse for a good path', () => {
		const diagnosis = diagnosePath( `${ BASE }/api/display` );

		expect( diagnosis.ok ).toBe( true );
		expect( diagnosis.parsed ).toMatchObject( { agency: '1', stopIds: [ '590' ] } );
		expect( diagnosis.reason ).toBeUndefined();
	} );

	it.each( [
		[ REJECTION_REASONS.missingAgency, `/token/${ TOKEN }/1/stop/590/api/display` ],
		[ REJECTION_REASONS.invalidAgency, `/token/${ TOKEN }/agency/metro/stop/590/api/display` ],
		[ REJECTION_REASONS.invalidAgency, `/token/${ TOKEN }/agency/12345/stop/590/api/display` ],
		[ REJECTION_REASONS.missingStop, `/token/${ TOKEN }/agency/1/590/api/display` ],
		[ REJECTION_REASONS.missingStop, `/token/${ TOKEN }/agency/1/stop` ],
		[ REJECTION_REASONS.tooManyStops, `/token/${ TOKEN }/agency/1/stop/590,430,600/api/display` ],
		[ REJECTION_REASONS.invalidStopId, `/token/${ TOKEN }/agency/1/stop/semi;colon/api/display` ],
		[ REJECTION_REASONS.invalidStopId, `/token/${ TOKEN }/agency/1/stop/has space/api/display` ],
		[
			REJECTION_REASONS.invalidStopId,
			`/token/${ TOKEN }/agency/1/stop/${ 'a'.repeat( 40 ) }/api/display`,
		],
		[ REJECTION_REASONS.malformedEscape, `/token/${ TOKEN }/agency/1/stop/%zz/api/display` ],
		[ REJECTION_REASONS.unknownRoute, `${ BASE }/api/whatever` ],
		[ REJECTION_REASONS.unknownRoute, BASE ],
	] )( 'reports %s', ( reason, pathname ) => {
		expect( diagnosePath( pathname ) ).toEqual( { ok: false, reason } );
	} );

	it( 'names a reason for every rejection it can produce', () => {
		const reported = new Set(
			DIAGNOSIS_CASES.filter( ( [ , , ok ] ) => ! ok ).map(
				( [ , pathname ] ) => diagnosePath( pathname ).reason
			)
		);

		expect( [ ...reported ].sort() ).toEqual( Object.values( REJECTION_REASONS ).sort() );
	} );

	// `parsePath()` returns a bare null so a caller cannot leak a reason to someone who has not
	// authenticated, and this wraps it so an authenticated caller can be told what is wrong. The
	// wrapping is what keeps the safe default safe, so the two must never disagree on *whether* a
	// path is good — only on how much they say about it.
	it.each( DIAGNOSIS_CASES )( 'agrees with parsePath about %s', ( _label, pathname, ok ) => {
		expect( diagnosePath( pathname ).ok ).toBe( ok );
		expect( parsePath( pathname ) !== null ).toBe( ok );
	} );
} );

describe( 'tarpit', () => {
	// Deliberately a tiny duration: waiting `TARPIT_MS` here would blow vitest's default timeout,
	// and the only behaviour worth asserting is that the held request is eventually answered.
	it( 'resolves so a held request still gets its 404', async () => {
		await expect( tarpit( 1 ) ).resolves.toBeUndefined();
	} );

	// The number is load-bearing: above the device's 15 s read timeout, so nothing the device can
	// reach may ever be tarpitted.
	it( 'is configured above the device read timeout', () => {
		expect( TARPIT_MS ).toBeGreaterThan( 15000 );
	} );
} );

/**
 * These strings are written into Analytics Engine as the index column, where they are permanent:
 * renaming one orphans every historical row carrying the old value. `toMatchObject` rather than
 * `toEqual` because appending a new outcome or reason is expressly allowed — only a rename fails.
 */
describe( 'analytics vocabulary', () => {
	it( 'pins the outcome strings', () => {
		expect( OUTCOMES ).toMatchObject( {
			unshapedPath: 'unshaped-path',
			badToken: 'bad-token',
			badRequest: 'bad-request',
			byosUnimplemented: 'byos-unimplemented',
			favicon: 'favicon',
			robots: 'robots',
			statsAuthFailed: 'stats-auth-failed',
		} );
	} );

	it( 'pins the rejection reason strings', () => {
		expect( REJECTION_REASONS ).toMatchObject( {
			missingAgency: 'missing-agency-segment',
			invalidAgency: 'invalid-agency',
			missingStop: 'missing-stop-segment',
			invalidStopId: 'invalid-stop-id',
			tooManyStops: 'too-many-stops',
			malformedEscape: 'malformed-escape',
			unknownRoute: 'unknown-route',
		} );
	} );
} );
