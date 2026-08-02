import { describe, expect, it } from 'vitest';
import { formatDeparture, isUpcoming, NOW_GRACE_MS } from './format.js';

const TZ = 'America/Los_Angeles';
const NOW = Date.parse( '2026-08-01T16:22:00-07:00' );
const minutes = ( count ) => NOW + count * 60000;

describe( 'formatDeparture', () => {
	// The boundary is measured off Metro's own signs rather than chosen — see the table in
	// `format.js`. Their photos show minutes up to 9 and clock times from 11; 10 was the owner's call.
	it( 'counts minutes through ten and switches to a clock time at eleven', () => {
		expect( formatDeparture( minutes( 10 ), NOW, TZ ) ).toEqual( { value: '10', unit: 'min' } );
		expect( formatDeparture( minutes( 11 ), NOW, TZ ) ).toEqual( { value: '4:33', unit: 'pm' } );
	} );

	it( 'reads Now inside the first minute', () => {
		expect( formatDeparture( minutes( 0 ), NOW, TZ ) ).toEqual( { value: 'Now', unit: '' } );
		expect( formatDeparture( NOW + 59000, NOW, TZ ) ).toEqual( { value: 'Now', unit: '' } );
		expect( formatDeparture( minutes( 1 ), NOW, TZ ) ).toEqual( { value: '1', unit: 'min' } );
	} );

	// A bus already at the kerb has a prediction in the past. Metro shows those as `Now`, and the
	// first departure in every captured fixture is one, so this is the common case rather than an edge.
	it( 'still reads Now for a departure slightly in the past', () => {
		expect( formatDeparture( NOW - 30000, NOW, TZ ) ).toEqual( { value: 'Now', unit: '' } );
	} );

	// Floored, not rounded: understating the wait sends someone to the kerb early, and overstating it
	// lets them watch the bus leave.
	it( 'floors the minute count', () => {
		expect( formatDeparture( NOW + 90000, NOW, TZ ) ).toEqual( { value: '1', unit: 'min' } );
	} );

	it( 'renders the clock time in the sign timezone, not UTC', () => {
		expect( formatDeparture( minutes( 40 ), NOW, TZ ) ).toEqual( { value: '5:02', unit: 'pm' } );
		expect( formatDeparture( minutes( 40 ), NOW, 'America/New_York' ) ).toEqual( { value: '8:02', unit: 'pm' } );
	} );
} );

describe( 'isUpcoming', () => {
	it( 'keeps a departure inside the grace window and drops one past it', () => {
		expect( isUpcoming( NOW - NOW_GRACE_MS + 1000, NOW ) ).toBe( true );
		expect( isUpcoming( NOW - NOW_GRACE_MS - 1000, NOW ) ).toBe( false );
	} );

	// OneBusAway writes 0 when it has no prediction. Treated as a timestamp that is January 1970,
	// which would sort to the top of the board as a bus that left 56 years ago.
	it( 'rejects a zero or missing timestamp', () => {
		expect( isUpcoming( 0, NOW ) ).toBe( false );
		expect( isUpcoming( undefined, NOW ) ).toBe( false );
	} );
} );
