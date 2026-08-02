import { describe, expect, it } from 'vitest';
import { collapseRepeatedPhrases } from './headsign.js';

describe( 'collapseRepeatedPhrases', () => {
	it( 'drops a phrase repeated immediately after itself', () => {
		expect( collapseRepeatedPhrases( 'Mount Baker Mount Baker Transit Center' ) ).toBe(
			'Mount Baker Transit Center'
		);
	} );

	it( 'collapses a repeat that is not at the start', () => {
		expect( collapseRepeatedPhrases( 'Downtown Seattle Mount Baker Mount Baker' ) ).toBe(
			'Downtown Seattle Mount Baker'
		);
	} );

	it( 'collapses a three-fold repeat down to one', () => {
		expect( collapseRepeatedPhrases( 'Alki Alki Alki Via SR-99' ) ).toBe( 'Alki Via SR-99' );
	} );

	it( 'ignores case when matching but keeps the casing it keeps', () => {
		expect( collapseRepeatedPhrases( 'Mount baker MOUNT BAKER Transit Center' ) ).toBe(
			'Mount baker Transit Center'
		);
	} );

	// The whole reason the rule is adjacency rather than word frequency: every one of these repeats a
	// word while naming two genuinely different places, and shortening any of them would be a lie
	// about where the bus goes. All are live OneBusAway headsigns.
	it.each( [
		'Seattle Pacific University Seattle Center W',
		'Rainier Beach Via Rainier Ave S',
		'Downtown Seattle Westwood Village',
		'Burien Transit Center Westwood Village',
		'Central District Downtown Seattle',
		'Seattle Tacoma International Airport',
		'Othello Station N Beacon Hill',
		'Madrona and 34th Ave Via E Cherry St',
		'Northgate Station Fremont',
		'Lynnwood City Center',
		'Ballard Uptown',
	] )( 'leaves %s alone', ( headsign ) => {
		expect( collapseRepeatedPhrases( headsign ) ).toBe( headsign );
	} );

	it( 'normalises stray whitespace', () => {
		expect( collapseRepeatedPhrases( '  Ballard   Uptown ' ) ).toBe( 'Ballard Uptown' );
	} );

	// `/api/display` runs about 1440 times a day and must never fail over a label.
	it.each( [ [ undefined ], [ null ], [ 42 ], [ '' ], [ '   ' ] ] )(
		'returns an empty string for %s rather than throwing',
		( value ) => {
			expect( collapseRepeatedPhrases( value ) ).toBe( '' );
		}
	);

	it( 'keeps a single word', () => {
		expect( collapseRepeatedPhrases( 'Ballard' ) ).toBe( 'Ballard' );
	} );
} );
