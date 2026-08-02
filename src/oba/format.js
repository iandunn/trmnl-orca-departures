/**
 * How far away a departure is, as the two strings a row draws.
 *
 * Kept in its own module and fed only a timestamp, because this is the one presentation rule most
 * likely to be revisited: the mapper hands rows a `departsAtMs` and never a formatted string, so
 * changing the ladder is a change to this file alone.
 *
 * ## The thresholds are measured, not chosen
 *
 * Read off King County Metro's own Connectpoint signs, in the photographs kept at
 * `.claude/tmp/cpu-spike/metro official/`. Every photo carries the current time in its header, so
 * each row is a data point:
 *
 * | Photo                     | Header  | Largest `N min` | Smallest clock time |
 * | ------------------------- | ------- | --------------- | ------------------- |
 * | `7214b1e1…`               | 6:52 am | 9 min           | —                   |
 * | `Screenshot …12.12.38 AM` | 4:11 pm | 8 min           | —                   |
 * | `0358e155…`               | 6:50 am | 8 min           | 7:03 am (13 min)    |
 * | `Screenshot …12.12.28 AM` | 3:51 pm | 7 min           | 4:03 pm (12 min)    |
 * | `Screenshot …12.12.14 AM` | 5:03 pm | 2 min           | 5:14 pm (11 min)    |
 * | `King-County-Metro-Blog`  | 4:07 pm | 4 min           | 4:26 pm (19 min)    |
 *
 * So the real sign counts minutes up to at least 9 and is showing clock times by 11. The owner's
 * call resolved the unobserved boundary: **10 counts, 11 does not.**
 *
 * The same photographs settle a second thing for free — `Scheduled 2 min`, `Scheduled 4 min` and
 * `Scheduled 8 min` all appear, so the ladder is a function of *time distance only*. Whether a
 * prediction is live never changes the format, only the `Scheduled` label above it.
 */

import { formatClockTime } from '../clock.js';

const MS_PER_MINUTE = 60000;

/** The last minute count that still counts. Above this the row shows a clock time. */
const LAST_COUNTED_MINUTE = 10;

/**
 * How far past its time a departure may be and still read as `Now`.
 *
 * Real predictions go negative routinely — the first departure in every captured fixture is a bus
 * already at the kerb, its `predictedArrivalTime` a minute or so in the past. Metro shows those as
 * `Now`, which is what a rider watching the bus door sees. Treating them as gone instead would blank
 * the most useful row on the board at exactly the moment it matters.
 */
export const NOW_GRACE_MS = 60000;

/**
 * @param {number} departsAtMs
 * @param {number} nowMs
 * @param {string} timezone
 * @returns {{ value: string, unit: string }} `unit` is empty for `Now`, which draws the value alone.
 */
export function formatDeparture( departsAtMs, nowMs, timezone ) {
	// Floored rather than rounded, so a bus 90 seconds out reads `1 min` and not `2`. Understating
	// the wait sends someone to the kerb early; overstating it lets them watch the bus leave.
	const minutes = Math.floor( ( departsAtMs - nowMs ) / MS_PER_MINUTE );

	if ( minutes < 1 ) {
		return { value: 'Now', unit: '' };
	}

	if ( minutes <= LAST_COUNTED_MINUTE ) {
		return { value: String( minutes ), unit: 'min' };
	}

	const { clock, meridiem } = formatClockTime( departsAtMs, timezone );

	return { value: clock, unit: meridiem };
}

/**
 * Whether a departure is still worth drawing.
 *
 * @param {number} departsAtMs
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isUpcoming( departsAtMs, nowMs ) {
	return Number.isFinite( departsAtMs ) && departsAtMs >= nowMs - NOW_GRACE_MS;
}
