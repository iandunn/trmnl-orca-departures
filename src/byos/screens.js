/**
 * The screens `/api/display` can serve.
 *
 * A working sign draws a departures board, built in `src/oba/`. The screens here are what it draws
 * instead when it cannot: a bad URL, an upstream that would not answer, or a throw on the way to the
 * board. Each is a full-panel notice rather than a board with small print, because a degraded state
 * has to be obvious from the doorway — someone glancing at the sign must see immediately that it is
 * not currently telling them when the bus comes.
 *
 * A stop that simply has no more service today is **not** one of these. That is a real answer, so it
 * stays on the board and is said in the direction band it belongs to.
 *
 * ## Every screen carries the clock, and that is a deliberate trade
 *
 * The `filename` these feed is a cache key: the device downloads and repaints only when the name
 * changes. Because the rendered notice carries a minute-resolution "Updated at" stamp, its hash
 * changes every minute, so the panel repaints every minute — which **gives up the zero-flicker
 * no-op entirely**, since at `refresh_rate: 60` that is every single poll.
 *
 * That is the chosen trade, not an oversight. Minute accuracy on the stamp is a hard requirement:
 * the stamp is the only defence against a silently frozen panel, and a stamp that can be twelve
 * hours stale on a perfectly healthy sign is indistinguishable from the failure it exists to expose.
 * A stamp finer than the poll interval would buy nothing, so one minute against a 60-second refresh
 * is exactly matched.
 */

import { formatBoardTime, formatMinuteOfDay } from '../clock.js';
import { FILENAME_TAGS } from '../filename.js';
import { DEFAULT_OVERNIGHT_VARIANT } from '../render/overnight.js';

/**
 * A screen with no clock on it.
 *
 * `formatBoardTime()` throws on a non-finite timestamp, deliberately, and the render-failed screen
 * is the one that has to be drawable when that has already happened. Blank fields beat a fabricated
 * time: a header reading `12:00 am` on a broken screen is a lie, and an empty one reads as "this
 * screen does not know", which is true.
 */
const NO_CLOCK = { weekday: '', date: '', clock: '', meridiem: '', asOf: 'unknown' };

function clockFields( timestampMs, timezone ) {
	try {
		return formatBoardTime( timestampMs, timezone );
	} catch {
		return NO_CLOCK;
	}
}

/**
 * @typedef  {object} Screen
 * @property {string} tag One of `FILENAME_TAGS`. Keeps every state's filename distinct from every
 *                        other, so the cache can never suppress a degraded screen.
 * @property {import('../render/notice.js').Notice} [notice]
 * @property {import('../render/overnight.js').Overnight} [overnight] The nightly rest screen, which
 *           has its own builder because it carries an icon and no sentence.
 * @property {boolean} [calibration] The edge test pattern from `src/render/calibration.js`.
 */

/**
 * The sign has finished for the day.
 *
 * **Built from config alone — nothing here reads a clock or calls upstream.** The times are
 * `ACTIVE_END` and `ACTIVE_START` rendered as wall-clock strings, so the screen is byte-identical
 * whenever it is served. That is also why it always reads 9:30 pm rather than 9:31 when the device's
 * wake drifts a minute past the boundary.
 *
 * The stop is deliberately not passed through. A board names it in every direction band all day; a
 * screen that says nothing else does not need to say that either.
 *
 * @param {object} options
 * @param {object} options.config    As returned by `readConfig()`.
 * @param {string} [options.variant] One of `OVERNIGHT_VARIANT_NAMES`.
 * @param {Array}  [options.rows]    Tomorrow's first departures, for the variant that draws them.
 *                                   Nothing produces these outside the preview yet: they need
 *                                   OneBusAway's `schedule-for-stop`, and calling upstream overnight
 *                                   is the property this screen exists to protect.
 * @returns {Screen}
 */
export function overnightScreen( { config, variant = DEFAULT_OVERNIGHT_VARIANT, rows = [] } ) {
	const opens = formatMinuteOfDay( config.activeStartMinutes );

	return {
		tag: FILENAME_TAGS.overnight,
		overnight: {
			variant,
			resumeClock: opens.clock,
			resumeMeridiem: opens.meridiem,
			resumeLabel: opens.label,
			rows,
		},
	};
}

/**
 * The edge test pattern, in place of everything but the malformed-URL screen while `CALIBRATION_SCREEN`
 * is set.
 *
 * @returns {Screen}
 */
export function calibrationScreen() {
	return { tag: FILENAME_TAGS.calibration, calibration: true };
}

/**
 * OneBusAway could not be reached, or answered with nothing usable, for every stop on the board.
 *
 * Distinct from a board whose groups are all empty, which uses `FILENAME_TAGS.noDepartures` and stays
 * a board: "no more buses today" is an answer and "we could not ask" is a fault, and a reader has to
 * be able to tell them apart from across the room.
 *
 * A *partial* failure never reaches here: one stop answering is enough for a board, and the stop that
 * did not gets its own line in its own band.
 *
 * @param {object} options
 * @param {number} options.nowMs
 * @param {string} options.timezone
 * @param {string} options.stopLabel
 * @returns {Screen}
 */
export function upstreamFailedScreen( { nowMs, timezone, stopLabel } ) {
	return {
		tag: FILENAME_TAGS.upstreamFailed,
		notice: {
			headline: 'No live arrivals',
			detail: 'OneBusAway is not answering. Departure times are unavailable.',
			stopName: stopLabel,
			...clockFields( nowMs, timezone ),
		},
	};
}

/**
 * The token was right and the rest of the URL was not.
 *
 * **This is the screen that pays for the whole "opaque before auth, helpful after" split.** Before
 * the token matches, every rejection is a byte-identical 404 so nothing leaks which half was right.
 * Once it matches, the caller is the owner, and the single most likely mistake they can make is a
 * typo in the base URL typed into the captive portal — which produces exactly this. A 404 there is
 * a sign that does nothing for seven minutes with no clue why; a board naming the wrong segment is
 * a fix in seconds.
 *
 * @param {object} options
 * @param {number} options.nowMs
 * @param {string} options.timezone
 * @param {string} options.reason One of `REJECTION_REASONS` from `src/abuse.js`.
 * @returns {Screen}
 */
export function badRequestScreen( { nowMs, timezone, reason } ) {
	return {
		tag: FILENAME_TAGS.badPath,
		notice: {
			headline: 'Check the sign URL',
			detail: `The server address is wrong: ${ describeReason( reason ) }.`,
			stopName: 'Re-enter it in the WiFi setup portal',
			...clockFields( nowMs, timezone ),
		},
	};
}

/**
 * `REJECTION_REASONS` slugs as something readable from across a room.
 *
 * Deliberately not a lookup keyed by importing `REJECTION_REASONS` — the sentence has to survive an
 * unrecognised slug, because a new reason added upstream must degrade to a vague board rather than
 * `undefined` on the glass.
 */
function describeReason( reason ) {
	const sentences = {
		'missing-agency-segment': 'the /agency/ part is missing',
		'invalid-agency': 'the agency must be a number, like 1 for King County Metro',
		'missing-stop-segment': 'the /stop/ part is missing',
		'invalid-stop-id': 'a stop ID has characters that are not allowed',
		'too-many-stops': 'no more than two stops, separated by a comma',
		'malformed-escape': 'it contains a broken % escape',
		'unknown-route': 'the part after the stop is not one this server serves',
	};

	return sentences[ reason ] ?? 'it is not in the expected format';
}

/**
 * Something threw on the way to a board. The endpoint must never fail — a 500 leaves the device with
 * no `refresh_rate`, which hot-loops it flat — so every throw lands here instead.
 *
 * @param {object} options
 * @param {number} options.nowMs
 * @param {string} options.timezone
 * @param {string} options.stopLabel
 * @returns {Screen}
 */
export function renderFailedScreen( { nowMs, timezone, stopLabel } ) {
	return {
		tag: FILENAME_TAGS.renderFailed,
		notice: {
			headline: 'Sign error',
			detail: 'The server could not build this screen. Check the logs.',
			stopName: stopLabel,
			...clockFields( nowMs, timezone ),
		},
	};
}
