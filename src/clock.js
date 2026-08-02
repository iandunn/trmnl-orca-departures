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
