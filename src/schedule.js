/**
 * When the sign is awake, and how long it sleeps when it is not.
 *
 * `refresh_rate` is the only lever the server has over battery life and panel wear, and it is the
 * field with the worst failure mode in the whole contract: absent or zero parses as 0, is written to
 * NVS, and the device hot-loops with no sleep until the battery is flat — surviving power cycles,
 * because the 0 persisted. So this module's job is to always return a usable number of seconds, for
 * any clock and any configuration, without throwing.
 *
 * Pure, and takes the timestamp rather than reading a clock, for the same reason `clock.js` does.
 *
 * ## The schedule is two states, not three
 *
 * Inside the active window the sign polls at `refreshActiveSeconds`. Outside it, the sign sleeps
 * until the window opens again — one wake, not a slower cadence. There is no third off-peak tier,
 * which is why `REFRESH_IDLE_SECONDS` no longer exists: with overnight collapsed to a single sleep,
 * nothing could consume it.
 *
 * **Outside the window the Worker never calls OneBusAway at all.** The overnight screen is built from
 * config alone, so an upstream outage at 9:30 pm cannot pin an error screen to the glass for nine
 * hours — we do not ask, so there is nothing to fail. That is worth more than the saved quota.
 *
 * ## Daylight saving is the entire difficulty
 *
 * `refresh_rate` is a duration, so DST cannot touch the active cadence: 60 seconds is 60 seconds in
 * March as in July. The whole exposure is the one computation "seconds until the next 6:30 am local",
 * and the tempting version of it is wrong:
 *
 *     ( activeStartMinutes + 1440 - nowMinutes ) * 60
 *
 * That assumes every night is 24 hours. Spring-forward night is 23 and fall-back is 25, so twice a
 * year the sign would wake an hour off — and since the sleep is only recomputed on the next
 * successful poll, it would stay wrong for that whole morning.
 *
 * JavaScript can convert an instant to local wall-clock time but not the reverse, so the fix is to
 * guess and correct: project the naive delta, format the result back in the configured zone, and
 * shift by whatever it is off. One correction is always enough in practice — a transition moves the
 * wall clock by an hour, not by an unpredictable amount — and the loop is bounded anyway rather than
 * trusting that.
 */

import { localMinutesSinceMidnight } from './clock.js';

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60000;

/**
 * A little past the window opening rather than exactly on it.
 *
 * The device wakes on its own timer, which drifts, and landing a second early means the waking poll
 * still reads as outside the window. That is self-correcting — this same function would then return
 * a sleep of about a minute rather than another whole day, because the next opening is a minute away
 * and not tomorrow's — but a nap on the boundary every morning is noise in the logs for nothing.
 */
const WAKE_MARGIN_SECONDS = 60;

/**
 * No single sleep may exceed a day.
 *
 * A backstop against a pathological `Intl` result rather than against any configuration: the longest
 * legitimate value is a shade under 24 hours plus the margin. Clamping slightly short is the safe
 * direction — the device wakes a touch early and takes one short nap, which costs a wake, whereas
 * clamping long would leave the sign dark past its own opening time.
 */
const MAX_SLEEP_SECONDS = 24 * 60 * 60;

/** Nothing below this may reach the wire. See the file header for what a 0 does. */
const MIN_SLEEP_SECONDS = 1;

/** How many times the DST correction may re-check before giving up and using what it has. */
const MAX_CORRECTIONS = 3;

export const SCHEDULE_MODES = Object.freeze( {
	active: 'active',
	overnight: 'overnight',
} );

/**
 * Whether a minute of the day falls inside the active window.
 *
 * Handles a window that wraps midnight (`ACTIVE_END` before `ACTIVE_START`), which no deployment here
 * uses but which a fork on a night shift would. Equal start and end reads as **always awake** rather
 * than never — the two are equally arbitrary as a reading of a zero-length window, and one of them
 * leaves a sign that shows departures while the other leaves a sign that never does.
 *
 * @param {number} minuteOfDay
 * @param {number} startMinutes
 * @param {number} endMinutes
 * @returns {boolean}
 */
export function isWithinActiveWindow( minuteOfDay, startMinutes, endMinutes ) {
	if ( startMinutes === endMinutes ) {
		return true;
	}

	if ( startMinutes < endMinutes ) {
		return minuteOfDay >= startMinutes && minuteOfDay < endMinutes;
	}

	return minuteOfDay >= startMinutes || minuteOfDay < endMinutes;
}

/**
 * The next instant whose local wall clock reads `targetMinutes`, in the configured zone.
 *
 * See the file header for why this is a search rather than arithmetic. The seconds of `fromMs` are
 * carried through unchanged, so the result lands a few seconds into the target minute rather than on
 * its edge, which is the desirable side of the boundary to be on.
 *
 * @param {number} fromMs
 * @param {number} targetMinutes
 * @param {string} timezone
 * @returns {number} Epoch milliseconds, always strictly after `fromMs`.
 */
export function nextOccurrenceMs( fromMs, targetMinutes, timezone ) {
	const nowMinutes = localMinutesSinceMidnight( fromMs, timezone );
	const naiveDelta = targetMinutes - nowMinutes;

	let candidate = fromMs + ( naiveDelta > 0 ? naiveDelta : naiveDelta + MINUTES_PER_DAY ) * MS_PER_MINUTE;

	for ( let attempt = 0; attempt < MAX_CORRECTIONS; attempt++ ) {
		const drift = signedMinutesApart( localMinutesSinceMidnight( candidate, timezone ), targetMinutes );

		if ( drift === 0 ) {
			break;
		}

		candidate -= drift * MS_PER_MINUTE;
	}

	return candidate;
}

/**
 * How far `minuteOfDay` is from `targetMinutes`, taking the shorter way round midnight.
 *
 * Without the wrap a correction across midnight would read as 23 hours in the wrong direction and
 * send the candidate a day away — which is the failure this whole search exists to avoid, arriving
 * by a different door.
 */
function signedMinutesApart( minuteOfDay, targetMinutes ) {
	const raw = minuteOfDay - targetMinutes;

	if ( raw > MINUTES_PER_DAY / 2 ) {
		return raw - MINUTES_PER_DAY;
	}

	if ( raw < -MINUTES_PER_DAY / 2 ) {
		return raw + MINUTES_PER_DAY;
	}

	return raw;
}

/**
 * @param {object} options
 * @param {number} options.nowMs
 * @param {object} options.config As returned by `readConfig()`.
 * @returns {{
 *   mode: 'active'|'overnight',
 *   refreshSeconds: number,
 *   resumeAtMs: number|null,
 * }} `resumeAtMs` is the exact instant the window next opens, with no wake margin on it, because it
 *    is what the overnight screen prints. The margin belongs to the sleep, not to the promise.
 */
export function currentSchedule( { nowMs, config } ) {
	const { activeStartMinutes, activeEndMinutes, refreshActiveSeconds, timezone } = config;

	if ( isWithinActiveWindow( localMinutesSinceMidnight( nowMs, timezone ), activeStartMinutes, activeEndMinutes ) ) {
		return {
			mode: SCHEDULE_MODES.active,
			refreshSeconds: refreshActiveSeconds,
			resumeAtMs: null,
		};
	}

	const resumeAtMs = nextOccurrenceMs( nowMs, activeStartMinutes, timezone );
	const untilResume = Math.round( ( resumeAtMs - nowMs ) / 1000 ) + WAKE_MARGIN_SECONDS;

	return {
		mode: SCHEDULE_MODES.overnight,
		refreshSeconds: Math.min( Math.max( untilResume, MIN_SLEEP_SECONDS ), MAX_SLEEP_SECONDS ),
		resumeAtMs,
	};
}
