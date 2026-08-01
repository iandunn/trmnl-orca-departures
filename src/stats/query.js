/**
 * Reading the stats back out of Analytics Engine.
 *
 * Analytics Engine is written through a Worker binding but read through an HTTP SQL API, which is an
 * asymmetry worth knowing before it surprises you: there is no `env.ANALYTICS.query()`. The read
 * needs an account ID and a Cloudflare API token scoped to Account Analytics read, and it has to
 * happen server-side because that API sends no CORS headers — a browser cannot call it directly even
 * with a valid token.
 *
 * Every count is `SUM(_sample_interval)` rather than `COUNT(*)`. Analytics Engine samples under load
 * and stores the sampling factor per row, so `COUNT(*)` silently under-reports exactly when the
 * numbers start to matter.
 *
 * Queries run concurrently and fail independently. A page where one panel says "query failed" is far
 * more useful than a page that renders nothing because a single `GROUP BY` was wrong, and this file
 * is where a broken query is most likely to live.
 */

import { blobColumn, doubleColumn, ABSENT_NUMBER } from './schema.js';
import { logBlobColumn, logDoubleColumn } from './device-logs.js';

const SQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * Selectable windows. Capped at 90 days because that is Analytics Engine's own retention — offering
 * a year would return a quietly truncated answer.
 */
export const STATS_RANGES = [
	{ key: '1d', label: 'Last 24 hours', days: 1 },
	{ key: '3d', label: 'Last 3 days', days: 3 },
	{ key: '7d', label: 'Last 7 days', days: 7 },
	{ key: '2w', label: 'Last 14 days', days: 14 },
	{ key: '1m', label: 'Last 30 days', days: 30 },
	{ key: '3m', label: 'Last 90 days (max)', days: 90 },
];

const DEFAULT_RANGE = '2w';

export function resolveRange( key ) {
	return STATS_RANGES.find( ( range ) => range.key === key ) ?? STATS_RANGES.find( ( range ) => range.key === DEFAULT_RANGE );
}

/**
 * Runs one SQL statement.
 *
 * @returns {Promise<object[]>} The `data` rows, or throws with a message fit to show on the page.
 */
async function sqlQuery( env, statement ) {
	if ( ! env?.CLOUDFLARE_ACCOUNT_ID ) {
		throw new Error( 'CLOUDFLARE_ACCOUNT_ID is not set' );
	}

	if ( ! env?.ANALYTICS_API_TOKEN ) {
		throw new Error( 'ANALYTICS_API_TOKEN is not set' );
	}

	const response = await fetch( `${ SQL_ENDPOINT }/${ env.CLOUDFLARE_ACCOUNT_ID }/analytics_engine/sql`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${ env.ANALYTICS_API_TOKEN }` },
		body: statement,
	} );

	if ( ! response.ok ) {
		// The body usually explains which column or function was wrong, and it is the only thing that
		// makes a broken query debuggable from the page itself.
		throw new Error( `SQL API HTTP ${ response.status }: ${ ( await response.text() ).slice( 0, 200 ) }` );
	}

	const payload = await response.json();

	return payload?.data ?? [];
}

/** Analytics Engine returns numbers as strings often enough that every read goes through this. */
function toNumber( value ) {
	const parsed = Number( value );

	return Number.isFinite( parsed ) ? parsed : 0;
}

/**
 * A `GROUP BY` over one or more columns, newest-heaviest first.
 *
 * @param {string[]} columns  Named blob/double columns, already resolved.
 */
function groupQuery( { dataset, columns, where, days, limit = 40 } ) {
	const selected = columns.map( ( column, index ) => `${ column } AS field${ index }` ).join( ', ' );
	const grouped = columns.join( ', ' );
	const filter = where ? `AND ${ where }` : '';

	return `
		SELECT ${ selected }, SUM(_sample_interval) AS count, MAX(timestamp) AS last_seen
		FROM ${ dataset }
		WHERE timestamp > NOW() - INTERVAL '${ days }' DAY ${ filter }
		GROUP BY ${ grouped }
		ORDER BY count DESC
		LIMIT ${ limit }
	`;
}

function rowsToGroups( rows, names ) {
	return rows.map( ( row ) => {
		const group = { count: toNumber( row.count ), lastSeen: row.last_seen ?? '' };

		names.forEach( ( name, index ) => {
			group[ name ] = row[ `field${ index }` ] ?? '';
		} );

		return group;
	} );
}

/**
 * How many polls the device should have made in the window, from config rather than from a constant.
 *
 * The point of this number is the comparison: two devices sharing a stolen token poll twice as
 * often, and without an expectation there is nothing to notice that against. It is deliberately
 * approximate — the device wakes to poll rather than on a wall clock, and a render that does not
 * change still costs a poll, so treat a result within a factor of two as normal.
 */
export function expectedRequests( config, days ) {
	const activeMinutes = Math.max( 0, config.activeEndMinutes - config.activeStartMinutes );
	const idleMinutes = Math.max( 0, 1440 - activeMinutes );

	const perDay =
		( activeMinutes * 60 ) / config.refreshActiveSeconds + ( idleMinutes * 60 ) / config.refreshIdleSeconds;

	return Math.round( perDay * days );
}

/**
 * Assembles everything the page renders.
 *
 * @param   {object} env
 * @param   {object} config     From `readConfig()`, for the expected-volume comparison.
 * @param   {string} rangeKey
 * @returns {Promise<StatsData>}
 */
export async function buildStatsData( env, config, rangeKey ) {
	const range = resolveRange( rangeKey );
	const dataset = env?.ANALYTICS_DATASET || 'trmnl_orca_departures_requests';
	const logDataset = env?.DEVICE_LOGS_DATASET || 'trmnl_orca_departures_device_logs';
	const days = range.days;

	const authorizedOnly = `${ blobColumn( 'authorized' ) } = '1'`;
	const rejectedOnly = `${ blobColumn( 'authorized' ) } = '0'`;

	// Each panel resolves to `{data, error}` independently, so one malformed query degrades one
	// section rather than blanking the page.
	const run = async ( statement ) => {
		try {
			return { data: await sqlQuery( env, statement ), error: '' };
		} catch ( error ) {
			return { data: [], error: error.message ?? String( error ) };
		}
	};

	const [
		outcomes,
		networks,
		firmware,
		imageCached,
		refreshEcho,
		battery,
		renderOutcomes,
		badRequests,
		rejectionSources,
		probePaths,
		recent,
		logLevels,
		logEntries,
	] = await Promise.all( [
		run( groupQuery( { dataset, columns: [ blobColumn( 'outcome' ), blobColumn( 'authorized' ) ], days } ) ),

		run(
			groupQuery( {
				dataset,
				columns: [ blobColumn( 'asn' ), blobColumn( 'networkOrganization' ), blobColumn( 'country' ) ],
				where: authorizedOnly,
				days,
			} )
		),

		run(
			groupQuery( {
				dataset,
				columns: [
					blobColumn( 'firmwareVersion' ),
					blobColumn( 'model' ),
					doubleColumn( 'width' ),
					doubleColumn( 'height' ),
				],
				where: authorizedOnly,
				days,
			} )
		),

		run( groupQuery( { dataset, columns: [ blobColumn( 'imageCached' ) ], where: authorizedOnly, days } ) ),

		run( groupQuery( { dataset, columns: [ doubleColumn( 'refreshRateEcho' ) ], where: authorizedOnly, days } ) ),

		run( `
			SELECT
				toStartOfInterval(timestamp, INTERVAL '6' HOUR) AS bucket,
				AVG(${ doubleColumn( 'batteryVoltage' ) }) AS voltage,
				AVG(${ doubleColumn( 'percentCharged' ) }) AS percent
			FROM ${ dataset }
			WHERE timestamp > NOW() - INTERVAL '${ days }' DAY
				AND ${ authorizedOnly }
				AND ${ doubleColumn( 'percentCharged' ) } > ${ ABSENT_NUMBER }
			GROUP BY bucket
			ORDER BY bucket ASC
			LIMIT 400
		` ),

		run( groupQuery( { dataset, columns: [ blobColumn( 'filenameTag' ) ], where: authorizedOnly, days } ) ),

		run(
			groupQuery( {
				dataset,
				columns: [ blobColumn( 'reason' ), blobColumn( 'agency' ), blobColumn( 'stopIds' ) ],
				where: `${ blobColumn( 'reason' ) } != ''`,
				days,
			} )
		),

		run(
			groupQuery( {
				dataset,
				columns: [ blobColumn( 'country' ), blobColumn( 'networkOrganization' ), blobColumn( 'userAgent' ) ],
				where: rejectedOnly,
				days,
			} )
		),

		run( groupQuery( { dataset, columns: [ blobColumn( 'probePath' ) ], where: rejectedOnly, days, limit: 25 } ) ),

		run( `
			SELECT
				timestamp,
				${ blobColumn( 'outcome' ) } AS outcome,
				${ blobColumn( 'country' ) } AS country,
				${ blobColumn( 'networkOrganization' ) } AS organization,
				${ blobColumn( 'userAgent' ) } AS user_agent,
				${ blobColumn( 'probePath' ) } AS probe_path
			FROM ${ dataset }
			WHERE timestamp > NOW() - INTERVAL '${ days }' DAY AND ${ rejectedOnly }
			ORDER BY timestamp DESC
			LIMIT 50
		` ),

		// The device's own diagnostics, from the separate dataset. Queried unconditionally: an empty
		// result is itself informative, since a device that has never filed a log is either healthy or
		// unable to reach us, and the request rows next to it say which.
		run(
			groupQuery( {
				dataset: logDataset,
				columns: [ logBlobColumn( 'level' ) ],
				days,
			} )
		),

		run( `
			SELECT
				timestamp,
				${ logBlobColumn( 'level' ) } AS level,
				${ logBlobColumn( 'message' ) } AS message,
				${ logBlobColumn( 'sourcePath' ) } AS source_path,
				${ logDoubleColumn( 'sourceLine' ) } AS source_line,
				${ logBlobColumn( 'firmwareVersion' ) } AS firmware_version,
				${ logBlobColumn( 'wakeReason' ) } AS wake_reason,
				${ logDoubleColumn( 'freeHeapSize' ) } AS free_heap_size,
				${ logDoubleColumn( 'wifiSignal' ) } AS wifi_signal,
				${ logDoubleColumn( 'messageBytes' ) } AS message_bytes
			FROM ${ logDataset }
			WHERE timestamp > NOW() - INTERVAL '${ days }' DAY
			ORDER BY timestamp DESC
			LIMIT 60
		` ),
	] );

	const outcomeRows = rowsToGroups( outcomes.data, [ 'outcome', 'authorized' ] );

	const authorizedCount = outcomeRows
		.filter( ( row ) => row.authorized === '1' )
		.reduce( ( sum, row ) => sum + row.count, 0 );

	const rejectedCount = outcomeRows
		.filter( ( row ) => row.authorized !== '1' )
		.reduce( ( sum, row ) => sum + row.count, 0 );

	const networkRows = rowsToGroups( networks.data, [ 'asn', 'organization', 'country' ] );

	const setupCalls = outcomeRows
		.filter( ( row ) => row.outcome === 'setup' )
		.reduce( ( sum, row ) => sum + row.count, 0 );

	return {
		range: range.key,
		rangeLabel: range.label,
		rangeDays: days,
		errorMessage: outcomes.error,

		totals: {
			total: authorizedCount + rejectedCount,
			authorized: authorizedCount,
			rejected: rejectedCount,
		},

		outcomes: collapseOutcomes( outcomeRows ),

		identity: {
			networks: networkRows,
			networksError: networks.error,
			firmware: rowsToGroups( firmware.data, [ 'firmwareVersion', 'model', 'width', 'height' ] ),
			firmwareError: firmware.error,
			setupCalls,
			authorizedRequests: authorizedCount,
			expectedRequests: expectedRequests( config, days ),
		},

		panel: {
			imageCached: rowsToGroups( imageCached.data, [ 'imageCached' ] ),
			imageCachedError: imageCached.error,
			refreshEcho: rowsToGroups( refreshEcho.data, [ 'refreshRateEcho' ] ),
			refreshEchoError: refreshEcho.error,
		},

		battery: {
			series: battery.data.map( ( row ) => ( {
				bucket: row.bucket ?? '',
				voltage: toNumber( row.voltage ),
				percent: toNumber( row.percent ),
			} ) ),
			error: battery.error,
		},

		renderOutcomes: {
			rows: rowsToGroups( renderOutcomes.data, [ 'filenameTag' ] ).filter( ( row ) => row.filenameTag !== '' ),
			error: renderOutcomes.error,
		},

		badRequests: {
			rows: rowsToGroups( badRequests.data, [ 'reason', 'agency', 'stopIds' ] ),
			error: badRequests.error,
		},

		rejections: {
			sources: rowsToGroups( rejectionSources.data, [ 'country', 'organization', 'userAgent' ] ),
			sourcesError: rejectionSources.error,
			probePaths: rowsToGroups( probePaths.data, [ 'probePath' ] ),
			probePathsError: probePaths.error,
		},

		recent: {
			rows: recent.data.map( ( row ) => ( {
				timestamp: row.timestamp ?? '',
				outcome: row.outcome ?? '',
				country: row.country ?? '',
				organization: row.organization ?? '',
				userAgent: row.user_agent ?? '',
				probePath: row.probe_path ?? '',
			} ) ),
			error: recent.error,
		},

		deviceLogs: {
			levels: rowsToGroups( logLevels.data, [ 'level' ] ),
			levelsError: logLevels.error,
			entries: logEntries.data.map( ( row ) => ( {
				timestamp: row.timestamp ?? '',
				level: row.level ?? '',
				message: row.message ?? '',
				sourcePath: row.source_path ?? '',
				sourceLine: toNumber( row.source_line ),
				firmwareVersion: row.firmware_version ?? '',
				wakeReason: row.wake_reason ?? '',
				freeHeapSize: toNumber( row.free_heap_size ),
				wifiSignal: toNumber( row.wifi_signal ),

				// The pre-truncation length, so a clipped message is identifiable as clipped rather than
				// quietly looking complete.
				messageBytes: toNumber( row.message_bytes ),
			} ) ),
			entriesError: logEntries.error,
		},
	};
}

/** Sums the per-authorized split back into one row per outcome, keeping the authorized flag. */
function collapseOutcomes( rows ) {
	const merged = new Map();

	for ( const row of rows ) {
		const existing = merged.get( row.outcome );

		if ( existing ) {
			existing.count += row.count;
		} else {
			merged.set( row.outcome, { outcome: row.outcome, count: row.count, authorized: row.authorized === '1' } );
		}
	}

	return [ ...merged.values() ].sort( ( first, second ) => second.count - first.count );
}
