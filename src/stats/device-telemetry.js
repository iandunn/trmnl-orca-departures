/**
 * What the device says about itself on every wake, in its own Analytics Engine dataset.
 *
 * ## Why this is not part of the request schema
 *
 * It was, for one deploy, and that is what broke recording entirely. Analytics Engine accepts twenty
 * blobs per row and **rejects the whole row past that** — see `MAX_BLOBS` in `./schema.js`. The
 * request schema was already at twenty when seven device columns and `upstreamReason` were appended
 * to it, so from 2026-08-02 17:32Z until this file existed, every write was dropped: no request
 * outcomes, no rejections, no scanner traffic, nothing. `/stats` rendered a page that looked merely
 * quiet.
 *
 * Splitting rather than dropping fields is the fix because these columns describe a **device**, not a
 * request. Most rows in the request dataset are scanner traffic where every one of them is empty, and
 * a device fact repeated on a row about `/wp-login.php` was never meaningful. The same reasoning
 * already justified `./device-logs.js` being separate, and the same two benefits follow: a chatty
 * device cannot dilute the sampling of request outcomes, and the two can be queried and aged apart.
 *
 * ## One row per authenticated device request
 *
 * Written from the same `recordOutcome()` call that writes the request row, so the two always agree
 * and neither can be forgotten independently. Gated on `identifiesADevice()`, because the setup-logo
 * download sends **no headers at all** — a row for it would be eighteen empty columns claiming a
 * device reported nothing, which is indistinguishable from a device whose fuel gauge failed.
 *
 * At roughly 900 polls a day this doubles nothing that matters: the two datasets together stay under
 * 10k writes a day against a 100k free-plan limit.
 *
 * **Blob and double positions are permanent, append only**, for the same reason as every other
 * dataset here: a mid-list insert silently reinterprets every historical row, with no migration and
 * no way to notice afterwards.
 */

import { ABSENT_NUMBER, MAX_BLOBS, MAX_DOUBLES, assertWithinLimits } from './schema.js';

export { ABSENT_NUMBER, MAX_BLOBS, MAX_DOUBLES };

const MAX_FIELD_BYTES = 64;
const MAX_LONG_FIELD_BYTES = 256;

/**
 * Blob columns, in wire order. **Append only.**
 *
 * `deviceId` is first because it is the key everything else hangs off. It is the MAC address from the
 * `ID` header, and it is **the only stable per-device identifier the firmware sends** — there is no
 * serial number. Everything beside it describes a *kind* of device (model, firmware build, panel
 * geometry), so before this dataset two identical signs were indistinguishable in the data, which is
 * precisely the case the identity alarms on `/stats` exist to catch.
 *
 * `clientIp` is recorded by the same decision that records stop IDs raw: on a single-device sign the
 * address is a constant, and a constant is what makes a deviation legible. If the URL token ever
 * leaks the attacker authenticates *successfully*, so a change of network is the only signal that
 * would ever exist. Cloudflare's own request logs hold the address regardless, so omitting it would
 * deny the owner the one view where a compromise is visible without denying anyone else anything. It
 * does mean a screenshot of `/stats` carries an IP as well as roughly a home address; the page says
 * so on itself.
 *
 * `wakeTime`, `batteryCharging`, `usbConnected` and `temperatureProfile` are kept as **text rather
 * than numbers**, even though three of them look numeric. The firmware's exact spelling for the two
 * flags is unverified, and `Wake-Time` is ambiguous in the sources this project has: the value looks
 * like an epoch while the reference notes describe a duration. Storing what arrived, verbatim, is
 * the only option that cannot be wrong — a parse here would bake in a guess that no one can check
 * until a real device has polled.
 */
export const DEVICE_BLOB_FIELDS = [
	{ name: 'deviceId' },
	{ name: 'model' },
	{ name: 'firmwareVersion' },
	{ name: 'firmwareCommit' },
	{ name: 'clientIp' },
	{ name: 'country' },
	{ name: 'networkOrganization', long: true },
	{ name: 'wifiBand' },
	{ name: 'imageCached' },
	{ name: 'updateSource' },
	{ name: 'wakeTime' },
	{ name: 'batteryCapacity' },
	{ name: 'batteryCharging' },
	{ name: 'usbConnected' },
	{ name: 'temperatureProfile' },

	/**
	 * Which request this device row came from, so a device box can say what the sign actually drew
	 * without a join — this SQL surface has none worth relying on.
	 *
	 * `upstreamReason` is why OneBusAway did not answer, on a poll where it did not. `filenameTag`
	 * already says a poll ended in `obafail`, which is *that* it failed and never *why*, and the
	 * difference is the whole diagnosis: a `429` is a rate-limited key with a known fix, a `timeout`
	 * is a slow upstream and is not.
	 *
	 * **Partial failures are recorded too.** One stop answering is enough to draw a board, so those
	 * never reach `obafail` and would otherwise stay invisible — which is exactly the shape a quota
	 * problem takes as it starts. Carries an HTTP status where there is one (`http-429`), the reason
	 * slug otherwise, and is empty on a poll where every stop answered.
	 *
	 * It is deliberately **not** part of the rendered `filename`: two outages that look identical on
	 * the glass must not repaint the panel.
	 */
	{ name: 'outcome' },
	{ name: 'filenameTag' },
	{ name: 'upstreamReason' },
];

/**
 * Double columns, in wire order. **Append only.**
 *
 * Absent values are `ABSENT_NUMBER` rather than 0, because 0 is a meaningful reading for most of
 * these — a `refresh_rate` of 0 is the hot-loop bug, and 0 volts is not the same as no fuel gauge.
 * The firmware itself reports -1 for a battery gauge that failed to initialise, so this matches a
 * convention the device sets rather than inventing one.
 *
 * `width` and `height` are read from the display driver at runtime by the firmware rather than
 * compiled in, which makes them the source of truth for panel geometry rather than a constant to
 * check against.
 */
export const DEVICE_DOUBLE_FIELDS = [
	{ name: 'refreshRateEcho' },
	{ name: 'batteryVoltage' },
	{ name: 'percentCharged' },
	{ name: 'batteryHealth' },
	{ name: 'batteryCurrent' },
	{ name: 'batteryTemperature' },
	{ name: 'batteryCount' },
	{ name: 'width' },
	{ name: 'height' },
	{ name: 'signalStrength' },
];

assertWithinLimits( 'The device telemetry schema', DEVICE_BLOB_FIELDS, DEVICE_DOUBLE_FIELDS );

const deviceBlobIndex = new Map( DEVICE_BLOB_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );
const deviceDoubleIndex = new Map( DEVICE_DOUBLE_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );

/** The SQL column for a named device blob. Queries go through this, never a literal `blobN`. */
export function deviceBlobColumn( name ) {
	const index = deviceBlobIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown device telemetry blob field ${ JSON.stringify( name ) }` );
	}

	return `blob${ index }`;
}

/** The SQL column for a named device double. */
export function deviceDoubleColumn( name ) {
	const index = deviceDoubleIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown device telemetry double field ${ JSON.stringify( name ) }` );
	}

	return `double${ index }`;
}

/**
 * Header names as the firmware puts them on the wire.
 *
 * `Headers.get()` matches case-insensitively, as the HTTP spec requires, so nothing depends on the
 * casing below — but keeping it accurate means a future mismatch reads as a firmware change rather
 * than as a typo here.
 *
 * The list is what `buildDisplayHeaders()` in `lib/trmnl/src/api-client/request_headers.cpp` sends,
 * read from source rather than from the reference docs, which omit several. It is still not a set to
 * rely on being complete: it differs per board and per radio path, and a firmware update that adds
 * one will not announce itself.
 */
const TEXT_HEADERS = {
	ID: 'deviceId',
	Model: 'model',
	'FW-Version': 'firmwareVersion',
	'FW-Commit': 'firmwareCommit',
	'WiFi-Band': 'wifiBand',
	'Image-Cached': 'imageCached',
	'Update-Source': 'updateSource',
	'Wake-Time': 'wakeTime',
	'Battery-Capacity': 'batteryCapacity',
	'Battery-Charging': 'batteryCharging',
	'USB-Connected': 'usbConnected',
	'Temperature-Profile': 'temperatureProfile',
};

const NUMERIC_HEADERS = {
	'Refresh-Rate': 'refreshRateEcho',
	'Battery-Voltage': 'batteryVoltage',
	'Percent-Charged': 'percentCharged',
	'Battery-Health': 'batteryHealth',
	'Battery-Current': 'batteryCurrent',
	'Battery-Temp': 'batteryTemperature',
	'Battery-Count': 'batteryCount',
	Width: 'width',
	Height: 'height',
	RSSI: 'signalStrength',
};

/**
 * The headers whose presence means a device sent this, rather than a browser or a scanner.
 *
 * Either alone is enough. `/api/setup` sends only four headers and `/api/display` sends everything,
 * but both carry these two, so a device is never missed for lacking the one that happened to be
 * checked.
 */
const IDENTIFYING_HEADERS = [ 'ID', 'Model' ];

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder( 'utf-8', { fatal: false } );

/**
 * Truncates to a byte budget rather than a character count.
 *
 * Analytics Engine bounds the total **bytes** of a row's blobs, and these values arrive in headers a
 * caller controls: 256 characters of four-byte emoji is a kilobyte, so a character cap across
 * several fields at once could overrun the row budget and make `writeDataPoint` reject it — which
 * fails in the worst direction, dropping exactly the anomalous rows worth seeing.
 */
function text( value, long = false ) {
	if ( value === undefined || value === null ) {
		return '';
	}

	const limit = long ? MAX_LONG_FIELD_BYTES : MAX_FIELD_BYTES;
	const clipped = String( value ).slice( 0, limit );
	const encoded = utf8Encoder.encode( clipped );

	// `fatal: false` turns a code point severed mid-sequence into a replacement character rather than
	// throwing, so a cut landing inside a multi-byte sequence costs one glyph.
	return encoded.length <= limit ? clipped : utf8Decoder.decode( encoded.slice( 0, limit ) );
}

/**
 * Coerces a telemetry header to a number.
 *
 * An absent header and an unparseable one collapse to the same `ABSENT_NUMBER`, which is correct:
 * both mean "no reading", and the page renders them identically. The firmware's own -1 for a failed
 * fuel gauge lands here unchanged, which is why the sentinel was chosen to match it.
 */
function numeric( value ) {
	if ( value === undefined || value === null || String( value ).trim() === '' ) {
		return ABSENT_NUMBER;
	}

	const parsed = Number( value );

	return Number.isFinite( parsed ) ? parsed : ABSENT_NUMBER;
}

/**
 * Whether this request came from a device at all.
 *
 * Exported because it is the gate on the whole dataset, and getting it wrong is invisible: too loose
 * and the Devices panel fills with empty boxes for scanner traffic, too tight and a real device is
 * missing from the one panel built to find it.
 *
 * @param   {Request} request
 * @returns {boolean}
 */
export function identifiesADevice( request ) {
	return IDENTIFYING_HEADERS.some( ( header ) => ( request?.headers?.get( header ) ?? '' ).trim() !== '' );
}

/**
 * Builds a device telemetry data point from a request.
 *
 * Pure, and that is the point: the header-to-column mapping is the part most likely to be wrong, and
 * keeping it free of the `env` binding means it is tested by passing a `Request` and asserting on an
 * array, with no Analytics Engine mock.
 *
 * @param   {object}  options
 * @param   {Request} options.request
 * @param   {string}  [options.outcome]         The recorded outcome slug for this request.
 * @param   {string}  [options.filenameTag]     Which screen was served.
 * @param   {string}  [options.upstreamReason]  Why OneBusAway did not answer, where it did not.
 * @returns {{blobs: string[], doubles: number[], indexes: string[]}}
 */
export function eventFromDeviceRequest( { request, outcome = '', filenameTag = '', upstreamReason = '' } ) {
	const headers = request?.headers;
	const cf = request?.cf ?? {};

	const values = {
		outcome,
		filenameTag,
		upstreamReason,
		country: cf.country,
		networkOrganization: cf.asOrganization,

		// Cloudflare's own header, not the device's — the firmware has no idea what its public address
		// is.
		clientIp: headers?.get( 'CF-Connecting-IP' ),
	};

	for ( const [ header, name ] of Object.entries( TEXT_HEADERS ) ) {
		values[ name ] = headers?.get( header );
	}

	const numbers = {};

	for ( const [ header, name ] of Object.entries( NUMERIC_HEADERS ) ) {
		numbers[ name ] = numeric( headers?.get( header ) );
	}

	return {
		blobs: DEVICE_BLOB_FIELDS.map( ( field ) => text( values[ field.name ], field.long ) ),
		doubles: DEVICE_DOUBLE_FIELDS.map( ( field ) => numbers[ field.name ] ?? ABSENT_NUMBER ),

		// Indexed on the MAC so one device's polls cannot sample away another's. With a single sign
		// this does nothing; with two it is the difference between the Devices panel being complete and
		// being a guess.
		indexes: [ text( headers?.get( 'ID' ) ) ],
	};
}

/**
 * Records one device's telemetry for this request.
 *
 * Silently does nothing when the binding is absent, which is the normal state under `wrangler dev`,
 * and nothing when the request carries no device headers.
 *
 * Fire-and-forget, like every other write here: a lost telemetry row must never be able to fail a
 * request, because `/api/display` runs ~900 times a day and the sign going dark over a metrics write
 * would be the tail wagging the dog.
 *
 * @param {object} env
 * @param {object} options  Passed through to `eventFromDeviceRequest()`.
 */
export function recordDeviceTelemetry( env, options ) {
	if ( ! env?.DEVICE_TELEMETRY || ! identifiesADevice( options?.request ) ) {
		return;
	}

	try {
		env.DEVICE_TELEMETRY.writeDataPoint( eventFromDeviceRequest( options ) );
	} catch ( error ) {
		// Never worth an outage, and never silent — a swallowed write with nothing in the log is what
		// made the twenty-blob overflow invisible for a whole deploy cycle. See `recordRequest()`.
		console.log(
			JSON.stringify( {
				event: 'analytics-write-failed',
				dataset: 'devices',
				message: error?.message ?? String( error ),
			} )
		);
	}
}
