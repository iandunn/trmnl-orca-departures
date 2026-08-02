/**
 * OneBusAway responses to the board data the renderer draws.
 *
 * Pure: takes already-fetched responses and returns a plain object, so every rule below is testable
 * against the captured fixtures in `fixtures/` with no network and no clock.
 *
 * Rows carry a `departsAtMs` and a `live` flag, never a formatted string. Turning those into `Now`,
 * `7 min` or `4:26 pm` is `format.js`, and keeping the two apart is what makes the format ladder
 * revisable without touching any of the mapping below.
 */

import { directionLabel } from '../render/board.js';
import { toOneBusAwayId } from '../routing.js';
import { formatDeparture, isUpcoming } from './format.js';

/**
 * GTFS route types that mean rail.
 *
 * **Never match on the route name.** RapidRide's `H Line` is a bus and Link's `1 Line` is a train,
 * and nothing about the strings says so. `0` is tram/streetcar, which covers Link and both
 * streetcars; `1` is subway and `2` is rail, which is where Sounder lands.
 */
const RAIL_ROUTE_TYPES = new Set( [ 0, 1, 2 ] );

function indexById( collection ) {
	return new Map( ( Array.isArray( collection ) ? collection : [] ).map( ( item ) => [ item?.id, item ] ) );
}

/**
 * When a departure happens, and whether anyone actually saw the vehicle.
 *
 * `predicted` alone is not enough: OneBusAway sets `predictedArrivalTime` to `0` when it has no
 * prediction, and a `0` treated as a timestamp is January 1970, which sorts to the top of the board
 * and reads as a bus that left 56 years ago.
 */
function departureTime( departure ) {
	const predicted = Number( departure?.predictedArrivalTime ) || 0;
	const scheduled = Number( departure?.scheduledArrivalTime ) || 0;
	const live = departure?.predicted === true && predicted > 0;

	return { departsAtMs: live ? predicted : scheduled, live };
}

/**
 * One stop's predictions, as rows.
 *
 * Deduplicated by `tripId` because a single stop can return the same trip more than once, keeping
 * whichever copy departs soonest. Sorted ascending, then cut to what the layout can hold.
 */
function rowsFor( entry, routesById, nowMs, limit ) {
	const byTrip = new Map();

	for ( const departure of entry.arrivalsAndDepartures ) {
		const { departsAtMs, live } = departureTime( departure );

		if ( ! isUpcoming( departsAtMs, nowMs ) ) {
			continue;
		}

		const route = routesById.get( departure?.routeId );
		const existing = byTrip.get( departure?.tripId );

		if ( existing && existing.departsAtMs <= departsAtMs ) {
			continue;
		}

		// The destination is the arrival's own `tripHeadsign`, never a name from
		// `stopGroupings[].stopGroups[]`. Those look like headsigns and are not: OneBusAway
		// disambiguates same-named groups with a counter, so route 125's two groups come back as
		// `Downtown Seattle South Seattle College - 0` and `- 1`, and the stray suffix would go
		// straight onto the panel.
		byTrip.set( departure?.tripId, {
			badge: departure?.routeShortName ?? route?.shortName ?? '',
			routeName: departure?.routeLongName || route?.longName || '',
			to: departure?.tripHeadsign ?? '',
			routeType: route?.type,
			departsAtMs,
			live,
		} );
	}

	return [ ...byTrip.values() ].sort( ( a, b ) => a.departsAtMs - b.departsAtMs ).slice( 0, limit );
}

/**
 * What the band says when a stop has nothing to show.
 *
 * A failed stop and a stop with no more buses today are different sentences, and the difference is
 * the whole reason to say anything at all: "we could not ask" is a fault, "nothing is coming" is an
 * answer. Neither may be silent — a group that simply vanished would leave a reader unable to tell a
 * dead direction from a quiet one.
 */
function emptyMessage( result ) {
	return result?.ok ? 'No more departures today' : 'Departure data unavailable';
}

/**
 * The stop code to print when the response that would have carried it never arrived.
 *
 * A stop's `code` is what is printed on the pole, and it comes from the references block — so a fetch
 * that failed has no code, and the band used to fall back to the full OneBusAway id: `Stop 40_621`
 * rather than `Stop No. 621`. That reads as debug output on the one screen a rider is looking at, and
 * it appears exactly when the sign is already degraded.
 *
 * The agency prefix is the first underscore-delimited field, so the rest is what the agency calls the
 * stop. **Split on the first underscore only** — the remainder is opaque and routinely contains its
 * own underscores and hyphens (`40_S_KS_T3`, `40_E15-T1`), and splitting on the last would mangle
 * them. This is not guaranteed to equal `code`, but it is the same number for every stop checked and
 * it is what the reader has to work with.
 */
function stopCodeFrom( stopId ) {
	return String( stopId ).replace( /^\d+_/, '' );
}

/** A stop's own entry in a response's references. Its name, code and compass bearing live here. */
export function stopReference( result, obaStopId ) {
	return result?.ok ? indexById( result.references?.stops ).get( obaStopId ) : undefined;
}

/**
 * @param {object} result  One entry from `loadStop()`, ok or failed.
 * @param {object} options
 * @param {object} [options.knownStops] `obaStopId` → a stop reference from an earlier successful
 *                                      response, used to label a group whose fetch just failed.
 * @returns {object} A group for `buildBoardSvg()`, with `rows` possibly empty.
 */
function groupFor( result, { agency, stopId, directionOverrides, nowMs, limit, knownStops = {} } ) {
	const obaStopId = toOneBusAwayId( agency, stopId );

	// A failed fetch takes the departures with it, not the stop's identity. Which platform this band
	// belongs to is a fact about the pole — it does not expire — so it is taken from whatever the
	// isolate last saw, and only the rows admit that nothing is current. A band that loses its
	// direction is worse than useless on a two-stop sign: the reader cannot tell which half of the
	// board went missing.
	const stopRef = stopReference( result, obaStopId ) ?? knownStops[ obaStopId ];
	const rows = result?.ok ? rowsFor( result.entry, indexById( result.references?.routes ), nowMs, limit ) : [];

	return {
		heading: directionLabel( stopRef?.direction ?? '', obaStopId, directionOverrides ),
		name: stopRef?.name ?? '',
		stop: `Stop No. ${ stopRef?.code || stopCodeFrom( stopId ) }`,
		rows,
		...( rows.length === 0 ? { message: emptyMessage( result ) } : {} ),
	};
}

/**
 * Bus board or rail board, decided by the departures rather than by the stop.
 *
 * A stop's agency prefix says who owns the pole, not who serves it — a `1_` Metro stop returns Sound
 * Transit express buses too. The routes actually departing are the only honest signal, and a board is
 * one mode or the other because the two modes have separate platforms. Mixed or empty falls back to
 * bus, which is the common case and the one whose header carries the Metro logo.
 */
function boardMode( groups ) {
	const types = groups.flatMap( ( group ) => group.rows.map( ( row ) => row.routeType ) );

	return types.length > 0 && types.every( ( type ) => RAIL_ROUTE_TYPES.has( type ) ) ? 'rail' : 'bus';
}

/**
 * The header lockup's agency name, for the rail board. The bus board draws Metro's logo instead and
 * never reads this.
 */
function agencyName( results ) {
	for ( const result of results ) {
		const agencies = result?.ok ? result.references?.agencies : null;

		if ( Array.isArray( agencies ) && agencies.length > 0 ) {
			const named = agencies.find( ( agency ) => typeof agency?.name === 'string' && agency.name !== '' );

			if ( named ) {
				return named.name.toUpperCase();
			}
		}
	}

	return '';
}

/**
 * The freshness of the whole board is the freshness of its oldest half.
 *
 * Two stops are two responses with two `currentTime` values. Stamping the board with the newer one
 * would overstate how current the older group is, which is precisely the claim the stamp exists to
 * make honestly.
 */
export function dataTimestamp( results ) {
	const times = results
		.filter( ( result ) => result?.ok )
		.map( ( result ) => Number( result.currentTime ) )
		.filter( ( time ) => Number.isFinite( time ) && time > 0 );

	return times.length > 0 ? Math.min( ...times ) : null;
}

/**
 * @param {object[]} results  `loadStop()` results, in the order the stops were requested.
 * @param {object}   options
 * @param {string}   options.agency
 * @param {string[]} options.stopIds  Bare stop IDs, same order and length as `results`.
 * @param {object}   options.directionOverrides
 * @param {number}   options.nowMs    OneBusAway's `currentTime`, not our clock.
 * @param {string}   options.timezone
 * @param {number}   options.limit    Rows per group the layout can hold.
 * @param {object}   options.time     Header fields from `formatBoardTime()`.
 * @param {object}   [options.knownStops] Stop references from earlier successful responses, so a
 *                                        group whose fetch failed can still name its platform.
 * @returns {object} A board for `buildBoardSvg()`.
 */
export function toBoard( results, { agency, stopIds, directionOverrides, nowMs, timezone, limit, time, knownStops } ) {
	const groups = results.map( ( result, index ) =>
		groupFor( result, { agency, stopId: stopIds[ index ], directionOverrides, nowMs, limit, knownStops } )
	);

	const mode = boardMode( groups );

	return {
		mode,
		agency: agencyName( results ),
		...time,
		groups: groups.map( ( group ) => ( {
			...group,
			// An empty group keeps its full share of the panel, so a half-failed board renders the
			// surviving direction at exactly the size it would have had on a healthy one. Without
			// this the good rows would grow to fill the gap and a partial failure would look like a
			// different design rather than a missing half.
			...( group.rows.length === 0 ? { reserved: limit } : {} ),
			rows: group.rows.map( ( row ) => ( {
				badge: row.badge,
				routeName: row.routeName,
				to: row.to,
				live: row.live,
				...formatDeparture( row.departsAtMs, nowMs, timezone ),
			} ) ),
		} ) ),
	};
}

/** Whether a board has anything worth putting on the glass. */
export function hasDepartures( board ) {
	return board.groups.some( ( group ) => group.rows.length > 0 );
}
