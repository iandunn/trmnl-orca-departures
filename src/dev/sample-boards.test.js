import { describe, expect, it } from 'vitest';
import {
	BUS_BOARD,
	RAIL_BOARD,
	REFERENCE_TIME_MS,
	SAMPLE_DIRECTION_OVERRIDES,
	busBoard,
	sampleBoards,
} from './sample-boards.js';
import { formatBoardTime } from '../clock.js';

describe( 'sample boards', () => {
	it( 'labels every group through the override mechanism production uses', () => {
		expect( BUS_BOARD.groups.map( ( group ) => group.heading ) ).toEqual( [
			'Northbound',
			'Southbound',
		] );
	} );

	// The rail pair reports plain N/S, so it needs no entry in the override map at all.
	it( 'derives the rail headings with no override', () => {
		expect( RAIL_BOARD.groups.map( ( group ) => group.heading ) ).toEqual( [
			'Northbound',
			'Southbound',
		] );
		expect( SAMPLE_DIRECTION_OVERRIDES ).not.toHaveProperty( '40_621' );
	} );

	it( 'falls back to the derived label when no override is supplied', () => {
		const board = busBoard( formatBoardTime( REFERENCE_TIME_MS, 'America/Los_Angeles' ), {} );

		expect( board.groups.map( ( group ) => group.heading ) ).toEqual( [
			'Northwest bound',
			'Southeast bound',
		] );
	} );

	// Four per direction is the accepted density, and both sample boards have to carry it or the
	// preview stops showing what the device will actually render.
	it.each( [
		[ 'bus', BUS_BOARD ],
		[ 'rail', RAIL_BOARD ],
	] )( 'gives the %s board four departures in each direction', ( _label, board ) => {
		expect( board.groups.map( ( group ) => group.rows.length ) ).toEqual( [ 4, 4 ] );
	} );

	it( 'takes its header fields from the timestamp rather than literals', () => {
		expect( BUS_BOARD ).toMatchObject( {
			weekday: 'Saturday',
			date: 'August 1',
			clock: '4:22',
			meridiem: 'pm',
			asOf: '4:22 pm',
		} );
	} );

	// The bus stops are three blocks apart rather than two sides of one street, which is the case the
	// per-group name exists for. The rail groups name one station twice, which is the case that shows
	// the name is unconditional rather than a fallback.
	it( 'names the stop on every group of both boards', () => {
		expect( BUS_BOARD.groups.map( ( group ) => group.name ) ).toEqual( [
			'3rd Ave & Virginia St',
			'3rd Ave & Pine St',
		] );
		expect( RAIL_BOARD.groups.map( ( group ) => group.name ) ).toEqual( [
			"Int'l District/Chinatown",
			"Int'l District/Chinatown",
		] );
	} );

	it( 'renders both boards at whatever moment the caller passes', () => {
		const boards = sampleBoards( {
			nowMs: Date.parse( '2026-12-25T07:09:00-08:00' ),
			timezone: 'America/Los_Angeles',
		} );

		expect( boards.map( ( sample ) => sample.slug ) ).toEqual( [ 'bus', 'light-rail' ] );

		for ( const { board } of boards ) {
			expect( board ).toMatchObject( {
				weekday: 'Friday',
				date: 'December 25',
				asOf: '7:09 am',
			} );
		}
	} );
} );
