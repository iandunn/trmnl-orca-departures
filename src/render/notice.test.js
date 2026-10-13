import { describe, expect, it } from 'vitest';
import { buildNoticeSvg, wrapText } from './notice.js';
import { buildBoardSvg } from './board.js';
import { BUS_BOARD } from '../dev/sample-boards.js';

const NOTICE = {
	headline: 'No departure data',
	detail: 'The sign is connected. Live arrivals are not switched on yet.',
	stopName: '1_590 / 1_430',
	weekday: 'Saturday',
	date: 'August 1',
	clock: '4:22',
	meridiem: 'pm',
	asOf: '4:22 pm',
};

// The wrap exists because a long detail line ran off both edges of the panel with its middle still
// perfectly legible — it read as working until someone read the whole sentence. Only looking at the
// rendered PNG caught it, so these assertions are the cheap half of the guard, not the whole one.
describe( 'wrapText', () => {
	it( 'breaks a long sentence onto several lines, none over the limit', () => {
		const sentence = 'The server address is wrong: the agency must be a number, like 1 for King County Metro.';
		const lines = wrapText( sentence, 40 );

		expect( lines.length ).toBeGreaterThan( 1 );

		for ( const line of lines ) {
			expect( line.length ).toBeLessThanOrEqual( 40 );
		}
	} );

	it( 'keeps every word, in order', () => {
		const sentence = 'one two three four five six seven eight';

		expect( wrapText( sentence, 12 ).join( ' ' ) ).toBe( sentence );
	} );

	it( 'leaves a short sentence on one line', () => {
		expect( wrapText( 'Sign error', 40 ) ).toEqual( [ 'Sign error' ] );
	} );

	it( 'returns nothing for empty input rather than a blank line', () => {
		expect( wrapText( '' ) ).toEqual( [] );
		expect( wrapText( '   ' ) ).toEqual( [] );
	} );

	// Every string reaching here is ours, so this means the copy needs shortening — not that the
	// renderer needs hyphenation. It must not loop forever deciding that.
	it( 'lets a single over-long word overflow rather than hanging', () => {
		expect( wrapText( 'Supercalifragilistic', 5 ) ).toEqual( [ 'Supercalifragilistic' ] );
	} );
} );

describe( 'buildNoticeSvg', () => {
	it( 'wraps the detail across multiple text elements when it is long', () => {
		const svg = buildNoticeSvg( {
			...NOTICE,
			detail: 'The server address is wrong: the agency must be a number, like 1 for King County Metro.',
		} );

		expect( svg.match( /font-size="52"/g ) ).toHaveLength( 2 );
	} );

	it( 'renders at native panel resolution', () => {
		expect( buildNoticeSvg( NOTICE ) ).toContain( 'width="1872" height="1404"' );
	} );

	it( 'carries the headline, the detail and the stop', () => {
		const svg = buildNoticeSvg( NOTICE );

		expect( svg ).toContain( 'No departure data' );
		expect( svg ).toContain( 'not switched on yet' );
		expect( svg ).toContain( '1_590 / 1_430' );
	} );

	// The whole defence against a silently frozen panel, and the condition the accepted staleness
	// risk rests on. A degraded screen needs it at least as much as a good one does.
	it( 'always carries an Updated at stamp', () => {
		expect( buildNoticeSvg( NOTICE ) ).toContain( 'Updated at 4:22 pm' );
	} );

	it( 'keeps the stacked day and date, which is what catches a panel frozen since yesterday', () => {
		const svg = buildNoticeSvg( NOTICE );

		expect( svg ).toContain( 'Saturday' );
		expect( svg ).toContain( 'August 1' );
	} );

	// The requirement is that someone glancing from the doorway sees immediately that the sign is not
	// telling them when the bus comes. A notice that reads as a board with fewer rows fails that.
	it( 'does not draw the board furniture', () => {
		const svg = buildNoticeSvg( NOTICE );
		const board = buildBoardSvg( BUS_BOARD );

		// No direction bands, no row rules, no badges.
		expect( svg ).not.toContain( '#c8c8c8' );
		expect( svg ).not.toContain( 'stroke="#8a8a8a" stroke-width="2"/><line' );
		expect( svg ).not.toContain( '<circle' );
		expect( board ).toContain( '#c8c8c8' );
	} );

	it( 'escapes markup coming from anywhere upstream', () => {
		const svg = buildNoticeSvg( { ...NOTICE, detail: 'stop <script>alert(1)</script> & co' } );

		expect( svg ).toContain( '&lt;script&gt;' );
		expect( svg ).toContain( '&amp; co' );
		expect( svg ).not.toContain( '<script>' );
	} );

	it( 'renders with empty time fields, which is how the render-failed screen has to draw', () => {
		const svg = buildNoticeSvg( {
			headline: 'Sign error',
			detail: '',
			stopName: '',
			weekday: '',
			date: '',
			clock: '',
			meridiem: '',
			asOf: 'unknown',
		} );

		expect( svg ).toContain( 'Sign error' );
		expect( svg ).toContain( 'Updated at unknown' );
	} );
} );
