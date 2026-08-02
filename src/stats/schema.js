/**
 * The Analytics Engine row shape, and the pure function that builds one from a request.
 *
 * ## Blob and double positions are permanent
 *
 * Analytics Engine has no schema. A row is a positional array of `blobs` and `doubles`, and a query
 * reads them back as `blob1`, `blob2`, `double1` and so on. Nothing validates that position 7 still
 * means what it meant last month — **inserting a field in the middle silently reinterprets every
 * historical row**, and there is no migration and no way to detect it after the fact except by
 * noticing the numbers look wrong.
 *
 * So: **append only.** Add new fields at the end of these lists, never in the middle, and never
 * reorder or delete. A field that stops being collected keeps its slot and goes empty. The lists
 * below are the schema, and referring to columns through `blobColumn()` rather than writing `blob13`
 * into a query string by hand is what keeps the SQL honest when a field is appended.
 *
 * ## What is deliberately recorded, and what is not
 *
 * Geo and network fields are recorded on **every** outcome, including authenticated ones. That is a
 * considered reversal of the obvious privacy instinct, and the reason is detection: if the shared
 * token ever leaks, the attacker authenticates successfully and a change of network is the only
 * signal that would ever exist. On a single-device sign the field is a constant, and that is exactly
 * what makes a deviation legible. Cloudflare's own request logs already hold the client IP
 * regardless of what is written here, so declining to record the network denies the owner the one
 * view where a compromise would be visible without denying anyone else anything.
 *
 * **Stop IDs are recorded raw, by explicit decision of the sign's owner**, because "which stop was
 * this failing request for" is the question the page exists to answer. This does not breach the
 * project's privacy rule, which is about tracked files — the stop still never enters git. The
 * residual risk is narrower and worth naming: the stop is printed on the `/stats` HTML, so a
 * screenshot of that page carries a home address. The page says so on itself.
 *
 * **The token is always hashed, never recorded.** It is the one value whose exposure grants access
 * rather than merely identifying, and a short hash correlates requests just as well.
 */

/** A numeric field the device did not report, or reported as unavailable. */
export const ABSENT_NUMBER = -1;

/**
 * Analytics Engine's hard per-row ceiling: twenty blobs, twenty doubles, one index.
 *
 * **This is a fixed number of slots, not a schema that grows with what you write.** `SELECT *` on a
 * dataset returns `double1` through `double20` even where only ten have ever been written, because
 * the columns are the storage shape rather than a record of past calls. A row handed more than
 * twenty of either is **rejected whole** — not truncated to the first twenty — so one field past the
 * line costs every field on the row.
 *
 * That failure is silent from both ends. `recordRequest()` swallows write errors by design, and a
 * query for the missing column comes back `unknown column: "blob21"`, which reads like a bad query
 * rather than like a dataset that has stopped accepting rows. It cost this project a full deploy
 * cycle of recording nothing at all on 2026-08-02, with 739 tests green throughout.
 *
 * Hence `assertWithinLimits()` below, called at module load in every file that defines a dataset
 * schema. A test would pin today's list; a load-time throw is what stops the same mistake in a
 * dataset added later, and it cannot be swallowed by the write path's catch.
 */
export const MAX_BLOBS = 20;
export const MAX_DOUBLES = 20;

/**
 * Fails at import when a schema is over the ceiling.
 *
 * Deliberately a throw rather than a warning: an over-long schema does not degrade, it drops every
 * row, so there is no partial-credit state worth continuing into. `npm test`, `npm run lint` and
 * `wrangler deploy --dry-run` all import these modules, so all three catch it before a deploy does.
 *
 * @param {string}   dataset  Named in the message, since three files call this.
 * @param {object[]} blobs
 * @param {object[]} doubles
 */
export function assertWithinLimits( dataset, blobs, doubles ) {
	if ( blobs.length > MAX_BLOBS ) {
		throw new RangeError(
			`${ dataset } declares ${ blobs.length } blobs; Analytics Engine accepts ${ MAX_BLOBS } and ` +
				'rejects the whole row past that. Move a field to its own dataset rather than dropping the guard.'
		);
	}

	if ( doubles.length > MAX_DOUBLES ) {
		throw new RangeError(
			`${ dataset } declares ${ doubles.length } doubles; Analytics Engine accepts ${ MAX_DOUBLES } and ` +
				'rejects the whole row past that. Move a field to its own dataset rather than dropping the guard.'
		);
	}
}

/**
 * Caps on the strings that come from outside, applied as both a character and a byte limit — see
 * `clampBytes`. Analytics Engine bounds the total bytes of all blobs in a row, so the long free-text
 * fields are clipped rather than trusted; the rest are short by nature and capped only against a
 * hostile caller stuffing a header.
 */
const MAX_BLOB_LENGTH = 256;
const MAX_SHORT_BLOB_LENGTH = 64;

/**
 * Blob columns, in wire order. **Append only** — see the note above.
 *
 * `long: true` marks a field allowed the full length; everything else is clipped short, since the
 * only fields that legitimately run long are the ones a caller controls.
 *
 * ## Why this list once ran to 28 and was cut back, which is not a violation of the rule above
 *
 * Eight fields were appended here on 2026-08-02 — `upstreamReason` and seven device columns — taking
 * the list to 28 against Analytics Engine's ceiling of 20. Every row written from that deploy was
 * **rejected whole**, so the dataset never gained a `blob21` and no query could ever have read one.
 *
 * Removing them was therefore a deletion of slots with **no history behind them**, which is a
 * different act from the reorder the append-only rule forbids: nothing was reinterpreted, because
 * nothing was ever stored. `blob1` through `blob20` below are byte-for-byte what they have always
 * been, and that is what makes the cut safe.
 *
 * The eight now live in `./device-telemetry.js`, which is the right home for them anyway — they
 * describe a device rather than a request, and they are empty on the scanner traffic that makes up
 * most rows here.
 */
export const BLOB_FIELDS = [
	{ name: 'outcome' },
	{ name: 'route' },
	{ name: 'reason' },
	{ name: 'agency' },
	{ name: 'stopIds', long: true },
	{ name: 'tokenHash' },
	{ name: 'model' },
	{ name: 'firmwareVersion' },
	{ name: 'imageCached' },
	{ name: 'updateSource' },
	{ name: 'wakeTime' },
	{ name: 'filenameTag' },
	{ name: 'batteryCapacity' },
	{ name: 'country' },
	{ name: 'asn' },
	{ name: 'networkOrganization', long: true },
	{ name: 'httpProtocol' },
	{ name: 'userAgent', long: true },
	{ name: 'probePath', long: true },

	/**
	 * Whether the shared token matched, as `'1'` or `'0'`.
	 *
	 * Redundant against `outcome` today, and deliberately stored anyway. Every interesting question
	 * on the stats page splits on authenticated versus not, and deriving that in SQL would mean
	 * enumerating the authorized outcome names in a `WHERE` clause — which silently produces wrong
	 * numbers the moment a new outcome is added and someone forgets to update the list. One column
	 * that states the fact outright cannot drift.
	 */
	{ name: 'authorized' },
];

/**
 * Double columns, in wire order. **Append only.**
 *
 * Absent values are `ABSENT_NUMBER` rather than 0, because 0 is a meaningful reading for most of
 * these — a `refresh_rate` of 0 is the hot-loop bug, and 0 volts is not the same as no fuel gauge.
 * The firmware already uses -1 for a battery gauge that failed to initialise, so this matches a
 * convention the device sets rather than inventing one.
 */
export const DOUBLE_FIELDS = [
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

assertWithinLimits( 'The request schema', BLOB_FIELDS, DOUBLE_FIELDS );

const blobIndex = new Map( BLOB_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );
const doubleIndex = new Map( DOUBLE_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );

/**
 * The SQL column for a named blob, e.g. `country` becomes `blob14`.
 *
 * Every query goes through this rather than writing the number, so appending a field cannot quietly
 * shift a query onto the wrong column.
 */
export function blobColumn( name ) {
	const index = blobIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown blob field ${ JSON.stringify( name ) }` );
	}

	return `blob${ index }`;
}

/** The SQL column for a named double, e.g. `batteryVoltage` becomes `double2`. */
export function doubleColumn( name ) {
	const index = doubleIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown double field ${ JSON.stringify( name ) }` );
	}

	return `double${ index }`;
}

/**
 * The maximum length of a path segment considered safe to record verbatim.
 *
 * Chosen to sit well below any plausible secret and well above any real probe path. `wp-login.php`
 * is 12 characters; a token from `openssl rand -hex 32` is 64.
 */
const MAX_SAFE_SEGMENT_LENGTH = 24;

/** Ordinary path segments: a word, a filename, a dotfile. Notably no long hex or base64 blobs. */
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,24}$/;

const MAX_PROBE_SEGMENTS = 4;

/**
 * What a scanner asked for, with anything that could be a secret removed.
 *
 * Knowing that bots probe `/wp-login.php` and `/.env` is genuinely useful and costs nothing, but the
 * naive version of this field is a serious leak: a URL one character away from ours — `/toke/<real
 * token>/...` — fails the token check, lands in the unshaped bucket, and would write the live shared
 * secret straight into the analytics dataset. That is precisely the trap `CLAUDE.md` warns about,
 * where the secret ends up in the place people paste when debugging.
 *
 * So this is an allow-list, not a deny-list. A segment is recorded only if it looks like an ordinary
 * short path word; anything long or high-entropy — which is every secret and no real probe path —
 * becomes a placeholder. Getting this backwards by filtering out "things that look like tokens"
 * would fail the moment a token format changed.
 *
 * Only ever called for unauthenticated outcomes. An authenticated path contains the real token by
 * definition and is never passed here.
 */
export function safeProbePath( pathname ) {
	const segments = String( pathname ?? '' )
		.split( '/' )
		.filter( ( segment ) => segment !== '' )
		.slice( 0, MAX_PROBE_SEGMENTS );

	const safe = segments.map( ( segment, index ) => {
		// The segment straight after `token` is redacted unconditionally, whatever it looks like. The
		// length rule alone would be enough for a token from `openssl rand -hex 32`, but it makes the
		// guarantee depend on how long the secret happens to be — and the one path shape guaranteed to
		// carry a near-miss of the live token is exactly this one, since a pairing typo lands here.
		// Positional redaction holds even if someone provisions a short token.
		if ( index === 1 && segments[ 0 ] === 'token' ) {
			return '[redacted]';
		}

		return SAFE_SEGMENT_PATTERN.test( segment ) && segment.length <= MAX_SAFE_SEGMENT_LENGTH
			? segment
			: '[redacted]';
	} );

	return safe.length === 0 ? '/' : `/${ safe.join( '/' ) }`;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder( 'utf-8', { fatal: false } );

/**
 * Truncates to a byte budget rather than a character count.
 *
 * Analytics Engine bounds the total **bytes** of a row's blobs, and a header is attacker-controlled:
 * 256 characters of four-byte emoji is a kilobyte, so a character cap on several long fields at once
 * could overrun the row budget and make `writeDataPoint` reject it. That fails in the worst possible
 * direction — the dropped rows would be exactly the hostile requests the page exists to show.
 *
 * Decoding with `fatal: false` turns a code point severed mid-sequence into a replacement character
 * instead of throwing, so a cut landing inside a multi-byte sequence degrades one glyph.
 */
function clampBytes( value, maxBytes ) {
	const encoded = utf8Encoder.encode( value );

	return encoded.length <= maxBytes ? value : utf8Decoder.decode( encoded.slice( 0, maxBytes ) );
}

function text( value, long = false ) {
	if ( value === undefined || value === null ) {
		return '';
	}

	const limit = long ? MAX_BLOB_LENGTH : MAX_SHORT_BLOB_LENGTH;

	return clampBytes( String( value ).slice( 0, limit ), limit );
}

/**
 * Coerces a telemetry header to a number.
 *
 * An absent header and an unparseable one collapse to the same `ABSENT_NUMBER`, which is correct:
 * both mean "no reading", and the page renders them identically as no data. The device's own -1 for
 * a failed fuel gauge also lands here unchanged, which is why the sentinel was chosen to match it.
 */
function numeric( value ) {
	if ( value === undefined || value === null || String( value ).trim() === '' ) {
		return ABSENT_NUMBER;
	}

	const parsed = Number( value );

	return Number.isFinite( parsed ) ? parsed : ABSENT_NUMBER;
}

/**
 * Every telemetry header the device sends, mapped to its column.
 *
 * Header names are matched case-insensitively by `Headers.get()`, which is what the HTTP spec
 * requires, but the literal casing here is what the firmware actually puts on the wire — worth
 * keeping accurate even though nothing depends on it, because a mismatch would otherwise look like
 * a firmware change when it is a typo.
 */
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

const TEXT_HEADERS = {
	Model: 'model',
	'FW-Version': 'firmwareVersion',
	'Image-Cached': 'imageCached',
	'Update-Source': 'updateSource',
	'Wake-Time': 'wakeTime',
	'Battery-Capacity': 'batteryCapacity',
};

/**
 * Builds an Analytics Engine data point from a request and its classification.
 *
 * Pure, and that is the point: the whole header-to-column mapping is the part most likely to be
 * wrong, and keeping it free of the `env` binding means it can be tested by passing a `Request` and
 * asserting on an array, with no Analytics Engine mock anywhere.
 *
 * @param   {object}  options
 * @param   {Request} options.request
 * @param   {object}  options.classification  From `classifyRequest()`.
 * @param   {string}  [options.tokenHash]     Short hash of the presented token, never the token.
 * @param   {string}  [options.filenameTag]   Which board state was served, once there is one.
 * @returns {{blobs: string[], doubles: number[], indexes: string[]}}
 */
/** A `Request` whose URL is unparseable is not worth a throw from a metrics helper. */
function pathOf( request ) {
	try {
		return new URL( request.url ).pathname;
	} catch {
		return '';
	}
}

export function eventFromRequest( { request, classification, tokenHash = '', filenameTag = '' } ) {
	const headers = request?.headers;
	const cf = request?.cf ?? {};
	const parsed = classification?.parsed;

	const values = {
		outcome: classification?.outcome,
		route: parsed?.route,
		reason: classification?.reason,
		agency: parsed?.agency,
		stopIds: parsed?.stopIds?.join( ',' ),
		tokenHash,
		filenameTag,

		// Recorded only when the caller did not authenticate. An authenticated path carries the live
		// shared secret in a segment, so it must never be written down even in filtered form.
		probePath: classification?.authorized ? '' : safeProbePath( pathOf( request ) ),
		authorized: classification?.authorized ? '1' : '0',
		country: cf.country,
		asn: cf.asn,
		networkOrganization: cf.asOrganization,
		httpProtocol: cf.httpProtocol,
		userAgent: headers?.get( 'User-Agent' ),
	};

	for ( const [ header, name ] of Object.entries( TEXT_HEADERS ) ) {
		values[ name ] = headers?.get( header );
	}

	const numbers = {};

	for ( const [ header, name ] of Object.entries( NUMERIC_HEADERS ) ) {
		numbers[ name ] = numeric( headers?.get( header ) );
	}

	return {
		blobs: BLOB_FIELDS.map( ( field ) => text( values[ field.name ], field.long ) ),
		doubles: DOUBLE_FIELDS.map( ( field ) => numbers[ field.name ] ?? ABSENT_NUMBER ),

		// Indexing on the outcome keeps sampling stratified per category rather than uniform, so a
		// rare-but-important outcome is not sampled away by a flood of common ones.
		indexes: [ text( classification?.outcome ) ],
	};
}
