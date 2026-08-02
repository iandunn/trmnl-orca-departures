import { describe, expect, it } from 'vitest';
import { edgeCaseBoards } from './edge-case-boards.js';

describe( 'edge case boards', () => {
	it( 'offers one board per family of awkward name', () => {
		expect( edgeCaseBoards().map( ( sample ) => sample.slug ) ).toEqual( [
			'edge-badges',
			'edge-badges-rail',
			'edge-headsigns',
			'edge-band',
			'edge-sparse',
		] );
	} );

	// A render lifted out of the preview must not be mistakable for a departures board. The boards
	// that compose routes across stops say so in the slot a real board uses for the stop name.
	// `edge-band` is exempt on purpose: its stop names and numbers are genuinely real, which is the
	// whole point of it.
	it( 'marks every composed board as not a real stop', () => {
		const composed = edgeCaseBoards().filter( ( sample ) => sample.slug !== 'edge-band' );

		expect( composed ).toHaveLength( 4 );

		for ( const { board } of composed ) {
			for ( const group of board.groups ) {
				expect( group.stop ).toBe( 'not a real stop' );
			}
		}
	} );

	it( 'takes its header fields from the timestamp, like every other board', () => {
		for ( const { board } of edgeCaseBoards( {
			nowMs: Date.parse( '2026-12-25T07:09:00-08:00' ),
			timezone: 'America/Los_Angeles',
		} ) ) {
			expect( board ).toMatchObject( { weekday: 'Friday', date: 'December 25', asOf: '7:09 am' } );
		}
	} );

	// The sparse board only does its job at the row-height ceiling; four rows would scale it down and
	// hide the collision it exists to show.
	it( 'keeps the sparse board sparse', () => {
		const sparse = edgeCaseBoards().find( ( sample ) => sample.slug === 'edge-sparse' );

		expect( sparse.board.groups ).toHaveLength( 1 );
		expect( sparse.board.groups[ 0 ].rows ).toHaveLength( 2 );
	} );
} );
