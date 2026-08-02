import { beforeEach, describe, expect, it, vi } from 'vitest';
import busNorth from './fixtures/1_600.json';
import { fetchStop, loadStop, OBA_FAILURE_REASONS } from './client.js';
import { clearMemo, lastGood } from './memo.js';

const BASE = 'https://api.example.test/api/where';
const KEY = 'test-key';
const STOP = '1_600';
const NOW = 1785632414762;

const jsonResponse = ( body, status = 200 ) =>
	new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );

const respondWith = ( response ) => vi.fn( async () => response );

function call( fetchImpl, overrides = {} ) {
	return fetchStop( { baseUrl: BASE, apiKey: KEY, stopId: STOP, fetchImpl, ...overrides } );
}

beforeEach( () => {
	clearMemo();
} );

describe( 'fetchStop', () => {
	it( 'returns the entry, the references and upstream’s own clock', async () => {
		const result = await call( respondWith( jsonResponse( busNorth ) ) );

		expect( result.ok ).toBe( true );
		expect( result.currentTime ).toBe( busNorth.currentTime );
		expect( result.entry.arrivalsAndDepartures.length ).toBeGreaterThan( 0 );
		expect( result.references.stops.length ).toBeGreaterThan( 0 );
	} );

	// The key is a query parameter, which makes the request URL a secret. Nothing that could reach a
	// log line may carry it.
	it( 'never puts the key in what it returns', async () => {
		const fetchImpl = respondWith( jsonResponse( busNorth ) );
		const result = await call( fetchImpl );

		expect( fetchImpl.mock.calls[ 0 ][ 0 ] ).toContain( `key=${ KEY }` );
		expect( JSON.stringify( result ) ).not.toContain( KEY );
	} );

	it( 'reports a missing key as a setup error rather than an outage', async () => {
		const result = await call( respondWith( jsonResponse( busNorth ) ), { apiKey: '' } );

		expect( result ).toMatchObject( { ok: false, reason: OBA_FAILURE_REASONS.notConfigured } );
	} );

	// The shared `TEST` key earns a 429 under any real use, so this is the failure most likely to
	// happen in development.
	it( 'reports an HTTP status failure with the status', async () => {
		const result = await call( respondWith( new Response( 'slow down', { status: 429 } ) ) );

		expect( result ).toMatchObject( { ok: false, reason: OBA_FAILURE_REASONS.httpStatus, detail: 429 } );
	} );

	// OneBusAway reports an unknown stop as HTTP 200 with a non-200 `code` in the body, so the status
	// line alone would call this a success.
	it( 'catches an error code inside a 200 body', async () => {
		const result = await call( respondWith( jsonResponse( { code: 404, text: 'resource not found' } ) ) );

		expect( result ).toMatchObject( { ok: false, reason: OBA_FAILURE_REASONS.upstreamError, detail: 404 } );
	} );

	it( 'treats an unparseable body and a missing entry alike', async () => {
		const notJson = await call( respondWith( new Response( '<html>', { status: 200 } ) ) );
		const noEntry = await call( respondWith( jsonResponse( { code: 200, data: {} } ) ) );

		expect( notJson.reason ).toBe( OBA_FAILURE_REASONS.malformed );
		expect( noEntry.reason ).toBe( OBA_FAILURE_REASONS.malformed );
	} );

	it( 'separates a timeout from an unreachable host', async () => {
		const timedOut = await call(
			vi.fn( async () => {
				throw Object.assign( new Error( 'timed out' ), { name: 'TimeoutError' } );
			} )
		);
		const refused = await call(
			vi.fn( async () => {
				throw new TypeError( 'fetch failed' );
			} )
		);

		expect( timedOut.reason ).toBe( OBA_FAILURE_REASONS.timeout );
		expect( refused.reason ).toBe( OBA_FAILURE_REASONS.unreachable );
	} );
} );

describe( 'loadStop', () => {
	// The whole reason the memo exists: `/api/display` hashes a board into a filename and `/image`
	// rebuilds it, and the two have to be the same bytes.
	it( 'serves a second call from the memo rather than refetching', async () => {
		const fetchImpl = respondWith( jsonResponse( busNorth ) );
		const options = { baseUrl: BASE, apiKey: KEY, stopId: STOP, fetchImpl, nowMs: NOW };

		const first = await loadStop( options );
		const second = await loadStop( options );

		expect( fetchImpl ).toHaveBeenCalledTimes( 1 );
		expect( second ).toBe( first );
	} );

	// Two constraints pull opposite ways. A cached failure has to outlast the gap between a wake's two
	// requests, or `/api/display` fails, `/image` refetches and succeeds, and the device caches a good
	// board under an `obafail-` name. It also has to expire well before the next poll, so a recovered
	// upstream is not hidden behind a stale error.
	it( 'holds a failure across a wake and releases it before the next poll', async () => {
		const failing = vi.fn( async () => new Response( '', { status: 500 } ) );
		const options = { baseUrl: BASE, apiKey: KEY, stopId: STOP, fetchImpl: failing, nowMs: NOW };

		await loadStop( options );
		await loadStop( { ...options, nowMs: NOW + 15000 } );
		expect( failing ).toHaveBeenCalledTimes( 1 );

		await loadStop( { ...options, nowMs: NOW + 45000 } );
		expect( failing ).toHaveBeenCalledTimes( 2 );
	} );

	// `/image` only. `/api/display` has already promised the device a departures filename, so painting
	// an error board under that name caches a failure as though it were a good board.
	it( 'falls back to the last good response only when asked to', async () => {
		const good = await loadStop( {
			baseUrl: BASE,
			apiKey: KEY,
			stopId: STOP,
			fetchImpl: respondWith( jsonResponse( busNorth ) ),
			nowMs: NOW,
		} );

		const failing = {
			baseUrl: BASE,
			apiKey: KEY,
			stopId: STOP,
			fetchImpl: respondWith( new Response( '', { status: 503 } ) ),
			nowMs: NOW + 120000,
		};

		expect( await loadStop( { ...failing, allowStale: true } ) ).toBe( good );
		expect( ( await loadStop( { ...failing, nowMs: NOW + 240000 } ) ).ok ).toBe( false );
		expect( lastGood( STOP ) ).toBe( good );
	} );
} );
