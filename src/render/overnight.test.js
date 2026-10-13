import { describe, expect, it } from 'vitest';

import { overnightScreen } from '../byos/screens.js';
import { readConfig } from '../config.js';
import { FILENAME_TAGS } from '../filename.js';
import { BAND_FILL } from './board.js';
import {
	buildOvernightSvg,
	DEFAULT_OVERNIGHT_VARIANT,
	OVERNIGHT_VARIANT_NAMES,
	VARIANTS_WITHOUT_OPENING_TIME,
} from './overnight.js';

const config = readConfig( {} );

const screenFor = ( variant ) => overnightScreen( { config, variant } );

describe( 'overnightScreen', () => {
	it( 'carries the opening time for the variants that draw it', () => {
		const { overnight } = screenFor();

		expect( overnight.resumeClock ).toBe( '6:30' );
		expect( overnight.resumeMeridiem ).toBe( 'am' );
		expect( overnight.resumeLabel ).toBe( '6:30 am' );
	} );

	it( 'carries its own filename tag, so the cache cannot confuse it with a board', () => {
		expect( screenFor().tag ).toBe( FILENAME_TAGS.overnight );
		expect( screenFor().tag ).not.toBe( FILENAME_TAGS.departures );
	} );
} );

describe( 'buildOvernightSvg', () => {
	const svg = buildOvernightSvg( screenFor().overnight );

	it( 'renders at native panel resolution', () => {
		expect( svg ).toContain( 'width="1872" height="1404"' );
	} );

	// `Wakes at`, not `Updated at`. On a board the stamp is an observation and the whole staleness
	// defence; here every time comes from config, so an `Updated at` line could never be false and so
	// could never be informative. The opening time is what a reader standing here actually wants.
	it( 'prints the opening time rather than a freshness stamp', () => {
		expect( svg ).toContain( 'Wakes at 6:30 am' );
		expect( svg ).not.toContain( 'Updated at' );
	} );

	// A date drawn at 9:30 pm is wrong by midnight, and this screen holds the glass until morning.
	it( 'has no clock and no date in the header', () => {
		expect( svg ).not.toContain( '9:30<' );
		expect( svg ).not.toMatch( /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/ );
	} );

	it( 'uses the Metro logo rather than the word', () => {
		expect( svg ).toContain( '<image href="data:image/png;base64,' );
		expect( svg ).not.toContain( 'Departures' );
	} );

	// It is not a failure screen and must not read as one, so it says nothing about service.
	it( 'says nothing about service, and nothing about resuming', () => {
		expect( svg.toLowerCase() ).not.toContain( 'service' );
		expect( svg.toLowerCase() ).not.toContain( 'resume' );
		expect( svg.toLowerCase() ).not.toContain( 'error' );
	} );

	it( 'draws no direction bands and no stop name', () => {
		expect( svg ).not.toContain( BAND_FILL );
		expect( svg ).not.toContain( '1_600' );
	} );

	// Whichever variant is chosen, the opening time has to be on the glass. Decided 2026-08-01, and
	// pinned here because it is a rule about the whole set — the kind a new variant breaks silently.
	// Asserted as an exact set rather than a filter, so a variant cannot join the exceptions quietly.
	it( 'prints the opening time on every variant but the named exceptions', () => {
		const missing = OVERNIGHT_VARIANT_NAMES.filter(
			( variant ) => ! buildOvernightSvg( screenFor( variant ).overnight ).includes( '6:30' )
		);

		expect( missing ).toEqual( [ ...VARIANTS_WITHOUT_OPENING_TIME ] );
	} );

	it( 'renders every variant to distinct markup', () => {
		const rendered = OVERNIGHT_VARIANT_NAMES.map( ( variant ) =>
			buildOvernightSvg( screenFor( variant ).overnight )
		);

		expect( new Set( rendered ).size ).toBe( OVERNIGHT_VARIANT_NAMES.length );
	} );

	// Nine hours a night hang off this file, so a bad variant name must not be able to blank it.
	it( 'falls back to the default rather than throwing on an unknown variant', () => {
		expect( buildOvernightSvg( screenFor( 'nonsense' ).overnight ) ).toBe(
			buildOvernightSvg( screenFor( DEFAULT_OVERNIGHT_VARIANT ).overnight )
		);
	} );

	// The property the whole "stamp it from config" decision buys.
	it( 'is byte-identical however often it is built', () => {
		expect( buildOvernightSvg( screenFor().overnight ) ).toBe( svg );
	} );
} );
