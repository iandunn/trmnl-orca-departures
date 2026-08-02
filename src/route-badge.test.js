import { describe, expect, it } from 'vitest';
import { destinationWithRoute, routeBadge } from './route-badge.js';

describe( 'routeBadge', () => {
	// The 13 routes the rule exists for, all live OneBusAway short names.
	it.each( [
		[ 'A Line', 'A' ],
		[ 'B Line', 'B' ],
		[ 'C Line', 'C' ],
		[ 'D Line', 'D' ],
		[ 'E Line', 'E' ],
		[ 'F Line', 'F' ],
		[ 'G Line', 'G' ],
		[ 'H Line', 'H' ],
		[ '1 Line', '1' ],
		[ '2 Line', '2' ],
		[ 'T Line', 'T' ],
		[ 'N Line', 'N' ],
		[ 'S Line', 'S' ],
	] )( 'badges %s as %s', ( shortName, expected ) => {
		expect( routeBadge( shortName ) ).toBe( expected );
	} );

	// `9X` is Intercity Transit's, and an express suffix on a number is still a route number.
	it.each( [ '7', '40', '570', '131', '9X' ] )( 'leaves %s alone', ( shortName ) => {
		expect( routeBadge( shortName ) ).toBe( shortName );
	} );

	// No word is ever drawn in the badge. Abbreviating would invent signage — and three Sound Transit
	// routes are all named `Shuttle`, so initials would collide as well as mislead.
	it.each( [
		'Swift Blue',
		'Swift Orange',
		'Monorail',
		'First Hill Streetcar',
		'South Lake Union Streetcar',
		'Waterfront Shuttle',
		'Trailhead Direct Issaquah Alps',
		'Metro Match Day Shuttle',
		'Duvall-Monroe Shuttle',
		'Shuttle',
		'TA034',
		'STCL',
	] )( 'blanks %s, which is a name or a code rather than a designation', ( shortName ) => {
		expect( routeBadge( shortName ) ).toBe( '' );
	} );

	// `Line` after more than one character is part of a name rather than the suffix the rule strips,
	// and the name is then too long for the slot.
	it.each( [ 'Sounder Line', 'AB Line' ] )( 'only strips Line after one character: %s', ( shortName ) => {
		expect( routeBadge( shortName ) ).toBe( '' );
	} );

	// Fitting the slot is necessary but not sufficient — the word `Line` is short enough to draw and
	// is still not a designation.
	it( 'blanks a short name that is still a word', () => {
		expect( routeBadge( 'Line' ) ).toBe( '' );
	} );

	it( 'trims stray whitespace', () => {
		expect( routeBadge( '  D Line ' ) ).toBe( 'D' );
	} );

	// 39 routes region-wide have no short name at all — every ferry route, and Amtrak Cascades.
	it.each( [ [ undefined ], [ null ], [ 42 ], [ '' ], [ '   ' ] ] )(
		'returns an empty string for %s rather than throwing',
		( value ) => {
			expect( routeBadge( value ) ).toBe( '' );
		}
	);
} );

describe( 'destinationWithRoute', () => {
	// A blank badge would otherwise leave a row that says where a vehicle goes but not which one.
	it.each( [
		[ 'Swift Blue', 'Shoreline North/185th Station', 'Swift Blue: Shoreline North/185th Station' ],
		[ 'Monorail', 'Westlake', 'Monorail: Westlake' ],
		[ 'First Hill Streetcar', 'Pioneer Square', 'First Hill Streetcar: Pioneer Square' ],
		[ 'Waterfront Shuttle', 'Seattle Center Waterfront', 'Waterfront Shuttle: Seattle Center Waterfront' ],
	] )( 'heads the destination with %s, whose badge is blank', ( shortName, destination, expected ) => {
		expect( destinationWithRoute( shortName, '', destination ) ).toBe( expected );
	} );

	// The badge already says which route it is; repeating it in the row would be noise.
	it.each( [
		[ '7', 'Rainier Beach Via Rainier Ave S' ],
		[ '570', 'Seattle Tacoma International Airport' ],
		[ 'D Line', 'Ballard Uptown' ],
		[ '1 Line', 'Lynnwood City Center' ],
		[ '9X', 'Olympia Transit Center' ],
	] )( 'leaves the destination alone when %s has a badge', ( shortName, destination ) => {
		expect( destinationWithRoute( shortName, '', destination ) ).toBe( destination );
	} );

	// A code is short enough for the slot but is not a designation, so it takes the same route as a
	// word-named service.
	it( 'heads the destination with a code like STCL', () => {
		expect( destinationWithRoute( 'STCL', '', 'Stream TDS / Spanaway TC' ) ).toBe(
			'STCL: Stream TDS / Spanaway TC'
		);
	} );

	// The long name is only consulted when there is no short name, and a route that has one already
	// says which it is.
	it( 'ignores the long name when the route has a short name', () => {
		expect( destinationWithRoute( '7', 'Rainier Beach - Downtown Seattle', 'Rainier Beach' ) ).toBe(
			'Rainier Beach'
		);
	} );

	// Amtrak Cascades is the one route with no short name whose long name is a service name rather
	// than a pair of endpoints, and it is exactly the one worth naming.
	it( 'falls back to the long name when it reads as a service', () => {
		expect( destinationWithRoute( '', 'Amtrak Cascades', 'Portland' ) ).toBe(
			'Amtrak Cascades: Portland'
		);
	} );

	// All 38 Washington State Ferries routes are shaped this way. A ferry route *is* its endpoints,
	// so the prefix would restate the destination and say nothing.
	it.each( [
		[ 'Bainbridge Island - Seattle', 'To Seattle' ],
		[ 'Tahlequah - Point Defiance', 'To Point Defiance' ],
		[ 'Coupeville  - Port Townsend', 'To Port Townsend' ],
	] )( 'adds nothing for the endpoint pair %s', ( routeName, destination ) => {
		expect( destinationWithRoute( '', routeName, destination ) ).toBe( destination );
	} );

	it.each( [ [ '' ], [ '   ' ], [ undefined ], [ null ], [ 42 ] ] )(
		'adds nothing when the route has no name of either kind (%s)',
		( value ) => {
			expect( destinationWithRoute( value, value, 'To Seattle' ) ).toBe( 'To Seattle' );
		}
	);
} );
