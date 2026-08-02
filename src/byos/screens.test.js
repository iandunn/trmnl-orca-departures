import { describe, expect, it } from 'vitest';
import { badRequestScreen, renderFailedScreen, upstreamFailedScreen } from './screens.js';
import { REJECTION_REASONS } from '../abuse.js';
import { FILENAME_TAGS } from '../filename.js';

const NOW = Date.parse( '2026-08-01T16:22:00-07:00' );
const TZ = 'America/Los_Angeles';

// Every state needs a tag of its own, or the device's cache suppresses a degraded screen because
// its filename matches the last good render.
describe( 'the tags are all distinct', () => {
	it( 'gives each screen its own', () => {
		const tags = [
			upstreamFailedScreen( { nowMs: NOW, timezone: TZ, stopLabel: '1_600' } ).tag,
			badRequestScreen( { nowMs: NOW, timezone: TZ, reason: REJECTION_REASONS.invalidAgency } ).tag,
			renderFailedScreen( { nowMs: NOW, timezone: TZ, stopLabel: '1_600' } ).tag,
		];

		expect( new Set( tags ).size ).toBe( tags.length );
		expect( tags ).toEqual( [ FILENAME_TAGS.upstreamFailed, FILENAME_TAGS.badPath, FILENAME_TAGS.renderFailed ] );
	} );
} );

describe( 'upstreamFailedScreen', () => {
	// A board full of blanks would read as a design, not a fault. The whole point of dropping to a
	// notice is that it cannot be mistaken for departures at a glance.
	it( 'says the data source failed rather than drawing an empty board', () => {
		const { notice } = upstreamFailedScreen( { nowMs: NOW, timezone: TZ, stopLabel: '1_600' } );

		expect( notice.headline ).toBe( 'No live arrivals' );
		expect( notice.detail ).toContain( 'OneBusAway' );
		expect( notice.asOf ).toBe( '4:22 pm' );
	} );
} );

describe( 'badRequestScreen', () => {
	// The single most likely mistake the owner can make is a typo in the base URL typed into the
	// captive portal, and naming the wrong segment is the difference between a five-second fix and
	// an afternoon in front of a sign that does nothing.
	it( 'names the segment that was wrong', () => {
		const { notice } = badRequestScreen( {
			nowMs: NOW,
			timezone: TZ,
			reason: REJECTION_REASONS.invalidAgency,
		} );

		expect( notice.headline ).toBe( 'Check the sign URL' );
		expect( notice.detail ).toContain( 'agency must be a number' );
	} );

	it( 'has a sentence for every reason the classifier can produce', () => {
		for ( const reason of Object.values( REJECTION_REASONS ) ) {
			const { notice } = badRequestScreen( { nowMs: NOW, timezone: TZ, reason } );

			expect( notice.detail ).not.toContain( 'undefined' );
			expect( notice.detail ).not.toContain( 'not in the expected format' );
		}
	} );

	// A reason added upstream must degrade to a vague board rather than `undefined` on the glass.
	it( 'degrades to a vague sentence for an unrecognised reason', () => {
		const { notice } = badRequestScreen( { nowMs: NOW, timezone: TZ, reason: 'invented-later' } );

		expect( notice.detail ).toContain( 'not in the expected format' );
	} );
} );

describe( 'renderFailedScreen', () => {
	// `formatBoardTime()` throws on a non-finite timestamp on purpose, and this is the screen that has
	// to draw when that already happened. Blank beats a fabricated `12:00 am`, which would be a lie on
	// the one screen whose whole job is to admit something is wrong.
	it( 'draws with blank time fields rather than throwing when the timestamp is unusable', () => {
		for ( const bad of [ undefined, NaN, null ] ) {
			const { notice } = renderFailedScreen( { nowMs: bad, timezone: TZ, stopLabel: '1_590' } );

			expect( notice.asOf ).toBe( 'unknown' );
			expect( notice.clock ).toBe( '' );
			expect( notice.headline ).toBe( 'Sign error' );
		}
	} );

	it( 'survives an unusable timezone the same way', () => {
		const { notice } = renderFailedScreen( { nowMs: NOW, timezone: 'Mars/Olympus', stopLabel: '1_590' } );

		expect( notice.headline ).toBe( 'Sign error' );
	} );
} );
