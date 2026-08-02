import { describe, expect, it } from 'vitest';
import {
	FOOTER_RULE_Y,
	PANEL_HEIGHT,
	PANEL_WIDTH,
	buildBoardSvg,
	directionLabel,
	maxRowsPerGroup,
	rowMetrics,
} from './board.js';
import { BUS_BOARD, RAIL_BOARD } from '../dev/sample-boards.js';
import { collapseRepeatedPhrases } from '../headsign.js';

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

/** A sparse board, for the cases where the ceiling binds instead of the fit. */
const SPARSE_BOARD = {
	...BUS_BOARD,
	groups: [ { ...BUS_BOARD.groups[ 0 ], rows: BUS_BOARD.groups[ 0 ].rows.slice( 0, 2 ) } ],
};

describe( 'rowMetrics', () => {
	it( 'scales the accepted board down to fit, since eight rows do not go at full height', () => {
		// 1028 of usable height over eight rows, floored.
		expect( rowMetrics( BUS_BOARD.groups ).height ).toBe( 128 );
	} );

	it( 'caps a sparse board at the ceiling rather than stretching it across the panel', () => {
		expect( rowMetrics( SPARSE_BOARD.groups ).height ).toBe( 158 );
	} );

	// The failure this guards against is silent: nothing clips, the rows simply draw over the footer
	// rule and off the bottom of the panel.
	it.each( [
		[ 'the bus board', BUS_BOARD ],
		[ 'the rail board', RAIL_BOARD ],
		[ 'a sparse board', SPARSE_BOARD ],
	] )( 'keeps the last row clear of the footer rule on %s', ( _label, board ) => {
		// Strictly below, not merely touching. Landing exactly on the rule satisfies "it fits" while
		// leaving descenders a pixel or two from crossing it.
		expect( rowMetrics( board.groups ).bottom ).toBeLessThan( FOOTER_RULE_Y );
	} );

	it( 'does not divide by a row count of zero', () => {
		expect( rowMetrics( [] ).height ).toBe( 158 );
	} );

	// A group that drew nothing would otherwise let the surviving group's rows grow to fill the panel,
	// so a half-failed board would be a different design rather than a missing half.
	it( 'counts a reserved empty group as though it had drawn its rows', () => {
		const halfFailed = [ BUS_BOARD.groups[ 0 ], { ...BUS_BOARD.groups[ 1 ], rows: [], reserved: 4 } ];

		expect( rowMetrics( halfFailed ).height ).toBe( rowMetrics( BUS_BOARD.groups ).height );
	} );
} );

describe( 'a group whose last bus has gone', () => {
	const spent = ( tomorrow ) => ( {
		...BUS_BOARD,
		groups: [
			{
				...BUS_BOARD.groups[ 0 ],
				rows: [],
				reserved: 4,
				message: 'No more departures today',
				...( tomorrow ? { tomorrow } : {} ),
			},
		],
	} );

	it( 'says so, and says nothing else when tomorrow is unknown', () => {
		const svg = buildBoardSvg( spent() );

		expect( svg ).toContain( 'No more departures today' );
		expect( svg ).not.toContain( 'Tomorrow' );
	} );

	// Both facts, not one: "nothing more today" and "here is the first one" are different answers, and
	// someone reading this at midnight wants both.
	it( 'lists tomorrow’s first departures under the sentence when they are known', () => {
		const svg = buildBoardSvg(
			spent( [ { badge: '5', to: 'Shoreline Greenwood', value: '5:12', unit: 'am', live: false } ] )
		);

		expect( svg ).toContain( 'No more departures today' );
		expect( svg ).toContain( 'Shoreline Greenwood' );
		expect( svg ).toContain( '5:12' );
		// In the slot a scheduled row uses for `Scheduled` — the word that stops the number below it
		// being read as the next bus.
		expect( svg ).toContain( 'Tomorrow' );
	} );
} );

describe( 'maxRowsPerGroup', () => {
	// Row count is not configuration — it follows from the space the layout has — so the number the
	// design was accepted at has to fall out of the geometry rather than be asserted into it.
	it( 'gives a two-stop board the four rows per direction the design was judged at', () => {
		expect( maxRowsPerGroup( 2 ) ).toBe( 4 );
	} );

	it( 'gives a single-direction sign more, since it pays for one band instead of two and a gap', () => {
		expect( maxRowsPerGroup( 1 ) ).toBeGreaterThan( maxRowsPerGroup( 2 ) );
	} );

	it( 'never asks for fewer than one row', () => {
		expect( maxRowsPerGroup( 0 ) ).toBeGreaterThanOrEqual( 1 );
	} );

	// The bound is only honest if a board built to it actually fits, which is the same silent failure
	// `rowMetrics` guards: nothing clips, the rows just draw over the footer rule.
	it.each( [ 1, 2 ] )( 'produces a board that clears the footer rule with %i group(s)', ( count ) => {
		const rows = Array.from( { length: maxRowsPerGroup( count ) }, () => BUS_BOARD.groups[ 0 ].rows[ 0 ] );
		const groups = Array.from( { length: count }, () => ( { ...BUS_BOARD.groups[ 0 ], rows } ) );

		expect( rowMetrics( groups ).bottom ).toBeLessThan( FOOTER_RULE_Y );
	} );
} );

describe( 'buildBoardSvg', () => {
	it( 'scales the whole row together, so a denser board is the same layout seen smaller', () => {
		const dense = buildBoardSvg( BUS_BOARD );

		expect( dense ).toContain( 'y1="288"' );
		expect( buildBoardSvg( SPARSE_BOARD ) ).toContain( 'y1="318"' );

		// Every size inside the row comes down by the same factor rather than being retuned.
		expect( dense ).toContain( 'font-size="62"' );
		expect( buildBoardSvg( SPARSE_BOARD ) ).toContain( 'font-size="76"' );
	} );

	it( 'credits nothing in the footer, which is now just the stamp and the stop', () => {
		expect( buildBoardSvg( BUS_BOARD ) ).not.toContain( '<svg x=' );
	} );

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
				expect( svg ).toContain( collapseRepeatedPhrases( row.to ) );
			}
		}
	} );

	// Applied here rather than in the data so it covers live predictions too, without the OneBusAway
	// mapper having to remember. The fixture keeps the raw headsign, which is what the API returns.
	it( 'collapses a stuttered headsign on the way to the panel', () => {
		const svg = buildBoardSvg( BUS_BOARD );

		expect( svg ).toContain( 'Mount Baker Transit Center' );
		expect( svg ).not.toContain( 'Mount Baker Mount Baker' );
	} );

	// The collision only happens on a sparse board, because `rowMetrics()` clamps rather than
	// stretches: two departures draw at full type size, and the region's longest headsign then runs
	// into the time. A dense board scales the same string down on its own and needs no help.
	describe( 'destination fitting', () => {
		const LONGEST = 'Pioneer Square Chinatown International District Waterfront';

		const sparseWith = ( to ) => ( {
			...BUS_BOARD,
			groups: [
				{
					heading: 'Northbound',
					name: '3rd Ave & Pine St',
					stop: 'Stop No. 430',
					rows: [ { badge: '7', to, value: '4:47', unit: 'pm', live: true } ],
				},
			],
		} );

		it( 'shrinks a destination that would otherwise run into the time column', () => {
			// The ceiling for a sparse row is 58; anything below it means the fit took over.
			expect( buildBoardSvg( sparseWith( LONGEST ) ) ).toContain( 'font-size="46"' );
			expect( buildBoardSvg( sparseWith( LONGEST ) ) ).not.toContain( `font-size="58">${ LONGEST }` );
		} );

		// Two type sizes in one destination column read as a rendering fault rather than as a fit, so
		// the longest destination sets the size for every row on the board.
		it( 'sizes every row alike, not each row to its own length', () => {
			const board = {
				...BUS_BOARD,
				groups: [
					{
						heading: 'Northbound',
						name: '3rd Ave & Pine St',
						stop: 'Stop No. 430',
						rows: [
							{ badge: '7', to: LONGEST, value: '4:47', unit: 'pm', live: true },
							{ badge: '13', to: 'Ballard Uptown', value: '11', unit: 'min', live: true },
						],
					},
				],
			};
			const sizes = [ ...buildBoardSvg( board ).matchAll( /font-size="(\d+)" fill="#111">(?!Now|\d)/g ) ];

			expect( sizes.length ).toBeGreaterThan( 1 );
			expect( new Set( sizes.map( ( match ) => match[ 1 ] ) ).size ).toBe( 1 );
		} );

		it( 'leaves a destination that already fits at full size', () => {
			expect( buildBoardSvg( sparseWith( 'Ballard Uptown' ) ) ).toContain(
				'font-size="58" fill="#111">Ballard Uptown'
			);
		} );

		// A dense board has already scaled the type down past what the longest headsign needs, so the
		// fit must not shrink it a second time.
		it( 'does not shrink twice on a dense board', () => {
			expect( buildBoardSvg( BUS_BOARD ) ).toContain( 'font-size="47" fill="#111">Rainier Beach' );
		} );
	} );

	// Same seam, same reason: the fixture carries `D Line` because that is what OneBusAway returns,
	// and the badge slot is far too narrow for it.
	it( 'badges a named line by its letter alone', () => {
		expect( buildBoardSvg( BUS_BOARD ) ).not.toContain( '>D Line<' );
		expect( buildBoardSvg( BUS_BOARD ) ).toContain( '>D<' );
		expect( buildBoardSvg( RAIL_BOARD ) ).not.toContain( '>1 Line<' );
		expect( buildBoardSvg( RAIL_BOARD ) ).toContain( '>1<' );
	} );

	it( 'labels only the scheduled rows', () => {
		const scheduled = BUS_BOARD.groups.flatMap( ( g ) => g.rows ).filter( ( r ) => ! r.live );
		const matches = buildBoardSvg( BUS_BOARD ).match( /Scheduled/g ) ?? [];

		expect( matches ).toHaveLength( scheduled.length );
	} );

	it( 'always carries the as-of stamp, which is the only staleness defence', () => {
		expect( buildBoardSvg( BUS_BOARD ) ).toContain( 'Updated at 4:22 pm' );
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

		// A ferry or Amtrak arrival has no route number at all. An empty black plate would read as a
		// rendering fault, and the destination column is a fixed x, so leaving the slot blank costs
		// nothing in alignment.
		it( 'leaves the slot blank for a route with no short name, without moving the destination', () => {
			const board = {
				...BUS_BOARD,
				groups: [
					{
						heading: 'Westbound',
						name: 'Colman Dock',
						stop: 'Stop No. 1',
						rows: [ { badge: '', to: 'To Seattle', value: '4', unit: 'min', live: true } ],
					},
				],
			};
			const svg = buildBoardSvg( board );

			expect( svg ).not.toContain( '<rect x="60"' );
			expect( svg ).toContain( '<text x="252"' );
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

	describe( 'direction bands', () => {
		it( 'names each stop in its own band', () => {
			const svg = buildBoardSvg( BUS_BOARD );

			expect( svg ).toContain( '3rd Ave &amp; Virginia St' );
			expect( svg ).toContain( '3rd Ave &amp; Pine St' );
		} );

		// The whole point of moving the name into the band: two stops on one board need not share a
		// name, so the reader must never have to infer which group a single footer name belonged to.
		it( 'repeats a shared name rather than hoisting it out of the bands', () => {
			const names = buildBoardSvg( RAIL_BOARD ).match( /Int'l District\/Chinatown/g ) ?? [];

			expect( names ).toHaveLength( 2 );
		} );

		// A `dx` rather than spaces, because SVG collapses whitespace and direction and name would
		// otherwise read as one phrase.
		it( 'separates the name from the direction without relying on spaces', () => {
			expect( buildBoardSvg( BUS_BOARD ) ).toContain( '<tspan dx="26"' );
		} );

		it( 'leaves the footer to the stamp alone', () => {
			const footer = buildBoardSvg( BUS_BOARD ).split( 'Updated at' )[ 1 ];

			expect( footer ).not.toContain( 'Virginia' );
			expect( footer ).not.toContain( 'Pine' );
		} );

		// OneBusAway leaves `stop.direction` empty often enough to matter — 24 of 515 stops surveyed,
		// one of them a Link platform — and the name must not sit indented behind an empty label.
		it( 'gives the name the whole slot when the stop reports no bearing', () => {
			const svg = buildBoardSvg( {
				...BUS_BOARD,
				groups: [ { ...BUS_BOARD.groups[ 0 ], heading: '' } ],
			} );

			expect( svg ).toContain( '3rd Ave &amp; Virginia St' );
			expect( svg ).not.toContain( '<tspan dx="26"' );
		} );

		it( 'still draws a band for a group with no name', () => {
			const svg = buildBoardSvg( {
				...BUS_BOARD,
				groups: [ { ...BUS_BOARD.groups[ 0 ], name: undefined } ],
			} );

			expect( svg ).toContain( 'NORTHBOUND' );
			expect( svg ).toContain( 'Stop No. 600' );
		} );
	} );

	describe( 'escaping', () => {
		it( 'escapes ampersands in a stop name', () => {
			// Cross-street names contain `&` constantly and headsigns come from an upstream API,
			// so unescaped text would produce invalid SVG that resvg rejects outright.
			const svg = buildBoardSvg( BUS_BOARD );

			expect( svg ).toContain( '3rd Ave &amp; Virginia St' );
			expect( svg ).not.toContain( '3rd Ave & Virginia St' );
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
