/**
 * `GET /api/display` — the endpoint the whole sign hangs off.
 *
 * Called on whatever interval the previous response set, roughly 1440 times a day. Three fields have
 * to be right *together*, which is why the BYOS endpoints were never built one at a time:
 *
 * - **`status: 0`.** The firmware's dispatch switch handles `0`, `202` and `500` and nothing else —
 *   every other value falls through `default: break;` and the entire response is discarded, so
 *   `{"status": 200}`, the obvious thing to write, silently throws away the image. The field is read
 *   from the JSON body, not the HTTP status line. **`/api/setup` is the exact opposite and wants
 *   200**; see `setup.js`.
 * - **`refresh_rate`.** Absent parses as `0`, is written to NVS, and the device hot-loops with no
 *   sleep until the battery is flat — and it stays wedged across power cycles. Verified against
 *   upstream's own parser test: a body without the field yields `refresh_rate = 0`.
 * - **`filename`.** The cache key. See `src/filename.js`, and `currentScreen()` below for what it is
 *   computed over and why that is the whole flicker budget.
 *
 * **Nothing may throw out of here.** A 500 carries no `refresh_rate`, which is the flat-battery
 * case, so every failure path ends in a degraded screen with a valid body instead.
 *
 * Two fields are deliberately never sent. `reset_firmware` factory-resets the device — it clears
 * WiFi credentials, the api key and the cached filename and reboots into the captive portal — and
 * `update_firmware` starts an OTA. Both default to false when absent, so the safest way to send
 * `false` is to not send them at all: a field that is not in the object cannot be typo'd into a
 * destructive value.
 */

import { readConfig } from '../config.js';
import { buildFilename, FILENAME_TAGS, stableEpoch } from '../filename.js';
import { loadBoard } from '../oba/index.js';
import { buildBoardSvg } from '../render/board.js';
import { buildNoticeSvg } from '../render/notice.js';
import { buildOvernightSvg } from '../render/overnight.js';
import { currentSchedule, SCHEDULE_MODES } from '../schedule.js';
import { badRequestScreen, overnightScreen, renderFailedScreen, upstreamFailedScreen } from './screens.js';

/** JSON, and never a bare object — `status` has to be in the body of every single response. */
function displayResponse( body ) {
	return new Response( JSON.stringify( body ), {
		headers: { 'Content-Type': 'application/json' },
	} );
}

/**
 * A description of the stop for a notice screen's footer.
 *
 * **What the agency prints on the pole, not the OneBusAway id.** These stop codes go on the glass, and
 * `40_621 / 40_623` reads as debug output — on the one screen a reader is looking at, at the moment
 * the sign is already degraded. The agency prefix is ours, not theirs: it says which regional feed the
 * stop came from, which is meaningless to someone standing at it.
 *
 * `Stop No.` is said once rather than per stop, matching the direction bands on a working board.
 *
 * Safe to draw — it is the owner's own sign — and safe to record, since `/stats` already prints stop
 * IDs by decision. Never put it in a raw path, which is what `redactPath()` and `safeProbePath()` are
 * for. `toOneBusAwayId()` remains the right call for anything addressed *to* OneBusAway.
 */
export function stopLabel( parsed ) {
	return `Stop No. ${ parsed.stopIds.join( ' / ' ) }`;
}

/**
 * The image URL must sit under the device's stored base URL.
 *
 * The firmware's auth test is a raw `strncmp` of the image URL against that base over the base's
 * length — no parsing, no normalisation. An image URL that diverges before the end of the prefix
 * silently loses its `Access-Token`, and a cross-host one loses it outright. Building from
 * `basePath`, which is assembled from the raw path segments, is what keeps the comparison true —
 * including on the malformed-path screen, where the base is whatever was mistyped and the image URL
 * has to match that same mistake to be fetched at all.
 */
export function imageUrl( request, basePath, filename ) {
	return `${ new URL( request.url ).origin }${ basePath }/image/${ filename }`;
}

/**
 * A departures board, or the notice that stands in for one.
 *
 * The empty board is deliberately still a board: "no more departures today" is a real answer, said in
 * the band of the direction it applies to, and a full-panel notice would throw away the other
 * direction's rows to say it. Only the tag changes, which is what keeps its filename distinct from a
 * board with departures on it.
 */
async function departuresScreen( parsed, env, config, nowMs, allowStale ) {
	const result = await loadBoard( { env, config, parsed, nowMs, allowStale } );

	// Carried on the screen rather than returned separately, so it survives whichever branch is taken
	// and reaches `recordOutcome()` without a second channel. It never affects what is drawn — a
	// reader does not need to know it was a 429 — and it is not part of the filename for the same
	// reason: two outages that look identical on the glass must not make the panel repaint.
	const { upstreamReason = '' } = result;

	if ( ! result.ok ) {
		return {
			...upstreamFailedScreen( {
				nowMs,
				timezone: config.timezone,
				stopLabel: stopLabel( parsed ),
			} ),
			upstreamReason,
		};
	}

	return {
		tag: result.empty ? FILENAME_TAGS.noDepartures : FILENAME_TAGS.departures,
		board: result.board,
		upstreamReason,
	};
}

/** A board, the nightly rest screen, or a notice — one builder each, chosen by what is present. */
function screenSvg( screen ) {
	if ( screen.board ) {
		return buildBoardSvg( screen.board );
	}

	if ( screen.overnight ) {
		return buildOvernightSvg( screen.overnight );
	}

	return buildNoticeSvg( screen.notice );
}

/**
 * Which of the three screens this request gets.
 *
 * The order is the design, not an accident:
 *
 * 1. **A malformed URL wins over everything**, including the schedule. The one thing this screen
 *    exists for is a base URL mistyped at the captive portal, and pairing happens whenever the owner
 *    is standing there — including at 10pm. A moon in place of the diagnostic would turn a two-second
 *    fix into a mystery until morning.
 * 2. **Outside the active window, we do not call OneBusAway at all.** The rest screen is built from
 *    config, so there is no upstream request to fail, which is what makes it impossible for an outage
 *    at 9:30 pm to pin an error screen to the glass all night.
 * 3. Otherwise, departures.
 */
async function chooseScreen( target, env, config, nowMs, allowStale ) {
	if ( ! target.parsed ) {
		return badRequestScreen( { nowMs, timezone: config.timezone, reason: target.reason } );
	}

	if ( currentSchedule( { nowMs, config } ).mode === SCHEDULE_MODES.overnight ) {
		return overnightScreen( { config } );
	}

	return departuresScreen( target.parsed, env, config, nowMs, allowStale );
}

/**
 * Chooses the screen, renders its SVG, and derives the cache key from it.
 *
 * Exported so `/image` can rebuild the identical screen without a second copy of this logic — the
 * two endpoints must agree, or the device downloads bytes that do not match the name it cached them
 * under.
 *
 * **The hash is taken over the SVG, which is the literal contract in `src/filename.js`: the name
 * changes exactly when the image changes.** An earlier version hashed an abstract "identity" that
 * excluded the clock, to buy zero-flicker no-ops on an unchanging screen. That was withdrawn because
 * it let the "Updated at" stamp go up to twelve hours stale on a perfectly healthy sign, which is
 * precisely the appearance the stamp exists to rule out. Building the SVG costs ~0 ms — rasterising
 * is the expensive step and does not happen here — so this is cheap as well as correct.
 *
 * @param {object}  target             `{ parsed }` for a good request, `{ reason }` for a malformed one.
 * @param {object}  env
 * @param {number}  nowMs
 * @param {object}  [options]
 * @param {boolean} [options.allowStale] Fall back to the last good upstream response when a fresh
 *                                       fetch fails. `/image` sets it; see `src/oba/memo.js`.
 * @returns {Promise<{ screen: import('./screens.js').Screen, svg: string, filename: string }>}
 */
export async function currentScreen( target, env, nowMs, { allowStale = false } = {} ) {
	const config = readConfig( env );
	const { timezone } = config;

	let screen;
	let svg;

	// Building the SVG is inside the same guard as choosing the screen, because a board assembled from
	// upstream data can throw on the way to markup just as readily as fetching it can.
	try {
		screen = await chooseScreen( target, env, config, nowMs, allowStale );
		svg = screenSvg( screen );
	} catch ( error ) {
		console.log( JSON.stringify( { event: 'byos-screen-failed', message: String( error ) } ) );

		screen = renderFailedScreen( { nowMs, timezone, stopLabel: '' } );
		svg = buildNoticeSvg( screen.notice );
	}

	return {
		screen,
		svg,
		filename: buildFilename( {
			tag: screen.tag,
			content: svg,
			epochSeconds: stableEpoch( Math.floor( nowMs / 1000 ) ),
		} ),
	};
}

/**
 * @param {Request} request
 * @param {object}  target   `{ parsed }` or `{ reason }`, plus the `basePath` to build URLs from.
 * @param {object}  env
 * @returns {Promise<{ response: Response, tag: string }>}
 */
export async function handleDisplay( request, target, env ) {
	const config = readConfig( env );
	const nowMs = Date.now();

	let filename;
	let tag = '';
	let upstreamReason = '';

	// Guarded even though `currentSchedule()` is pure arithmetic over a validated timezone and a
	// `Date.now()` that cannot be non-finite. It is not defending against a known throw — it is
	// defending against this field ever being absent, and an absent `refresh_rate` parses as 0, is
	// written to NVS, and hot-loops the device flat across power cycles. The active rate is the safe
	// fallback: worse for battery than a night's sleep, and harmless.
	let refreshSeconds = config.refreshActiveSeconds;

	try {
		refreshSeconds = currentSchedule( { nowMs, config } ).refreshSeconds;
	} catch ( error ) {
		console.log( JSON.stringify( { event: 'byos-schedule-failed', message: String( error ) } ) );
	}

	try {
		( { filename, screen: { tag, upstreamReason = '' } = {} } = await currentScreen( target, env, nowMs ) );
	} catch ( error ) {
		// The last resort. `buildFilename` throws on a bad tag or a bad epoch, and even that must not
		// reach the device as a 500 — a fixed name is a frozen panel, which is survivable; a missing
		// `refresh_rate` is a dead battery, which is not.
		console.log( JSON.stringify( { event: 'byos-display-filename-failed', message: String( error ) } ) );

		filename = `rnderrs-000000-${ stableEpoch( Math.floor( nowMs / 1000 ) ) }`;
	}

	return {
		tag,
		upstreamReason,
		response: displayResponse( {
			status: 0,
			image_url: imageUrl( request, target.basePath, filename ),
			filename,
			// Computed above rather than threaded out of `currentScreen()`, which needs the same answer
			// to pick the screen. `currentSchedule()` is pure and both calls pass the same `nowMs`, so
			// the two cannot disagree, and this one still has a value when the screen above threw.
			refresh_rate: refreshSeconds,
		} ),
	};
}
