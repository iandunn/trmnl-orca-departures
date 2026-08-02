/**
 * The nightly rest screen, once per variant, so they can be judged side by side as images.
 *
 * They exist because the choice is a visual one and this project's rule is to look at the render
 * rather than at a description of it — a plate that reads clearly at 940px in a browser can be a
 * smudge at 227 PPI across a room, and the only way to know is to put them next to each other.
 *
 * Everything except the layout is identical between them, and the times come from `CONFIG_DEFAULTS`
 * rather than a fixture, so the samples carry the real sentence the real sign will carry.
 */

import { overnightScreen } from '../byos/screens.js';
import { readConfig } from '../config.js';
import {
	buildOvernightSvg,
	LIVE_OVERNIGHT_VARIANTS,
	OVERNIGHT_VARIANT_NAMES,
} from '../render/overnight.js';

const TITLES = {
	'badge-moon': 'Overnight — the moon in the route badge',
	'badge-moon-row': 'Overnight — drawn as a departure row, opening time in the time column',
	'row-scheduled': "Overnight — the row, time column set like the board's Scheduled treatment",
	'row-scheduled-inverse': 'Overnight — the same row, inked, with stars',
	'row-band': 'Overnight — the row under a direction band, using both of its slots',
	'row-destination': 'Overnight — the full row: badge, destination column, time column',
	'badge-moon-header-time': "Overnight — with the opening time in the header's stacked slot",
	'badge-moon-inverse': 'Overnight — inked panel, everything reversed out',
	'badge-moon-inverse-stars': 'Overnight — inked, white stars, both rules, no words at all',
	'logo-plate': 'Overnight — the lockup on the badge plate, centred',
	'logo-plate-inverse': 'Overnight — the same plate, inked panel, mid-grey badge',
	'logo-plate-inverse-white': 'Overnight — the same plate, inked panel, white badge',
	'first-departures': "Overnight — tomorrow's first departures (times are placeholders)",
	'first-departures-inverse': "Overnight — tomorrow's first departures, inked (times are placeholders)",
	'first-departures-inverse-moon':
		"Overnight — tomorrow's first departures, moon scaled to what the rows leave (times are placeholders)",
};

/**
 * Illustrative rows for the `first-departures` variant.
 *
 * **Real route names and real headsigns from the public sample stops; the times are invented.** First
 * trips come from OneBusAway's `schedule-for-stop`, which nothing calls yet — see the variant in
 * `render/overnight.js` for why wiring it is a decision rather than a chore. Same footing as
 * `edge-case-boards.js`: real names, arrangement that is ours.
 */
const FIRST_TRIPS = [
	{ badge: 'D Line', to: 'Ballard Uptown', clock: '4:58', meridiem: 'am' },
	{ badge: '5', to: 'Shoreline Greenwood', clock: '5:12', meridiem: 'am' },
	{ badge: '40', to: 'Northgate Station Fremont', clock: '5:26', meridiem: 'am' },
	{ badge: '7', to: 'Rainier Beach Via Rainier Ave S', clock: '5:34', meridiem: 'am' },
];

/**
 * @param {object} [env] Read for the active window, so the samples move with config.
 * @returns {Array<{ slug: string, title: string, svg: string }>}
 */
export function overnightSamples( env ) {
	const config = readConfig( env );

	return buildSamples( config, OVERNIGHT_VARIANT_NAMES.filter( ( name ) => LIVE_OVERNIGHT_VARIANTS.includes( name ) ) );
}

/**
 * Everything that lost, kept renderable rather than deleted.
 *
 * They live on their own page so the main sheet shows what the sign actually draws — a contact sheet
 * that mixes shipped screens with rejected ones stops being a picture of the sign. The choice is
 * provisional until the panel has been seen at 227 PPI, and the runner-up is blocked on data rather
 * than on taste, so deleting them would be throwing away work that is one word from being live.
 *
 * @param {object} [env]
 * @returns {Array<{ slug: string, title: string, svg: string }>}
 */
export function parkedOvernightSamples( env ) {
	const config = readConfig( env );
	const parked = OVERNIGHT_VARIANT_NAMES.filter( ( name ) => ! LIVE_OVERNIGHT_VARIANTS.includes( name ) );

	return buildSamples( config, parked );
}

function buildSamples( config, variants ) {
	const samples = variants.map( ( variant ) => ( {
		slug: `overnight-${ variant }`,
		title: TITLES[ variant ] ?? `Overnight — ${ variant }`,
		svg: buildOvernightSvg( overnightScreen( { config, variant, rows: FIRST_TRIPS } ).overnight ),
	} ) );

	if ( ! variants.includes( 'first-departures-inverse-moon' ) ) {
		return samples;
	}

	// The scaling variant twice, because the whole point of it is what happens between these two: the
	// plate is sized from what the rows leave, so one departure and four are different compositions
	// rather than the same one with a gap in it. A single render shows neither.
	samples.push( {
		slug: 'overnight-first-departures-inverse-moon-single',
		title: "Overnight — the same, with one departure (times are placeholders)",
		svg: buildOvernightSvg(
			overnightScreen( {
				config,
				variant: 'first-departures-inverse-moon',
				rows: FIRST_TRIPS.slice( 0, 1 ),
			} ).overnight
		),
	} );

	return samples;
}
