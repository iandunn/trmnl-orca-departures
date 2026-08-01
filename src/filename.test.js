import { describe, expect, it } from 'vitest';
import { FILENAME_TAGS, buildFilename, stableEpoch } from './filename.js';

const EPOCH = 1785564693;

function build( overrides = {} ) {
	return buildFilename( {
		tag: FILENAME_TAGS.departures,
		content: 'three rows of departures',
		epochSeconds: EPOCH,
		...overrides,
	} );
}

describe( 'buildFilename', () => {
	describe( 'firmware shape rules', () => {
		it( 'ends in exactly 10 ASCII digits so the 24h purge can read a timestamp', () => {
			// A name that does not end in 10 digits extracts as epoch 0, which always reads as
			// stale, so every image write wipes the rest of the cache.
			expect( build() ).toMatch( /\d{10}$/ );
		} );

		it( 'is never exactly 31 characters, for any tag or content', () => {
			// At exactly 31 the firmware copies without a NUL terminator and the cache key picks
			// up stack garbage.
			const samples = Object.values( FILENAME_TAGS ).flatMap( ( tag ) =>
				[ '', 'a', 'x'.repeat( 5000 ) ].map( ( content ) => build( { tag, content } ) )
			);

			for ( const name of samples ) {
				expect( name ).not.toHaveLength( 31 );
			}
		} );

		it( 'stays at or under 30 characters so the middle is never discarded', () => {
			// Over 31 the firmware keeps only the first 7 and last 17 characters.
			expect( build().length ).toBeLessThanOrEqual( 30 );
		} );

		it( 'carries no file extension', () => {
			// A trailing `.png` is enough to break the trailing-digits rule above.
			expect( build() ).not.toContain( '.' );
		} );

		it( 'matches the documented tag-hash-epoch layout', () => {
			expect( build() ).toMatch( /^[a-z0-9]{7}-[a-z0-9]{6}-\d{10}$/ );
		} );
	} );

	describe( 'cache behaviour', () => {
		it( 'is identical for identical input, so an unchanged render costs zero flicker', () => {
			expect( build() ).toBe( build() );
		} );

		it( 'changes when the content changes', () => {
			expect( build( { content: 'a' } ) ).not.toBe( build( { content: 'b' } ) );
		} );

		it( 'treats a string and its UTF-8 bytes as the same content', () => {
			const bytes = new TextEncoder().encode( 'three rows of departures' );

			expect( build( { content: bytes } ) ).toBe( build() );
		} );

		it( 'holds the name steady while only the content is unchanged', () => {
			// The epoch is an input rather than a clock read precisely so this holds. Passing the
			// current time here would change the name every poll and flash the panel every time.
			const first = build( { epochSeconds: EPOCH } );
			const later = build( { epochSeconds: EPOCH } );

			expect( first ).toBe( later );
		} );

		it( 'changes when the epoch changes', () => {
			expect( build( { epochSeconds: EPOCH } ) ).not.toBe( build( { epochSeconds: EPOCH + 1 } ) );
		} );
	} );

	describe( 'degraded screens', () => {
		it( 'gives every state a distinct name even when the content is identical', () => {
			// An error screen sharing a name with the last good render is suppressed by the cache
			// and never reaches the glass.
			const names = Object.values( FILENAME_TAGS ).map( ( tag ) => build( { tag, content: 'same' } ) );

			expect( new Set( names ).size ).toBe( names.length );
		} );

		it( 'keeps each state stable across polls so a persistent error does not flicker', () => {
			const first = build( { tag: FILENAME_TAGS.upstreamFailed, content: 'same' } );
			const second = build( { tag: FILENAME_TAGS.upstreamFailed, content: 'same' } );

			expect( first ).toBe( second );
		} );
	} );

	describe( 'recovery perturbation', () => {
		it( 'changes the name for identical content when salted', () => {
			// Firmware-drawn error screens never update the device's cached filename, so after an
			// outage the server must perturb the name or the error screen stays up forever.
			expect( build( { salt: 'gen-2' } ) ).not.toBe( build() );
		} );

		it( 'is stable for the same salt', () => {
			expect( build( { salt: 'gen-2' } ) ).toBe( build( { salt: 'gen-2' } ) );
		} );

		it( 'still satisfies the shape rules when salted', () => {
			expect( build( { salt: 'gen-2' } ) ).toMatch( /^[a-z0-9]{7}-[a-z0-9]{6}-\d{10}$/ );
		} );
	} );

	describe( 'input validation', () => {
		it.each( [ 'short', 'toolongtag', 'DEPARTS', 'depart-', '' ] )(
			'rejects the malformed tag %o',
			( tag ) => {
				expect( () => build( { tag } ) ).toThrow( TypeError );
			}
		);

		it.each( [ 999999999, 10000000000, 1785564693.5, -1785564693, NaN ] )(
			'rejects the out-of-range epoch %o',
			( epochSeconds ) => {
				expect( () => build( { epochSeconds } ) ).toThrow( RangeError );
			}
		);

		it( 'accepts the boundary epochs that are still 10 digits', () => {
			expect( build( { epochSeconds: 1000000000 } ) ).toMatch( /1000000000$/ );
			expect( build( { epochSeconds: 9999999999 } ) ).toMatch( /9999999999$/ );
		} );
	} );

	describe( 'stableEpoch', () => {
		const TWELVE_HOURS = 12 * 60 * 60;

		it( 'produces a value buildFilename accepts', () => {
			expect( () => build( { epochSeconds: stableEpoch( EPOCH ) } ) ).not.toThrow();
			expect( String( stableEpoch( EPOCH ) ) ).toHaveLength( 10 );
		} );

		it( 'is unchanged as the clock advances within a bucket', () => {
			// This is the whole point: an unchanged render must keep an identical filename so the
			// device skips both the download and the repaint.
			const start = stableEpoch( EPOCH );

			for ( const offset of [ 1, 60, 3600, TWELVE_HOURS - 1 ] ) {
				expect( stableEpoch( start + offset ) ).toBe( start );
			}
		} );

		it( 'advances by exactly one bucket at the boundary', () => {
			const start = stableEpoch( EPOCH );

			expect( stableEpoch( start + TWELVE_HOURS ) ).toBe( start + TWELVE_HOURS );
		} );

		it( 'never returns a time in the future', () => {
			// A future timestamp risks the firmware computing a negative age, which under unsigned
			// arithmetic would read as maximally stale and purge the cache on every write.
			for ( let offset = 0; offset < TWELVE_HOURS * 3; offset += 997 ) {
				expect( stableEpoch( EPOCH + offset ) ).toBeLessThanOrEqual( EPOCH + offset );
			}
		} );

		it( 'never returns a time more than 12 hours old, well inside the 24h purge threshold', () => {
			for ( let offset = 0; offset < TWELVE_HOURS * 3; offset += 997 ) {
				const now = EPOCH + offset;

				expect( now - stableEpoch( now ) ).toBeLessThan( TWELVE_HOURS );
			}
		} );

		it( 'puts one of the two daily boundaries inside the overnight sleep window', () => {
			// 09:00 and 21:00 UTC, i.e. roughly 2am and 2pm Pacific. The 2am rollover is free
			// because the device is asleep; the 2pm one costs at most one repaint a day.
			const hours = new Set();

			for ( let day = 0; day < 4; day++ ) {
				for ( const half of [ 0, 1 ] ) {
					const boundary = stableEpoch( EPOCH + day * 86400 + half * TWELVE_HOURS );
					hours.add( new Date( boundary * 1000 ).getUTCHours() );
				}
			}

			expect( [ ...hours ].sort( ( a, b ) => a - b ) ).toEqual( [ 9, 21 ] );
		} );

		it( 'lands exactly on a bucket boundary, so it is idempotent', () => {
			expect( stableEpoch( stableEpoch( EPOCH ) ) ).toBe( stableEpoch( EPOCH ) );
		} );

		it( 'rejects non-numeric input', () => {
			expect( () => stableEpoch( undefined ) ).toThrow( TypeError );
			expect( () => stableEpoch( NaN ) ).toThrow( TypeError );
		} );
	} );

	describe( 'hash', () => {
		it( 'is always padded to six characters', () => {
			// Small hash values must not shorten the name; the length rules depend on it.
			for ( let i = 0; i < 500; i++ ) {
				expect( build( { content: `sample-${ i }` } ) ).toHaveLength( 25 );
			}
		} );

		it( 'spreads similar content across different names', () => {
			const names = new Set();

			for ( let i = 0; i < 500; i++ ) {
				names.add( build( { content: `4:2${ i } pm` } ) );
			}

			expect( names.size ).toBe( 500 );
		} );
	} );
} );
