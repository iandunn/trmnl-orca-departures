import { describe, expect, it } from 'vitest';
import { formatBoardTime } from './clock.js';

const PACIFIC = 'America/Los_Angeles';

/** 2026-08-01 16:22 Pacific — the moment the reference boards are rendered at. */
const AFTERNOON = Date.parse( '2026-08-01T16:22:00-07:00' );

describe( 'formatBoardTime', () => {
	it( 'produces the header fields and the stamp', () => {
		expect( formatBoardTime( AFTERNOON, PACIFIC ) ).toEqual( {
			weekday: 'Saturday',
			date: 'August 1',
			clock: '4:22',
			meridiem: 'pm',
			asOf: '4:22 pm',
		} );
	} );

	/**
	 * ICU separates the day period with U+202F, a narrow no-break space, which Fira Sans need not
	 * carry — it would reach the PNG as tofu or a gap and nothing but looking at the image would
	 * catch it. Every string here is assembled from parts, so only ASCII spaces appear.
	 */
	it( 'uses only ASCII spaces', () => {
		const time = formatBoardTime( AFTERNOON, PACIFIC );

		for ( const value of Object.values( time ) ) {
			expect( value ).toMatch( /^[\x20-\x7e]*$/ );
		}
	} );

	it( 'lowercases the meridiem, which ICU gives in caps', () => {
		expect( formatBoardTime( Date.parse( '2026-08-01T09:05:00-07:00' ), PACIFIC ) ).toMatchObject( {
			clock: '9:05',
			meridiem: 'am',
			asOf: '9:05 am',
		} );
	} );

	it( 'reads the clock in the given timezone, not UTC', () => {
		// The same instant, three zones. A UTC leak would show 23:22 and the wrong weekday.
		expect( formatBoardTime( AFTERNOON, PACIFIC ).clock ).toBe( '4:22' );
		expect( formatBoardTime( AFTERNOON, 'America/New_York' ).clock ).toBe( '7:22' );

		const berlin = formatBoardTime( AFTERNOON, 'Europe/Berlin' );

		expect( berlin.clock ).toBe( '1:22' );
		expect( berlin.weekday ).toBe( 'Sunday' );
		expect( berlin.date ).toBe( 'August 2' );
	} );

	it.each( [
		[ '2026-08-01T00:04:00-07:00', '12:04', 'am' ],
		[ '2026-08-01T12:00:00-07:00', '12:00', 'pm' ],
		[ '2026-08-01T23:59:00-07:00', '11:59', 'pm' ],
	] )( 'renders %s as %s %s', ( iso, clock, meridiem ) => {
		expect( formatBoardTime( Date.parse( iso ), PACIFIC ) ).toMatchObject( { clock, meridiem } );
	} );

	it( 'pads the minute but not the hour, matching the sign', () => {
		expect( formatBoardTime( Date.parse( '2026-08-01T16:02:00-07:00' ), PACIFIC ).clock ).toBe( '4:02' );
	} );

	it( 'writes the date with no comma after the weekday, as Metro does', () => {
		const time = formatBoardTime( AFTERNOON, PACIFIC );

		expect( time.weekday ).not.toContain( ',' );
		expect( time.date ).not.toContain( ',' );
	} );

	// Callers must supply a real timestamp. `/api/display` has to catch this rather than pass a
	// missing OneBusAway `currentTime` straight through, or the stamp silently reads 1969.
	it.each( [ undefined, null, NaN, '2026-08-01', Infinity ] )( 'refuses %o', ( value ) => {
		expect( () => formatBoardTime( value, PACIFIC ) ).toThrow( TypeError );
	} );
} );
