/**
 * Persisting what the device says about itself.
 *
 * `/api/log` is the only channel back from a sign that is rendering nothing, which makes it the one
 * stream where losing history hurts most: the interesting entries arrive during a failure, and a
 * failure is exactly when nobody is watching a live tail.
 *
 * **`console.log` is not a substitute.** It reaches `wrangler tail` live, and with
 * `[observability.logs]` enabled Workers Logs retains it for a few days — but that is a separate
 * store with a much shorter window, and it cannot be queried alongside the request outcomes that
 * would explain what the device was reacting to. So entries go to Analytics Engine as well, in their
 * own dataset. The two are complementary rather than redundant: the tail is for watching a device
 * you are standing next to, this is for answering "what happened on Tuesday".
 *
 * Kept in a **separate dataset** from request outcomes for two reasons. A device that starts logging
 * heavily would otherwise dilute the sampling of ordinary request rows, and the two have completely
 * different shapes, so sharing positional columns between them would mean one schema where half the
 * fields are always empty.
 *
 * The same rule as the request schema applies, for the same reason: **blob and double positions are
 * permanent, append only.** Inserting a field mid-list silently reinterprets every historical row.
 * The twenty-column ceiling applies here too, and is asserted at module load below.
 */

import { assertWithinLimits } from './schema.js';

/** A numeric field the entry did not carry. Matches the request schema's convention. */
export const ABSENT_NUMBER = -1;

/**
 * The message gets a far larger share of the row's byte budget than anything else, because it is the
 * only field that cannot be reconstructed from somewhere else. The rest are short identifiers.
 */
const MAX_MESSAGE_BYTES = 1024;
const MAX_FIELD_BYTES = 128;

/**
 * Blob columns, in wire order. **Append only.**
 *
 * `sourcePath` plus `sourceLine` are the pair that earns this whole file: together they map a failure
 * onto a specific line of the GPLv3 firmware rather than a guess about what went wrong.
 */
export const LOG_BLOB_FIELDS = [
	{ name: 'level' },
	{ name: 'message', bytes: MAX_MESSAGE_BYTES },
	{ name: 'sourcePath' },
	{ name: 'firmwareVersion' },
	{ name: 'wakeReason' },
	{ name: 'wifiStatus' },
	{ name: 'createdAt' },
	{ name: 'agency' },
	{ name: 'stopIds' },
];

/**
 * Double columns, in wire order. **Append only.**
 *
 * `freeHeapSize` and `maxAllocSize` are here because out-of-memory is one of the failure modes that
 * draws nothing at all, forever — and it is invisible in every other signal we collect.
 *
 * `messageBytes` is the message's length *before* truncation, so a clipped entry is identifiable as
 * clipped rather than quietly looking complete.
 */
export const LOG_DOUBLE_FIELDS = [
	{ name: 'sourceLine' },
	{ name: 'retry' },
	{ name: 'sleepDuration' },
	{ name: 'refreshRate' },
	{ name: 'freeHeapSize' },
	{ name: 'maxAllocSize' },
	{ name: 'batteryVoltage' },
	{ name: 'wifiSignal' },
	{ name: 'messageBytes' },
];

assertWithinLimits( 'The device log schema', LOG_BLOB_FIELDS, LOG_DOUBLE_FIELDS );

const logBlobIndex = new Map( LOG_BLOB_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );
const logDoubleIndex = new Map( LOG_DOUBLE_FIELDS.map( ( field, index ) => [ field.name, index + 1 ] ) );

/** The SQL column for a named device-log blob. Queries go through this, never a literal `blobN`. */
export function logBlobColumn( name ) {
	const index = logBlobIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown device log blob field ${ JSON.stringify( name ) }` );
	}

	return `blob${ index }`;
}

/** The SQL column for a named device-log double. */
export function logDoubleColumn( name ) {
	const index = logDoubleIndex.get( name );

	if ( ! index ) {
		throw new TypeError( `unknown device log double field ${ JSON.stringify( name ) }` );
	}

	return `double${ index }`;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder( 'utf-8', { fatal: false } );

function clamp( value, maxBytes ) {
	if ( value === undefined || value === null ) {
		return '';
	}

	const text = String( value );
	const encoded = utf8Encoder.encode( text );

	// Byte-bounded rather than character-bounded: Analytics Engine limits the total bytes of a row's
	// blobs, and a firmware message is free text that may not be ASCII.
	return encoded.length <= maxBytes ? text : utf8Decoder.decode( encoded.slice( 0, maxBytes ) );
}

function numeric( value ) {
	if ( value === undefined || value === null || String( value ).trim() === '' ) {
		return ABSENT_NUMBER;
	}

	const parsed = Number( value );

	return Number.isFinite( parsed ) ? parsed : ABSENT_NUMBER;
}

/**
 * Turns one `/api/log` entry into an Analytics Engine data point.
 *
 * Pure, so the field mapping — the part most likely to be wrong, since it is transcribed from a
 * firmware payload nobody here has yet received — is testable by passing an object and asserting on
 * an array.
 *
 * The entry keys are snake_case because that is what the device sends; the columns are camelCase
 * because that is what the rest of this codebase reads. This function is the only place the two meet.
 *
 * @param   {object} entry            One element of the `logs` array in the request body.
 * @param   {object} [context]        Which sign this came from, for correlating against request rows.
 * @returns {{blobs: string[], doubles: number[], indexes: string[]}}
 */
export function eventFromLogEntry( entry, context = {} ) {
	const source = entry && typeof entry === 'object' ? entry : {};
	const message = source.message ?? '';

	const values = {
		level: source.level,
		message,
		sourcePath: source.source_path,
		firmwareVersion: source.firmware_version,
		wakeReason: source.wake_reason,
		wifiStatus: source.wifi_status,
		createdAt: source.created_at,
		agency: context.agency,
		stopIds: Array.isArray( context.stopIds ) ? context.stopIds.join( ',' ) : context.stopIds,
	};

	const numbers = {
		sourceLine: numeric( source.source_line ),
		retry: numeric( source.retry ),
		sleepDuration: numeric( source.sleep_duration ),
		refreshRate: numeric( source.refresh_rate ),
		freeHeapSize: numeric( source.free_heap_size ),
		maxAllocSize: numeric( source.max_alloc_size ),
		batteryVoltage: numeric( source.battery_voltage ),
		wifiSignal: numeric( source.wifi_signal ),
		messageBytes: utf8Encoder.encode( String( message ) ).length,
	};

	return {
		blobs: LOG_BLOB_FIELDS.map( ( field ) => clamp( values[ field.name ], field.bytes ?? MAX_FIELD_BYTES ) ),
		doubles: LOG_DOUBLE_FIELDS.map( ( field ) => numbers[ field.name ] ?? ABSENT_NUMBER ),

		// Indexed on level so a handful of errors are not sampled away by a flood of debug chatter,
		// which is the case this whole dataset exists for.
		indexes: [ clamp( source.level, MAX_FIELD_BYTES ) ],
	};
}

/**
 * The cap on entries persisted from a single request.
 *
 * The body is device-supplied and unbounded, and one request must not be able to spend a meaningful
 * share of the daily write quota. Whatever is dropped is counted and logged rather than discarded
 * silently, because a silent cap on a diagnostic channel reads as "nothing else happened".
 */
export const MAX_ENTRIES_PER_REQUEST = 64;

/**
 * Persists a `/api/log` body.
 *
 * Never throws and never returns a failure: `/api/log` answers `204` regardless, because a device
 * that cannot file a diagnostic must not conclude the server is broken and start backing off.
 *
 * @param {object} env
 * @param {Array}  logs       The `logs` array from the request body.
 * @param {object} [context]  `{ agency, stopIds }`, for correlating against request rows.
 * @returns {number} How many entries were persisted, for the caller's own log line.
 */
export function recordDeviceLogs( env, logs, context = {} ) {
	if ( ! env?.DEVICE_LOGS || ! Array.isArray( logs ) ) {
		return 0;
	}

	const kept = logs.slice( 0, MAX_ENTRIES_PER_REQUEST );
	let written = 0;

	for ( const entry of kept ) {
		try {
			env.DEVICE_LOGS.writeDataPoint( eventFromLogEntry( entry, context ) );
			written++;
		} catch {
			// One malformed entry must not cost the rest of the batch, and none of them is worth an
			// outage. The gap shows up as a message count lower than the device reported sending.
		}
	}

	if ( logs.length > kept.length ) {
		console.log(
			JSON.stringify( {
				event: 'device-log-truncated',
				received: logs.length,
				persisted: written,
			} )
		);
	}

	return written;
}
