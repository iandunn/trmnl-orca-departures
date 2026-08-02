/**
 * Wall-clock strings for the board, in the sign's configured timezone.
 *
 * `Intl.DateTimeFormat` with a `timeZone` works under workerd, so this needs no tz library and no
 * bundled tz data. Pure: it takes a timestamp and never reads a clock. That is not tidiness —
 *
 * - the "Updated at" stamp must come from OneBusAway's own `currentTime`, not our render time. If OBA
 *   serves cached predictions, stamping them with our clock claims they are fresher than they are,
 *   which is the exact lie the stamp exists to prevent.
 * - the Worker's clock is frozen for the duration of synchronous execution anyway, so there is no
 *   meaningful "now" to read from inside a render.
 */

/**
 * Parts, not a formatted string.
 *
 * Slicing a formatted `h:mm a` string looks simpler and is a trap: ICU separates the day period
 * with U+202F (narrow no-break space), not an ASCII space. Fira Sans need not carry that glyph, so
 * it would land in the PNG as tofu or a gap — and nothing short of looking at the rendered image
 * would catch it. Everything below is assembled from parts with ASCII spaces.
 */
function partsOf( timestampMs, timezone, options ) {
	const formatter = new Intl.DateTimeFormat( 'en-US', { timeZone: timezone, ...options } );
	const found = {};

	for ( const part of formatter.formatToParts( new Date( timestampMs ) ) ) {
		found[ part.type ] = part.value;
	}

	return found;
}

/**
 * A wall-clock time as the two pieces the board draws separately.
 *
 * The meridiem is set at its own size and weight beside the numerals, so it has to arrive as its own
 * string rather than being sliced back off a formatted one — see the U+202F note above for what
 * slicing costs.
 *
 * @param {number} timestampMs
 * @param {string} timezone
 * @returns {{ clock: string, meridiem: string }}
 */
export function formatClockTime( timestampMs, timezone ) {
	if ( ! Number.isFinite( timestampMs ) ) {
		throw new TypeError( `formatClockTime needs epoch milliseconds, got ${ JSON.stringify( timestampMs ) }` );
	}

	const time = partsOf( timestampMs, timezone, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	} );

	return {
		clock: `${ time.hour }:${ time.minute }`,
		meridiem: ( time.dayPeriod ?? '' ).toLowerCase(),
	};
}

/**
 * Where an instant falls in its local day, as minutes since local midnight.
 *
 * The scheduler compares against `activeStartMinutes` / `activeEndMinutes`, which `readConfig()`
 * already stores in this form, so this is the other half of that comparison.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which is not the same thing: the latter leaves ICU
 * free to use the h24 cycle, where midnight formats as `24` rather than `00` and every overnight
 * comparison would be off by a day. The modulo is belt and braces on top of that.
 *
 * @param {number} timestampMs
 * @param {string} timezone
 * @returns {number} 0-1439.
 */
export function localMinutesSinceMidnight( timestampMs, timezone ) {
	if ( ! Number.isFinite( timestampMs ) ) {
		throw new TypeError(
			`localMinutesSinceMidnight needs epoch milliseconds, got ${ JSON.stringify( timestampMs ) }`
		);
	}

	const time = partsOf( timestampMs, timezone, {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	} );

	return ( Number( time.hour ) % 24 ) * 60 + Number( time.minute );
}

/**
 * A configured wall-clock time as the pieces the header and the stamp draw.
 *
 * Arithmetic rather than `Intl`, which is the one place in this file that is not, and deliberately:
 * there is no instant here to format. `ACTIVE_END` is a time of day, not a moment, so the `Intl` path
 * would mean inventing an epoch that lands on it in the configured zone — which is exactly the
 * DST-sensitive search `src/schedule.js` exists to contain, spent to produce a string that does not
 * depend on the answer.
 *
 * That is what makes the overnight screen a pure function of config: it renders identically no matter
 * when it is served, so its bytes and therefore its `filename` never move.
 *
 * @param {number} minuteOfDay 0-1439, as `readConfig()` stores the active window.
 * @returns {{ clock: string, meridiem: string, label: string }}
 */
export function formatMinuteOfDay( minuteOfDay ) {
	if ( ! Number.isInteger( minuteOfDay ) || minuteOfDay < 0 || minuteOfDay > 1439 ) {
		throw new RangeError( `formatMinuteOfDay needs 0-1439, got ${ JSON.stringify( minuteOfDay ) }` );
	}

	const hour24 = Math.floor( minuteOfDay / 60 );
	const minute = String( minuteOfDay % 60 ).padStart( 2, '0' );
	const clock = `${ hour24 % 12 === 0 ? 12 : hour24 % 12 }:${ minute }`;
	const meridiem = hour24 < 12 ? 'am' : 'pm';

	return { clock, meridiem, label: `${ clock } ${ meridiem }` };
}

/**
 * The four header fields plus the "Updated at" stamp.
 *
 * The date carries **no comma** after the weekday, matching Metro's own sign, and the weekday and
 * date are stacked separately in the header rather than being one string — together they are what
 * catches a panel frozen since yesterday, which a bare `h:mm` cannot.
 *
 * @param {number} timestampMs Epoch milliseconds. For `asOf` this must be the moment the data was
 *                             generated upstream, never the render time.
 * @param {string} timezone    IANA zone, already validated by `readConfig`.
 * @returns {{ weekday: string, date: string, clock: string, meridiem: string, asOf: string }}
 */
export function formatBoardTime( timestampMs, timezone ) {
	if ( ! Number.isFinite( timestampMs ) ) {
		throw new TypeError( `formatBoardTime needs epoch milliseconds, got ${ JSON.stringify( timestampMs ) }` );
	}

	const day = partsOf( timestampMs, timezone, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
	} );

	const { clock, meridiem } = formatClockTime( timestampMs, timezone );

	return {
		weekday: day.weekday,
		date: `${ day.month } ${ day.day }`,
		clock,
		meridiem,
		asOf: `${ clock } ${ meridiem }`.trim(),
	};
}
