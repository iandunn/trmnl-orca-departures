import { describe, expect, it } from 'vitest';
import { OUTCOME_LABELS, buildMockStatsData, escapeHtml, renderStatsHtml } from './render.js';
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
		},
		panel: { imageCached: [], imageCachedError: '', refreshEcho: [], refreshEchoError: '' },
		battery: { series: [], error: '' },
		renderOutcomes: { rows: [], error: '' },
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

	it( 'renders every section heading', () => {
		const html = renderStatsHtml( buildMockStatsData( '7d' ) );

		for ( const heading of [
			'Device identity',
			'Request totals',
			'Outcome breakdown',
			'Panel health',
			'Refresh rate echo',
			'Battery',
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

		data.battery.series = [ { bucket: '" onmouseover="alert(1)', voltage: 3.9, percent: 80 } ];

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

		expect( html ).toContain( 'That is the expected state' );
		expect( html ).toContain( 'until the BYOS endpoints exist' );
		expect( html ).toContain( 'Device identity' );
	} );

	it( 'renders a quiet "none" for each empty panel', () => {
		expect( ( renderStatsHtml( emptyData() ).match( /class="none"/g ) ?? [] ).length ).toBeGreaterThan( 4 );
	} );

	// Caught by looking at the rendered page rather than by an assertion: the panels that explain their
	// own empty state in a sentence were also falling through to a bare "none" underneath it, so each
	// read as though it had half-failed.
	it.each( [
		[ 'panel health', 'nothing has reported a cache result' ],
		[ 'battery', 'reported no battery readings' ],
		[ 'device logs', 'no way to file one' ],
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
		expect( html ).not.toContain( 'That is the expected state' );
	} );
} );

describe( 'per-panel errors', () => {
	it( 'reports a failed query inside its own panel without blanking the page', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.error = 'no such column: double99';

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'query failed: no such column: double99' );

		// Everything either side of the broken panel still renders.
		expect( html ).toContain( '>Panel health</h2>' );
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

	it( 'reports an absent latest reading as no data', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.series = [ { bucket: '2026-07-29 06:00:00', voltage: -1, percent: -1 } ];

		const html = renderStatsHtml( data );

		expect( html ).toContain( 'no data' );
		expect( chartPoints( html ) ).toHaveLength( 0 );
	} );

	it( 'plots a single reading without dividing by zero', () => {
		const data = buildMockStatsData( '7d' );

		data.battery.series = [ { bucket: '2026-07-29 06:00:00', voltage: 3.9, percent: 80 } ];

		expect( chartPoints( renderStatsHtml( data ) ) ).toHaveLength( 1 );
	} );
} );

describe( 'panel health', () => {
	it( 'renders the cache hit rate as a percentage, since it is the flicker rate', () => {
		const data = buildMockStatsData( '7d' );

		data.panel.imageCached = [
			{ imageCached: 'true', count: 750, lastSeen: '' },
			{ imageCached: 'false', count: 250, lastSeen: '' },
		];

		expect( renderStatsHtml( data ) ).toContain( '<strong>75.0%</strong>' );
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

	it( 'counts by level, giving error the warning tone so a spike needs no reading', () => {
		const html = deviceLogsPanel( renderStatsHtml( buildMockStatsData( '7d' ) ) );

		expect( barFor( html, 'error' ) ).toContain( 'bar-fill rejected' );
		expect( barFor( html, 'error' ) ).toContain( '>31</span>' );
		expect( barFor( html, 'info' ) ).toContain( 'bar-fill served' );
		expect( barFor( html, 'info' ) ).toContain( '>4,120</span>' );
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

	it( 'calls an empty panel expected state, because /api/log is not implemented yet', () => {
		const html = deviceLogsPanel( renderStatsHtml( emptyData() ) );

		expect( html ).toContain( 'no way to file one' );
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
