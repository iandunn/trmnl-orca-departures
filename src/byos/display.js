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
import { buildFilename, stableEpoch } from '../filename.js';
import { buildNoticeSvg } from '../render/notice.js';
import { toOneBusAwayId } from '../routing.js';
import { awaitingDataScreen, badRequestScreen, renderFailedScreen } from './screens.js';

/** JSON, and never a bare object — `status` has to be in the body of every single response. */
function displayResponse( body ) {
	return new Response( JSON.stringify( body ), {
		headers: { 'Content-Type': 'application/json' },
	} );
}

/**
 * A description of the stop for the footer.
 *
 * Safe to draw on the glass — it is the owner's own sign — and safe to record, since `/stats`
 * already prints stop IDs by decision. Never put it in a raw path, which is what `redactPath()` and
 * `safeProbePath()` exist for.
 */
export function stopLabel( parsed ) {
	return parsed.stopIds.map( ( stopId ) => toOneBusAwayId( parsed.agency, stopId ) ).join( ' / ' );
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
 * @param {object} target        `{ parsed }` for a good request, `{ reason }` for a malformed one.
 * @param {object} env
 * @param {number} nowMs
 * @returns {{ screen: import('./screens.js').Screen, svg: string, filename: string }}
 */
export function currentScreen( target, env, nowMs ) {
	const { timezone } = readConfig( env );

	let screen;

	try {
		if ( target.parsed ) {
			// Live OneBusAway data is the next piece of work; until it exists this is the honest
			// screen, and it is a real degraded state rather than a placeholder.
			screen = awaitingDataScreen( { nowMs, timezone, stopLabel: stopLabel( target.parsed ) } );
		} else {
			screen = badRequestScreen( { nowMs, timezone, reason: target.reason } );
		}
	} catch {
		screen = renderFailedScreen( { nowMs, timezone, stopLabel: '' } );
	}

	const svg = buildNoticeSvg( screen.notice );

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

	try {
		( { filename, screen: { tag } = {} } = currentScreen( target, env, nowMs ) );
	} catch ( error ) {
		// The last resort. `buildFilename` throws on a bad tag or a bad epoch, and even that must not
		// reach the device as a 500 — a fixed name is a frozen panel, which is survivable; a missing
		// `refresh_rate` is a dead battery, which is not.
		console.log( JSON.stringify( { event: 'byos-display-filename-failed', message: String( error ) } ) );

		filename = `rnderrs-000000-${ stableEpoch( Math.floor( nowMs / 1000 ) ) }`;
	}

	return {
		tag,
		response: displayResponse( {
			status: 0,
			image_url: imageUrl( request, target.basePath, filename ),
			filename,
			// One rate for now. Windowing it against `activeStartMinutes` / `activeEndMinutes`, and the
			// overnight "seconds until morning", is step 8 of the task order in
			// `docs/plans/initial-plan.md` — deliberately not half-built here.
			refresh_rate: config.refreshActiveSeconds,
		} ),
	};
}
