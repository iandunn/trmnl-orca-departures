import { describe, expect, it } from 'vitest';
import {
	ABSENT_NUMBER,
	BLOB_FIELDS,
	DOUBLE_FIELDS,
	blobColumn,
	doubleColumn,
	eventFromRequest,
	safeProbePath,
} from './schema.js';
import { OUTCOMES, REJECTION_REASONS } from '../abuse.js';
import { ROUTES } from '../routing.js';

/** A realistic shared secret: `openssl rand -hex 32` is 64 characters. */
const TOKEN = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';
const BASE = `/token/${ TOKEN }/agency/1/stop/590,430`;

/**
 * Positions are resolved through the same accessors the SQL uses, so appending a field cannot shift
 * an assertion onto a neighbouring column. Hardcoding an index would be worse than a typo: an
 * off-by-one onto an adjacent empty column passes green while checking the wrong slot.
 */
const blobAt = ( blobs, name ) => blobs[ Number( blobColumn( name ).slice( 'blob'.length ) ) - 1 ];
const doubleAt = ( doubles, name ) =>
	doubles[ Number( doubleColumn( name ).slice( 'double'.length ) ) - 1 ];

const TELEMETRY_HEADERS = {
	Model: 'x',
	'FW-Version': '1.7.2',
	'Image-Cached': 'true',
	'Update-Source': 'sleep',
	'Wake-Time': '1785564693',
	'Battery-Capacity': '4000/6000',
	'Refresh-Rate': '60',
	'Battery-Voltage': '3.98',
	'Percent-Charged': '72',
	'Battery-Health': '98',
	'Battery-Current': '-120',
	'Battery-Temp': '21.5',
	'Battery-Count': '2',
	Width: '1872',
	Height: '1404',
	RSSI: '-58',
};

const AUTHORIZED = {
	outcome: OUTCOMES.byosUnimplemented,
	tarpit: false,
	authorized: true,
	parsed: { token: TOKEN, agency: '1', stopIds: [ '590', '430' ], route: ROUTES.display },
};

const UNSHAPED = { outcome: OUTCOMES.unshapedPath, tarpit: true, authorized: false };

function requestFor( pathname, headers = {} ) {
	return new Request( `https://sign.test${ pathname }`, { headers } );
}

describe( 'BLOB_FIELDS and DOUBLE_FIELDS', () => {
	/**
	 * Analytics Engine columns are positional and there is no schema: a query reads position 7 back
	 * as `blob7` whatever it now means, so **inserting a field mid-list silently reinterprets every
	 * historical row** with no migration and no way to detect it afterwards.
	 *
	 * If either of these fails, first confirm the change was an append to the end — then extend the
	 * list below to match. A reorder, a mid-list insert or a deletion is never the right fix.
	 */
	it( 'pins the blob order', () => {
		expect( BLOB_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'outcome',
			'route',
			'reason',
			'agency',
			'stopIds',
			'tokenHash',
			'model',
			'firmwareVersion',
			'imageCached',
			'updateSource',
			'wakeTime',
			'filenameTag',
			'batteryCapacity',
			'country',
			'asn',
			'networkOrganization',
			'httpProtocol',
			'userAgent',
			'probePath',
			'authorized',
		] );
	} );

	it( 'pins the double order', () => {
		expect( DOUBLE_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'refreshRateEcho',
			'batteryVoltage',
			'percentCharged',
			'batteryHealth',
			'batteryCurrent',
			'batteryTemperature',
			'batteryCount',
			'width',
			'height',
			'signalStrength',
		] );
	} );
} );

describe( 'blobColumn and doubleColumn', () => {
	it.each( [
		[ 'outcome', 'blob1' ],
		[ 'stopIds', 'blob5' ],
		[ 'country', 'blob14' ],
		[ 'authorized', `blob${ BLOB_FIELDS.length }` ],
	] )( 'maps the %s blob to %s', ( name, column ) => {
		expect( blobColumn( name ) ).toBe( column );
	} );

	it.each( [
		[ 'refreshRateEcho', 'double1' ],
		[ 'batteryVoltage', 'double2' ],
		[ 'signalStrength', `double${ DOUBLE_FIELDS.length }` ],
	] )( 'maps the %s double to %s', ( name, column ) => {
		expect( doubleColumn( name ) ).toBe( column );
	} );

	it( 'resolves every declared field', () => {
		expect( BLOB_FIELDS.map( ( field ) => blobColumn( field.name ) ) ).toHaveLength(
			BLOB_FIELDS.length
		);
		expect( DOUBLE_FIELDS.map( ( field ) => doubleColumn( field.name ) ) ).toHaveLength(
			DOUBLE_FIELDS.length
		);
	} );

	// A query naming a field that no longer exists must break loudly rather than read `blobundefined`
	// or, worse, silently fall back to a column that happens to parse.
	it.each( [ 'nope', '', undefined, 'blob1' ] )( 'throws for the unknown blob %o', ( name ) => {
		expect( () => blobColumn( name ) ).toThrow( TypeError );
	} );

	it.each( [ 'nope', '', undefined, 'refreshRate' ] )(
		'throws for the unknown double %o',
		( name ) => {
			expect( () => doubleColumn( name ) ).toThrow( TypeError );
		}
	);
} );

describe( 'eventFromRequest', () => {
	it( 'fills exactly one slot per declared field', () => {
		const event = eventFromRequest( {
			request: requestFor( `${ BASE }/api/display`, TELEMETRY_HEADERS ),
			classification: AUTHORIZED,
		} );

		expect( event.blobs ).toHaveLength( BLOB_FIELDS.length );
		expect( event.doubles ).toHaveLength( DOUBLE_FIELDS.length );
	} );

	it( 'indexes on the outcome alone', () => {
		const event = eventFromRequest( {
			request: requestFor( `${ BASE }/api/display` ),
			classification: AUTHORIZED,
		} );

		expect( event.indexes ).toEqual( [ OUTCOMES.byosUnimplemented ] );
	} );

	describe( 'the classification', () => {
		it.each( [
			[ 'outcome', OUTCOMES.byosUnimplemented ],
			[ 'route', ROUTES.display ],
			[ 'agency', '1' ],
			[ 'stopIds', '590,430' ],
			[ 'tokenHash', '3f9a1b2c' ],
			[ 'filenameTag', 'departs' ],
		] )( 'records %s as %o', ( name, expected ) => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display` ),
				classification: AUTHORIZED,
				tokenHash: '3f9a1b2c',
				filenameTag: 'departs',
			} );

			expect( blobAt( event.blobs, name ) ).toBe( expected );
		} );

		it( 'records the rejection reason once there is one', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE },600/api/display` ),
				classification: {
					outcome: OUTCOMES.badRequest,
					tarpit: false,
					authorized: true,
					reason: REJECTION_REASONS.tooManyStops,
				},
			} );

			expect( blobAt( event.blobs, 'reason' ) ).toBe( REJECTION_REASONS.tooManyStops );
			expect( blobAt( event.blobs, 'outcome' ) ).toBe( OUTCOMES.badRequest );
		} );

		// An absent value has to be an empty string rather than the word "undefined", since the
		// column is read back verbatim and `/stats` would otherwise count a literal `undefined`.
		it.each( [ 'route', 'reason', 'agency', 'stopIds', 'tokenHash', 'filenameTag' ] )(
			'leaves %s empty when there is nothing to record',
			( name ) => {
				const event = eventFromRequest( {
					request: requestFor( '/wp-login.php' ),
					classification: UNSHAPED,
				} );

				expect( blobAt( event.blobs, name ) ).toBe( '' );
			}
		);
	} );

	describe( 'the authorized flag', () => {
		// Redundant against `outcome` on purpose: deriving it in SQL would mean enumerating the
		// authorized outcome names in a `WHERE` clause, which goes quietly wrong the moment a new
		// outcome is added.
		it( 'is "1" for an authorized request', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display` ),
				classification: AUTHORIZED,
			} );

			expect( blobAt( event.blobs, 'authorized' ) ).toBe( '1' );
		} );

		it.each( [
			[ 'an unshaped path', UNSHAPED ],
			[ 'a bad token', { outcome: OUTCOMES.badToken, tarpit: false, authorized: false } ],
		] )( 'is "0" for %s', ( _label, classification ) => {
			const event = eventFromRequest( {
				request: requestFor( '/wp-login.php' ),
				classification,
			} );

			expect( blobAt( event.blobs, 'authorized' ) ).toBe( '0' );
		} );
	} );

	describe( 'telemetry headers', () => {
		const event = eventFromRequest( {
			request: requestFor( `${ BASE }/api/display`, TELEMETRY_HEADERS ),
			classification: AUTHORIZED,
		} );

		it.each( [
			[ 'model', 'x' ],
			[ 'firmwareVersion', '1.7.2' ],
			[ 'imageCached', 'true' ],
			[ 'updateSource', 'sleep' ],
			[ 'wakeTime', '1785564693' ],
			[ 'batteryCapacity', '4000/6000' ],
		] )( 'lands %s in its own column as %o', ( name, expected ) => {
			expect( blobAt( event.blobs, name ) ).toBe( expected );
		} );

		it.each( [
			[ 'refreshRateEcho', 60 ],
			[ 'batteryVoltage', 3.98 ],
			[ 'percentCharged', 72 ],
			[ 'batteryHealth', 98 ],
			[ 'batteryCurrent', -120 ],
			[ 'batteryTemperature', 21.5 ],
			[ 'batteryCount', 2 ],
			[ 'width', 1872 ],
			[ 'height', 1404 ],
			[ 'signalStrength', -58 ],
		] )( 'lands %s in its own column as %o', ( name, expected ) => {
			expect( doubleAt( event.doubles, name ) ).toBe( expected );
		} );

		it( 'reads the panel geometry the device reports rather than assuming it', () => {
			const swapped = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, { Width: '1404', Height: '1872' } ),
				classification: AUTHORIZED,
			} );

			expect( doubleAt( swapped.doubles, 'width' ) ).toBe( 1404 );
			expect( doubleAt( swapped.doubles, 'height' ) ).toBe( 1872 );
		} );
	} );

	/**
	 * Zero is unacceptable as the absent value because it is a meaningful reading for most of these:
	 * a `refresh_rate` of 0 is the hot-loop bug that flattens the battery, and 0 volts is not the
	 * same as a fuel gauge that never reported.
	 */
	describe( 'missing numeric telemetry', () => {
		it.each( [
			[ 'an absent header', {} ],
			[ 'an empty header', { 'Refresh-Rate': '' } ],
			[ 'a whitespace header', { 'Refresh-Rate': '   ' } ],
			[ 'an unparseable header', { 'Refresh-Rate': 'soon' } ],
		] )( 'records %s as ABSENT_NUMBER, not 0', ( _label, headers ) => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, headers ),
				classification: AUTHORIZED,
			} );

			expect( doubleAt( event.doubles, 'refreshRateEcho' ) ).toBe( ABSENT_NUMBER );
			expect( doubleAt( event.doubles, 'refreshRateEcho' ) ).not.toBe( 0 );
		} );

		it( 'fills every double when the device sends no telemetry at all', () => {
			const event = eventFromRequest( {
				request: requestFor( '/wp-login.php' ),
				classification: UNSHAPED,
			} );

			expect( event.doubles ).toEqual( DOUBLE_FIELDS.map( () => ABSENT_NUMBER ) );
		} );

		// The X reports -1 from every battery header when the fuel gauge failed to initialise, which
		// is why the sentinel was chosen to match: the device's own reading passes through untouched.
		it( 'passes the failed fuel gauge through unchanged', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, {
					'Battery-Voltage': '-1',
					'Percent-Charged': '-1',
					'Battery-Health': '-1',
					'Battery-Current': '-1',
					'Battery-Temp': '-1',
					'Battery-Count': '-1',
				} ),
				classification: AUTHORIZED,
			} );

			expect( doubleAt( event.doubles, 'batteryVoltage' ) ).toBe( -1 );
			expect( doubleAt( event.doubles, 'batteryCount' ) ).toBe( -1 );
		} );

		it( 'records a real zero as zero', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, { 'Percent-Charged': '0' } ),
				classification: AUTHORIZED,
			} );

			expect( doubleAt( event.doubles, 'percentCharged' ) ).toBe( 0 );
		} );
	} );

	describe( 'the probe path', () => {
		// The rule that keeps the live shared secret out of the dataset: an authenticated path
		// carries the token in a segment by definition, so it is never written down at all.
		it( 'is empty for an authorized request whose URL holds the real token', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, TELEMETRY_HEADERS ),
				classification: AUTHORIZED,
			} );

			expect( blobAt( event.blobs, 'probePath' ) ).toBe( '' );
			expect( event.blobs.join( '\n' ) ).not.toContain( TOKEN );
		} );

		it( 'records what an unauthenticated caller asked for', () => {
			const event = eventFromRequest( {
				request: requestFor( '/wp-login.php' ),
				classification: UNSHAPED,
			} );

			expect( blobAt( event.blobs, 'probePath' ) ).toBe( '/wp-login.php' );
		} );

		// The near miss is the whole reason the field is filtered: `/toke/<real token>/...` fails the
		// token check, lands in the unshaped bucket, and would otherwise write the secret to
		// analytics — exactly the place people paste when debugging.
		it( 'redacts the token from a one-character near miss', () => {
			const event = eventFromRequest( {
				request: requestFor( `/toke/${ TOKEN }/agency/1/stop/590/api/display` ),
				classification: UNSHAPED,
			} );

			const probePath = blobAt( event.blobs, 'probePath' );

			expect( probePath ).not.toContain( TOKEN );
			expect( probePath ).toContain( '[redacted]' );
			expect( event.blobs.join( '\n' ) ).not.toContain( TOKEN );
		} );

		// The pairing typo is the most likely unauthenticated request the sign will ever see, and its
		// path carries a value one character away from the live secret.
		it( 'redacts the near-miss token from a pairing typo', () => {
			const event = eventFromRequest( {
				request: requestFor( `/token/${ TOKEN.slice( 0, -1 ) }x/agency/1/stop/590/api/display` ),
				classification: { outcome: OUTCOMES.badToken, tarpit: false, authorized: false },
			} );

			expect( blobAt( event.blobs, 'probePath' ) ).toBe( '/token/[redacted]/agency/1' );
		} );

		it( 'survives a request whose URL will not parse', () => {
			const event = eventFromRequest( {
				request: { url: 'not a url', headers: new Headers() },
				classification: UNSHAPED,
			} );

			expect( blobAt( event.blobs, 'probePath' ) ).toBe( '/' );
		} );
	} );

	describe( 'string caps', () => {
		// Analytics Engine bounds the total bytes of all blobs in a row, so the free-text fields are
		// clipped rather than trusted.
		it( 'clips a long field at the long cap', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, { 'User-Agent': 'u'.repeat( 400 ) } ),
				classification: AUTHORIZED,
			} );

			expect( blobAt( event.blobs, 'userAgent' ) ).toHaveLength( 256 );
		} );

		it( 'clips a short field harder than a long one', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display`, {
					Model: 'm'.repeat( 400 ),
					'User-Agent': 'u'.repeat( 400 ),
				} ),
				classification: AUTHORIZED,
			} );

			const model = blobAt( event.blobs, 'model' );

			expect( model ).toHaveLength( 64 );
			expect( model.length ).toBeLessThan( blobAt( event.blobs, 'userAgent' ).length );
		} );

		it( 'clips a long stop list', () => {
			const event = eventFromRequest( {
				request: requestFor( `${ BASE }/api/display` ),
				classification: {
					...AUTHORIZED,
					parsed: { ...AUTHORIZED.parsed, stopIds: [ 'a'.repeat( 200 ), 'b'.repeat( 200 ) ] },
				},
			} );

			expect( blobAt( event.blobs, 'stopIds' ) ).toHaveLength( 256 );
		} );
	} );
} );

describe( 'safeProbePath', () => {
	// The segment after `token` is redacted on position alone, not on how it looks. The length rule
	// would already catch a 64-character hex secret, but that makes the guarantee depend on how long
	// the secret happens to be — and this is the one path shape guaranteed to carry a near-miss of the
	// live token, since a pairing typo produces exactly it.
	describe( 'the token position specifically', () => {
		it.each( [
			[ 'a short token', `/token/${ 'a'.repeat( 8 ) }/agency/1`, '/token/[redacted]/agency/1' ],
			[ 'a long token', `/token/${ 'a'.repeat( 64 ) }/agency/1`, '/token/[redacted]/agency/1' ],
			[ 'a wordlike token', '/token/hunter2/agency/1', '/token/[redacted]/agency/1' ],
			[ 'nothing else', '/token/abc', '/token/[redacted]' ],
		] )( 'redacts %s', ( _label, path, expected ) => {
			expect( safeProbePath( path ) ).toBe( expected );
		} );

		it( 'does not redact a same-shaped segment that is not after `token`', () => {
			expect( safeProbePath( '/agency/1/stop/590' ) ).toBe( '/agency/1/stop/590' );
		} );

		it.each( [ 4, 8, 16, 24, 32, 64 ] )( 'never emits a %i-character secret', ( length ) => {
			const secret = 'f'.repeat( length );

			expect( safeProbePath( `/token/${ secret }/agency/1/stop/590` ) ).not.toContain( secret );
		} );
	} );

	it.each( [
		[ '/wp-login.php', '/wp-login.php' ],
		[ '/.env', '/.env' ],
		[ '/api/display', '/api/display' ],
		[ '/admin/x.php', '/admin/x.php' ],
		[ '/favicon.ico', '/favicon.ico' ],
		[ '/robots.txt', '/robots.txt' ],
		[ '//api//display', '/api/display' ],
	] )( 'keeps the ordinary probe %o', ( pathname, expected ) => {
		expect( safeProbePath( pathname ) ).toBe( expected );
	} );

	it.each( [ '', '/', undefined, null ] )( 'renders %o as a bare root', ( pathname ) => {
		expect( safeProbePath( pathname ) ).toBe( '/' );
	} );

	it( 'caps the number of segments', () => {
		expect( safeProbePath( '/a/b/c/d/e/f' ) ).toBe( '/a/b/c/d' );
	} );

	/**
	 * An allow-list rather than a deny-list, which is the load-bearing decision: filtering out
	 * "things that look like tokens" would fail the moment the token format changed, while requiring
	 * a segment to look like an ordinary short path word excludes every secret by construction.
	 */
	describe( 'redaction', () => {
		const hexToken = TOKEN;

		it.each( [
			[ 'the first segment', `/${ hexToken }/api/display` ],
			[ 'a middle segment', `/toke/${ hexToken }/agency/1` ],
			[ 'the last kept segment', `/token/x/agency/${ hexToken }` ],
		] )( 'never emits a 64-character hex token in %s', ( _label, pathname ) => {
			const safe = safeProbePath( pathname );

			expect( safe ).not.toContain( hexToken );
			expect( safe ).toContain( '[redacted]' );
		} );

		it.each( [
			[ 'anything over the safe length', `/${ 'a'.repeat( 25 ) }` ],
			[ 'a base64 blob', '/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' ],
			[ 'a percent-escape', '/%2e%2e%2f%2e%2e' ],
			[ 'a query-like segment', '/index.php?a=1' ],
			[ 'a space', '/has space' ],
		] )( 'redacts %s', ( _label, pathname ) => {
			expect( safeProbePath( pathname ) ).toBe( '/[redacted]' );
		} );

		it( 'keeps the segments around a redacted one', () => {
			expect( safeProbePath( `/toke/${ hexToken }/agency/1` ) ).toBe(
				'/toke/[redacted]/agency/1'
			);
		} );

		it( 'accepts a segment right at the safe length', () => {
			expect( safeProbePath( `/${ 'a'.repeat( 24 ) }` ) ).toBe( `/${ 'a'.repeat( 24 ) }` );
		} );
	} );
} );
