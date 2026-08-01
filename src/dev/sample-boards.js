/**
 * The reference boards, reproducible from source.
 *
 * These replace the throwaway spike renders that used to live in `.claude/tmp/cpu-spike/` — they
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
 * Only the bus pair needs an override, and the reason is the useful part: 3rd Ave runs diagonally
 * through downtown, so its stops report `NW`/`SE` and derive to "Northwest bound" and "Southeast
 * bound" where every rider and every Metro timetable says northbound and southbound. The rail pair
 * reports plain `N`/`S` and derives correctly with no entry at all, which is what an override map
 * should look like: only the stops where the bearing itself misleads.
 */
export const SAMPLE_DIRECTION_OVERRIDES = {
	'1_590': 'Northbound',
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

/** 3rd Ave & Pine St — `1_590` northwest bound, `1_430` southeast bound. Buses only. */
export function busBoard( time, overrides = SAMPLE_DIRECTION_OVERRIDES ) {
	return {
		mode: 'bus',
		agency: 'KING COUNTY METRO',
		stopName: '3rd Ave & Pine St',
		...time,
		groups: [
			{
				heading: directionLabel( 'NW', '1_590', overrides ),
				stop: 'Stop No. 590',
				rows: [
					{ badge: 'H', to: 'Downtown Seattle Westwood Village', value: 'Now', unit: '', live: true },
					{ badge: '40', to: 'Northgate Station Fremont', value: '4', unit: 'min', live: true },
					{ badge: '62', to: 'Sand Point East Green Lake', value: '11', unit: 'min', live: false },
				],
			},
			{
				heading: directionLabel( 'SE', '1_430', overrides ),
				stop: 'Stop No. 430',
				rows: [
					{ badge: '7', to: 'Rainier Beach Via Rainier Ave S', value: '6', unit: 'min', live: true },
					{ badge: '36', to: 'Othello Station N Beacon Hill', value: '4:44', unit: 'pm', live: false },
					{ badge: '14', to: 'Mount Baker Transit Center', value: '4:52', unit: 'pm', live: true },
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
 */
export function railBoard( time, overrides = SAMPLE_DIRECTION_OVERRIDES ) {
	return {
		mode: 'rail',
		agency: 'SOUND TRANSIT',
		stopName: "Int'l District/Chinatown",
		...time,
		groups: [
			{
				heading: directionLabel( 'N', '40_621', overrides ),
				stop: 'Stop No. 621',
				rows: [
					{ badge: '1', to: 'Lynnwood City Center', value: '3', unit: 'min', live: true },
					{ badge: '2', to: 'Lynnwood City Center', value: '7', unit: 'min', live: true },
					{ badge: '1', to: 'Lynnwood City Center', value: '12', unit: 'min', live: false },
				],
			},
			{
				heading: directionLabel( 'S', '40_623', overrides ),
				stop: 'Stop No. 623',
				rows: [
					{ badge: '1', to: 'Federal Way Downtown', value: '5', unit: 'min', live: true },
					{ badge: '2', to: 'Downtown Redmond', value: '9', unit: 'min', live: true },
					{ badge: '1', to: 'Federal Way Downtown', value: '4:52', unit: 'pm', live: false },
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
 * header block and the "as of" stamp as the device will actually get them.
 *
 * @param {object} [options]
 * @param {number} [options.nowMs]    Epoch milliseconds.
 * @param {string} [options.timezone] IANA zone.
 */
export function sampleBoards( { nowMs = REFERENCE_TIME_MS, timezone = CONFIG_DEFAULTS.timezone } = {} ) {
	const time = formatBoardTime( nowMs, timezone );

	return [
		{ slug: 'bus', title: 'Bus — 3rd Ave & Pine St', board: busBoard( time ) },
		{ slug: 'light-rail', title: "Light rail — Int'l District/Chinatown", board: railBoard( time ) },
	];
}
