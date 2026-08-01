import { describe, expect, it } from 'vitest';
import {
	ABSENT_NUMBER,
	LOG_BLOB_FIELDS,
	LOG_DOUBLE_FIELDS,
	MAX_ENTRIES_PER_REQUEST,
	eventFromLogEntry,
	logBlobColumn,
	logDoubleColumn,
	recordDeviceLogs,
} from './device-logs.js';

/** A realistic entry, shaped from the payload `usetrmnl/terminus` documents. */
const entry = () => ( {
	message: 'wifi connect failed, retrying',
	level: 'error',
	source_path: 'src/bl.cpp',
	source_line: 2235,
	firmware_version: '1.6.2',
	wake_reason: 'timer',
	retry: 2,
	sleep_duration: 900,
	refresh_rate: 60,
	free_heap_size: 184320,
	max_alloc_size: 110592,
	battery_voltage: 3.82,
	wifi_status: 'disconnected',
	wifi_signal: -67,
	created_at: '2026-07-31T22:04:11Z',
} );

const blobAt = ( event, name ) => event.blobs[ Number( logBlobColumn( name ).slice( 4 ) ) - 1 ];
const doubleAt = ( event, name ) => event.doubles[ Number( logDoubleColumn( name ).slice( 6 ) ) - 1 ];

function recordingEnv() {
	const rows = [];

	return { rows, env: { DEVICE_LOGS: { writeDataPoint: ( row ) => rows.push( row ) } } };
}

describe( 'the device log schema', () => {
	/**
	 * Analytics Engine columns are positional and have no schema, so inserting a field mid-list
	 * silently reinterprets every historical row with no migration and no way to notice afterwards.
	 * If this fails, the change should have been an append.
	 */
	it( 'pins the column order, which is permanent', () => {
		expect( LOG_BLOB_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'level',
			'message',
			'sourcePath',
			'firmwareVersion',
			'wakeReason',
			'wifiStatus',
			'createdAt',
			'agency',
			'stopIds',
		] );

		expect( LOG_DOUBLE_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'sourceLine',
			'retry',
			'sleepDuration',
			'refreshRate',
			'freeHeapSize',
			'maxAllocSize',
			'batteryVoltage',
			'wifiSignal',
			'messageBytes',
		] );
	} );

	it( 'emits exactly one value per declared column', () => {
		const event = eventFromLogEntry( entry() );

		expect( event.blobs ).toHaveLength( LOG_BLOB_FIELDS.length );
		expect( event.doubles ).toHaveLength( LOG_DOUBLE_FIELDS.length );
	} );

	it.each( [ [ 'level', 'blob1' ], [ 'message', 'blob2' ], [ 'stopIds', 'blob9' ] ] )(
		'resolves blob %s to %s',
		( name, column ) => {
			expect( logBlobColumn( name ) ).toBe( column );
		}
	);

	it.each( [ [ 'sourceLine', 'double1' ], [ 'messageBytes', 'double9' ] ] )(
		'resolves double %s to %s',
		( name, column ) => {
			expect( logDoubleColumn( name ) ).toBe( column );
		}
	);

	it.each( [ [ 'nope' ], [ '' ], [ undefined ] ] )( 'throws for unknown column %o', ( name ) => {
		expect( () => logBlobColumn( name ) ).toThrow();
		expect( () => logDoubleColumn( name ) ).toThrow();
	} );
} );

describe( 'eventFromLogEntry', () => {
	// The device sends snake_case and the columns are camelCase; this function is the only place the
	// two meet, which makes a silent typo here invisible everywhere else.
	it( 'maps every documented field onto its column', () => {
		const event = eventFromLogEntry( entry() );

		expect( blobAt( event, 'level' ) ).toBe( 'error' );
		expect( blobAt( event, 'message' ) ).toBe( 'wifi connect failed, retrying' );
		expect( blobAt( event, 'sourcePath' ) ).toBe( 'src/bl.cpp' );
		expect( blobAt( event, 'firmwareVersion' ) ).toBe( '1.6.2' );
		expect( blobAt( event, 'wakeReason' ) ).toBe( 'timer' );
		expect( blobAt( event, 'wifiStatus' ) ).toBe( 'disconnected' );
		expect( blobAt( event, 'createdAt' ) ).toBe( '2026-07-31T22:04:11Z' );

		expect( doubleAt( event, 'sourceLine' ) ).toBe( 2235 );
		expect( doubleAt( event, 'retry' ) ).toBe( 2 );
		expect( doubleAt( event, 'sleepDuration' ) ).toBe( 900 );
		expect( doubleAt( event, 'refreshRate' ) ).toBe( 60 );
		expect( doubleAt( event, 'freeHeapSize' ) ).toBe( 184320 );
		expect( doubleAt( event, 'maxAllocSize' ) ).toBe( 110592 );
		expect( doubleAt( event, 'batteryVoltage' ) ).toBe( 3.82 );
	} );

	// RSSI is legitimately negative, so it must survive rather than being treated as absent.
	it( 'keeps a negative wifi signal, which is a real reading', () => {
		expect( doubleAt( eventFromLogEntry( entry() ), 'wifiSignal' ) ).toBe( -67 );
	} );

	it( 'indexes on level, so a few errors are not sampled away by a flood of debug lines', () => {
		expect( eventFromLogEntry( entry() ).indexes ).toEqual( [ 'error' ] );
	} );

	it( 'carries the stop it came from, for correlating against request rows', () => {
		const event = eventFromLogEntry( entry(), { agency: '1', stopIds: [ '590', '430' ] } );

		expect( blobAt( event, 'agency' ) ).toBe( '1' );
		expect( blobAt( event, 'stopIds' ) ).toBe( '590,430' );
	} );

	it.each( [ [ undefined ], [ null ], [ '' ], [ 'not a number' ] ] )(
		'records an absent numeric field %o as the sentinel rather than 0',
		( value ) => {
			const event = eventFromLogEntry( { ...entry(), free_heap_size: value } );

			expect( doubleAt( event, 'freeHeapSize' ) ).toBe( ABSENT_NUMBER );
			expect( doubleAt( event, 'freeHeapSize' ) ).not.toBe( 0 );
		}
	);

	it.each( [ [ undefined ], [ null ], [ 'nonsense' ], [ 42 ], [ [] ] ] )(
		'survives a malformed entry %o without throwing',
		( malformed ) => {
			expect( () => eventFromLogEntry( malformed ) ).not.toThrow();
			expect( eventFromLogEntry( malformed ).blobs ).toHaveLength( LOG_BLOB_FIELDS.length );
		}
	);

	describe( 'long messages', () => {
		it( 'records the pre-truncation size so a clipped entry is identifiable as clipped', () => {
			const long = 'x'.repeat( 5000 );
			const event = eventFromLogEntry( { ...entry(), message: long } );

			expect( doubleAt( event, 'messageBytes' ) ).toBe( 5000 );
			expect( blobAt( event, 'message' ).length ).toBeLessThan( 5000 );
		} );

		it( 'gives the message a larger budget than the short identifier fields', () => {
			const long = 'x'.repeat( 5000 );
			const event = eventFromLogEntry( { ...entry(), message: long, wake_reason: long } );

			expect( blobAt( event, 'message' ).length ).toBeGreaterThan( blobAt( event, 'wakeReason' ).length );
		} );

		// Byte-bounded rather than character-bounded, because Analytics Engine limits the row's bytes and
		// a firmware message is free text that may not be ASCII.
		it( 'truncates by bytes without throwing on a severed multi-byte character', () => {
			const event = eventFromLogEntry( { ...entry(), message: '\u{1F600}'.repeat( 2000 ) } );

			expect( blobAt( event, 'message' ) ).toBeTypeOf( 'string' );
			expect( doubleAt( event, 'messageBytes' ) ).toBe( 8000 );
		} );
	} );
} );

describe( 'recordDeviceLogs', () => {
	it( 'writes one row per entry', () => {
		const { rows, env } = recordingEnv();

		expect( recordDeviceLogs( env, [ entry(), entry() ] ) ).toBe( 2 );
		expect( rows ).toHaveLength( 2 );
	} );

	// The body is device-supplied and unbounded, so one request must not be able to spend a meaningful
	// share of the daily write quota.
	it( 'caps how much one request can write, and says so rather than dropping silently', () => {
		const { rows, env } = recordingEnv();
		const flood = Array.from( { length: MAX_ENTRIES_PER_REQUEST + 20 }, entry );

		expect( recordDeviceLogs( env, flood ) ).toBe( MAX_ENTRIES_PER_REQUEST );
		expect( rows ).toHaveLength( MAX_ENTRIES_PER_REQUEST );
	} );

	// `/api/log` answers 204 regardless: a device that cannot file a diagnostic must not conclude the
	// server is broken and start backing off.
	it.each( [ [ {} ], [ { DEVICE_LOGS: undefined } ], [ undefined ] ] )(
		'does nothing and does not throw without the binding (%o)',
		( env ) => {
			expect( () => recordDeviceLogs( env, [ entry() ] ) ).not.toThrow();
			expect( recordDeviceLogs( env, [ entry() ] ) ).toBe( 0 );
		}
	);

	it.each( [ [ undefined ], [ null ], [ 'logs' ], [ 42 ], [ {} ] ] )(
		'ignores a non-array body %o',
		( logs ) => {
			const { env } = recordingEnv();

			expect( recordDeviceLogs( env, logs ) ).toBe( 0 );
		}
	);

	it( 'keeps the rest of the batch when one entry cannot be written', () => {
		let calls = 0;
		const rows = [];

		const env = {
			DEVICE_LOGS: {
				writeDataPoint: ( row ) => {
					calls++;

					if ( calls === 2 ) {
						throw new Error( 'row rejected' );
					}

					rows.push( row );
				},
			},
		};

		expect( recordDeviceLogs( env, [ entry(), entry(), entry() ] ) ).toBe( 2 );
		expect( rows ).toHaveLength( 2 );
	} );
} );
