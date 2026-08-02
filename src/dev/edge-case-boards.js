/**
 * Boards that exist to show how awkward names render, not what a real sign shows.
 *
 * **Every route name, headsign and stop name here is real**, taken from OneBusAway across all 11
 * agencies in the deployment. What is synthetic is the *co-location*: these routes do not call at
 * one stop, and some of these groups pair a route with a stop it never serves. That is deliberate —
 * the sheet exists to put the hard cases side by side, so the band and the badge column can be
 * judged against the worst input the region can produce rather than against downtown Metro.
 *
 * The groups say so on themselves, in the slot a real board uses for the stop name, so a render
 * pulled out of context cannot be mistaken for a departures board.
 *
 * Kept apart from `sample-boards.js` on purpose: those two are the reference design and the source
 * of the committed README screenshots, and mixing stress cases into them would make it unclear which
 * is which.
 */

import { formatBoardTime } from '../clock.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { REFERENCE_TIME_MS } from './sample-boards.js';

/** The four row shapes, so each board differs only in the names being exercised. */
const TIMES = [
	{ value: 'Now', unit: '', live: true },
	{ value: '4', unit: 'min', live: true },
	{ value: '11', unit: 'min', live: false },
	{ value: '4:47', unit: 'pm', live: true },
];

const rows = ( departures ) =>
	departures.map( ( [ badge, to, routeName ], index ) => ( {
		badge,
		to,
		routeName,
		...TIMES[ index % TIMES.length ],
	} ) );

/**
 * Route short names against a 152px badge slot.
 *
 * The first group is what `routeBadge()` handles — 13 routes region-wide, every one of which a
 * Seattle sign is likely to show. The second is what it deliberately does not, and the render is the
 * argument: anything past about four characters spills out of the box, and a route with no short
 * name at all draws an empty black plate.
 */
function badgeBoard( time ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		...time,
		groups: [
			{
				heading: 'Badge rule applies',
				name: 'real route names, composed for comparison',
				stop: 'not a real stop',
				rows: rows( [
					[ 'D Line', 'Ballard Uptown' ],
					[ 'S Line', 'Lakewood' ],
					[ '570', 'Seattle Tacoma International Airport' ],
					[ '7', 'Rainier Beach Via Rainier Ave S' ],
				] ),
			},
			{
				heading: 'No badge that fits',
				name: 'word-named routes, and one with no name at all',
				stop: 'not a real stop',
				rows: rows( [
					[ 'STCL', 'Stream TDS / Spanaway TC' ],
					[ 'Swift Blue', 'Shoreline North/185th Station' ],
					[ 'Trailhead Direct Issaquah Alps', 'Squak Mountain' ],
					// A ferry route's long name is its endpoints, so it is not worth repeating.
					[ '', 'To Seattle', 'Bainbridge Island - Seattle' ],
				] ),
			},
		],
	};
}

/** The same question in rail mode, where the badge is a circle and even less forgiving. */
function railBadgeBoard( time ) {
	return {
		mode: 'rail',
		agency: 'SOUND TRANSIT',
		...time,
		groups: [
			{
				heading: 'Badge rule applies',
				name: 'real route names, composed for comparison',
				stop: 'not a real stop',
				rows: rows( [
					[ '1 Line', 'Lynnwood City Center' ],
					[ '2 Line', 'Downtown Redmond' ],
					[ 'T Line', 'Tacoma Dome' ],
					[ 'N Line', 'Everett' ],
				] ),
			},
			{
				heading: 'No badge that fits',
				name: 'word-named routes, and one with no name at all',
				stop: 'not a real stop',
				rows: rows( [
					[ 'Monorail', 'Westlake' ],
					[ 'First Hill Streetcar', 'Pioneer Square' ],
					[ 'South Lake Union Streetcar', 'Westlake Hub' ],
					// The one route with no short name whose long name is a real service name.
					[ '', 'Portland', 'Amtrak Cascades' ],
				] ),
			},
		],
	};
}

/**
 * Destination text, and the distinction the collapsing rule turns on.
 *
 * The first group is the case for adjacency: one row stutters and is collapsed, three repeat a word
 * while naming two different places and must survive untouched. The second is length — the region's
 * longest headsign is 58 characters, and one route names no destination at all.
 */
function headsignBoard( time ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		...time,
		groups: [
			{
				heading: 'Repeats',
				name: 'row 1 collapses, rows 2-4 must not',
				stop: 'not a real stop',
				rows: rows( [
					[ '14', 'Mount Baker Mount Baker Transit Center' ],
					[ '13', 'Seattle Pacific University Seattle Center W' ],
					[ '7', 'Rainier Beach Via Rainier Ave S' ],
					[ '3', 'Madrona and 34th Ave Via E Cherry St' ],
				] ),
			},
			{
				heading: 'Length, and no destination at all',
				name: 'the longest headsigns the region returns',
				stop: 'not a real stop',
				rows: rows( [
					[ '7', 'Pioneer Square Chinatown International District Waterfront' ],
					[ '4', 'Seattle Pacific University Downtown Seattle' ],
					[ '50', 'Othello Station South Downtown Seattle' ],
					[ '13', 'Downtown Only' ],
				] ),
			},
		],
	};
}

/**
 * The band: a derived diagonal label, the longest stop name in the region, and a stop that reports
 * no compass bearing at all — 24 of the 515 stops surveyed do, one of them a Link platform.
 */
function bandBoard( time ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		...time,
		groups: [
			{
				heading: 'Northwest bound',
				name: 'S Columbian Way & Veterans Administration Hospital Rd',
				stop: 'Stop No. 36145',
				rows: rows( [
					[ '36', 'Othello Station N Beacon Hill' ],
					[ '7', 'Rainier Beach Via Rainier Ave S' ],
					[ '14', 'Mount Baker Mount Baker Transit Center' ],
					[ '570', 'Seattle Tacoma International Airport' ],
				] ),
			},
			{
				heading: '',
				name: "Int'l Dist/Chinatown",
				stop: 'Stop No. C09',
				rows: rows( [
					[ 'D Line', 'Ballard Uptown' ],
					[ '5', 'Shoreline Greenwood' ],
					[ '40', 'Northgate Station Fremont' ],
					[ '13', 'Seattle Pacific University Seattle Center W' ],
				] ),
			},
		],
	};
}

/**
 * The longest destinations again, but on a board sparse enough to hit the row-height ceiling.
 *
 * This is the harder case and it is easy to miss: `rowMetrics()` clamps rather than stretches, so a
 * board with few departures draws its rows at full size — 58px destinations rather than the 47px an
 * eight-row board gets. The longest headsign therefore reaches furthest right exactly when the sign
 * has the least on it, which is the opposite of where you would look for an overflow.
 */
function sparseBoard( time ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		...time,
		groups: [
			{
				heading: 'Northbound',
				name: 'the longest destinations at full row height',
				stop: 'not a real stop',
				rows: [
					{
						badge: '570',
						to: 'Pioneer Square Chinatown International District Waterfront',
						value: '4:47',
						unit: 'pm',
						live: false,
					},
					{
						badge: '13',
						to: 'Seattle Pacific University Seattle Center W',
						value: '11',
						unit: 'min',
						live: true,
					},
				],
			},
		],
	};
}

/**
 * @param {object} [options]
 * @param {number} [options.nowMs]    Epoch milliseconds.
 * @param {string} [options.timezone] IANA zone.
 */
export function edgeCaseBoards( {
	nowMs = REFERENCE_TIME_MS,
	timezone = CONFIG_DEFAULTS.timezone,
} = {} ) {
	const time = formatBoardTime( nowMs, timezone );

	return [
		{ slug: 'edge-badges', title: 'Edge case — route names against the badge slot', board: badgeBoard( time ) },
		{ slug: 'edge-badges-rail', title: 'Edge case — the same names in a rail circle', board: railBadgeBoard( time ) },
		{ slug: 'edge-headsigns', title: 'Edge case — repeated words, and the longest destinations', board: headsignBoard( time ) },
		{ slug: 'edge-band', title: 'Edge case — longest stop name, and a stop with no bearing', board: bandBoard( time ) },
		{ slug: 'edge-sparse', title: 'Edge case — the longest destinations at full row height', board: sparseBoard( time ) },
	];
}
