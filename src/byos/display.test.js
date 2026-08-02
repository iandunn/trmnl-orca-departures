/**
 * The schedule's effect on `/api/display`, which is where the two halves have to meet.
 *
 * Everything here is about the seam rather than the arithmetic — `src/schedule.test.js` covers the
 * clock, and this covers what the endpoint does with the answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FILENAME_TAGS } from '../filename.js';
import { currentScreen, handleDisplay } from './display.js';

const TARGET = { parsed: { agency: '1', stopIds: [ '600', '430' ] }, basePath: '/token/x/agency/1/stop/600,430' };

/** Pacific wall-clock time as epoch milliseconds, in August, so the offset is fixed at -07:00. */
const august = ( time ) => Date.parse( `2026-08-01T${ time }-07:00` );

const request = () => new Request( 'https://sign.test/token/x/agency/1/stop/600,430/api/display' );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
} );

describe( 'currentScreen, outside the active window', () => {
	// The reason the branch lives in `currentScreen()` rather than in `handleDisplay()`: `/image` calls
	// this same function, so a branch any higher would leave the image route still fetching all night.
	it( 'never calls OneBusAway', async () => {
		const fetchSpy = vi.fn( () => {
			throw new Error( 'the overnight screen must not reach upstream' );
		} );

		vi.stubGlobal( 'fetch', fetchSpy );

		const { screen } = await currentScreen( TARGET, {}, august( '22:00:00' ) );

		expect( screen.tag ).toBe( FILENAME_TAGS.overnight );
		expect( fetchSpy ).not.toHaveBeenCalled();
	} );

	it( 'renders identical bytes whenever it is served', async () => {
		const early = await currentScreen( TARGET, {}, august( '21:30:07' ) );
		const late = await currentScreen( TARGET, {}, august( '23:59:59' ) );
		const smallHours = await currentScreen( TARGET, {}, august( '03:00:00' ) );

		expect( late.svg ).toBe( early.svg );
		expect( smallHours.svg ).toBe( early.svg );

		// The content half of the name follows the bytes and so never moves. The epoch half still
		// advances with `stableEpoch()`, whose 12-hour bucket rolls at about 02:00 Pacific — inside the
		// sleep window, where nothing is awake to see a repaint.
		expect( late.filename ).toBe( early.filename );
		expect( smallHours.filename.split( '-' ).slice( 0, 2 ) ).toEqual(
			early.filename.split( '-' ).slice( 0, 2 )
		);
	} );

	// A base URL mistyped at the captive portal is the one thing this screen must not hide, and
	// pairing happens whenever the owner is standing there — including at 10pm.
	it( 'still shows the bad-path diagnostic instead of the rest screen', async () => {
		const { screen } = await currentScreen( { reason: 'invalid-agency' }, {}, august( '22:00:00' ) );

		expect( screen.tag ).toBe( FILENAME_TAGS.badPath );
	} );
} );

describe( 'handleDisplay refresh_rate', () => {
	const bodyAt = async ( time ) => {
		vi.setSystemTime( august( time ) );

		const { response } = await handleDisplay( request(), TARGET, {} );

		return response.json();
	};

	it( 'sleeps until morning once the window has closed', async () => {
		vi.useFakeTimers();
		vi.stubGlobal( 'fetch', vi.fn() );

		const body = await bodyAt( '21:30:00' );

		expect( body.refresh_rate ).toBe( 9 * 60 * 60 + 60 );
		expect( body.status ).toBe( 0 );
		expect( body.filename ).toContain( FILENAME_TAGS.overnight );
	} );

	// The three fields that are only correct together. A missing rate is a flat battery, and a
	// `status` of anything but 0 makes the firmware discard the whole response.
	it( 'always carries a status, a filename and a usable rate', async () => {
		vi.useFakeTimers();
		vi.stubGlobal( 'fetch', vi.fn( () => Promise.reject( new Error( 'upstream down' ) ) ) );

		for ( const time of [ '00:30:00', '06:29:00', '12:00:00', '21:29:00', '21:31:00' ] ) {
			const body = await bodyAt( time );

			expect( body.status ).toBe( 0 );
			expect( body.filename ).toMatch( /^[a-z0-9]{7}-[a-z0-9]{6}-\d{10}$/ );
			expect( body.refresh_rate ).toBeGreaterThanOrEqual( 1 );
		}
	} );
} );
