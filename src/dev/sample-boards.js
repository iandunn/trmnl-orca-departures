/**
 * The reference boards, reproducible from source.
 *
 * These replace the throwaway spike renders that used to live in `assets/sources/` — they
 * are the current design, not experiments, and the app regenerates them on demand.
 *
 * **Every value is real, verified live against OneBusAway.** Route numbers, headsigns, stop codes
 * and directions all come from the API. Invented data hides width problems: `Downtown Seattle
 * Westwood Village` and `Seattle Pacific University Downtown Seattle` are far longer than anything
 * a person would make up, and Metro concatenates destination with via-point so headsigns repeat
 * themselves.
 *
 * **Never the stop this sign actually points at.** These are busy public downtown stops chosen so
 * no committed image can leak an address. See `CLAUDE.md` for the full sample-stop table.
 *
 * The headings are not literals: they run through `directionLabel()` with the same override
 * mechanism production uses, so the preview exercises that path rather than describing it.
 */

import { formatBoardTime } from '../clock.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { directionLabel } from '../render/board.js';

/**
 * Direction labels for the sample stops.
 *
 * These are public downtown stops, so unlike the real sign's `DIRECTION_OVERRIDES` — which is
 * privacy-sensitive and lives in `.dev.vars` and a Worker secret — they can be written down here.
 *
 * Only the bus stops need an override, and the reason is the useful part: 3rd Ave runs diagonally
 * through downtown, so its stops report `NW`/`SE` and derive to "Northwest bound" and "Southeast
 * bound" where every rider and every Metro timetable says northbound and southbound. The rail pair
 * reports plain `N`/`S` and derives correctly with no entry at all, which is what an override map
 * should look like: only the stops where the bearing itself misleads.
 */
export const SAMPLE_DIRECTION_OVERRIDES = {
	'1_600': 'Northbound',
	'1_430': 'Southbound',
};

/**
 * The instant the frozen fixtures below are rendered at.
 *
 * A fixed moment keeps `BUS_BOARD` and `RAIL_BOARD` byte-stable, so a test or a diff of the rendered
 * PNG measures the change being made rather than the time of day. The live preview passes the real
 * clock instead.
 */
export const REFERENCE_TIME_MS = Date.parse( '2026-08-01T16:22:00-07:00' );

/**
 * Two stops that are **not** a matched pair — `1_600` at 3rd Ave & Virginia St heading north, and
 * `1_430` at 3rd Ave & Pine St heading south. Buses only.
 *
 * A sign serves whichever stops its owner actually walks to, and those need not be the two sides of
 * one street. These are 313 m apart, three blocks along 3rd Ave, and between them they carry the
 * departures a rider at that spot would want in each direction — which no single matched pair can,
 * because 3rd Ave interleaves two stop zones and the `7` never calls at the same one as the `D`.
 *
 * That is why the name lives in each band rather than once in the footer: there is no shared name.
 * The rail board below keeps the footer treatment, so the preview shows both cases.
 *
 * Four departures per direction, the accepted density. The last row of the southbound group is
 * deliberately the awkward one: `570` is the widest badge, `Seattle Tacoma International Airport` is
 * the longest headsign either stop carries, and the row is scheduled — so the board's tightest row
 * also carries its tallest stack. `570` is Sound Transit rather than Metro, which is itself real: a
 * `1_` stop returns ST Express arrivals alongside Metro's. `Mount Baker Mount Baker Transit Center`
 * is left exactly as OneBusAway reports it, repeated words and all, because that is the headsign
 * problem the renderer still has to solve rather than one to hide in a fixture.
 */
export function busBoard( time, overrides = SAMPLE_DIRECTION_OVERRIDES ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		...time,
		groups: [
			{
				heading: directionLabel( 'NW', '1_600', overrides ),
				name: '3rd Ave & Virginia St',
				stop: 'Stop No. 600',
				rows: [
					{ badge: 'D Line', to: 'Ballard Uptown', value: 'Now', unit: '', live: true },
					{
						badge: '13',
						to: 'Seattle Pacific University Seattle Center W',
						value: '4',
						unit: 'min',
						live: true,
					},
					{ badge: '40', to: 'Northgate Station Fremont', value: '11', unit: 'min', live: false },
					{ badge: '5', to: 'Shoreline Greenwood', value: '4:47', unit: 'pm', live: true },
				],
			},
			{
				heading: directionLabel( 'SE', '1_430', overrides ),
				name: '3rd Ave & Pine St',
				stop: 'Stop No. 430',
				rows: [
					{ badge: '7', to: 'Rainier Beach Via Rainier Ave S', value: '6', unit: 'min', live: true },
					{ badge: '36', to: 'Othello Station N Beacon Hill', value: '4:44', unit: 'pm', live: false },
					{
						badge: '14',
						to: 'Mount Baker Mount Baker Transit Center',
						value: '4:52',
						unit: 'pm',
						live: true,
					},
					{
						badge: '570',
						to: 'Seattle Tacoma International Airport',
						value: '4:58',
						unit: 'pm',
						live: false,
					},
				],
			},
		],
	};
}

/**
 * International District/Chinatown — `40_621` northbound, `40_623` southbound. Light rail only.
 *
 * Deliberately the interchange rather than Westlake: northbound **both lines show the same
 * destination**, so the line number is the only thing separating those rows. If the circle badge
 * cannot carry that, nothing else in the row will. Southbound is where the lines actually diverge.
 *
 * The lines alternate, which is what the real service does and what makes the fourth row worth
 * having here — it puts two indistinguishable northbound destinations directly above another two.
 *
 * Both groups name the same station, and both bands say so. That repetition is deliberate: the band
 * is the one place a reader ever looks for the stop, and making it conditional would mean the name
 * moves depending on data the reader cannot see.
 */
export function railBoard( time, overrides = SAMPLE_DIRECTION_OVERRIDES ) {
	return {
		mode: 'rail',
		agency: 'SOUND TRANSIT',
		...time,
		groups: [
			{
				heading: directionLabel( 'N', '40_621', overrides ),
				name: "Int'l District/Chinatown",
				stop: 'Stop No. 621',
				rows: [
					{ badge: '1 Line', to: 'Lynnwood City Center', value: '3', unit: 'min', live: true },
					{ badge: '2 Line', to: 'Lynnwood City Center', value: '7', unit: 'min', live: true },
					{ badge: '1 Line', to: 'Lynnwood City Center', value: '12', unit: 'min', live: false },
					{ badge: '2 Line', to: 'Lynnwood City Center', value: '16', unit: 'min', live: false },
				],
			},
			{
				heading: directionLabel( 'S', '40_623', overrides ),
				name: "Int'l District/Chinatown",
				stop: 'Stop No. 623',
				rows: [
					{ badge: '1 Line', to: 'Federal Way Downtown', value: '5', unit: 'min', live: true },
					{ badge: '2 Line', to: 'Downtown Redmond', value: '9', unit: 'min', live: true },
					{ badge: '1 Line', to: 'Federal Way Downtown', value: '4:52', unit: 'pm', live: false },
					{ badge: '2 Line', to: 'Downtown Redmond', value: '4:59', unit: 'pm', live: false },
				],
			},
		],
	};
}

/** The frozen fixtures, for tests and anywhere a stable render matters. */
export const BUS_BOARD = busBoard( formatBoardTime( REFERENCE_TIME_MS, CONFIG_DEFAULTS.timezone ) );
export const RAIL_BOARD = railBoard( formatBoardTime( REFERENCE_TIME_MS, CONFIG_DEFAULTS.timezone ) );

/**
 * The contact sheet's boards, rendered at whatever moment and timezone the caller supplies.
 *
 * The preview passes the real clock and the configured timezone, which is the only way to see the
 * header block and the "Updated at" stamp as the device will actually get them.
 *
 * @param {object} [options]
 * @param {number} [options.nowMs]    Epoch milliseconds.
 * @param {string} [options.timezone] IANA zone.
 */
export function sampleBoards( { nowMs = REFERENCE_TIME_MS, timezone = CONFIG_DEFAULTS.timezone } = {} ) {
	const time = formatBoardTime( nowMs, timezone );

	return [
		{ slug: 'bus', title: 'Bus — 3rd Ave & Virginia St and 3rd Ave & Pine St', board: busBoard( time ) },
		{ slug: 'light-rail', title: "Light rail — Int'l District/Chinatown", board: railBoard( time ) },
	];
}
