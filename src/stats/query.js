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

import { OUTCOMES } from '../abuse.js';
import { blobColumn, ABSENT_NUMBER } from './schema.js';
import { logBlobColumn, logDoubleColumn } from './device-logs.js';
import { deviceBlobColumn, deviceDoubleColumn } from './device-telemetry.js';

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

	// One wake for the whole night rather than a slower cadence, since the sign now sleeps until the
	// window reopens. That single poll is the `+ 1`.
	const perDay = ( activeMinutes * 60 ) / config.refreshActiveSeconds + 1;

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
	const dataset = env?.ANALYTICS_DATASET || 'trmnl_orca_departures_requests_v2';
	const logDataset = env?.DEVICE_LOGS_DATASET || 'trmnl_orca_departures_device_logs_v2';

	// Every row here came from a request carrying device headers, so the panels below need no
	// `authorized` filter and — more usefully — cannot pick up the owner's own `curl`. That is not a
	// nicety: two hand-made requests were enough to make `/stats` report a firmware build of "unknown"
	// on a panel of -1 by -1, which reads as a device in trouble rather than as no device at all.
	const deviceDataset = env?.DEVICE_TELEMETRY_DATASET || 'trmnl_orca_departures_devices_v2';

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
		deviceRows,
		enrollments,
		upstreamReasons,
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
				dataset: deviceDataset,
				columns: [
					deviceBlobColumn( 'firmwareVersion' ),
					deviceBlobColumn( 'model' ),
					deviceDoubleColumn( 'width' ),
					deviceDoubleColumn( 'height' ),
				],
				days,
			} )
		),

		// Grouped by device as well as by value, because every reading below describes one piece of
		// hardware. Aggregated across devices they average a healthy sign against a failing one and
		// describe neither, which is invisible until the day a second device exists — exactly the day
		// the numbers start mattering.
		run(
			groupQuery( {
				dataset: deviceDataset,
				columns: [ deviceBlobColumn( 'deviceId' ), deviceBlobColumn( 'imageCached' ) ],
				days,
			} )
		),

		run(
			groupQuery( {
				dataset: deviceDataset,
				columns: [ deviceBlobColumn( 'deviceId' ), deviceDoubleColumn( 'refreshRateEcho' ) ],
				days,
			} )
		),

		// **Ordered newest-first and reversed in JS, so a cap that bites drops the oldest points.**
		// `ORDER BY bucket ASC LIMIT n` takes the first n of an oldest-first sort, which cuts the
		// *recent* end — the part of the chart anyone is looking at. Sorting the other way makes
		// truncation lose history instead, which is the survivable direction.
		//
		// The cap is per device now, so it is also sized for several rather than one: at the 90-day
		// maximum a single device fills 360 six-hour buckets.
		run( `
			SELECT
				toStartOfInterval(timestamp, INTERVAL '6' HOUR) AS bucket,
				${ deviceBlobColumn( 'deviceId' ) } AS device_id,
				AVG(${ deviceDoubleColumn( 'batteryVoltage' ) }) AS voltage,
				AVG(${ deviceDoubleColumn( 'percentCharged' ) }) AS percent,
				-- WiFi signal shares the battery's bucketing because it is read the same way: one value
				-- per poll, from a header, meaningful only as a trend. A falling RSSI is the earliest
				-- warning this sign can produce — the device goes quiet long after the signal starts
				-- degrading, so a line that sags for a week is the only lead time there is.
				AVG(${ deviceDoubleColumn( 'signalStrength' ) }) AS signal
			FROM ${ deviceDataset }
			WHERE timestamp > NOW() - INTERVAL '${ days }' DAY
				AND ${ deviceDoubleColumn( 'percentCharged' ) } > ${ ABSENT_NUMBER }
			GROUP BY bucket, device_id
			ORDER BY bucket DESC
			LIMIT 4000
		` ),

		run( groupQuery( { dataset, columns: [ blobColumn( 'filenameTag' ) ], where: authorizedOnly, days } ) ),

		// The most recent device polls, with every device column on them.
		//
		// **Raw rows rather than a `GROUP BY`, because "latest" is the question.** Grouping would need
		// `argMax` per column, which this SQL surface may or may not support, and the aggregate a
		// `GROUP BY` can give — an average battery voltage — is not what a device panel is asking for.
		// Fifty rows is enough to cover several devices' last poll each, and the per-device snapshot is
		// assembled in JS below.
		//
		// **Image, setup and log rows are excluded.** Every wake downloads the image a second after it
		// polls, and that request carries only `ID` and `Access-Token`, so without the filter the newest
		// row is almost always one with no battery, WiFi or firmware reading on it. Excluding rather than
		// keeping only `byos-display` matters: a poll with a mistyped stop or a stale key is recorded as
		// `bad-request` or `byos-bad-access-token`, still carries every header, and is exactly when the
		// owner needs the box.
		run( `
			SELECT
				timestamp,
				${ deviceBlobColumn( 'deviceId' ) } AS device_id,
				${ deviceBlobColumn( 'model' ) } AS model,
				${ deviceBlobColumn( 'firmwareVersion' ) } AS firmware_version,
				${ deviceBlobColumn( 'firmwareCommit' ) } AS firmware_commit,
				${ deviceBlobColumn( 'clientIp' ) } AS client_ip,
				${ deviceBlobColumn( 'networkOrganization' ) } AS organization,
				${ deviceBlobColumn( 'country' ) } AS country,
				${ deviceBlobColumn( 'wifiBand' ) } AS wifi_band,
				${ deviceBlobColumn( 'batteryCharging' ) } AS battery_charging,
				${ deviceBlobColumn( 'usbConnected' ) } AS usb_connected,
				${ deviceBlobColumn( 'batteryCapacity' ) } AS battery_capacity,
				${ deviceBlobColumn( 'imageCached' ) } AS image_cached,
				${ deviceBlobColumn( 'updateSource' ) } AS update_source,
				${ deviceBlobColumn( 'wakeTime' ) } AS wake_time,
				${ deviceBlobColumn( 'outcome' ) } AS outcome,
				${ deviceBlobColumn( 'filenameTag' ) } AS filename_tag,
				${ deviceBlobColumn( 'upstreamReason' ) } AS upstream_reason,
				${ deviceDoubleColumn( 'signalStrength' ) } AS signal,
				${ deviceDoubleColumn( 'batteryVoltage' ) } AS voltage,
				${ deviceDoubleColumn( 'percentCharged' ) } AS percent,
				${ deviceDoubleColumn( 'batteryTemperature' ) } AS battery_temp,
				${ deviceDoubleColumn( 'refreshRateEcho' ) } AS refresh_rate,
				${ deviceDoubleColumn( 'width' ) } AS width,
				${ deviceDoubleColumn( 'height' ) } AS height
			FROM ${ deviceDataset }
			WHERE timestamp > NOW() - INTERVAL '${ days }' DAY
				AND ${ deviceBlobColumn( 'outcome' ) } NOT IN ('${ OUTCOMES.byosImage }', '${ OUTCOMES.byosSetup }', '${ OUTCOMES.byosLog }')
			ORDER BY timestamp DESC
			LIMIT 50
		` ),

		// Who enrolled, for the alarm that says something did. A bare count answers "did this happen"
		// and nothing else — and the follow-up question is always the same one: was that me re-pairing
		// the sign, or was it something else holding the URL? Network, model and firmware together are
		// what distinguish those two, so the alarm carries them rather than making the owner go and
		// cross-reference another panel while worried.
		run(
			groupQuery( {
				dataset,
				columns: [
					blobColumn( 'country' ),
					blobColumn( 'networkOrganization' ),
					blobColumn( 'model' ),
					blobColumn( 'firmwareVersion' ),
				],
				where: `${ blobColumn( 'outcome' ) } = '${ OUTCOMES.byosSetup }'`,
				days,
			} )
		),

		// Why OneBusAway did not answer, on the polls where it did not. Filtered to non-empty because
		// the overwhelming majority of rows are polls where it did, and a bar for "nothing went wrong"
		// would dwarf every bar worth reading.
		run(
			groupQuery( {
				dataset: deviceDataset,
				columns: [ deviceBlobColumn( 'upstreamReason' ) ],
				where: `${ deviceBlobColumn( 'upstreamReason' ) } != ''`,
				days,
			} )
		),

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

	// Against the imported constant, never a retyped string. This read `'setup'` until 2026-08-02
	// while the recorded value has always been `'byos-setup'`, so the enrollment alarm — the single
	// clearest signal that something other than your device has the URL — could never fire. It is the
	// same rule `render.js` states for its label maps, and this is what breaking it costs.
	// One entry per device, from its most recent poll. The rows arrive newest-first, so the first row
	// seen for a MAC is that device's current state and every later one is history.
	//
	// **Keyed on the MAC even when it is empty.** A device that sends no `ID` header still gets a
	// panel, under a name that says the header was missing — silently dropping it would hide exactly
	// the device most worth looking at, since every one observed so far does send it.
	const devices = [];
	const seenDevices = new Set();

	for ( const row of deviceRows.data ) {
		const id = row.device_id ?? '';

		if ( seenDevices.has( id ) ) {
			continue;
		}

		seenDevices.add( id );

		devices.push( {
			deviceId: id,
			lastSeen: row.timestamp ?? '',
			model: row.model ?? '',
			firmwareVersion: row.firmware_version ?? '',
			firmwareCommit: row.firmware_commit ?? '',
			clientIp: row.client_ip ?? '',
			organization: row.organization ?? '',
			country: row.country ?? '',
			wifiBand: row.wifi_band ?? '',
			batteryCharging: row.battery_charging ?? '',
			usbConnected: row.usb_connected ?? '',
			batteryCapacity: row.battery_capacity ?? '',
			imageCached: row.image_cached ?? '',
			updateSource: row.update_source ?? '',
			wakeTime: row.wake_time ?? '',
			outcome: row.outcome ?? '',
			filenameTag: row.filename_tag ?? '',
			upstreamReason: row.upstream_reason ?? '',
			signal: toNumber( row.signal ),
			voltage: toNumber( row.voltage ),
			percent: toNumber( row.percent ),
			batteryTemperature: toNumber( row.battery_temp ),
			refreshRate: toNumber( row.refresh_rate ),
			width: toNumber( row.width ),
			height: toNumber( row.height ),
		} );
	}

	const setupCalls = outcomeRows
		.filter( ( row ) => row.outcome === OUTCOMES.byosSetup )
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

		devices: { rows: devices, error: deviceRows.error },

		identity: {
			networks: networkRows,
			networksError: networks.error,
			firmware: rowsToGroups( firmware.data, [ 'firmwareVersion', 'model', 'width', 'height' ] ),
			firmwareError: firmware.error,

			// Whether any device has polled in this window at all.
			//
			// Every check in the identity panel is a comparison against what a paired sign looks like,
			// and none of them means anything before one exists — a poll count of 2 against an expected
			// 12,614 is not a quiet alarm, it is a question nobody asked yet. So the panel needs to know
			// the difference between "nothing is wrong" and "there is nothing to be wrong about", and
			// this is it. Taken from the device dataset rather than from the authenticated request count,
			// because the owner's own `curl` authenticates and is not a device.
			deviceCount: devices.length,
			deviceCountError: deviceRows.error,
			setupCalls,
			enrollments: rowsToGroups( enrollments.data, [ 'country', 'organization', 'model', 'firmwareVersion' ] ),
			enrollmentsError: enrollments.error,
			authorizedRequests: authorizedCount,
			expectedRequests: expectedRequests( config, days ),
		},

		panel: {
			imageCached: rowsToGroups( imageCached.data, [ 'deviceId', 'imageCached' ] ),
			imageCachedError: imageCached.error,
			refreshEcho: rowsToGroups( refreshEcho.data, [ 'deviceId', 'refreshRateEcho' ] ),
			refreshEchoError: refreshEcho.error,
		},

		battery: {
			// Reversed back to ascending here rather than in the SQL, because the `DESC` above is what
			// makes the row cap drop old history instead of the current reading. The charts plot in
			// array order, and per-device filtering preserves it.
			series: [ ...battery.data ].reverse().map( ( row ) => ( {
				deviceId: row.device_id ?? '',
				bucket: row.bucket ?? '',
				voltage: toNumber( row.voltage ),
				percent: toNumber( row.percent ),
				signal: toNumber( row.signal ),
			} ) ),
			error: battery.error,
		},

		renderOutcomes: {
			rows: rowsToGroups( renderOutcomes.data, [ 'filenameTag' ] ).filter( ( row ) => row.filenameTag !== '' ),
			error: renderOutcomes.error,
		},

		upstreamReasons: {
			rows: rowsToGroups( upstreamReasons.data, [ 'upstreamReason' ] ),
			error: upstreamReasons.error,
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
