import { describe, expect, it } from 'vitest';
import { OUTCOME_LABELS, buildMockStatsData, escapeHtml, renderStatsHtml, signalBars } from './render.js';
import { OUTCOMES } from '../abuse.js';

/** The payload the page has to survive, in the fields an attacker actually controls. */
const INJECTION = '<img src=x onerror=alert(1)>';
const ESCAPED_INJECTION = '&lt;img src=x onerror=alert(1)&gt;';

/**
 * A dataset with every query succeeding and returning nothing — the real state of a freshly
 * deployed Worker, which is why it gets a banner rather than looking broken.
 */
function emptyData() {
	return {
		range: '2w',
		rangeLabel: 'Last 14 days',
		rangeDays: 14,
		errorMessage: '',
		totals: { total: 0, authorized: 0, rejected: 0 },
		outcomes: [],
		identity: {
			networks: [],
			networksError: '',
			firmware: [],
			firmwareError: '',
			setupCalls: 0,
			authorizedRequests: 0,
			expectedRequests: 8064,
			deviceCount: 0,
			deviceCountError: '',
		},
		panel: { imageCached: [], imageCachedError: '', refreshEcho: [], refreshEchoError: '' },
		battery: { series: [], error: '' },
		renderOutcomes: { rows: [], error: '' },
		upstreamReasons: { rows: [], error: '' },
		devices: { rows: [], error: '' },
		badRequests: { rows: [], error: '' },
		rejections: { sources: [], sourcesError: '', probePaths: [], probePathsError: '' },
		recent: { rows: [], error: '' },
		deviceLogs: { levels: [], levelsError: '', entries: [], entriesError: '' },
	};
}

/** The device logs panel alone, so an assertion about it cannot be satisfied by another section. */
function deviceLogsPanel( html ) {
	const start = html.indexOf( '>Device logs</h2>' );

	return html.slice( start, html.indexOf( '</section>', start ) );
}

describe( 'escapeHtml', () => {
	it.each( [
		[ '&', '&amp;' ],
		[ '<', '&lt;' ],
		[ '>', '&gt;' ],
		[ '"', '&quot;' ],
		[ '\'', '&#39;' ],
	] )( 'escapes %o', ( character, expected ) => {
		expect( escapeHtml( character ) ).toBe( expected );
	} );

	it( 'escapes every occurrence, not just the first', () => {
		expect( escapeHtml( '<<>>' ) ).toBe( '&lt;&lt;&gt;&gt;' );
	} );

	it( 'renders absent values as an empty string rather than "undefined"', () => {
		expect( escapeHtml( undefined ) ).toBe( '' );
		expect( escapeHtml( null ) ).toBe( '' );
	} );
} );

describe( 'renderStatsHtml', () => {
	it( 'returns one complete document with no external references', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html.startsWith( '<!doctype html>' ) ).toBe( true );
		expect( html ).toContain( '<meta name="robots" content="noindex">' );
		expect( html ).toContain( 'color-scheme:dark' );
		expect( html ).not.toContain( '<link' );
		expect( html ).not.toContain( '<script' );
		expect( html ).not.toMatch( /https?:\/\// );
	} );

	// Repaints, refresh echo and charge are `h3` rather than `h2` because they live inside a
	// device box: each describes one piece of hardware, and averaging them across devices would
	// describe none of them.
	it( 'renders the per-device readings inside a device box rather than as page-level panels', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		for ( const heading of [ 'Panel repaints', 'Refresh rate echo', 'Charge over time' ] ) {
			expect( html ).toContain( `>${ heading }</h3>` );
			expect( html ).not.toContain( `>${ heading }</h2>` );
		}

		const boxStart = html.indexOf( '>Device A4:CF:12:9B:7E:03</h2>' );
		const boxEnd = html.indexOf( '>Request totals</h2>' );

		expect( boxStart ).toBeGreaterThan( -1 );
		expect( html.slice( boxStart, boxEnd ) ).toContain( '>Charge over time</h3>' );
	} );

	it( 'renders every section heading', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		for ( const heading of [
			'Device identity',
			'Request totals',
			'Outcome breakdown',
			'Render outcomes',
			'Device logs',
			'Configuration errors',
			'Rejections',
			'Recent rejections',
		] ) {
			expect( html ).toContain( `>${ heading }</h2>` );
		}
	} );

	it( 'puts the device identity panel before the totals, since it is the alarm', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html.indexOf( 'Device identity' ) ).toBeLessThan( html.indexOf( 'Request totals' ) );
	} );

	it( 'builds the range picker from the selectable windows, marking the current one', () => {
		const html = renderStatsHtml( buildMockStatsData( '3m' ) );

		expect( html ).toContain( '<option value="3m" selected>Last 90 days (max)</option>' );
		expect( html ).toContain( '<option value="1d">Last 24 hours</option>' );
	} );

	it( 'labels outcomes rather than printing the wire values alone', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( escapeHtml( OUTCOME_LABELS[ OUTCOMES.unshapedPath ] ) );
	} );
} );

describe( 'escaping', () => {
	it( 'escapes an injection payload arriving through userAgent and probePath', () => {
		const data = buildMockStatsData( '7d' );
		const html = renderStatsHtml( data );

		// Counted from the data rather than hardcoded. Asserting only that the escaped form appears
		// would pass even if one field silently stopped rendering, and a hardcoded total would read
		// as an escaping regression the moment someone adds a mock row.
		const occurrences = [
			...data.rejections.sources.map( ( row ) => row.userAgent ),
			...data.rejections.probePaths.map( ( row ) => row.probePath ),
			...data.recent.rows.flatMap( ( row ) => [ row.userAgent, row.probePath ] ),
		].filter( ( value ) => value === INJECTION ).length;

		expect( occurrences ).toBeGreaterThan( 0 );
		expect( html ).not.toContain( INJECTION );
		expect( html.split( ESCAPED_INJECTION ).length - 1 ).toBe( occurrences );
	} );

	it( 'escapes quotes in attribute context, where a payload needs no angle bracket to break out', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.series = [
			{ deviceId: data.devices.rows[ 0 ].deviceId, bucket: '" onmouseover="alert(1)', voltage: 3.9, percent: 80 },
		];

		const html = renderStatsHtml( data );

		expect( html ).not.toContain( '" onmouseover="alert(1)' );
		expect( html ).toContain( '&quot; onmouseover=&quot;alert(1)' );
	} );
} );

describe( 'device identity alarms', () => {
	it( 'raises the alarm on a second network', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( '2 distinct networks — expected exactly one' );
		expect( html ).toContain( 'class="check alarm"' );
	} );

	it( 'stays calm on exactly one network', () => {
		const data = buildMockStatsData( '7d' );

		data.identity.networks = data.identity.networks.slice( 0, 1 );

		const html = renderStatsHtml( data );

		expect( html ).not.toContain( 'expected exactly one' );
		expect( html ).toContain( '1 network: Comcast Cable Communications (7922, US)' );
	} );

	it( 'flags any enrollment call, because enrollment is a once-per-repair event', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( 'enrollment should only happen' );
	} );

	it( 'does not flag zero enrollment calls', () => {
		const data = buildMockStatsData( '7d' );

		data.identity.setupCalls = 0;

		expect( renderStatsHtml( data ) ).not.toContain( 'enrollment should only happen' );
	} );

	it( 'flags poll volume only at roughly double the expectation, and says it is approximate', () => {
		const data = buildMockStatsData( '7d' );
		const doubled = renderStatsHtml( data );

		expect( doubled ).toContain( 'authenticated vs' );
		expect( doubled ).toContain( 'The expectation is approximate' );

		// 19102 against an expectation of 19000 is well within the factor of two that a device
		// waking to poll rather than on a wall clock produces.
		data.identity.expectedRequests = 19000;
		data.identity.networks = data.identity.networks.slice( 0, 1 );
		data.identity.firmware = data.identity.firmware.slice( 0, 1 );
		data.identity.setupCalls = 0;

		expect( renderStatsHtml( data ) ).not.toContain( 'class="check alarm"' );
	} );

	it( 'flags a second firmware or geometry, which catches a device on the same network', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( 'suggests a second physical device' );
	} );
} );

describe( 'zero data', () => {
	it( 'explains the empty state rather than looking broken', () => {
		const html = renderStatsHtml( emptyData() );

		expect( html ).toContain( 'that is expected' );
		expect( html ).toContain( 'Device identity' );
	} );

	// The banner is the only thing on the page when the dataset is empty, and an empty dataset has two
	// causes that look identical: nothing arrived, or every write was rejected. It claimed only the
	// first until 2026-08-02, which is the day the second one happened.
	it( 'names rejected writes as the other reason the dataset can be empty', () => {
		const html = renderStatsHtml( emptyData() );

		expect( html ).toContain( 'the writes are being rejected' );
		expect( html ).toContain( 'npm run tail' );
	} );

	it( 'renders a quiet "none" for each empty panel', () => {
		expect( ( renderStatsHtml( emptyData() ).match( /class="none"/g ) ?? [] ).length ).toBeGreaterThan( 4 );
	} );

	// Caught by looking at the rendered page rather than by an assertion: the panels that explain their
	// own empty state in a sentence were also falling through to a bare "none" underneath it, so each
	// read as though it had half-failed.
	it.each( [
		[ 'panel health', 'nothing has reported a cache result' ],
		[ 'battery', 'nothing has reported a battery reading' ],
		[ 'device logs', 'has not hit anything worth reporting' ],
	] )( 'does not print a bare "none" under the %s explanation', ( _label, explanation ) => {
		const html = renderStatsHtml( emptyData() );
		const afterExplanation = html.slice( html.indexOf( explanation ) + explanation.length );

		// Whatever comes next must be the end of that panel, not another empty-state line inside it.
		expect( afterExplanation.slice( 0, afterExplanation.indexOf( '</section>' ) ) ).not.toContain(
			'class="none"'
		);
	} );

	it( 'does not claim an expected empty state when a query failed', () => {
		const data = emptyData();

		data.errorMessage = 'SQL API HTTP 403';

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'query failed: SQL API HTTP 403' );
		expect( html ).not.toContain( 'that is expected' );
	} );
} );

/**
 * The unpaired state.
 *
 * Everything in the identity panel is a comparison against what a paired sign looks like, and the
 * page had no way to say there was nothing to compare — so two hand-made `curl` calls rendered as a
 * device on an unknown firmware build with a panel of -1 by -1 and a poll count 12,000 short of
 * expectation, every line of it labelled `ok`.
 */
describe( 'before any device has polled', () => {
	it( 'says so once, plainly, rather than leaving it to be inferred', () => {
		const html = renderStatsHtml( emptyData() );

		expect( html ).toContain( 'Paired device' );
		expect( html ).toContain( 'No device has polled in this window' );
	} );

	it( 'withholds the expected poll count instead of showing a 12,000-poll shortfall', () => {
		const html = renderStatsHtml( emptyData() );

		expect( html ).toContain( 'Nothing to compare yet' );
		expect( html ).not.toContain( '8,064 expected' );
	} );

	it( 'raises no alarm, because an unpaired sign is not a fault', () => {
		expect( renderStatsHtml( emptyData() ) ).not.toContain( 'class="check alarm"' );
	} );

	// A failed query returns zero rows, and "no device has polled" is a claim rather than a default.
	// Without this the page would answer a broken query with a confident statement about hardware.
	it( 'does not claim an unpaired sign when the device query failed', () => {
		const data = emptyData();

		data.identity.deviceCountError = 'SQL API HTTP 422';

		const html = renderStatsHtml( data );

		expect( html ).not.toContain( 'Paired device' );
		expect( html ).not.toContain( 'Nothing to compare yet' );
	} );

	it( 'drops the unpaired copy once a device appears', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).not.toContain( 'Paired device' );
		expect( html ).toContain( 'authenticated vs' );
	} );
} );

/**
 * No panel may print reassurance beside its own error.
 *
 * The rule was written down for the device-logs panel and applied nowhere else, so `/stats` rendered
 * "every stop answered on every poll in this window" directly under the 422 from the query that
 * would have found out. The sentence is the part a reader believes.
 */
/**
 * `emptyData()` plus one device that has reported nothing.
 *
 * Repaints, refresh echo and charge are drawn inside a device box, so their empty states need a
 * box to be empty *in*. This is the state a sign is in between its first poll and its first reading.
 */
function emptyDataWithDevice() {
	const data = emptyData();

	data.devices.rows = [ { deviceId: 'AA:BB:CC:00:11:22', lastSeen: '2026-08-01 07:00:00' } ];
	data.identity.deviceCount = 1;

	return data;
}

describe( 'empty states beside a failed query', () => {
	it.each( [
		[ 'upstreamReasons', 'error', 'every stop answered' ],
		[ 'renderOutcomes', 'error', 'nothing has been rendered yet' ],
	] )( 'withholds the %s empty state when its query failed', ( section, key, sentence ) => {
		const clean = emptyData();

		expect( renderStatsHtml( clean ) ).toContain( sentence );

		const broken = emptyData();

		broken[ section ][ key ] = 'SQL API HTTP 422';

		const html = renderStatsHtml( broken );

		expect( html ).toContain( 'query failed: SQL API HTTP 422' );
		expect( html ).not.toContain( sentence );
	} );

	// The per-device blocks need a device to render into, so these use a box with no readings in it
	// rather than `emptyData()` — with no device there is no empty state to withhold in the first place.
	it.each( [
		[ 'battery', 'error', 'this device has not reported a battery reading yet' ],
		[ 'panel', 'imageCachedError', 'this device has not reported a cache result yet' ],
		[ 'panel', 'refreshEchoError', 'this device has not reported a refresh rate yet' ],
	] )( 'withholds the %s.%s empty state when its query failed', ( section, key, sentence ) => {
		expect( renderStatsHtml( emptyDataWithDevice() ) ).toContain( sentence );

		const broken = emptyDataWithDevice();

		broken[ section ][ key ] = 'SQL API HTTP 422';

		const html = renderStatsHtml( broken );

		expect( html ).toContain( 'query failed: SQL API HTTP 422' );
		expect( html ).not.toContain( sentence );
	} );

	// Those three blocks only exist inside a device box, so with no device their failures have nowhere
	// to appear — and a query error rendered nowhere reads exactly like a device that has not polled.
	it.each( [
		[ 'battery', 'error' ],
		[ 'panel', 'imageCachedError' ],
		[ 'panel', 'refreshEchoError' ],
	] )( 'still reports a failed %s.%s query when no device has polled', ( section, key ) => {
		const broken = emptyData();

		broken[ section ][ key ] = 'SQL API HTTP 422';

		expect( renderStatsHtml( broken ) ).toContain( 'query failed: SQL API HTTP 422' );
	} );
} );

describe( 'per-panel errors', () => {
	it( 'reports a failed query inside its own panel without blanking the page', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.error = 'no such column: double99';

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'query failed: no such column: double99' );

		// Everything either side of the broken block still renders.
		expect( html ).toContain( '>Panel repaints</h3>' );
		expect( html ).toContain( '>Render outcomes</h2>' );
		expect( html ).toContain( '2 distinct networks — expected exactly one' );
	} );

	it( 'reports each ranked rejection column separately', () => {
		const data = buildMockStatsData( '7d' );

		data.rejections.probePathsError = 'probe query broke';

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'query failed: probe query broke' );
		expect( html ).toContain( 'CensysInspect' );
	} );
} );

describe( 'battery', () => {
	/** The coordinate pairs the chart actually plots. */
	function chartPoints( html ) {
		const match = /<polyline class="series" points="([^"]*)"/.exec( html );

		return match ? match[ 1 ].split( ' ' ) : [];
	}

	it( 'leaves buckets with no charge reading out of the chart rather than plotting -1', () => {
		const data = buildMockStatsData( '7d' );
		const usable = data.battery.series.filter( ( point ) => point.percent > -1 );

		const html = renderStatsHtml( data );

		expect( usable.length ).toBeLessThan( data.battery.series.length );
		expect( chartPoints( html ) ).toHaveLength( usable.length );
		expect( html ).toContain( 'left out of the chart' );
	} );

	// Asserted through the empty state rather than through "no data", which the device-log table also
	// prints — that made this pass while testing nothing after the latest-reading line was removed.
	it( 'draws no chart, and says so, when every bucket is absent', () => {
		const data = buildMockStatsData( '7d' );
		const deviceId = data.devices.rows[ 0 ].deviceId;

		data.battery.series = [ { deviceId, bucket: '2026-07-29 06:00:00', voltage: -1, percent: -1, signal: -1 } ];

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'this device has not reported a battery reading yet' );
		expect( html ).toContain( 'this device has not reported a WiFi signal reading yet' );
		expect( chartPoints( html ) ).toHaveLength( 0 );
	} );

	// The two series are different phenomena and must not be generated as one shape: a sign on a wall
	// does not drift away from its router, so RSSI is flat and noisy while charge trends down.
	it( 'gives WiFi signal a flat, noisy shape rather than the battery curve', () => {
		const reported = buildMockStatsData( '3m' ).battery.series.filter( ( point ) => point.percent > -1 );
		const first = reported.slice( 0, 20 );
		const last = reported.slice( -20 );

		const mean = ( points, key ) => points.reduce( ( sum, point ) => sum + point[ key ], 0 ) / points.length;

		// Charge ends materially lower than it started; signal does not.
		expect( mean( last, 'percent' ) ).toBeLessThan( mean( first, 'percent' ) - 10 );
		expect( Math.abs( mean( last, 'signal' ) - mean( first, 'signal' ) ) ).toBeLessThan( 8 );

		// And it is noise, not a constant — there are dips well below the baseline.
		expect( Math.min( ...reported.map( ( point ) => point.signal ) ) ).toBeLessThan( -70 );
		expect( Math.max( ...reported.map( ( point ) => point.signal ) ) ).toBeGreaterThan( -64 );
	} );

	it( 'trims the series to the selected range, the way the real query does', () => {
		const long = buildMockStatsData( '3m' ).battery.series;
		const short = buildMockStatsData( '7d' ).battery.series;

		expect( long ).toHaveLength( 90 * 4 );
		expect( short ).toHaveLength( 7 * 4 );

		// The short window is the recent end of the same history, not a separately generated series.
		expect( short ).toEqual( long.slice( -short.length ) );
	} );

	it( 'scales volumes with the range, so the picker moves the numbers and not only the charts', () => {
		const week = buildMockStatsData( '7d' );
		const month = buildMockStatsData( '1m' );

		expect( month.totals.total ).toBeGreaterThan( week.totals.total * 3 );
		expect( month.deviceLogs.levels[ 0 ].count ).toBeGreaterThan( week.deviceLogs.levels[ 0 ].count * 3 );

		// Enrolments are discrete events, so they say the same thing on every range.
		expect( month.identity.setupCalls ).toBe( week.identity.setupCalls );
		expect( month.identity.enrollments ).toEqual( week.identity.enrollments );
		expect( month.recent.rows ).toEqual( week.recent.rows );
	} );

	it( 'dates the intermediate x ticks, not only the two ends', () => {
		const html = renderStatsHtml( buildMockStatsData( '2w' ) );
		const tracks = html.split( '<div class="x-track">' ).slice( 1 );

		// One per chart: charge and WiFi signal.
		expect( tracks ).toHaveLength( 2 );
		expect( [ ...tracks[ 0 ].matchAll( /class="x-tick"/g ) ] ).toHaveLength( 5 );

		// The leftmost keeps its year so the rest can drop it.
		expect( tracks[ 0 ] ).toMatch( /class="x-tick"[^>]*>\d{4}-\d{2}-\d{2}</ );
		expect( tracks[ 0 ] ).toMatch( /class="x-tick"[^>]*>\d{2}-\d{2}</ );
	} );

	it( 'plots a single reading without dividing by zero', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.series = [
			{ deviceId: data.devices.rows[ 0 ].deviceId, bucket: '2026-07-29 06:00:00', voltage: 3.9, percent: 80 },
		];

		expect( chartPoints( renderStatsHtml( data ) ) ).toHaveLength( 1 );
	} );

	// The whole point of the per-device split: one sign at 20% must not be averaged into a healthy one.
	it( 'charts each device from its own readings rather than from a shared average', () => {
		const data = buildMockStatsData( '7d' );
		const first = data.devices.rows[ 0 ].deviceId;
		const second = 'BB:CC:DD:11:22:33';

		data.devices.rows = [ ...data.devices.rows, { ...data.devices.rows[ 0 ], deviceId: second } ];

		data.battery.series = [
			{ deviceId: first, bucket: '2026-07-29 00:00:00', voltage: 4.01, percent: 91 },
			{ deviceId: first, bucket: '2026-07-29 06:00:00', voltage: 4.0, percent: 90 },
			{ deviceId: second, bucket: '2026-07-29 06:00:00', voltage: 3.4, percent: 20 },
		];

		const html = renderStatsHtml( data );
		const split = html.indexOf( `>Device ${ second }</h2>` );

		expect( split ).toBeGreaterThan( -1 );
		expect( html.slice( 0, split ) ).toContain( 'Battery charge over 2 buckets' );
		expect( html.slice( split ) ).toContain( 'Battery charge over 1 buckets' );

		// The second device sits at 20%, a fifth of the way up a 0-100 axis, so its single point is
		// plotted at y = 104 of 130. Averaged against the first device it would land near the top
		// instead, which makes the coordinate the assertion rather than the bucket count.
		expect( html.slice( split ) ).toContain( 'points="360.0,104.0"' );
	} );
} );

describe( 'device facts the server did not observe', () => {
	/** Every device-box row as `[ label, marked ]`, with the marker stripped back out of the label. */
	function factRows( html ) {
		return [ ...html.matchAll( /<div class="fact"><dt>(.*?)<\/dt>/g ) ].map( ( [ , dt ] ) => [
			dt.replace( '<span class="tell">*</span>', '' ),
			dt.includes( 'tell' ),
		] );
	}

	it( 'marks the MAC address, which a caller replaying the URL can set to anything', () => {
		const rows = factRows( renderStatsHtml( buildMockStatsData( '7d' ) ) );

		expect( rows.length ).toBeGreaterThan( 0 );
		expect( rows ).toContainEqual( [ 'MAC address', true ] );
		expect( rows ).toContainEqual( [ 'IP address', false ] );
	} );

	// Pins the classification from the rendered output rather than from the constant, so renaming a
	// label in `facts` without renaming it in `OBSERVED_DEVICE_FACTS` fails here instead of silently
	// marking an observed row as self-reported.
	it( 'leaves unmarked exactly the rows the server worked out for itself', () => {
		const unmarked = factRows( renderStatsHtml( buildMockStatsData( '7d' ) ) )
			.filter( ( [ , marked ] ) => ! marked )
			.map( ( [ label ] ) => label );

		expect( unmarked ).toEqual( [
			'IP address',
			'Network',
			'Last seen',
			'Last request',
			'Last screen served',
			'Upstream on that poll',
		] );
	} );

	it( 'explains the marker in the box rather than leaving a bare asterisk', () => {
		expect( renderStatsHtml( buildMockStatsData( '7d' ) ) ).toContain( 'Self-reported by the device' );
	} );
} );

describe( 'panel repaints', () => {
	it( 'renders the share of wakes that did not repaint, as a percentage', () => {
		const data = buildMockStatsData( '7d' );
		const deviceId = data.devices.rows[ 0 ].deviceId;

		data.panel.imageCached = [
			{ deviceId, imageCached: 'true', count: 750, lastSeen: '' },
			{ deviceId, imageCached: 'false', count: 250, lastSeen: '' },
		];

		expect( renderStatsHtml( data ) ).toContain( '<strong>75.0%</strong>' );
	} );

	// The rate is per device for the same reason the charge chart is: one sign repainting on every
	// wake is the fault this number exists to expose, and an average with a healthy sign hides it.
	it( 'computes the rate per device rather than across all of them', () => {
		const data = buildMockStatsData( '7d' );
		const first = data.devices.rows[ 0 ].deviceId;
		const second = 'BB:CC:DD:11:22:33';

		data.devices.rows = [ ...data.devices.rows, { ...data.devices.rows[ 0 ], deviceId: second } ];

		data.panel.imageCached = [
			{ deviceId: first, imageCached: 'true', count: 900, lastSeen: '' },
			{ deviceId: first, imageCached: 'false', count: 100, lastSeen: '' },
			{ deviceId: second, imageCached: 'false', count: 1000, lastSeen: '' },
		];

		const html = renderStatsHtml( data );
		const split = html.indexOf( `>Device ${ second }</h2>` );

		expect( html.slice( 0, split ) ).toContain( '<strong>90.0%</strong>' );
		expect( html.slice( split ) ).toContain( '<strong>0.0%</strong>' );
	} );

	it( 'calls out a refresh rate of 0, which arrives as a string from a double column', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( '0 seconds — the hot-loop bug' );
		expect( html ).toContain( '60 seconds' );
	} );
} );

describe( 'device logs', () => {
	/** The one ranked bar carrying a given label, so a tone assertion cannot match another row. */
	function barFor( html, label ) {
		const rows = html.split( '<li class="bar">' );

		return rows.find( ( row ) => row.includes( `>${ label }</span>` ) ) ?? '';
	}

	it( 'sits between the render outcomes and the configuration errors', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );
		const panelAt = ( heading ) => html.indexOf( `>${ heading }</h2>` );

		expect( panelAt( 'Render outcomes' ) ).toBeLessThan( panelAt( 'Device logs' ) );
		expect( panelAt( 'Device logs' ) ).toBeLessThan( panelAt( 'Configuration errors' ) );
	} );

	it( 'explains that the source pair names a line of firmware, which is why it is stored', () => {
		expect( renderStatsHtml( buildMockStatsData( '7d' ) ) ).toContain( 'name the exact line of' );
	} );

	// Counts are read out of the data rather than hardcoded, because the mock scales its volumes to
	// the selected range — a literal here would pin the range as much as the rendering.
	it( 'counts by level, giving error the warning tone so a spike needs no reading', () => {
		const data = buildMockStatsData( '7d' );
		const html = deviceLogsPanel( renderStatsHtml( data ) );
		const countOf = ( level ) => data.deviceLogs.levels.find( ( row ) => row.level === level ).count;

		expect( barFor( html, 'error' ) ).toContain( 'bar-fill rejected' );
		expect( barFor( html, 'error' ) ).toContain( `>${ countOf( 'error' ) }</span>` );
		expect( barFor( html, 'info' ) ).toContain( 'bar-fill served' );
		expect( barFor( html, 'info' ) ).toContain( `>${ countOf( 'info' ).toLocaleString( 'en-US' ) }</span>` );
	} );

	it( 'renders the source as path:line', () => {
		const html = deviceLogsPanel( renderStatsHtml( buildMockStatsData( '7d' ) ) );

		expect( html ).toContain( 'src/png.cpp:118' );
	} );

	it( 'renders an absent heap or signal reading as no data, never as the sentinel', () => {
		const html = deviceLogsPanel( renderStatsHtml( buildMockStatsData( '7d' ) ) );

		expect( html ).toContain( '>no data</td>' );
		expect( html ).not.toContain( '-1' );

		// A real signal is negative, so anything treating "below the sentinel" as absent would swallow
		// every reading the device ever sends.
		expect( html ).toContain( '-67 dBm' );
		expect( html ).toContain( '21,440 bytes' );
	} );

	it( 'marks a clipped message rather than letting it read as complete', () => {
		const html = deviceLogsPanel( renderStatsHtml( buildMockStatsData( '7d' ) ) );

		expect( html ).toContain( 'the device sent 1,420 bytes and' );
		expect( html ).toContain( 'panel…</td>' );

		// Only the entry whose byte count exceeds what is on the page, not every entry.
		expect( html.split( 'clipped on write' ).length - 1 ).toBe( 1 );
	} );

	it( 'escapes an injection payload arriving through a log message', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).not.toContain( '<img src=x onerror=alert(3)>' );
		expect( deviceLogsPanel( html ) ).toContain( '&lt;img src=x onerror=alert(3)&gt;' );
	} );

	// The copy said `/api/log` was unimplemented long after it landed, which would have read a real
	// outage as expected state. Pinned as an assertion that the endpoint is described as working, so
	// the same drift fails a test rather than sitting on the page.
	it( 'calls an empty panel expected state without claiming the endpoint is missing', () => {
		const html = deviceLogsPanel( renderStatsHtml( emptyData() ) );

		expect( html ).toContain( 'implemented and reachable' );
		expect( html ).not.toContain( 'not implemented' );
		expect( html ).not.toContain( '<table' );
	} );

	it.each( [
		[ 'levelsError', 'level query broke' ],
		[ 'entriesError', 'entry query broke' ],
	] )( 'reports %s inside the panel without blanking the page', ( key, message ) => {
		const data = buildMockStatsData( '7d' );

		data.deviceLogs[ key ] = message;

		const html = renderStatsHtml( data );

		expect( deviceLogsPanel( html ) ).toContain( `query failed: ${ message }` );
		expect( html ).toContain( '>Render outcomes</h2>' );
		expect( html ).toContain( '>Configuration errors</h2>' );
		expect( html ).toContain( 'src/png.cpp:118' );
	} );
} );

describe( 'configuration errors', () => {
	it( 'turns a rejection reason into a sentence and warns that stop IDs are on the page', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		expect( html ).toContain( 'A stop ID contains characters no OBA stop ID has.' );
		expect( html ).toContain( 'carries the sign&#39;s location' );
	} );
} );

describe( 'buildMockStatsData', () => {
	it( 'follows the requested range, falling back to the default for an unknown key', () => {
		expect( buildMockStatsData( '1d' ) ).toMatchObject( { range: '1d', rangeDays: 1 } );
		expect( buildMockStatsData( 'nonsense' ) ).toMatchObject( { range: '2w', rangeDays: 14 } );
	} );

	it( 'names no stop this sign points at — the downtown samples only', () => {
		const stops = buildMockStatsData( '7d' ).badRequests.rows.map( ( row ) => row.stopIds );

		expect( stops ).toEqual( [ '590,43O', '621,623,1121' ] );
	} );
} );

describe( 'signalBars', () => {
	// The trap this exists for: RSSI is legitimately negative, so a naive "is it below zero" check
	// cannot tell a real reading from the -1 the schema writes for an absent header. -1 must read as
	// no bars, not as the strongest possible signal.
	it( 'treats the absent sentinel as no reading rather than a strong one', () => {
		expect( signalBars( -1 ) ).toBe( 0 );
		expect( signalBars( 0 ) ).toBe( 0 );
		expect( signalBars( '' ) ).toBe( 0 );
		expect( signalBars( undefined ) ).toBe( 0 );
	} );

	it.each( [
		[ -40, 4 ],
		[ -55, 4 ],
		[ -56, 3 ],
		[ -67, 3 ],
		[ -68, 2 ],
		[ -75, 2 ],
		[ -76, 1 ],
		[ -95, 1 ],
	] )( 'draws %i dBm as %i bars', ( rssi, bars ) => {
		expect( signalBars( rssi ) ).toBe( bars );
	} );

	// Analytics Engine hands doubles back as strings often enough that every other reader coerces.
	it( 'accepts the strings the SQL API actually returns', () => {
		expect( signalBars( '-61' ) ).toBe( 3 );
	} );
} );
