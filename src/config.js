/**
 * The deployment's configuration, read from the Worker environment.
 *
 * Nothing else in the app should touch `env` for a display or scheduling value. The rule in
 * `CLAUDE.md` is that no deployment-specific value may be a literal in the code — someone should be
 * able to fork this, point it at a stop in another city with different hours, and change only
 * config. Reading through one function is what makes that checkable: the defaults below are the
 * complete list of what a fork can vary.
 *
 * **Everything is coerced and range-checked here, and nothing throws.** `/api/display` runs ~1440
 * times a day and must never fail, so a malformed value falls back to its default rather than
 * taking the endpoint down. That matters more than it looks: the same name arrives as a **number**
 * from `[vars]` in `wrangler.toml` and as a **string** from `.dev.vars` or `wrangler secret put`,
 * so every read has to survive both.
 *
 * **Secrets are deliberately absent.** `DEVICE_TOKEN` and `OBA_API_KEY` stay on `env` and are read
 * at their point of use, so there is no object holding a credential that some future log line can
 * serialise wholesale. `directionOverrides` is the one privacy-sensitive value that has to live
 * here, because the renderer needs it — never log this object.
 */

/**
 * Fallbacks for a Worker where a var is unset or malformed. Defaults are allowed; literals
 * elsewhere in the code are not.
 *
 * These describe *this* sign, so a fork edits `wrangler.toml` rather than this file. They are
 * duplicated from the `[vars]` block on purpose — that block is the deployed value and this is the
 * behaviour when it is missing, which is not the same thing.
 */
export const CONFIG_DEFAULTS = {
	timezone: 'America/Los_Angeles',
	activeStart: '06:30',
	activeEnd: '21:30',
	refreshActiveSeconds: 60,
	obaBaseUrl: 'https://api.pugetsound.onebusaway.org/api/where',
	tarpitMs: 25000,
};

/**
 * `refresh_rate` is unclamped by the firmware and an absent or zero value makes the device hot-loop
 * with no sleep until the battery is flat — a state that persists across power cycles because it is
 * written to NVS. So a nonsense refresh rate must never reach the wire; one second is the floor.
 */
const MIN_REFRESH_SECONDS = 1;

function trimmedString( value, fallback ) {
	if ( typeof value !== 'string' ) {
		return fallback;
	}

	const trimmed = value.trim();

	return trimmed === '' ? fallback : trimmed;
}

function positiveInteger( value, fallback ) {
	const parsed = typeof value === 'number' ? value : Number.parseInt( String( value ?? '' ).trim(), 10 );

	if ( ! Number.isFinite( parsed ) || parsed < MIN_REFRESH_SECONDS ) {
		return fallback;
	}

	return Math.floor( parsed );
}

/**
 * `HH:MM` in local time, as minutes since midnight — the form the scheduler actually compares.
 * Parsing here rather than at the comparison keeps the validation in one place.
 *
 * @returns {number} Minutes since local midnight, 0-1439.
 */
function minutesSinceMidnight( value, fallback ) {
	const match = /^(\d{1,2}):(\d{2})$/.exec( trimmedString( value, '' ) );

	if ( ! match ) {
		return minutesSinceMidnight( fallback, '00:00' );
	}

	const hour = Number( match[ 1 ] );
	const minute = Number( match[ 2 ] );

	// Both halves are range-checked, not just the total: `06:60` would otherwise pass as 07:00.
	if ( hour > 23 || minute > 59 ) {
		return minutesSinceMidnight( fallback, '00:00' );
	}

	return hour * 60 + minute;
}

/**
 * How long an obviously hostile request is held before its 404.
 *
 * Configuration rather than a constant for two reasons beyond the project's no-literals rule. It is
 * the one knob that trades bot cost against Worker concurrency — a held request occupies an
 * invocation, so a large enough flood could crowd out the device's own poll, and the documented
 * mitigation is to lower this. And it lets the tests exercise the tarpit without waiting 25 seconds.
 *
 * **Zero disables the delay entirely**, which is why this cannot reuse the refresh-rate coercer: that
 * one floors at 1 because a `refresh_rate` of 0 flattens the battery, whereas 0 here is a legitimate
 * setting. Negative and unparseable values fall back rather than being clamped, since a negative
 * delay is a typo rather than an intent.
 */
function nonNegativeInteger( value, fallback ) {
	const parsed = typeof value === 'number' ? value : Number.parseInt( String( value ?? '' ).trim(), 10 );

	if ( ! Number.isFinite( parsed ) || parsed < 0 ) {
		return fallback;
	}

	return Math.floor( parsed );
}

/** An unknown IANA zone makes every `Intl.DateTimeFormat` throw, which would be every render. */
function supportedTimezone( value, fallback ) {
	const candidate = trimmedString( value, fallback );

	try {
		new Intl.DateTimeFormat( 'en-US', { timeZone: candidate } );

		return candidate;
	} catch {
		return fallback;
	}
}

/**
 * Per-stop direction labels, keyed by full OBA stop ID.
 *
 * **This cannot live in `[vars]`, because that block is committed.** A map containing the stop this
 * sign points at is a home address in a tracked file, which is the project's hardest rule. It goes
 * in `.dev.vars` locally and `wrangler secret put DIRECTION_OVERRIDES` in production — not because
 * it is a credential, but because that is the only home for a value that is neither secret nor
 * publishable.
 *
 * A malformed value degrades to no overrides, which is a slightly odd label rather than an outage.
 */
function stopLabelMap( value ) {
	const raw = trimmedString( value, '' );

	if ( raw === '' ) {
		return {};
	}

	try {
		const parsed = JSON.parse( raw );

		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
			return {};
		}

		return Object.fromEntries(
			Object.entries( parsed ).filter(
				( [ stopId, label ] ) => trimmedString( stopId, '' ) !== '' && trimmedString( label, '' ) !== ''
			)
		);
	} catch {
		return {};
	}
}

/** OBA paths are appended to this, and the firmware's own doubled-slash bug is a lesson worth reusing. */
function baseUrl( value, fallback ) {
	return trimmedString( value, fallback ).replace( /\/+$/, '' );
}

/**
 * @param {object} [env] The Worker environment. Absent in unit tests and during early boot, so an
 *                       empty environment must yield a completely usable config.
 * @returns {{
 *   timezone: string,
 *   activeStartMinutes: number,
 *   activeEndMinutes: number,
 *   refreshActiveSeconds: number,
 *   obaBaseUrl: string,
 *   tarpitMs: number,
 *   directionOverrides: Record<string, string>,
 * }}
 */
export function readConfig( env ) {
	const source = env ?? {};

	return Object.freeze( {
		timezone: supportedTimezone( source.TIMEZONE, CONFIG_DEFAULTS.timezone ),
		activeStartMinutes: minutesSinceMidnight( source.ACTIVE_START, CONFIG_DEFAULTS.activeStart ),
		activeEndMinutes: minutesSinceMidnight( source.ACTIVE_END, CONFIG_DEFAULTS.activeEnd ),
		refreshActiveSeconds: positiveInteger(
			source.REFRESH_ACTIVE_SECONDS,
			CONFIG_DEFAULTS.refreshActiveSeconds
		),
		obaBaseUrl: baseUrl( source.OBA_BASE_URL, CONFIG_DEFAULTS.obaBaseUrl ),
		tarpitMs: nonNegativeInteger( source.TARPIT_MS, CONFIG_DEFAULTS.tarpitMs ),
		directionOverrides: Object.freeze( stopLabelMap( source.DIRECTION_OVERRIDES ) ),
	} );
}
