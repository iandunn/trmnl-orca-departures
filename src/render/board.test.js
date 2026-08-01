import { describe, expect, it } from 'vitest';
import { PANEL_HEIGHT, PANEL_WIDTH, buildBoardSvg, directionLabel } from './board.js';
import { BUS_BOARD, RAIL_BOARD } from '../dev/sample-boards.js';

describe( 'directionLabel', () => {
	// Cardinals close up, because "Northbound" is the word Metro prints; diagonals stay spaced,
	// because "Northwestbound" is not a word anyone writes.
	it.each( [
		[ 'N', 'Northbound' ],
		[ 'E', 'Eastbound' ],
		[ 'S', 'Southbound' ],
		[ 'W', 'Westbound' ],
		[ 'NE', 'Northeast bound' ],
		[ 'NW', 'Northwest bound' ],
		[ 'SE', 'Southeast bound' ],
		[ 'SW', 'Southwest bound' ],
	] )( 'spells %s out as %s', ( bearing, expected ) => {
		expect( directionLabel( bearing, '1_590' ) ).toBe( expected );
	} );

	it( 'lets a per-stop override win, for stops where the derived form is not what anyone says', () => {
		expect( directionLabel( 'NW', '1_590', { '1_590': 'Northbound' } ) ).toBe( 'Northbound' );
	} );

	it( 'only applies an override to the stop it is keyed to', () => {
		expect( directionLabel( 'SE', '1_430', { '1_590': 'Northbound' } ) ).toBe( 'Southeast bound' );
	} );

	it( 'returns empty for a bearing OneBusAway did not supply', () => {
		expect( directionLabel( undefined, '1_590' ) ).toBe( '' );
		expect( directionLabel( '', '1_590' ) ).toBe( '' );
	} );
} );

describe( 'buildBoardSvg', () => {
	it( 'renders at native panel resolution', () => {
		const svg = buildBoardSvg( BUS_BOARD );

		expect( svg ).toContain( `width="${ PANEL_WIDTH }" height="${ PANEL_HEIGHT }"` );
		expect( svg ).toContain( `viewBox="0 0 ${ PANEL_WIDTH } ${ PANEL_HEIGHT }"` );
	} );

	it( 'includes every row from every group', () => {
		const svg = buildBoardSvg( BUS_BOARD );

		for ( const group of BUS_BOARD.groups ) {
			expect( svg ).toContain( group.heading.toUpperCase() );
			expect( svg ).toContain( group.stop );

			for ( const row of group.rows ) {
				expect( svg ).toContain( row.to );
			}
		}
	} );

	it( 'labels only the scheduled rows', () => {
		const scheduled = BUS_BOARD.groups.flatMap( ( g ) => g.rows ).filter( ( r ) => ! r.live );
		const matches = buildBoardSvg( BUS_BOARD ).match( /Scheduled/g ) ?? [];

		expect( matches ).toHaveLength( scheduled.length );
	} );

	it( 'always carries the as-of stamp, which is the only staleness defence', () => {
		expect( buildBoardSvg( BUS_BOARD ) ).toContain( 'as of 4:22 pm' );
	} );

	it( 'shows the day and date, so a panel frozen since yesterday is obvious', () => {
		const svg = buildBoardSvg( BUS_BOARD );

		expect( svg ).toContain( 'Saturday' );
		expect( svg ).toContain( 'August 1' );
	} );

	describe( 'badges', () => {
		it( 'uses rounded rects for buses and no circles', () => {
			expect( buildBoardSvg( BUS_BOARD ) ).not.toContain( '<circle' );
		} );

		it( 'uses circles for light rail', () => {
			// The only thing separating northbound rows at Int'l District is the line number, so
			// the badge has to carry the distinction on its own.
			const circles = buildBoardSvg( RAIL_BOARD ).match( /<circle/g ) ?? [];
			const rows = RAIL_BOARD.groups.flatMap( ( group ) => group.rows );

			expect( circles ).toHaveLength( rows.length );
		} );
	} );

	describe( 'lockup', () => {
		it( 'uses the Metro logo image on a bus board', () => {
			expect( buildBoardSvg( BUS_BOARD ) ).toContain( 'data:image/png;base64,' );
		} );

		it( 'names Sound Transit on a rail board, since they operate Link', () => {
			const svg = buildBoardSvg( RAIL_BOARD );

			expect( svg ).toContain( 'SOUND TRANSIT' );
			expect( svg ).toContain( 'LINK LIGHT RAIL' );
		} );
	} );

	describe( 'escaping', () => {
		it( 'escapes ampersands in a stop name', () => {
			// Cross-street names contain `&` constantly and headsigns come from an upstream API,
			// so unescaped text would produce invalid SVG that resvg rejects outright.
			const svg = buildBoardSvg( { ...BUS_BOARD, stopName: '3rd Ave & Pine St' } );

			expect( svg ).toContain( '3rd Ave &amp; Pine St' );
			expect( svg ).not.toContain( '3rd Ave & Pine St' );
		} );

		it( 'escapes angle brackets in a headsign', () => {
			const board = {
				...BUS_BOARD,
				groups: [
					{
						heading: 'Northwest bound',
						stop: 'Stop No. 590',
						rows: [ { badge: '1', to: '<script>', value: '4', unit: 'min', live: true } ],
					},
				],
			};

			expect( buildBoardSvg( board ) ).not.toContain( '<script>' );
		} );
	} );

	it( 'produces no markup for a board with no groups', () => {
		const svg = buildBoardSvg( { ...BUS_BOARD, groups: [] } );

		expect( svg ).toContain( '</svg>' );
		expect( svg ).not.toContain( 'Scheduled' );
	} );
} );
