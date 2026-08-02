import { describe, expect, it, vi } from 'vitest';
import {
	ABSENT_NUMBER,
	DEVICE_BLOB_FIELDS,
	DEVICE_DOUBLE_FIELDS,
	deviceBlobColumn,
	deviceDoubleColumn,
	eventFromDeviceRequest,
	identifiesADevice,
	recordDeviceTelemetry,
} from './device-telemetry.js';

/**
 * Positions resolve through the same accessors the SQL uses, so appending a field cannot shift an
 * assertion onto a neighbouring column. A hardcoded index would be worse than a typo: an off-by-one
 * onto an adjacent empty column passes green while checking the wrong slot.
 */
const blobAt = ( blobs, name ) => blobs[ Number( deviceBlobColumn( name ).slice( 'blob'.length ) ) - 1 ];
const doubleAt = ( doubles, name ) => doubles[ Number( deviceDoubleColumn( name ).slice( 'double'.length ) ) - 1 ];

/** Everything a real `/api/display` poll carries, per `buildDisplayHeaders()` in the firmware. */
const DEVICE_HEADERS = {
	ID: 'AA:BB:CC:DD:EE:FF',
	Model: 'x',
	'FW-Version': '1.7.2',
	'FW-Commit': 'a1b2c3d',
	'WiFi-Band': '5',
	'Image-Cached': 'true',
	'Update-Source': 'sleep',
	'Wake-Time': '1785564693',
	'Battery-Capacity': '4000/6000',
	'Battery-Charging': 'false',
	'USB-Connected': 'false',
	'Temperature-Profile': '0',
	'Refresh-Rate': '60',
	'Battery-Voltage': '4.05',
	'Percent-Charged': '72',
	'Battery-Health': '98',
	'Battery-Current': '-120',
	'Battery-Temp': '21.5',
	'Battery-Count': '2',
	Width: '1872',
	Height: '1404',
	RSSI: '-58',
};

function requestFor( headers = {}, cf = {} ) {
	const request = new Request( 'https://sign.test/token/x/agency/1/stop/600,430/api/display', { headers } );

	Object.defineProperty( request, 'cf', { value: cf } );

	return request;
}

describe( 'DEVICE_BLOB_FIELDS and DEVICE_DOUBLE_FIELDS', () => {
	/**
	 * Analytics Engine columns are positional with no schema, so a query reads position 7 back as
	 * `blob7` whatever it now means — **a mid-list insert silently reinterprets every historical row**
	 * with no migration and no way to detect it afterwards.
	 *
	 * If this fails, first confirm the change was an append to the end, then extend the list below. A
	 * reorder, a mid-list insert or a deletion is never the right fix.
	 */
	it( 'pins the blob order', () => {
		expect( DEVICE_BLOB_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'deviceId',
			'model',
			'firmwareVersion',
			'firmwareCommit',
			'clientIp',
			'country',
			'networkOrganization',
			'wifiBand',
			'imageCached',
			'updateSource',
			'wakeTime',
			'batteryCapacity',
			'batteryCharging',
			'usbConnected',
			'temperatureProfile',
			'outcome',
			'filenameTag',
			'upstreamReason',
		] );
	} );

	it( 'pins the double order', () => {
		expect( DEVICE_DOUBLE_FIELDS.map( ( field ) => field.name ) ).toEqual( [
			'refreshRateEcho',
			'batteryVoltage',
			'percentCharged',
			'batteryHealth',
			'batteryCurrent',
			'batteryTemperature',
			'batteryCount',
			'width',
			'height',
			'signalStrength',
		] );
	} );

	it( 'keeps the MAC first, since every device panel groups on it', () => {
		expect( deviceBlobColumn( 'deviceId' ) ).toBe( 'blob1' );
	} );

	it.each( [ 'nope', '', undefined, 'blob1' ] )( 'throws for the unknown blob %o', ( name ) => {
		expect( () => deviceBlobColumn( name ) ).toThrow( TypeError );
	} );

	it.each( [ 'nope', '', undefined, 'refreshRate' ] )( 'throws for the unknown double %o', ( name ) => {
		expect( () => deviceDoubleColumn( name ) ).toThrow( TypeError );
	} );
} );

/**
 * The gate on the whole dataset.
 *
 * Getting it wrong is invisible from the page: too loose and the Devices panel fills with empty
 * boxes for scanner traffic, too tight and a real device is missing from the one panel built to
 * find it.
 */
describe( 'identifiesADevice', () => {
	it( 'accepts a full display poll', () => {
		expect( identifiesADevice( requestFor( DEVICE_HEADERS ) ) ).toBe( true );
	} );

	// `/api/setup` sends only four headers and `/api/display` sends everything, so either alone has
	// to be enough or enrollment would be missed.
	it.each( [
		[ 'ID alone', { ID: 'AA:BB:CC:DD:EE:FF' } ],
		[ 'Model alone', { Model: 'x' } ],
	] )( 'accepts %s', ( _label, headers ) => {
		expect( identifiesADevice( requestFor( headers ) ) ).toBe( true );
	} );

	it( 'rejects a browser or a scanner', () => {
		expect( identifiesADevice( requestFor( { 'User-Agent': 'Mozilla/5.0' } ) ) ).toBe( false );
	} );

	// A header present but blank is not a device reporting nothing, it is no device. Trimmed rather
	// than tested for presence, or an empty `ID` would mint a device box named after nothing.
	it( 'rejects a blank identifying header', () => {
		expect( identifiesADevice( requestFor( { ID: '   ', Model: '' } ) ) ).toBe( false );
	} );

	it( 'rejects a missing request rather than throwing', () => {
		expect( identifiesADevice( undefined ) ).toBe( false );
	} );
} );

describe( 'eventFromDeviceRequest', () => {
	it( 'lands every telemetry header in its own column', () => {
		const { blobs, doubles } = eventFromDeviceRequest( { request: requestFor( DEVICE_HEADERS ) } );

		expect( blobAt( blobs, 'deviceId' ) ).toBe( 'AA:BB:CC:DD:EE:FF' );
		expect( blobAt( blobs, 'model' ) ).toBe( 'x' );
		expect( blobAt( blobs, 'firmwareVersion' ) ).toBe( '1.7.2' );
		expect( blobAt( blobs, 'firmwareCommit' ) ).toBe( 'a1b2c3d' );
		expect( blobAt( blobs, 'wifiBand' ) ).toBe( '5' );
		expect( blobAt( blobs, 'batteryCharging' ) ).toBe( 'false' );
		expect( blobAt( blobs, 'usbConnected' ) ).toBe( 'false' );
		expect( blobAt( blobs, 'batteryCapacity' ) ).toBe( '4000/6000' );

		expect( doubleAt( doubles, 'refreshRateEcho' ) ).toBe( 60 );
		expect( doubleAt( doubles, 'batteryVoltage' ) ).toBe( 4.05 );
		expect( doubleAt( doubles, 'width' ) ).toBe( 1872 );
		expect( doubleAt( doubles, 'height' ) ).toBe( 1404 );
		expect( doubleAt( doubles, 'signalStrength' ) ).toBe( -58 );
	} );

	/**
	 * Verbatim text, not a parse.
	 *
	 * The firmware's spelling for the two flags is unverified, and `Wake-Time` is ambiguous in the
	 * sources this project has — the value looks like an epoch while the notes describe a duration.
	 * Storing what arrived is the only option that cannot be wrong, and a parse here would bake in a
	 * guess nobody can check until a real device has polled.
	 */
	it( 'stores the ambiguous fields as text rather than interpreting them', () => {
		const { blobs } = eventFromDeviceRequest( {
			request: requestFor( { ID: 'AA', 'Wake-Time': '1785564693', 'Battery-Charging': 'Yes' } ),
		} );

		expect( blobAt( blobs, 'wakeTime' ) ).toBe( '1785564693' );
		expect( blobAt( blobs, 'batteryCharging' ) ).toBe( 'Yes' );
	} );

	it( 'carries the request outcome so a device box can say what was drawn', () => {
		const { blobs } = eventFromDeviceRequest( {
			request: requestFor( DEVICE_HEADERS ),
			outcome: 'byos-display',
			filenameTag: 'obafail',
			upstreamReason: 'http-429',
		} );

		expect( blobAt( blobs, 'outcome' ) ).toBe( 'byos-display' );
		expect( blobAt( blobs, 'filenameTag' ) ).toBe( 'obafail' );
		expect( blobAt( blobs, 'upstreamReason' ) ).toBe( 'http-429' );
	} );

	it( 'takes the network from Cloudflare rather than from the device', () => {
		const { blobs } = eventFromDeviceRequest( {
			request: requestFor( { ID: 'AA', 'CF-Connecting-IP': '203.0.113.9' }, { country: 'US', asOrganization: 'Comcast Cable' } ),
		} );

		expect( blobAt( blobs, 'clientIp' ) ).toBe( '203.0.113.9' );
		expect( blobAt( blobs, 'country' ) ).toBe( 'US' );
		expect( blobAt( blobs, 'networkOrganization' ) ).toBe( 'Comcast Cable' );
	} );

	/**
	 * -1, never 0.
	 *
	 * 0 is a meaningful reading for most of these — a refresh rate of 0 is the hot-loop bug, and 0
	 * volts is not the same as no fuel gauge — so collapsing an absent header onto it would invent a
	 * fault. The firmware itself reports -1 for a gauge that failed to initialise.
	 */
	it( 'marks an absent or unparseable reading absent rather than zero', () => {
		const { doubles } = eventFromDeviceRequest( {
			request: requestFor( { ID: 'AA', 'Battery-Voltage': 'n/a', 'Percent-Charged': '' } ),
		} );

		expect( doubleAt( doubles, 'batteryVoltage' ) ).toBe( ABSENT_NUMBER );
		expect( doubleAt( doubles, 'percentCharged' ) ).toBe( ABSENT_NUMBER );
		expect( doubleAt( doubles, 'refreshRateEcho' ) ).toBe( ABSENT_NUMBER );
	} );

	it( 'passes the firmware -1 through unchanged, which is why the sentinel matches it', () => {
		const { doubles } = eventFromDeviceRequest( { request: requestFor( { ID: 'AA', 'Battery-Health': '-1' } ) } );

		expect( doubleAt( doubles, 'batteryHealth' ) ).toBe( ABSENT_NUMBER );
	} );

	it( 'fills every declared column, so no row is short', () => {
		const { blobs, doubles } = eventFromDeviceRequest( { request: requestFor( { ID: 'AA' } ) } );

		expect( blobs ).toHaveLength( DEVICE_BLOB_FIELDS.length );
		expect( doubles ).toHaveLength( DEVICE_DOUBLE_FIELDS.length );
		expect( blobs.every( ( value ) => typeof value === 'string' ) ).toBe( true );
	} );

	/**
	 * Headers are caller-controlled, and Analytics Engine bounds the total **bytes** of a row's
	 * blobs. Overrunning that budget makes `writeDataPoint` reject the row, which fails in the worst
	 * direction — the dropped rows would be exactly the anomalous ones worth seeing.
	 *
	 * A header cannot carry an emoji: HTTP header values are ByteStrings, so anything above U+00FF
	 * throws before it reaches us. Latin-1 accents are the worst a header can do, and they are still
	 * two UTF-8 bytes each — which is the case a character-counting cap would get wrong.
	 */
	it( 'clamps a hostile header by bytes rather than by characters', () => {
		const { blobs } = eventFromDeviceRequest( {
			request: requestFor( { ID: 'A'.repeat( 5000 ), Model: 'é'.repeat( 500 ) } ),
		} );

		expect( blobAt( blobs, 'deviceId' ).length ).toBeLessThanOrEqual( 64 );
		expect( new TextEncoder().encode( blobAt( blobs, 'model' ) ).length ).toBeLessThanOrEqual( 64 );
	} );

	// `asOrganization` is the one long field that does not come from a header, so it is the only one
	// that can legitimately contain a code point a header could never carry.
	it( 'clamps a wide network name from cf, where a header cap does not apply', () => {
		const { blobs } = eventFromDeviceRequest( {
			request: requestFor( { ID: 'AA' }, { asOrganization: '\u{1F600}'.repeat( 500 ) } ),
		} );

		expect( new TextEncoder().encode( blobAt( blobs, 'networkOrganization' ) ).length ).toBeLessThanOrEqual( 256 );
	} );

	// Sampling is stratified per index, so one device's polls cannot sample away another's. With a
	// single sign this does nothing; with two it is the difference between the Devices panel being
	// complete and being a guess.
	it( 'indexes on the MAC', () => {
		const { indexes } = eventFromDeviceRequest( { request: requestFor( DEVICE_HEADERS ) } );

		expect( indexes ).toEqual( [ 'AA:BB:CC:DD:EE:FF' ] );
	} );
} );

describe( 'recordDeviceTelemetry', () => {
	const binding = () => ( { writeDataPoint: vi.fn() } );

	it( 'writes one row for a device poll', () => {
		const DEVICE_TELEMETRY = binding();

		recordDeviceTelemetry( { DEVICE_TELEMETRY }, { request: requestFor( DEVICE_HEADERS ) } );

		expect( DEVICE_TELEMETRY.writeDataPoint ).toHaveBeenCalledTimes( 1 );
	} );

	/**
	 * The setup-logo download sends **no headers at all**, so a row for it would be eighteen empty
	 * columns claiming a device reported nothing — indistinguishable from a device whose fuel gauge
	 * failed, and enough to put a nameless box on the Devices panel.
	 */
	it( 'writes nothing for a request carrying no device headers', () => {
		const DEVICE_TELEMETRY = binding();

		recordDeviceTelemetry( { DEVICE_TELEMETRY }, { request: requestFor() } );

		expect( DEVICE_TELEMETRY.writeDataPoint ).not.toHaveBeenCalled();
	} );

	// The normal state under `wrangler dev`: local development must not need an Analytics Engine
	// dataset to exercise the gate.
	it( 'does nothing without the binding', () => {
		expect( () => recordDeviceTelemetry( {}, { request: requestFor( DEVICE_HEADERS ) } ) ).not.toThrow();
		expect( () => recordDeviceTelemetry( undefined, { request: requestFor( DEVICE_HEADERS ) } ) ).not.toThrow();
	} );

	// A metrics write is never worth an outage — `/api/display` runs ~900 times a day and the sign
	// going dark over telemetry would be the tail wagging the dog.
	it( 'swallows a failing write', () => {
		const DEVICE_TELEMETRY = {
			writeDataPoint: () => {
				throw new Error( 'dataset rejected the row' );
			},
		};

		expect( () =>
			recordDeviceTelemetry( { DEVICE_TELEMETRY }, { request: requestFor( DEVICE_HEADERS ) } )
		).not.toThrow();
	} );
} );
