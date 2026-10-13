import { describe, expect, it } from 'vitest';

import { CONFIG_DEFAULTS, readConfig } from './config.js';
import {
	alignedSleepSeconds,
	currentSchedule,
	isWithinActiveWindow,
	nextOccurrenceMs,
	SCHEDULE_MODES,
} from './schedule.js';

const TIMEZONE = CONFIG_DEFAULTS.timezone;

/** Epoch milliseconds for a Pacific wall-clock time, via the offset the zone actually had that day. */
function pacific( iso, offsetHours ) {
	return Date.parse( `${ iso }${ offsetHours === 7 ? '-07:00' : '-08:00' }` );
}

const config = readConfig( {} );

describe( 'isWithinActiveWindow', () => {
	it( 'includes the opening minute and excludes the closing one', () => {
		expect( isWithinActiveWindow( 390, 390, 1290 ) ).toBe( true );
		expect( isWithinActiveWindow( 1289, 390, 1290 ) ).toBe( true );
		expect( isWithinActiveWindow( 1290, 390, 1290 ) ).toBe( false );
		expect( isWithinActiveWindow( 389, 390, 1290 ) ).toBe( false );
	} );

	it( 'handles a window that wraps midnight', () => {
		expect( isWithinActiveWindow( 23 * 60, 22 * 60, 6 * 60 ) ).toBe( true );
		expect( isWithinActiveWindow( 2 * 60, 22 * 60, 6 * 60 ) ).toBe( true );
		expect( isWithinActiveWindow( 12 * 60, 22 * 60, 6 * 60 ) ).toBe( false );
	} );

	// Equally arbitrary either way, so it fails toward a sign that shows departures.
	it( 'treats an empty window as always awake', () => {
		expect( isWithinActiveWindow( 0, 600, 600 ) ).toBe( true );
		expect( isWithinActiveWindow( 1439, 600, 600 ) ).toBe( true );
	} );
} );

describe( 'nextOccurrenceMs', () => {
	it( 'finds the same-day occurrence when it is still ahead', () => {
		const from = pacific( '2026-08-01T05:00:00', 7 );

		expect( nextOccurrenceMs( from, 390, TIMEZONE ) ).toBe( pacific( '2026-08-01T06:30:00', 7 ) );
	} );

	it( 'rolls to tomorrow when the time has passed', () => {
		const from = pacific( '2026-08-01T21:30:00', 7 );

		expect( nextOccurrenceMs( from, 390, TIMEZONE ) ).toBe( pacific( '2026-08-02T06:30:00', 7 ) );
	} );

	// The whole reason this is a search. A naive `+1440 minutes` lands an hour off on both nights.
	it( 'lands on 6:30 across the spring-forward night, which is 23 hours long', () => {
		const from = pacific( '2026-03-07T21:30:00', 8 );
		const resume = nextOccurrenceMs( from, 390, TIMEZONE );

		expect( resume ).toBe( pacific( '2026-03-08T06:30:00', 7 ) );
		expect( resume - from ).toBe( 8 * 60 * 60 * 1000 );
	} );

	it( 'lands on 6:30 across the fall-back night, which is 25 hours long', () => {
		const from = pacific( '2026-10-31T21:30:00', 7 );
		const resume = nextOccurrenceMs( from, 390, TIMEZONE );

		expect( resume ).toBe( pacific( '2026-11-01T06:30:00', 8 ) );
		expect( resume - from ).toBe( 10 * 60 * 60 * 1000 );
	} );

	it( 'keeps the seconds of the starting instant, so it lands inside the target minute', () => {
		const from = pacific( '2026-08-01T21:30:45', 7 );

		expect( nextOccurrenceMs( from, 390, TIMEZONE ) ).toBe( pacific( '2026-08-02T06:30:45', 7 ) );
	} );
} );

describe( 'alignedSleepSeconds', () => {
	// Sleep plus the wake lead is when the next request arrives, so that sum is what has to land.
	function nextPollAt( nowMs, period, lead ) {
		return nowMs + ( alignedSleepSeconds( nowMs, period, lead ) + lead ) * 1000;
	}

	it( 'lands the next poll a few seconds after the next minute turns', () => {
		const nowMs = pacific( '2026-08-01T12:00:05', 7 );

		expect( nextPollAt( nowMs, 60, 12 ) ).toBe( pacific( '2026-08-01T12:01:03', 7 ) );
	} );

	it( 'holds every poll on the minute once it is there', () => {
		let nowMs = pacific( '2026-08-01T12:00:03', 7 );

		for ( let poll = 1; poll <= 5; poll++ ) {
			nowMs = nextPollAt( nowMs, 60, 12 );

			expect( nowMs ).toBe( pacific( `2026-08-01T12:0${ poll }:03`, 7 ) );
		}
	} );

	// A poll arriving just before the minute must not wake again seconds later for the boundary.
	it( 'skips to the following minute rather than taking a short nap', () => {
		const nowMs = pacific( '2026-08-01T12:00:55', 7 );

		expect( alignedSleepSeconds( nowMs, 60, 12 ) ).toBeGreaterThanOrEqual( 5 );
		expect( nextPollAt( nowMs, 60, 12 ) ).toBe( pacific( '2026-08-01T12:02:03', 7 ) );
	} );

	// A slow WiFi join must cost one late board, not a skipped minute.
	it( 'still reaches the next minute after a late wake', () => {
		for ( const second of [ 25, 41, 45 ] ) {
			const late = pacific( `2026-08-01T12:00:${ second }`, 7 );

			expect( nextPollAt( late, 60, 12 ) ).toBe( pacific( '2026-08-01T12:01:03', 7 ) );
		}
	} );

	it( 'never returns less than one second, whatever the lead', () => {
		const nowMs = pacific( '2026-08-01T12:00:00', 7 );

		for ( const lead of [ 0, 12, 59, 60, 600 ] ) {
			expect( alignedSleepSeconds( nowMs, 60, lead ) ).toBeGreaterThanOrEqual( 1 );
		}
	} );
} );

describe( 'currentSchedule', () => {
	it( 'polls on the minute inside the window', () => {
		const schedule = currentSchedule( { nowMs: pacific( '2026-08-01T12:00:20', 7 ), config } );

		expect( schedule.mode ).toBe( SCHEDULE_MODES.active );
		expect( schedule.refreshSeconds ).toBe( 40 + 3 - config.wakeLeadSeconds );
		expect( schedule.resumeAtMs ).toBeNull();
	} );

	it( 'sleeps until morning after the window closes', () => {
		const nowMs = pacific( '2026-08-01T21:30:00', 7 );
		const schedule = currentSchedule( { nowMs, config } );

		expect( schedule.mode ).toBe( SCHEDULE_MODES.overnight );
		expect( schedule.resumeAtMs ).toBe( pacific( '2026-08-02T06:30:00', 7 ) );
		expect( schedule.refreshSeconds ).toBe( 9 * 60 * 60 + 60 );
	} );

	it( 'sleeps until morning before the window opens', () => {
		const schedule = currentSchedule( { nowMs: pacific( '2026-08-01T03:00:00', 7 ), config } );

		expect( schedule.mode ).toBe( SCHEDULE_MODES.overnight );
		expect( schedule.refreshSeconds ).toBe( 3.5 * 60 * 60 + 60 );
	} );

	// A device whose timer drifts a few seconds early must take a short nap, never another whole day.
	// Two minutes rather than one: the opening is 62 seconds away and the wake margin adds its own.
	it( 'returns a short nap when the window is about to open', () => {
		const schedule = currentSchedule( { nowMs: pacific( '2026-08-01T06:29:58', 7 ), config } );

		expect( schedule.mode ).toBe( SCHEDULE_MODES.overnight );
		expect( schedule.refreshSeconds ).toBe( 120 );
	} );

	it( 'never returns a sleep longer than a day, whatever the window says', () => {
		const wide = readConfig( { ACTIVE_START: '00:01', ACTIVE_END: '00:02' } );

		for ( const hour of [ 0, 6, 12, 18, 23 ] ) {
			const { refreshSeconds } = currentSchedule( {
				nowMs: pacific( `2026-08-01T${ String( hour ).padStart( 2, '0' ) }:30:00`, 7 ),
				config: wide,
			} );

			expect( refreshSeconds ).toBeGreaterThan( 0 );
			expect( refreshSeconds ).toBeLessThanOrEqual( 24 * 60 * 60 );
		}
	} );

	// The field that flattens the battery when it is absent or zero. Nothing may produce either.
	it( 'always returns a usable rate, at every minute of the day', () => {
		const startOfDay = pacific( '2026-08-01T00:00:00', 7 );

		for ( let minute = 0; minute < 1440; minute++ ) {
			const { refreshSeconds } = currentSchedule( { nowMs: startOfDay + minute * 60000, config } );

			expect( Number.isInteger( refreshSeconds ) ).toBe( true );
			expect( refreshSeconds ).toBeGreaterThanOrEqual( 1 );
		}
	} );
} );
