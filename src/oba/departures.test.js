/**
 * Mapping, checked against real captured responses rather than invented ones.
 *
 * The fixtures in `fixtures/` are live `arrivals-and-departures-for-stop` responses for the public
 * sample stops, captured 2026-08-01. `tripStatus`, `references.trips` and references belonging to
 * other stops are stripped — nothing here reads them and they were four fifths of the bytes — but
 * every field this code touches is exactly as OneBusAway returned it. That matters: the first bus at
 * `1_600` is already 74 seconds past its prediction, the second is 15 seconds past, and no invented
 * fixture would have thought to include either.
 */

import { describe, expect, it } from 'vitest';
import busNorth from './fixtures/1_600.json';
import busSouth from './fixtures/1_430.json';
import railNorth from './fixtures/40_621.json';
import railSouth from './fixtures/40_623.json';
import { dataTimestamp, hasDepartures, stopReference, toBoard } from './departures.js';
import { formatBoardTime } from '../clock.js';

const TZ = 'America/Los_Angeles';

function ok( fixture, stopId ) {
	return {
		ok: true,
		stopId,
		currentTime: fixture.currentTime,
		entry: fixture.data.entry,
		references: fixture.data.references,
	};
}

function failed( stopId ) {
	return { ok: false, stopId, reason: 'timeout' };
}

function board( results, { agency, stopIds, directionOverrides = {}, limit = 4 } ) {
	const nowMs = dataTimestamp( results );

	return toBoard( results, {
		agency,
		stopIds,
		directionOverrides,
		nowMs,
		timezone: TZ,
		limit,
		time: formatBoardTime( nowMs, TZ ),
	} );
}

const busResults = [ ok( busNorth, '1_600' ), ok( busSouth, '1_430' ) ];
const railResults = [ ok( railNorth, '40_621' ), ok( railSouth, '40_623' ) ];

const busBoard = () => board( busResults, { agency: '1', stopIds: [ '600', '430' ] } );
const railBoard = () => board( railResults, { agency: '40', stopIds: [ '621', '623' ] } );

describe( 'toBoard', () => {
	it( 'builds a group per stop, named and numbered from the references', () => {
		const [ north, south ] = busBoard().groups;

		expect( north.name ).toBe( '3rd Ave & Virginia St' );
		expect( north.stop ).toBe( 'Stop No. 600' );
		expect( south.name ).toBe( '3rd Ave & Pine St' );
		expect( south.stop ).toBe( 'Stop No. 430' );
	} );

	// 3rd Ave runs diagonally, so its stops report NW/SE while every rider and every Metro timetable
	// says northbound. The override map is the escape hatch for exactly that.
	it( 'spells the bearing out and lets an override replace it', () => {
		expect( busBoard().groups[ 0 ].heading ).toBe( 'Northwest bound' );

		const overridden = board( busResults, {
			agency: '1',
			stopIds: [ '600', '430' ],
			directionOverrides: { '1_600': 'Northbound' },
		} );

		expect( overridden.groups[ 0 ].heading ).toBe( 'Northbound' );
	} );

	it( 'takes the soonest departures, in order, up to the limit', () => {
		const rows = busBoard().groups[ 0 ].rows;

		expect( rows ).toHaveLength( 4 );
		expect( rows.map( ( row ) => row.badge ) ).toEqual( [ 'E Line', '4', '1', 'C Line' ] );
	} );

	// The first departure at this stop is 74 seconds past its prediction and the second is 15 seconds
	// past. One is gone; the other is the bus at the kerb, which is the most useful row on the board.
	it( 'drops a departure past the grace window and keeps the one inside it', () => {
		const rows = busBoard().groups[ 0 ].rows;

		expect( rows.map( ( row ) => row.badge ) ).not.toContain( '40' );
		expect( rows[ 0 ] ).toMatchObject( { badge: 'E Line', value: 'Now', unit: '' } );
	} );

	// Never on the route name: `H Line` is a bus and `1 Line` is a train, and only `route.type` says so.
	it( 'reads the mode from the route type', () => {
		expect( busBoard().mode ).toBe( 'bus' );
		expect( railBoard().mode ).toBe( 'rail' );
	} );

	it( 'carries the agency name for the rail lockup', () => {
		expect( railBoard().agency ).toBe( 'SOUND TRANSIT' );
	} );

	it( 'formats each row through the ladder', () => {
		const rows = railBoard().groups[ 0 ].rows;

		expect( rows.map( ( row ) => `${ row.value } ${ row.unit }`.trim() ) ).toEqual( [
			'1 min',
			'8 min',
			'9 min',
			'6:18 pm',
		] );
	} );

	it( 'keeps the raw headsign for the renderer to shorten', () => {
		expect( railBoard().groups[ 0 ].rows[ 0 ].to ).toBe( 'Lynnwood City Center' );
	} );

	it( 'gives every live prediction a live flag', () => {
		expect( busBoard().groups[ 0 ].rows.every( ( row ) => row.live ) ).toBe( true );
	} );
} );

describe( 'a stop with no usable data', () => {
	const partial = () => board( [ ok( busNorth, '1_600' ), failed( '1_430' ) ], { agency: '1', stopIds: [ '600', '430' ] } );

	it( 'still draws the band and says which kind of nothing it is', () => {
		const [ , south ] = partial().groups;

		expect( south.rows ).toHaveLength( 0 );
		expect( south.message ).toBe( 'Departure data unavailable' );
		expect( south.stop ).toBe( 'Stop 1_430' );
	} );

	// Which platform a band belongs to is a fact about the pole, not about this fetch. On a two-stop
	// sign a band that lost its direction leaves the reader unable to tell which half went missing.
	it( 'keeps its name and bearing from whatever was last seen', () => {
		const board = toBoard( [ ok( busNorth, '1_600' ), failed( '1_430' ) ], {
			agency: '1',
			stopIds: [ '600', '430' ],
			knownStops: { '1_430': stopReference( ok( busSouth, '1_430' ), '1_430' ) },
			directionOverrides: {},
			nowMs: busNorth.currentTime,
			timezone: TZ,
			limit: 4,
			time: formatBoardTime( busNorth.currentTime, TZ ),
		} );

		expect( board.groups[ 1 ] ).toMatchObject( {
			heading: 'Southeast bound',
			name: '3rd Ave & Pine St',
			stop: 'Stop No. 430',
			message: 'Departure data unavailable',
		} );
	} );

	// Without the reservation the surviving group's four rows would grow to fill the whole panel, so a
	// partial failure would look like a different design rather than a missing half.
	it( 'reserves its share of the panel so the surviving group is unchanged', () => {
		const [ north, south ] = partial().groups;

		expect( south.reserved ).toBe( 4 );
		expect( north.reserved ).toBeUndefined();
		expect( north.rows ).toEqual( busBoard().groups[ 0 ].rows );
	} );

	// "No more buses today" is an answer and "we could not ask" is a fault. A reader has to be able to
	// tell them apart, so they are different sentences.
	it( 'distinguishes no service left from an upstream failure', () => {
		const tomorrow = toBoard( busResults, {
			agency: '1',
			stopIds: [ '600', '430' ],
			directionOverrides: {},
			nowMs: busNorth.currentTime + 24 * 60 * 60 * 1000,
			timezone: TZ,
			limit: 4,
			time: formatBoardTime( busNorth.currentTime, TZ ),
		} );

		expect( hasDepartures( tomorrow ) ).toBe( false );
		expect( tomorrow.groups[ 0 ].message ).toBe( 'No more departures today' );
	} );
} );

describe( 'dataTimestamp', () => {
	// Two stops are two responses with two clocks. Stamping the board with the newer one would
	// overstate how current the older group is, which is the one claim the stamp exists to make.
	it( 'takes the oldest successful response, so the stamp never overstates freshness', () => {
		expect( dataTimestamp( railResults ) ).toBe( railNorth.currentTime );
		expect( railNorth.currentTime ).toBeLessThan( railSouth.currentTime );
	} );

	it( 'ignores failed stops and reports nothing when none succeeded', () => {
		expect( dataTimestamp( [ ok( busNorth, '1_600' ), failed( '1_430' ) ] ) ).toBe( busNorth.currentTime );
		expect( dataTimestamp( [ failed( '1_600' ), failed( '1_430' ) ] ) ).toBeNull();
	} );
} );
