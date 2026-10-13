/**
 * The `/stats` page, as one self-contained HTML string.
 *
 * ## Why every value goes through `escapeHtml()`
 *
 * This is the one page in the project that renders strings an attacker chose. `userAgent`,
 * `probePath` and `networkOrganization` all arrive from the network, are stored verbatim by
 * `src/stats/schema.js`, and are printed here — so a scanner can pick its own `User-Agent` and have
 * it land in the owner's browser. A stored-XSS on a page whose whole purpose is telling the owner
 * whether the sign's URL token has leaked would be the worst possible place to have one.
 *
 * `src/dev/preview.js` builds HTML by concatenation with no escaping, and that is fine there: every
 * value it interpolates is a slug or title from `src/dev/sample-boards.js`, i.e. a fixture written
 * in this repo. **This page cannot follow that precedent.** There is no partial version of the rule
 * that survives editing, so the helpers below escape centrally — `dataTable()` escapes every cell,
 * `checkRow()` escapes every field — and the only strings that reach the output unescaped are
 * literals in this file.
 *
 * ## Why the page is inert
 *
 * No external CSS, JS, fonts or images: the page must be readable when the SQL API is down, and a
 * dashboard that phones out to a CDN is a dashboard that fails differently than the thing it
 * measures. The single piece of inline script is `onchange="this.form.submit()"` on the range
 * picker, with a `<noscript>` submit button behind it, so the page works with scripting off.
 *
 * ## Why one broken query must not blank the page
 *
 * `buildStatsData()` resolves every panel independently and hands back a per-panel `*Error` string.
 * Rendering those inside their own panel rather than as one page-level failure is the whole reason
 * the queries were split: a page reporting nine good panels and one "query failed" is diagnostic,
 * and a page rendering nothing because a `GROUP BY` was wrong is not.
 */

import { OUTCOMES, REJECTION_REASONS } from '../abuse.js';
import { FILENAME_TAGS } from '../filename.js';

// Aliased because the two datasets each declare their own sentinel and both are named
// `ABSENT_NUMBER`. They happen to agree on the value, but they are separate contracts.
import { ABSENT_NUMBER as ABSENT_LOG_NUMBER } from './device-logs.js';
import { STATS_RANGES, resolveRange } from './query.js';
import { ABSENT_NUMBER } from './schema.js';

/**
 * The three tones the page assigns meaning to. Everything else is neutral chrome.
 *
 * `REJECTED` is deliberately not the alarm colour: rejected traffic is the expected background noise
 * of a public hostname, so painting it red would train the owner to ignore red. The alarm colour is
 * reserved for the device-identity panel, where it means "someone else may be holding your token".
 */
const COLOR_SERVED = '#4fb3a0';
const COLOR_REJECTED = '#c8913c';
const COLOR_ALARM = '#ff6b5e';

const HTML_ESCAPES = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\'': '&#39;',
};

/**
 * Escapes text for both element and attribute context.
 *
 * Both quote characters are escaped, not just `<` and `&`, because the page puts data inside
 * `title="…"` and `aria-label="…"` attributes — and an unescaped `"` there breaks out of the
 * attribute without ever needing a `<`, which is the realistic bug in a page built by
 * concatenation.
 */
export function escapeHtml( value ) {
	return String( value ?? '' ).replace( /[&<>"']/g, ( character ) => HTML_ESCAPES[ character ] );
}

/**
 * A human label per `OUTCOMES`.
 *
 * Keyed off the imported constants rather than retyped, because those strings are written into
 * Analytics Engine as the index column and are therefore permanent — a copy here could drift from
 * the real value and quietly label a whole row wrong.
 */
export const OUTCOME_LABELS = {
	// These three are a sequence — how far through the gate a request got — so they are worded to be
	// read against each other. Each names the check that rejected it, because "which of these three
	// is it" is the whole diagnostic value: only the third can be your own device, and only the first
	// is tarpitted.
	[ OUTCOMES.unshapedPath ]: 'No /token/ segment in the path (scanner)',
	[ OUTCOMES.badToken ]: 'Path well-formed, token value wrong',
	[ OUTCOMES.badRequest ]: 'Token valid, rest of the path malformed',
	// Retired 2026-08-01 and unreachable now. The label says so rather than describing a state the
	// sign can still be in, because the rows are real and will keep appearing until they age out.
	[ OUTCOMES.byosUnimplemented ]: 'Device poll before the endpoints existed (historical)',
	[ OUTCOMES.favicon ]: 'Favicon',
	[ OUTCOMES.robots ]: 'robots.txt',
	[ OUTCOMES.statsAuthFailed ]: 'Stats password rejected',
};

/** `REJECTION_REASONS` as sentences the owner can act on. */
const REJECTION_REASON_LABELS = {
	[ REJECTION_REASONS.missingAgency ]: 'The URL is missing its agency segment.',
	[ REJECTION_REASONS.invalidAgency ]: 'The agency is not a number.',
	[ REJECTION_REASONS.missingStop ]: 'The URL is missing its stop segment.',
	[ REJECTION_REASONS.invalidStopId ]: 'A stop ID contains characters no OBA stop ID has.',
	[ REJECTION_REASONS.tooManyStops ]: 'More than two stops were asked for.',
	[ REJECTION_REASONS.malformedEscape ]: 'The stop segment has a broken percent-escape.',
	[ REJECTION_REASONS.unknownRoute ]: 'The path is valid but names no endpoint.',
};

/** `FILENAME_TAGS` as board states, so the degraded-render rate is readable without a decoder. */
const FILENAME_TAG_LABELS = {
	[ FILENAME_TAGS.departures ]: 'Departures',
	[ FILENAME_TAGS.noDepartures ]: 'No departures in the window',
	[ FILENAME_TAGS.upstreamFailed ]: 'OneBusAway unavailable',
	[ FILENAME_TAGS.renderFailed ]: 'Render failed',
};

/**
 * Values of the `Image-Cached` header that mean the device skipped the download.
 *
 * A set of strings rather than a comparison, because the header's exact spelling is unverified —
 * it is read back out of a blob column as text, and the firmware has not been observed sending it.
 */
const CACHED_HEADER_VALUES = new Set( [ '1', 'true', 'yes' ] );

/**
 * Device log levels that mean the sign is reporting a failure rather than narrating.
 *
 * These get the rejected tone rather than the alarm colour, for the same reason rejected traffic
 * does: some error chatter is ordinary, and an alarm the owner learns to ignore is worse than none.
 */
const FAILURE_LOG_LEVELS = new Set( [ 'error', 'fatal' ] );

/** Above this multiple of the expected poll count, a second device is the likeliest explanation. */
const VOLUME_ALARM_MULTIPLE = 2;

const CHART_WIDTH = 720;
const CHART_HEIGHT = 130;

function formatCount( value ) {
	return Number( value ?? 0 ).toLocaleString( 'en-US' );
}

function formatPercent( value ) {
	return `${ Number( value ).toFixed( 1 ) }%`;
}

function shareOf( count, total ) {
	return total > 0 ? ( count / total ) * 100 : 0;
}

/** Doubles come back out of Analytics Engine as strings, so nothing here compares with `===`. */
function toNumber( value ) {
	const parsed = Number( value );

	return Number.isFinite( parsed ) ? parsed : ABSENT_NUMBER;
}

const utf8Encoder = new TextEncoder();

/**
 * The byte length of a string.
 *
 * Bytes rather than characters because the length it gets compared against was measured in bytes on
 * the way in, and a firmware message is free text that may not be ASCII.
 */
function byteLength( text ) {
	return utf8Encoder.encode( String( text ?? '' ) ).length;
}

function labelFor( labels, value ) {
	return labels[ value ] ?? value ?? '';
}

function none() {
	return '<p class="none">none</p>';
}

/**
 * An empty-state sentence, withheld when the query that would have filled the panel failed.
 *
 * **A panel must never print reassurance next to its own error.** "Every stop answered on every
 * poll" beside "query failed" is the page describing data it did not manage to read, and it is worse
 * than saying nothing: the sentence is the part a reader believes, and the error above it looks like
 * a detail. This rule was written down once, for the device-logs panel, and not applied to the five
 * others that need it — which is how `/stats` came to claim a clean upstream while the query behind
 * that claim was returning a 422.
 *
 * An error alone is the right output here. `panel()` has already rendered it.
 */
function emptyState( error, sentence ) {
	return error ? '' : `<p class="none">${ escapeHtml( sentence ) }</p>`;
}

function queryFailed( message ) {
	return `<p class="query-error">query failed: ${ escapeHtml( message ) }</p>`;
}

/**
 * One panel.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.tooltip]   Plain text, escaped here.
 * @param {string} [options.error]     A per-panel `*Error` string; renders inside this panel only.
 * @param {string} options.bodyHtml    Already-escaped markup from the helpers below.
 */
function panel( { title, tooltip = '', error = '', bodyHtml } ) {
	const tooltipAttribute = tooltip ? ` title="${ escapeHtml( tooltip ) }"` : '';

	return (
		'<section class="panel">' +
		`<h2${ tooltipAttribute }>${ escapeHtml( title ) }</h2>` +
		( error ? queryFailed( error ) : '' ) +
		bodyHtml +
		'</section>'
	);
}

/**
 * A block nested inside a panel, one heading level down.
 *
 * Exists so the per-device readings can sit inside a device box without nesting `<section
 * class="panel">` in itself, which would double the chrome and put an `<h2>` under an `<h2>`.
 */
function subsection( { title, tooltip = '', error = '', bodyHtml } ) {
	const tooltipAttribute = tooltip ? ` title="${ escapeHtml( tooltip ) }"` : '';

	return (
		'<section class="subpanel">' +
		`<h3${ tooltipAttribute }>${ escapeHtml( title ) }</h3>` +
		( error ? queryFailed( error ) : '' ) +
		bodyHtml +
		'</section>'
	);
}

function note( text ) {
	return `<p class="note">${ escapeHtml( text ) }</p>`;
}

/** A ranked horizontal bar. `tone` is `served` or `rejected`. */
function barRow( { label, count, total, tone } ) {
	return (
		'<li class="bar">' +
		`<span class="bar-label">${ escapeHtml( label ) }</span>` +
		'<span class="bar-track">' +
		`<span class="bar-fill ${ tone }" style="width:${ formatPercent( shareOf( count, total ) ) }"></span>` +
		'</span>' +
		`<span class="bar-count">${ escapeHtml( formatCount( count ) ) }</span>` +
		'</li>'
	);
}

function barList( rows ) {
	return rows.length === 0 ? none() : `<ul class="bars">${ rows.join( '' ) }</ul>`;
}

/**
 * One cell. Text, or `{ text, title }` when the value needs a tooltip to be honest about itself.
 *
 * The object form exists so a caller that needs an attribute does not have to build its own `<td>`,
 * which is how the escaping invariant below would eventually get broken.
 */
function tableCell( cell ) {
	if ( cell && typeof cell === 'object' ) {
		return `<td title="${ escapeHtml( cell.title ) }">${ escapeHtml( cell.text ) }</td>`;
	}

	return `<td>${ escapeHtml( cell ) }</td>`;
}

/**
 * A table whose every cell is escaped here, so no caller can forget.
 *
 * Wrapped in its own scroll container: the recent-rejections table is wider than a phone and the
 * page itself must never scroll sideways.
 */
function dataTable( headings, rows ) {
	if ( rows.length === 0 ) {
		return none();
	}

	const head = headings.map( ( heading ) => `<th>${ escapeHtml( heading ) }</th>` ).join( '' );

	const body = rows.map( ( cells ) => `<tr>${ cells.map( tableCell ).join( '' ) }</tr>` ).join( '' );

	return `<div class="scroll"><table><thead><tr>${ head }</tr></thead><tbody>${ body }</tbody></table></div>`;
}

/**
 * One line of the device-identity panel.
 *
 * The normal state of every check is one calm line, so an anomaly is the only thing on the page
 * carrying the alarm colour. `detailHtml` is markup, not text — the caller has already escaped it.
 */
function checkRow( { label, value, alarm, detailHtml = '' } ) {
	return (
		`<li class="check ${ alarm ? 'alarm' : 'ok' }">` +
		`<span class="check-state">${ alarm ? 'ALARM' : 'ok' }</span>` +
		'<span class="check-body">' +
		`<span class="check-label">${ escapeHtml( label ) }</span>` +
		`<span class="check-value">${ escapeHtml( value ) }</span>` +
		detailHtml +
		'</span>' +
		'</li>'
	);
}

function rangePicker( range ) {
	const options = STATS_RANGES.map(
		( candidate ) =>
			`<option value="${ escapeHtml( candidate.key ) }"${ candidate.key === range ? ' selected' : '' }>` +
			`${ escapeHtml( candidate.label ) }</option>`
	).join( '' );

	return (
		'<form method="get" class="range">' +
		'<label for="range">Range</label>' +
		`<select id="range" name="range" onchange="this.form.submit()">${ options }</select>` +
		'<noscript><button type="submit">Update</button></noscript>' +
		'</form>'
	);
}

/* ------------------------------------------------------------------ sections */

/**
 * The compromise alarm.
 *
 * Deliberately not a breakdown table. The sign is one device on one network, so every number here
 * is a constant in normal operation — which is exactly what makes a deviation legible. The panel is
 * built so the calm state is four quiet lines and any anomaly is the loudest thing on the page.
 */
function identitySection( identity ) {
	const networkCount = identity.networks.length;

	/**
	 * Whether any device has polled in this window.
	 *
	 * **Every check below is a comparison against what a paired sign looks like, and none of them
	 * means anything before one exists.** Without this the panel reported a firmware build of
	 * "unknown" on a panel of "-1 x -1" and a poll volume of "2 against ~12,614 expected", all
	 * labelled `ok` — three lines describing a device in trouble, generated by two `curl` calls the
	 * owner made by hand. A reader cannot tell that apart from a real sign that has stopped reporting,
	 * which is the one thing this panel is for.
	 *
	 * Guarded on the error as well as the count, because a failed query returns zero rows and "no
	 * device has polled" is a claim, not a default. Same rule as the device-logs panel below.
	 */
	const noDeviceYet = ! identity.deviceCountError && identity.deviceCount === 0;

	const networkDetail =
		networkCount > 1
			? dataTable(
					[ 'ASN', 'Network', 'Country', 'Requests', 'Last seen' ],
					identity.networks.map( ( row ) => [
						row.asn,
						row.organization,
						row.country,
						formatCount( row.count ),
						row.lastSeen,
					] )
			  )
			: '';

	const networkValue = ( () => {
		if ( networkCount === 0 ) {
			return 'No authenticated requests yet.';
		}

		if ( networkCount === 1 ) {
			const [ only ] = identity.networks;

			return `1 network: ${ only.organization || 'unknown' } (${ only.asn || 'no ASN' }, ${ only.country || '??' })`;
		}

		return `${ networkCount } distinct networks — expected exactly one`;
	} )();

	const enrollmentDetail = ( { setupCalls, enrollments = [], enrollmentsError = '' } ) => {
		if ( setupCalls === 0 ) {
			return '';
		}

		if ( enrollmentsError ) {
			return queryFailed( enrollmentsError );
		}

		// The count and the breakdown come from two different queries, so they can disagree — the
		// breakdown is capped at 40 groups and the count is not. Saying so beats a table that quietly
		// adds up to less than the number above it.
		return (
			dataTable(
				[ 'Country', 'Network', 'Model', 'Firmware', 'Calls', 'Last seen' ],
				enrollments.map( ( row ) => [
					row.country,
					row.organization,
					row.model,
					row.firmwareVersion,
					formatCount( row.count ),
					row.lastSeen,
				] )
			) +
			note(
				'`/api/setup` is unauthenticated by design — that is how enrolment works — so these rows ' +
					'are whoever asked, not whoever succeeded. It sends no Access-Token and only four ' +
					'headers, which is why there is less here than on a poll.'
			)
		);
	};

	const firmwareDetail =
		identity.firmware.length > 1
			? dataTable(
					[ 'Firmware', 'Model', 'Width', 'Height', 'Requests', 'Last seen' ],
					identity.firmware.map( ( row ) => [
						row.firmwareVersion,
						row.model,
						row.width,
						row.height,
						formatCount( row.count ),
						row.lastSeen,
					] )
			  )
			: '';

	const firmwareValue = ( () => {
		if ( identity.firmware.length === 0 ) {
			return 'No device has reported one yet.';
		}

		if ( identity.firmware.length === 1 ) {
			const [ only ] = identity.firmware;

			return `${ only.firmwareVersion || 'unknown build' } on model ${ only.model || '?' }, ` +
				`${ only.width || '?' } x ${ only.height || '?' }`;
		}

		return `${ identity.firmware.length } distinct firmware, model or geometry combinations — ` +
			'suggests a second physical device';
	} )();

	// Ratio rather than difference, and only flagged at roughly double: the expectation is derived
	// from config and is approximate by construction, so a tight threshold would cry wolf daily.
	const volumeAlarm =
		identity.expectedRequests > 0 &&
		identity.authorizedRequests >= identity.expectedRequests * VOLUME_ALARM_MULTIPLE;

	// Said once, at the top, rather than left to be inferred from three lines that each read like a
	// measurement. It is not an alarm — an unpaired sign is the expected state of a Worker that has
	// been deployed and not yet pointed at anything.
	const pairingCheck = noDeviceYet
		? [
				checkRow( {
					label: 'Paired device',
					value: 'None. No device has polled in this window, so the checks below have nothing to measure.',
					alarm: false,
					detailHtml: note(
						'A device appears here once it sends its first `/api/setup` or `/api/display`. Until then ' +
							'the panels that describe hardware — firmware, panel health, battery — stay empty by ' +
							'design rather than by failure.'
					),
				} ),
		  ]
		: [];

	const checks = [
		...pairingCheck,

		checkRow( {
			label: 'Networks on authenticated requests',
			value: networkValue,
			alarm: networkCount > 1,
			detailHtml: networkDetail,
		} ),

		checkRow( {
			label: 'Enrollment calls',
			value:
				identity.setupCalls > 0
					? `${ formatCount( identity.setupCalls ) } — enrollment should only happen when you re-pair ` +
						'the device, so any call you did not cause means something else enrolled'
					: 'none',
			alarm: identity.setupCalls > 0,

			// **The detail is the whole point of the alarm, not a footnote to it.** A count answers
			// "did this happen" and leaves the only question that matters unanswered: was it me
			// re-pairing the sign, or something else holding the URL? Network, model and firmware
			// together settle that — an enrolment from your own home network on the same model you own
			// is the boring answer, and anything else is not. Putting it here means the owner is not
			// cross-referencing three other panels while worried.
			detailHtml: enrollmentDetail( identity ),
		} ),

		checkRow( {
			label: 'Firmware and panel geometry',
			value: firmwareValue,
			alarm: identity.firmware.length > 1,
			detailHtml: firmwareDetail,
		} ),

		checkRow( {
			label: 'Poll volume',

			// The expected figure is deliberately withheld until there is something to compare it
			// against. Printed beside a count of zero it reads as a shortfall of twelve thousand polls,
			// which is a number nobody should be asked to dismiss.
			value: noDeviceYet
				? 'Nothing to compare yet — no device has polled.'
				: `${ formatCount( identity.authorizedRequests ) } authenticated vs ` +
					`~${ formatCount( identity.expectedRequests ) } expected`,
			alarm: volumeAlarm && ! noDeviceYet,
			detailHtml: noDeviceYet
				? ''
				: note(
						'The expectation is approximate: the device wakes to poll rather than on a wall clock, so ' +
							'treat anything within a factor of two as normal. Roughly double is what two devices ' +
							'sharing one token looks like.'
				  ),
		} ),
	];

	return panel( {
		title: 'Device identity',
		tooltip:
			'How a leaked URL token would be detected. The token rides in the URL path, so anyone who ' +
			'has the URL authenticates successfully — a second network, a second firmware build, or an ' +
			'enrollment you did not cause is the only signal that would ever exist.',
		bodyHtml: `<ul class="checks">${ checks.join( '' ) }</ul>`,
	} );
}

function totalsSection( totals ) {
	const tiles = [
		[ 'Requests', totals.total, '' ],
		[ 'Authenticated', totals.authorized, 'served' ],
		[ 'Rejected', totals.rejected, 'rejected' ],
	].map(
		( [ label, count, tone ] ) =>
			`<div class="tile ${ tone }"><span class="tile-value">${ escapeHtml( formatCount( count ) ) }</span>` +
			`<span class="tile-label">${ escapeHtml( label ) }</span></div>`
	).join( '' );

	const splitLabel = `${ formatCount( totals.authorized ) } authenticated, ${ formatCount( totals.rejected ) } rejected`;

	return panel( {
		title: 'Request totals',
		bodyHtml:
			`<div class="tiles">${ tiles }</div>` +
			`<div class="split" role="img" aria-label="${ escapeHtml( splitLabel ) }">` +
			`<span class="split-part served" style="width:${ formatPercent( shareOf( totals.authorized, totals.total ) ) }"></span>` +
			`<span class="split-part rejected" style="width:${ formatPercent( shareOf( totals.rejected, totals.total ) ) }"></span>` +
			'</div>' +
			'<ul class="legend">' +
			`<li><span class="swatch served"></span>authenticated ${ escapeHtml( formatCount( totals.authorized ) ) }</li>` +
			`<li><span class="swatch rejected"></span>rejected ${ escapeHtml( formatCount( totals.rejected ) ) }</li>` +
			'</ul>',
	} );
}

function outcomesSection( outcomes ) {
	const total = outcomes.reduce( ( sum, row ) => sum + row.count, 0 );

	const rows = [ ...outcomes ]
		.sort( ( first, second ) => second.count - first.count )
		.map( ( row ) =>
			barRow( {
				label: labelFor( OUTCOME_LABELS, row.outcome ),
				count: row.count,
				total,
				tone: row.authorized ? 'served' : 'rejected',
			} )
		);

	return panel( { title: 'Outcome breakdown', bodyHtml: barList( rows ) } );
}

/**
 * How often this device repainted, and the refresh rate it believes in.
 *
 * `Image-Cached` is the most important number on the page after the identity panel: the whole design
 * bets on the `filename` cache no-op, because the X takes a full-panel refresh every time a changed
 * image reaches it.
 *
 * **It is a repaint count, not a health score, and the difference decides how to read a low rate.** A
 * miss means the board really did change, which during the day it does most minutes — so a low rate
 * is what live departures look like. The failure it exposes is the rate falling while the board is
 * *static*: that is the filename churning, and it flashes the panel for nothing.
 */
function repaintsFor( panelData, deviceId ) {
	const cached = panelData.imageCached.filter( ( row ) => row.deviceId === deviceId );
	const cachedTotal = cached.reduce( ( sum, row ) => sum + row.count, 0 );

	const cachedCount = cached
		.filter( ( row ) => CACHED_HEADER_VALUES.has( String( row.imageCached ).trim().toLowerCase() ) )
		.reduce( ( sum, row ) => sum + row.count, 0 );

	const cachedMetric =
		cachedTotal === 0
			? emptyState( panelData.imageCachedError, 'this device has not reported a cache result yet' )
			: `<p class="metric"><strong>${ escapeHtml( formatPercent( shareOf( cachedCount, cachedTotal ) ) ) }</strong>` +
				'<span>of wakes skipped the download, and so did not repaint the panel</span></p>';

	const cachedRows = cached.map( ( row ) =>
		barRow( {
			label: CACHED_HEADER_VALUES.has( String( row.imageCached ).trim().toLowerCase() )
				? `cached (${ row.imageCached })`
				: `downloaded (${ row.imageCached || 'no header' })`,
			count: row.count,
			total: cachedTotal,
			tone: 'served',
		} )
	);

	const echo = panelData.refreshEcho.filter( ( row ) => row.deviceId === deviceId );
	const echoTotal = echo.reduce( ( sum, row ) => sum + row.count, 0 );

	const echoRows = echo.map( ( row ) => {
		const seconds = toNumber( row.refreshRateEcho );
		const hotLoop = seconds === 0;

		return barRow( {
			label: hotLoop
				? '0 seconds — the hot-loop bug, this flattens the battery'
				: `${ seconds === ABSENT_NUMBER ? 'not reported' : `${ seconds } seconds` }`,
			count: row.count,
			total: echoTotal,
			tone: hotLoop ? 'rejected' : 'served',
		} );
	} );

	return (
		subsection( {
			title: 'Panel repaints',

			// **Not "panel health".** A miss is the correct outcome when the board actually changed, and
			// during the day it changes most minutes, so a low rate is what live departures look like
			// rather than a fault. What would be a fault is the rate collapsing while the board is
			// static — that is the filename churning, and it flashes the panel for nothing.
			tooltip:
				'How often the device skipped the download because `filename` was unchanged, which is how ' +
				'often it did not repaint. A miss is expected whenever the departures actually changed. ' +
				'The Image-Cached header reports the *previous* wake, not the one carrying it, so read the ' +
				'rate rather than any single row.',
			error: panelData.imageCachedError,

			// The bar list is suppressed when there is nothing to chart, because its own empty state
			// would otherwise print a bare "none" directly under a sentence that already explained why.
			bodyHtml: cachedMetric + ( cachedTotal === 0 ? '' : barList( cachedRows ) ),
		} ) +
		subsection( {
			title: 'Refresh rate echo',
			tooltip:
				'What the device read back out of NVS. A value of 0 is the hot-loop bug: the device sleeps ' +
				'for no time at all and stays that way across power cycles.',
			error: panelData.refreshEchoError,
			bodyHtml: echoRows.length
				? barList( echoRows )
				: emptyState( panelData.refreshEchoError, 'this device has not reported a refresh rate yet' ),
		} )
	);
}

/**
 * How this device has held up over the window: charge, and WiFi signal, one chart each.
 *
 * **Deliberately no "latest reading" line.** The facts above already print charge, voltage and RSSI
 * from the device's own last poll, and repeating them here produced two different numbers for the
 * same thing in one box — the facts come from the latest raw poll, these buckets are six-hour
 * averages. The shape over time is the one thing the facts cannot show, so that is all this draws.
 *
 * -1 is the firmware's own value for a fuel gauge that failed to initialise, and it is also what
 * `src/stats/schema.js` writes for an absent header. Plotting it would put a point far below the
 * axis and drag the whole line flat, so those points are dropped from the series rather than
 * clamped — a gap in the line is honest about a missing reading in a way that a 0 is not.
 */
function trendsFor( battery, deviceId ) {
	const series = battery.series.filter( ( point ) => point.deviceId === deviceId );
	const charge = series.filter( ( point ) => toNumber( point.percent ) > ABSENT_NUMBER );

	// **Strict inequality against the sentinel, not `< 0`.** RSSI is legitimately negative — a healthy
	// reading is around -58 dBm — so sign says nothing about whether a value is present, and the
	// absent marker is exactly -1. Same trap `logReading()` below documents for the device-log copy.
	const signal = series.filter( ( point ) => toNumber( point.signal ) < ABSENT_NUMBER );

	const excluded = series.length - charge.length;

	const excludedNote =
		excluded > 0
			? note(
					`${ excluded } of ${ series.length } buckets reported no charge reading and are ` +
						'left out of the chart rather than plotted as -1.'
			  )
			: '';

	return (
		subsection( {
			title: 'Charge over time',
			tooltip:
				'The slope is the reading, not any single point: it is the only thing here that answers ' +
				'how long the sign runs between charges.',
			error: battery.error,
			bodyHtml: charge.length
				? trendChart( {
						points: charge,
						valueOf: ( point ) => toNumber( point.percent ),
						min: 0,
						max: 100,
						format: ( value ) => `${ value }%`,
						caption: 'Battery charge',
				  } ) + excludedNote
				: emptyState( battery.error, 'this device has not reported a battery reading yet' ),
		} ) +
		// Its own subsection rather than a second line on the charge chart: the two share no unit and
		// no range, so one axis could only serve them by lying about one of them.
		subsection( {
			title: 'WiFi signal over time',
			tooltip:
				'The device goes quiet long after its signal starts degrading, so a line sagging over a ' +
				'week is the only lead time there is. -30 dBm is excellent, -90 dBm is barely connected.',

			// The error is reported once, on the subsection above — both charts come from the same query,
			// and printing the same failure twice in one box reads as two things having gone wrong.
			bodyHtml: signal.length
				? trendChart( {
						points: signal,
						valueOf: ( point ) => toNumber( point.signal ),
						min: -90,
						max: -30,
						format: ( value ) => `${ value } dBm`,
						caption: 'WiFi signal',
				  } )
				: emptyState( battery.error, 'this device has not reported a WiFi signal reading yet' ),
		} )
	);
}

/**
 * A labelled line chart.
 *
 * **The axis labels are HTML, not SVG text.** The plot is stretched to its container with
 * `preserveAspectRatio="none"`, which distorts any glyph inside it — so the ticks are positioned
 * beside the plot instead, at the same percentages the gridlines use.
 */
function trendChart( { points, valueOf, min, max, format, caption } ) {
	if ( points.length === 0 ) {
		return none();
	}

	const span = max - min;

	const plotted = points.map( ( point, index ) => {
		// A single reading has no span to spread across, so it sits in the middle rather than dividing
		// by zero.
		const x = points.length === 1 ? CHART_WIDTH / 2 : ( index / ( points.length - 1 ) ) * CHART_WIDTH;
		const clamped = Math.min( max, Math.max( min, valueOf( point ) ) );
		const y = CHART_HEIGHT - ( ( clamped - min ) / span ) * CHART_HEIGHT;

		return `${ x.toFixed( 1 ) },${ y.toFixed( 1 ) }`;
	} );

	const levels = [ max, min + span / 2, min ];

	const gridlines = levels
		.map( ( level ) => {
			const y = ( CHART_HEIGHT - ( ( level - min ) / span ) * CHART_HEIGHT ).toFixed( 1 );

			return `<line x1="0" y1="${ y }" x2="${ CHART_WIDTH }" y2="${ y }" class="grid"></line>`;
		} )
		.join( '' );

	const ticks = levels
		.map( ( level, index ) => {
			const top = [ '0', '50%', '100%' ][ index ];

			return `<span class="y-tick" style="top:${ top }">${ escapeHtml( format( level ) ) }</span>`;
		} )
		.join( '' );

	const first = points[ 0 ].bucket;
	const last = points[ points.length - 1 ].bucket;
	const label = `${ caption } over ${ points.length } buckets, from ${ first } to ${ last }`;

	// Five dated ticks rather than only the two ends, because "somewhere between 28 July and 26
	// October" is not enough to read a slope against. The leftmost keeps its year and the rest drop to
	// `MM-DD`: the year is established once, and repeating it five times crowds the axis at the widths
	// this page is read at.
	const tickCount = Math.min( 5, points.length );
	const fractionAt = ( position ) => ( tickCount === 1 ? 0.5 : position / ( tickCount - 1 ) );

	const xTicks = Array.from( { length: tickCount }, ( unused, position ) => {
		const fraction = fractionAt( position );
		const bucket = points[ Math.round( fraction * ( points.length - 1 ) ) ].bucket;
		const text = position === 0 ? bucket.slice( 0, 10 ) : bucket.slice( 5, 10 );

		// The end labels are pulled inside the plot rather than centred on it, so neither hangs off the
		// edge of the panel.
		const shift = position === 0 ? '0' : position === tickCount - 1 ? '-100%' : '-50%';

		return (
			`<span class="x-tick" style="left:${ ( fraction * 100 ).toFixed( 2 ) }%;` +
			`transform:translateX(${ shift })">${ escapeHtml( text ) }</span>`
		);
	} ).join( '' );

	const xGridlines = Array.from( { length: tickCount }, ( unused, position ) => {
		const x = ( fractionAt( position ) * CHART_WIDTH ).toFixed( 1 );

		return `<line x1="${ x }" y1="0" x2="${ x }" y2="${ CHART_HEIGHT }" class="grid"></line>`;
	} ).join( '' );

	// `caption` is the accessible name only. The subsection heading above already says what this
	// charts, and printing it twice was two labels for one line.
	return (
		'<figure class="trend">' +
		`<div class="plot">${ ticks }` +
		`<svg class="chart" viewBox="0 0 ${ CHART_WIDTH } ${ CHART_HEIGHT }" preserveAspectRatio="none" ` +
		`role="img" aria-label="${ escapeHtml( label ) }">` +
		gridlines +
		xGridlines +
		`<polyline class="series" points="${ plotted.join( ' ' ) }"></polyline>` +
		'</svg></div>' +
		`<div class="x-axis"><div class="x-track">${ xTicks }</div></div>` +
		'</figure>'
	);
}

function renderOutcomesSection( renderOutcomes ) {
	const total = renderOutcomes.rows.reduce( ( sum, row ) => sum + row.count, 0 );

	const rows = renderOutcomes.rows.map( ( row ) =>
		barRow( {
			label: labelFor( FILENAME_TAG_LABELS, row.filenameTag ),
			count: row.count,
			total,
			tone: row.filenameTag === FILENAME_TAGS.departures ? 'served' : 'rejected',
		} )
	);

	return panel( {
		title: 'Render outcomes',
		tooltip:
			'Which board state was served, from the filename tag. Anything other than Departures is a ' +
			'degraded screen.',
		error: renderOutcomes.error,
		bodyHtml: rows.length ? barList( rows ) : emptyState( renderOutcomes.error, 'nothing has been rendered yet' ),
	} );
}

/**
 * RSSI as the number of bars a phone would draw.
 *
 * The thresholds are the conventional WiFi ones — roughly -55 / -67 / -75 / -85 dBm — chosen because
 * a reader already knows how to read them, not because the firmware defines any. `-1` is the absent
 * sentinel rather than an extremely strong signal, so it has to be excluded before comparing: every
 * real reading is more negative than it.
 */
export function signalBars( rssi ) {
	const value = toNumber( rssi );

	if ( value >= ABSENT_NUMBER ) {
		return 0;
	}

	if ( value >= -55 ) {
		return 4;
	}

	if ( value >= -67 ) {
		return 3;
	}

	if ( value >= -75 ) {
		return 2;
	}

	return 1;
}

/**
 * The bars themselves.
 *
 * Inline SVG, like every other chart here — the page loads no external asset, so an icon font or a
 * sprite is not available even in principle. Unfilled bars stay drawn in outline rather than being
 * omitted, so "one bar of four" is legible as weak rather than as a rendering that half-failed.
 */
function signalIcon( rssi ) {
	const bars = signalBars( rssi );
	const label = bars === 0 ? 'no signal reading' : `${ bars } of 4 bars`;

	const shapes = [ 0, 1, 2, 3 ]
		.map( ( index ) => {
			const height = 6 + index * 5;
			const filled = index < bars;

			return (
				`<rect x="${ index * 7 }" y="${ 22 - height }" width="5" height="${ height }" rx="1" ` +
				`fill="${ filled ? COLOR_SERVED : 'none' }" stroke="${ filled ? 'none' : '#4a4a4a' }" ` +
				'stroke-width="1"></rect>'
			);
		} )
		.join( '' );

	return (
		`<svg class="signal" viewBox="0 0 26 24" width="26" height="24" role="img" ` +
		`aria-label="${ escapeHtml( label ) }"><title>${ escapeHtml( label ) }</title>${ shapes }</svg>`
	);
}

/**
 * One panel per physical device, keyed on the MAC address from the `ID` header.
 *
 * **This is the only place two devices are ever separated.** Every other panel aggregates across
 * whatever authenticated, which is what made a second device look like "two firmware versions" or
 * "double the expected polls" rather than like a second device. Those alarms still matter — they fire
 * on inference and catch a device that has not polled recently — but this box answers the follow-up.
 *
 * Grouped from the most recent authenticated polls, so each box is that device's *current* state
 * rather than an average over the window.
 */
function devicesSection( devices, panelData, battery ) {
	if ( devices.error ) {
		return panel( { title: 'Devices', error: devices.error, bodyHtml: '' } );
	}

	if ( devices.rows.length === 0 ) {
		// **The query errors have to be repeated here.** Repaints, refresh echo and charge are
		// drawn inside device boxes, so with no boxes there is nowhere for their failures to appear —
		// and a failed query rendered nowhere is indistinguishable from a device that has not polled.
		// That is the same trap `emptyState()` exists for, one level up.
		const strandedErrors = [ panelData.imageCachedError, panelData.refreshEchoError, battery.error ]
			.filter( Boolean )
			.map( queryFailed )
			.join( '' );

		return panel( {
			title: 'Devices',
			tooltip: 'One box per physical device, from the MAC address the firmware sends as `ID`.',
			bodyHtml:
				strandedErrors +
				'<p class="none">no device has polled yet. A box appears here on the first request ' +
				'carrying device headers — an authenticated request without them, such as a hand-made ' +
				'curl, is counted elsewhere but is deliberately not a device</p>',
		} );
	}

	return devices.rows.map( ( device ) => deviceBox( device, panelData, battery ) ).join( '' );
}

/** A `-1` numeric reading as words, so an absent sensor never renders as a plausible value. */
function deviceReading( value, format ) {
	const number = toNumber( value );

	return number === ABSENT_NUMBER ? 'no data' : format( number );
}

/**
 * `Battery-Charging` and `USB-Connected` arrive as free text, and the firmware's exact spelling is
 * unverified — so this reports what was sent rather than interpreting it into a yes or a no it might
 * have wrong.
 */
function deviceFlag( value ) {
	return String( value ?? '' ).trim() === '' ? 'not reported' : value;
}

/**
 * The rows in a device box the server worked out for itself, rather than believing.
 *
 * **Listed as the exception because the safe default is the other way round.** Almost everything the
 * page knows about a device arrives in a request header, and a header is whatever the caller typed —
 * including the MAC address the whole per-device split is keyed on. Someone replaying this sign's URL
 * can send its MAC and merge silently into its box, so a single calm device box is not evidence of a
 * single device. That is why the identity alarms above key on network and firmware instead.
 *
 * Marking the observed rows rather than the claimed ones means a row added later is treated as
 * spoofable until someone decides otherwise, which is the direction that fails safely.
 */
const OBSERVED_DEVICE_FACTS = new Set( [
	'IP address',
	'Network',
	'Last seen',
	'Last request',
	'Last screen served',
	'Upstream on that poll',
] );

function deviceBox( device, panelData, battery ) {
	const rssi = toNumber( device.signal );

	const facts = [
		[ 'MAC address', device.deviceId || 'not sent' ],
		[ 'IP address', device.clientIp || 'unknown' ],
		[ 'Network', `${ device.organization || 'unknown' } (${ device.country || '??' })` ],
		[
			'WiFi signal',
			`${ signalIcon( device.signal ) } ${ escapeHtml(
				deviceReading( rssi, ( value ) => `${ value.toFixed( 0 ) } dBm` )
			) }${ device.wifiBand ? escapeHtml( ` on ${ device.wifiBand }` ) : '' }`,
			true,
		],
		[ 'Model', device.model || 'not sent' ],
		[
			'Panel',
			`${ deviceReading( device.width, ( value ) => value.toFixed( 0 ) ) } x ${ deviceReading(
				device.height,
				( value ) => value.toFixed( 0 )
			) }`,
		],
		[ 'Firmware', `${ device.firmwareVersion || 'unknown' }${ device.firmwareCommit ? ` (${ device.firmwareCommit })` : '' }` ],
		[
			'Battery',
			`${ deviceReading( device.percent, ( value ) => `${ value.toFixed( 0 ) }%` ) }, ` +
				`${ deviceReading( device.voltage, ( value ) => `${ value.toFixed( 2 ) } V` ) }, ` +
				`${ deviceReading( device.batteryTemperature, ( value ) => `${ value.toFixed( 0 ) } C` ) }`,
		],
		[ 'Battery capacity', device.batteryCapacity || 'not reported' ],
		[ 'Charging', deviceFlag( device.batteryCharging ) ],
		[ 'USB connected', deviceFlag( device.usbConnected ) ],
		[ 'Last seen', device.lastSeen || 'unknown' ],
		[ 'Last request', labelFor( OUTCOME_LABELS, device.outcome ) || device.outcome || 'unknown' ],
		[
			'Last screen served',
			device.filenameTag
				? labelFor( FILENAME_TAG_LABELS, device.filenameTag )
				: 'none — that request served no image',
		],
		[ 'Upstream on that poll', device.upstreamReason || 'every stop answered' ],
		[ 'Woke because', device.updateSource || 'not reported' ],
		[ 'Awake before last poll', device.wakeTime ? `${ device.wakeTime } ms` : 'not reported' ],
		[ 'Image cached', deviceFlag( device.imageCached ) ],
		[
			'Refresh rate it echoed',
			deviceReading( device.refreshRate, ( value ) => `${ value.toFixed( 0 ) } s` ),
		],
	];

	// `raw` marks the one row whose value is already markup — the signal icon. Everything else is
	// escaped here, which is the rule this file exists to keep: a device sends its own model string
	// and firmware version, and both land in the owner's browser.
	const rows = facts
		.map( ( [ label, value, raw ] ) => {
			const tell = OBSERVED_DEVICE_FACTS.has( label ) ? '' : '<span class="tell">*</span>';

			return (
				`<div class="fact"><dt>${ escapeHtml( label ) }${ tell }</dt>` +
				`<dd>${ raw ? value : escapeHtml( value ) }</dd></div>`
			);
		} )
		.join( '' );

	const claimedNote =
		'<p class="claimed">* Self-reported by the device in a request header, so anyone holding the URL ' +
		'for this sign can claim any of it, a matching MAC address included. The unmarked rows are ' +
		'observed by the server rather than taken on trust.</p>';

	return panel( {
		title: `Device ${ device.deviceId || '(no ID header)' }`,
		tooltip: 'This device: its last poll, and its readings across the window.',
		bodyHtml:
			`<dl class="facts">${ rows }</dl>${ claimedNote }` +
			repaintsFor( panelData, device.deviceId ) +
			trendsFor( battery, device.deviceId ),
	} );
}

/**
 * Why OneBusAway did not answer, on the polls where it did not.
 *
 * **The panel next to it says a poll ended in `obafail`; this one says why**, and the difference is
 * the whole diagnosis. `http-429` means the API key is rate-limited, which has a known fix — swap the
 * shared `TEST` key for a real one — while `timeout` means the upstream is slow, which does not.
 * Those were indistinguishable on this page until 2026-08-01.
 *
 * Empty is the healthy state and says so, rather than rendering a bare "none" that reads as a
 * missing query.
 */
function upstreamReasonsSection( upstreamReasons ) {
	const total = upstreamReasons.rows.reduce( ( sum, row ) => sum + row.count, 0 );

	const rows = upstreamReasons.rows.map( ( row ) =>
		barRow( { label: row.upstreamReason, count: row.count, total, tone: 'rejected' } )
	);

	return panel( {
		title: 'Upstream failures',
		tooltip:
			'Why OneBusAway did not answer. Counts polls where at least one stop failed, including ' +
			'partial failures that still drew a board. `http-429` is the shared TEST key being rate-limited.',
		error: upstreamReasons.error,
		bodyHtml: rows.length
			? barList( rows )
			: emptyState( upstreamReasons.error, 'every stop answered on every poll in this window' ),
	} );
}

/**
 * A `-1` device-log reading as words.
 *
 * Compared with strict equality rather than `<=`, unlike the battery readings above: WiFi signal is
 * legitimately negative, so treating everything below the sentinel as absent would report every
 * real reading the device ever sends as missing. `toNumber()` already collapses unparseable values
 * onto the sentinel, so equality still catches those.
 */
function logReading( value, format ) {
	const number = toNumber( value );

	return number === ABSENT_LOG_NUMBER ? 'no data' : format( number );
}

/** `path:line`, the pair that turns a failure into a specific line of firmware. */
function sourceLocation( entry ) {
	const line = toNumber( entry.sourceLine );

	if ( ! entry.sourcePath ) {
		return '';
	}

	return line === ABSENT_LOG_NUMBER ? entry.sourcePath : `${ entry.sourcePath }:${ line }`;
}

/**
 * The message, marked when it was clipped on the way into storage.
 *
 * `messageBytes` is the length the device sent, before truncation, so the two disagreeing is the
 * only way to know the text on screen is not the whole diagnostic. An unmarked clipped message is
 * worse than a short one, because it reads as a complete sentence that happens to stop early.
 */
function messageCell( entry ) {
	const kept = byteLength( entry.message );
	const sent = toNumber( entry.messageBytes );

	if ( sent <= kept ) {
		return entry.message;
	}

	return {
		text: `${ entry.message }…`,
		title:
			`clipped on write: the device sent ${ formatCount( sent ) } bytes and ` +
			`${ formatCount( kept ) } were kept`,
	};
}

/**
 * What the device says about itself.
 *
 * `/api/log` is the only channel back from a sign that is rendering nothing, which makes this the
 * one panel that can explain a failure the request rows cannot see at all: every other panel here
 * is built from what the server observed, and a device that never woke leaves no request row.
 */
function deviceLogsSection( deviceLogs ) {
	const levelTotal = deviceLogs.levels.reduce( ( sum, row ) => sum + row.count, 0 );

	const levelRows = deviceLogs.levels.map( ( row ) =>
		barRow( {
			label: row.level || 'no level',
			count: row.count,
			total: levelTotal,
			tone: FAILURE_LOG_LEVELS.has( String( row.level ).trim().toLowerCase() ) ? 'rejected' : 'served',
		} )
	);

	const entryRows = deviceLogs.entries.map( ( entry ) => [
		entry.timestamp,
		entry.level,
		messageCell( entry ),
		sourceLocation( entry ),
		entry.firmwareVersion,
		logReading( entry.freeHeapSize, ( bytes ) => `${ formatCount( bytes ) } bytes` ),
		logReading( entry.wifiSignal, ( strength ) => `${ strength } dBm` ),
	] );

	const isEmpty = deviceLogs.levels.length === 0 && deviceLogs.entries.length === 0;
	const anyError = Boolean( deviceLogs.levelsError || deviceLogs.entriesError );
	const entriesFailure = deviceLogs.entriesError ? queryFailed( deviceLogs.entriesError ) : '';

	// An empty panel only claims to be expected state when nothing failed, for the same reason the
	// page-level banner does: "expected" printed beside "query failed" is the page lying about itself.
	// The device only files a log when something goes wrong, so silence here is good news rather than
	// a gap — but the sentence has to say which, because an empty diagnostic panel reads as broken
	// plumbing. It said the opposite until 2026-08-02: that `/api/log` was unimplemented, which was
	// true when it was written and had not been since the endpoint landed. Copy describing what the
	// Worker does not do yet is copy that turns into a lie the day someone implements it.
	const emptyBody = anyError
		? entriesFailure
		: '<p class="none">no device logs yet. /api/log is implemented and reachable, and the device ' +
			'only files an entry when it has something to report, so an empty panel means it has not ' +
			'hit anything worth reporting</p>';

	return panel( {
		title: 'Device logs',
		tooltip:
			'What the device reports through /api/log. The source path and line name the exact line of ' +
			'firmware that produced the entry — the firmware is open source, so that pair is a ' +
			'definitive answer rather than a guess about what went wrong, which is the whole reason ' +
			'it is stored.',
		error: deviceLogs.levelsError,
		bodyHtml: isEmpty
			? emptyBody
			: barList( levelRows ) +
				entriesFailure +
				dataTable(
					[ 'When', 'Level', 'Message', 'Source', 'Firmware', 'Free heap', 'WiFi' ],
					entryRows
				) +
				note(
					'Free heap is recorded because out-of-memory is one of the failure modes that draws nothing ' +
						'at all, forever, and it is invisible in every other signal on this page.'
				),
	} );
}

function badRequestsSection( badRequests ) {
	const rows = badRequests.rows.map( ( row ) => [
		labelFor( REJECTION_REASON_LABELS, row.reason ),
		row.agency,
		row.stopIds,
		formatCount( row.count ),
	] );

	return panel( {
		title: 'Configuration errors',
		tooltip: 'A caller holding the right token whose URL will not parse — almost always a pairing typo.',
		error: badRequests.error,
		bodyHtml:
			( rows.length
				? dataTable( [ 'Problem', 'Agency', 'Stop IDs', 'Requests' ], rows )
				: emptyState( badRequests.error, 'none' ) ) +
			note(
				'Stop IDs are shown deliberately, because "which stop was this failing request for" is the ' +
					'question this panel exists to answer. A screenshot of this page therefore carries the ' +
					'sign\'s location.'
			),
	} );
}

function rejectionsSection( rejections ) {
	const sourceRows = rejections.sources.map( ( row ) => [
		row.country,
		row.organization,
		row.userAgent,
		formatCount( row.count ),
	] );

	const probeTotal = rejections.probePaths.reduce( ( sum, row ) => sum + row.count, 0 );

	const probeRows = rejections.probePaths.map( ( row ) =>
		barRow( { label: row.probePath, count: row.count, total: probeTotal, tone: 'rejected' } )
	);

	return panel( {
		title: 'Rejections',
		tooltip:
			'Who is scanning the hostname. Probe paths are allow-list filtered before they are recorded, ' +
			'so anything that could have been a secret shows as [redacted].',
		bodyHtml:
			'<div class="columns">' +
			'<div><h3>Sources</h3>' +
			( rejections.sourcesError ? queryFailed( rejections.sourcesError ) : '' ) +
			dataTable( [ 'Country', 'Network', 'User agent', 'Requests' ], sourceRows ) +
			'</div>' +
			'<div><h3>Probe paths</h3>' +
			( rejections.probePathsError ? queryFailed( rejections.probePathsError ) : '' ) +
			barList( probeRows ) +
			'</div>' +
			'</div>',
	} );
}

function recentSection( recent ) {
	const rows = recent.rows.map( ( row ) => [
		row.timestamp,
		labelFor( OUTCOME_LABELS, row.outcome ),
		row.country,
		row.organization,
		row.userAgent,
		row.probePath,
	] );

	return panel( {
		title: 'Recent rejections',
		error: recent.error,
		bodyHtml: dataTable( [ 'When', 'Outcome', 'Country', 'Network', 'User agent', 'Path' ], rows ),
	} );
}

/**
 * The banner for an empty dataset.
 *
 * Worded as expected state rather than failure, because on a freshly deployed Worker it is: nothing
 * has found the hostname and nothing has been paired. A dashboard that looks broken when it is
 * correct is a dashboard nobody trusts later, when it is reporting something real.
 *
 * **But it must not rule out the failure it cannot see.** Zero rows is also exactly what a rejected
 * write schema looks like, which is not hypothetical — every write was silently dropped for a full
 * deploy cycle on 2026-08-02, and a banner reading "that is the expected state" was the only thing
 * `/stats` had to say about it. So the second sentence names the other explanation and where to
 * check it.
 */
function emptyBanner( rangeLabel ) {
	return (
		'<p class="banner">' +
		escapeHtml(
			`No requests recorded in ${ rangeLabel }. On a Worker nothing has found yet that is expected — ` +
				'rejections only appear once a scanner arrives, and the hardware panels stay empty until a ' +
				'device is paired. If you know traffic has reached it, the writes are being rejected rather ' +
				'than the traffic being absent: check `npm run tail` and the Analytics Engine binding.'
		) +
		'</p>'
	);
}

const STYLES =
	':root{color-scheme:dark;' +
	`--served:${ COLOR_SERVED };--rejected:${ COLOR_REJECTED };--alarm:${ COLOR_ALARM };` +
	'--bg:#2c2c2c;--panel:#383838;--line:#4a4a4a;--text:#ececec;--muted:#a2a2a2;--link:#9cf}' +
	'*{box-sizing:border-box}' +
	'body{margin:0;padding:20px;background:var(--bg);color:var(--text);' +
	'font:14px/1.45 system-ui,sans-serif;overflow-x:hidden}' +
	'h1{font-size:18px;margin:0}' +
	'h2{font-size:14px;font-weight:600;margin:0 0 12px}' +
	'h3{font-size:13px;font-weight:600;margin:0 0 8px;color:var(--muted)}' +
	'h2[title]{border-bottom:1px dotted var(--muted);display:inline-block;cursor:help}' +
	'header{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;' +
	'justify-content:space-between;margin-bottom:18px}' +
	'.range{display:flex;gap:8px;align-items:center}' +
	'.range label{color:var(--muted)}' +
	'select,button{background:var(--panel);color:var(--text);border:1px solid var(--line);' +
	'border-radius:4px;padding:4px 6px;font:inherit}' +
	'.panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;' +
	'padding:14px;margin-bottom:14px}' +
	'.banner{background:#3d3a2a;border:1px solid #6b5f30;border-radius:6px;padding:12px;margin:0 0 14px}' +
	'.banner.error{background:#452c2c;border-color:#7a4040}' +
	'.query-error{color:var(--alarm);margin:0 0 10px;font-family:ui-monospace,monospace;font-size:12px}' +
	'.none{color:var(--muted);margin:0}' +
	'.note{color:var(--muted);font-size:12px;margin:10px 0 0}' +
	'.metric{margin:0 0 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}' +
	'.metric strong{font-size:26px;font-weight:700}' +
	'.metric span{color:var(--muted)}' +
	'.tiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}' +
	'.tile{flex:1 1 130px;border:1px solid var(--line);border-radius:5px;padding:10px;' +
	'display:flex;flex-direction:column;gap:2px}' +
	'.tile-value{font-size:24px;font-weight:700}' +
	'.tile-label{color:var(--muted);font-size:12px}' +
	'.tile.served{border-left:3px solid var(--served)}' +
	'.tile.rejected{border-left:3px solid var(--rejected)}' +
	'.split{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#4a4a4a}' +
	'.split-part.served,.bar-fill.served,.swatch.served{background:var(--served)}' +
	'.split-part.rejected,.bar-fill.rejected,.swatch.rejected{background:var(--rejected)}' +
	'.legend{list-style:none;display:flex;flex-wrap:wrap;gap:14px;margin:8px 0 0;padding:0;' +
	'color:var(--muted);font-size:12px}' +
	'.legend li{display:flex;gap:6px;align-items:center}' +
	'.swatch{width:10px;height:10px;border-radius:2px}' +
	'.bars{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}' +
	'.bar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:10px;align-items:center}' +
	'.bar-label{overflow-wrap:anywhere}' +
	'.bar-track{background:#4a4a4a;border-radius:4px;height:12px;overflow:hidden}' +
	'.bar-fill{display:block;height:100%}' +
	'.bar-count{font-variant-numeric:tabular-nums;color:var(--muted)}' +
	'.checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}' +
	'.facts{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 24px}' +
	'.fact dt{font-size:12px;color:#8a8a8a;margin:0 0 2px}' +
	'.fact dd{margin:0;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:8px}' +
	'.fact dt .tell{margin-left:2px;color:#b0b0b0}' +
	'.claimed{margin:14px 0 0;font-size:12px;font-style:italic;color:#8a8a8a;line-height:1.5}' +
	'.subpanel{margin:18px 0 0;padding:16px 0 0;border-top:1px solid var(--line)}' +
	'.subpanel h3{margin:0 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}' +
	'.trend{margin:0}' +
	'.trend figcaption{font-size:12px;color:var(--muted);margin:0 0 6px}' +
	// The y-gutter is wide enough for the longest tick a chart here produces (`-90 dBm`) and the ticks
	// never wrap, because a wrapped label stops being vertically centred on the gridline it labels.
	'.trend .plot{position:relative;padding-left:64px}' +
	'.trend .y-tick{position:absolute;left:0;width:56px;text-align:right;font-size:11px;white-space:nowrap;' +
	'color:var(--muted);transform:translateY(-50%);font-variant-numeric:tabular-nums}' +
	// The ticks are positioned inside `.x-track` rather than against `.x-axis`, because a percentage
	// `left` resolves against the padding box — measured from the panel edge, it would sit the whole
	// axis 64px left of the plot it labels.
	'.trend .x-axis{padding-left:64px;margin-top:5px;font-size:11px;color:var(--muted);' +
	'font-variant-numeric:tabular-nums}' +
	'.trend .x-track{position:relative;height:14px}' +
	'.trend .x-tick{position:absolute;top:0;white-space:nowrap}' +
	'.signal{flex:none;vertical-align:middle}' +
	'.check{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:5px;' +
	'border:1px solid var(--line)}' +
	'.check-body{display:flex;flex-direction:column;gap:2px;min-width:0}' +
	'.check-label{color:var(--muted);font-size:12px}' +
	'.check-value{overflow-wrap:anywhere}' +
	'.check-state{font-size:11px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:3px;' +
	'background:#4a4a4a;color:var(--muted);flex:none}' +
	'.check.alarm{border-color:var(--alarm);background:#432c2b}' +
	'.check.alarm .check-state{background:var(--alarm);color:#1a1a1a}' +
	'.check.alarm .check-value{font-weight:600;font-size:16px}' +
	'.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}' +
	'.scroll{overflow-x:auto;max-width:100%}' +
	'table{border-collapse:collapse;font-size:12px;min-width:100%}' +
	'th,td{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid var(--line);' +
	'white-space:nowrap;vertical-align:top}' +
	'th{color:var(--muted);font-weight:600}' +
	'td[title]{cursor:help}' +
	'.chart{width:100%;height:130px;display:block}' +
	'.chart .grid{stroke:var(--line);stroke-width:1}' +
	'.chart .series{fill:none;stroke:var(--served);stroke-width:2;vector-effect:non-scaling-stroke}';

/**
 * The whole page.
 *
 * @param   {object} data From `buildStatsData()` in `./query.js`.
 * @returns {string} A complete HTML document.
 */
export function renderStatsHtml( data ) {
	const showEmptyBanner = data.totals.total === 0 && ! data.errorMessage;

	return (
		'<!doctype html><html lang="en"><head><meta charset="utf-8">' +
		'<meta name="viewport" content="width=device-width,initial-scale=1">' +
		// Not a security control — the page is password gated — but a scanner that indexes it would
		// republish the sign's stop IDs, which is the one value on here that implies an address.
		'<meta name="robots" content="noindex">' +
		`<title>Sign stats &middot; ${ escapeHtml( data.rangeLabel ) }</title>` +
		`<style>${ STYLES }</style></head><body>` +
		'<header><h1>Sign stats</h1>' +
		`${ rangePicker( data.range ) }</header>` +
		( data.errorMessage ? `<p class="banner error">${ escapeHtml( `query failed: ${ data.errorMessage }` ) }</p>` : '' ) +
		( showEmptyBanner ? emptyBanner( data.rangeLabel ) : '' ) +
		identitySection( data.identity ) +
		devicesSection( data.devices, data.panel, data.battery ) +
		totalsSection( data.totals ) +
		outcomesSection( data.outcomes ) +
		renderOutcomesSection( data.renderOutcomes ) +
		upstreamReasonsSection( data.upstreamReasons ) +
		deviceLogsSection( data.deviceLogs ) +
		badRequestsSection( data.badRequests ) +
		rejectionsSection( data.rejections ) +
		recentSection( data.recent ) +
		'</body></html>'
	);
}

/**
 * Mock data in exactly the shape `buildStatsData()` returns, for iterating on this page without an
 * Analytics Engine dataset or a Cloudflare API token.
 *
 * Two things are deliberate rather than incidental. **Every timestamp is a fixed literal** — a
 * `Date.now()` here would make any test that renders the mock non-deterministic. And **the stop IDs
 * are the downtown Seattle samples** from `src/render/CLAUDE.md`, never the stop this sign points
 * at, because this is a tracked file.
 *
 * The dataset is chosen to exercise the page's hard cases at once: a second network and a non-zero
 * enrollment count so both alarms are visible, a battery bucket with no charge reading so the
 * exclusion path runs, a device log entry with no heap or signal reading and another whose message
 * was clipped on write, and an injection payload in every attacker-controlled string field so the
 * escaping is exercised rather than assumed.
 */
/**
 * The same page before a device has ever polled — scanner traffic, and nothing else.
 *
 * A separate builder rather than a flag, because this is a distinct thing to look at rather than a
 * variant of the other one: it is what `/stats` shows for however long a Worker is deployed before
 * the sign is paired, and until 2026-08-02 nobody had looked at it. What it showed then was a
 * firmware build of "unknown" on a panel of -1 by -1 and a poll count 12,000 short of expectation,
 * all of it generated by two hand-made `curl` calls and all of it labelled `ok`.
 *
 * Rejections are kept rather than zeroed, because a bare empty page is the *other* state — a Worker
 * nothing has found. Scanners arrive within hours of a `workers.dev` hostname existing, so this is
 * the realistic shape: plenty of traffic, no device.
 */
export function buildUnpairedMockStatsData( rangeKey ) {
	const data = buildMockStatsData( rangeKey );
	const rejected = data.totals.rejected;

	return {
		...data,
		totals: { total: rejected, authorized: 0, rejected },
		outcomes: data.outcomes.filter( ( row ) => ! row.authorized ),
		identity: {
			...data.identity,
			networks: [],
			firmware: [],
			setupCalls: 0,
			enrollments: [],
			authorizedRequests: 0,
			deviceCount: 0,
		},
		devices: { rows: [], error: '' },
		panel: { imageCached: [], imageCachedError: '', refreshEcho: [], refreshEchoError: '' },
		battery: { series: [], error: '' },
		renderOutcomes: { rows: [], error: '' },
		upstreamReasons: { rows: [], error: '' },
		deviceLogs: { levels: [], levelsError: '', entries: [], entriesError: '' },
	};
}

/**
 * The one device in the mock.
 *
 * Named rather than repeated, because the per-device panels join on it: a typo in any one copy would
 * render a device box with every reading missing, which is a real state and so would not look wrong.
 */
const MOCK_DEVICE_ID = 'A4:CF:12:9B:7E:03';

/** The last six-hour bucket the mock telemetry ends on, fixed so every render is identical. */
const MOCK_SERIES_END_MS = Date.UTC( 2026, 6, 31, 18, 0, 0 );

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Six-hourly telemetry for the mock device, shaped like the real thing rather than like a demo.
 *
 * **Deterministic, and that is why the noise is arithmetic rather than `Math.random()`.** A series
 * that changed per run would make every test rendering the mock flaky. It still has to *be* noise: a
 * smooth line makes the preview look like the charts work when what they have to survive is jitter,
 * dropouts and a recharge.
 *
 * **The two series are deliberately different shapes, because they are different phenomena.**
 *
 * - **Charge sawtooths.** It falls slowly and jumps back to full when someone plugs the sign in, so
 *   a long window contains a recharge rather than one clean slope.
 * - **Signal is flat and noisy.** A sign screwed to a wall does not drift away from its router: RSSI
 *   sits around a baseline and occasionally craters when something interferes. The first version of
 *   this mock sloped it downward in lockstep with the battery, which is not what the hardware does
 *   and taught exactly the wrong reading of the chart.
 *
 * Generates the full 90 days that Analytics Engine retains; the caller slices the tail to whatever
 * range is selected, exactly as the `WHERE timestamp > NOW() - INTERVAL` in the real query does. So a
 * short window is the *recent* end of this history rather than a differently-shaped series, and it
 * legitimately may not contain the recharge.
 */
function mockTelemetry() {
	const buckets = 90 * 4;

	// A fixed hash of the bucket index. `salt` gives each series its own uncorrelated sequence, so
	// charge and signal do not dip in the same places.
	const noise = ( index, salt ) => {
		const value = Math.sin( ( index + 1 ) * salt ) * 43758.5453;

		return value - Math.floor( value );
	};

	let percent = 100;

	return Array.from( { length: buckets }, ( unused, index ) => {
		const bucket = new Date( MOCK_SERIES_END_MS - ( buckets - 1 - index ) * SIX_HOURS_MS )
			.toISOString()
			.replace( 'T', ' ' )
			.slice( 0, 19 );

		percent -= 0.3 + noise( index, 12.9898 ) * 0.25;

		if ( percent < 12 ) {
			percent = 100;
		}

		// A bucket the device reported nothing in. Every ninth rather than randomly, so the shortest
		// range still contains one and the test that counts them is not a coin toss.
		if ( index % 9 === 4 ) {
			return {
				deviceId: MOCK_DEVICE_ID,
				bucket,
				voltage: ABSENT_NUMBER,
				percent: ABSENT_NUMBER,
				signal: ABSENT_NUMBER,
			};
		}

		// Whether a bucket craters is itself noise, not `index % 17`. A fixed cadence draws a visibly
		// periodic comb, and interference does not arrive on a timetable.
		const interference = noise( index, 91.7743 ) > 0.87;

		return {
			deviceId: MOCK_DEVICE_ID,
			bucket,
			voltage: Number( ( 3.3 + ( percent / 100 ) * 0.85 ).toFixed( 2 ) ),
			percent: Math.round( percent ),
			signal: Math.round(
				interference ? -72 - noise( index, 4.1414 ) * 14 : -58 + ( noise( index, 78.233 ) - 0.5 ) * 8
			),
		};
	} );
}

export function buildMockStatsData( rangeKey ) {
	const range = resolveRange( rangeKey );
	const injection = '<img src=x onerror=alert(1)>';

	// A distinct payload per field group, so a test can count occurrences of one and know which field
	// stopped rendering rather than only that the total moved.
	const logInjection = '<img src=x onerror=alert(3)>';

	// `messageBytes` is the length the device sent, before truncation, so it is derived rather than
	// typed: a hand-counted number one byte high would mark an intact message as clipped, and the one
	// entry that is genuinely clipped says so by overriding it.
	const logEntry = ( entry ) => ( { messageBytes: byteLength( entry.message ), ...entry } );

	// The literals below describe the default 14-day window. `scaleMockVolumes()` stretches them to
	// whatever range is selected, so the picker moves every number on the page rather than only the
	// charts — a picker that visibly does nothing is the preview lying about what the page does.
	const mock = {
		range: range.key,
		rangeLabel: range.label,
		rangeDays: range.days,
		errorMessage: '',

		totals: { total: 21840, authorized: 19102, rejected: 2738 },

		outcomes: [
			{ outcome: OUTCOMES.byosUnimplemented, count: 19099, authorized: true },
			{ outcome: OUTCOMES.unshapedPath, count: 2461, authorized: false },
			{ outcome: OUTCOMES.badToken, count: 214, authorized: false },
			{ outcome: OUTCOMES.robots, count: 41, authorized: false },
			{ outcome: OUTCOMES.favicon, count: 18, authorized: false },
			{ outcome: OUTCOMES.statsAuthFailed, count: 4, authorized: false },
			{ outcome: OUTCOMES.badRequest, count: 3, authorized: true },
		],

		identity: {
			networks: [
				{
					asn: '7922',
					organization: 'Comcast Cable Communications',
					country: 'US',
					count: 18944,
					lastSeen: '2026-07-31 22:04:11',
				},
				{
					asn: '14618',
					organization: 'Amazon Data Services',
					country: 'US',
					count: 158,
					lastSeen: '2026-07-31 21:12:40',
				},
			],
			networksError: '',
			firmware: [
				{
					firmwareVersion: '1.6.2',
					model: 'x',
					width: '1872',
					height: '1404',
					count: 19044,
					lastSeen: '2026-07-31 22:04:11',
				},
				{
					firmwareVersion: '1.5.9',
					model: 'og',
					width: '800',
					height: '480',
					count: 58,
					lastSeen: '2026-07-30 08:41:02',
				},
			],
			firmwareError: '',
			setupCalls: 3,
			enrollments: [
				{ country: 'US', organization: 'Comcast Cable', model: 'x', firmwareVersion: '1.7.2', count: 2, lastSeen: '2026-07-30 09:14:02' },
				{ country: 'DE', organization: 'Hetzner Online', model: '', firmwareVersion: '', count: 1, lastSeen: '2026-07-29 03:51:44' },
			],
			enrollmentsError: '',
			authorizedRequests: 19102,
			expectedRequests: 8064,

			// One, matching the single device box below, so the mock renders the paired state. Note it
			// sits alongside identity alarms that infer a *second* device from two firmware builds and
			// two networks — that combination is the real one worth showing: the inference fires before
			// the second device has polled enough to appear as a box of its own.
			//
			// The unpaired state is a distinct render, built by `buildUnpairedMockStatsData()`.
			deviceCount: 1,
			deviceCountError: '',
		},

		panel: {
			imageCached: [
				{ deviceId: MOCK_DEVICE_ID, imageCached: 'true', count: 16510, lastSeen: '2026-07-31 22:04:11' },
				{ deviceId: MOCK_DEVICE_ID, imageCached: 'false', count: 2592, lastSeen: '2026-07-31 21:58:02' },
			],
			imageCachedError: '',
			refreshEcho: [
				{ deviceId: MOCK_DEVICE_ID, refreshRateEcho: '60', count: 12880, lastSeen: '2026-07-31 22:04:11' },
				{ deviceId: MOCK_DEVICE_ID, refreshRateEcho: '900', count: 6210, lastSeen: '2026-07-31 05:14:00' },
				{ deviceId: MOCK_DEVICE_ID, refreshRateEcho: '0', count: 12, lastSeen: '2026-07-29 03:22:17' },
			],
			refreshEchoError: '',
		},

		battery: {
			series: mockTelemetry(),
			error: '',
		},

		devices: {
			rows: [
				{
					deviceId: MOCK_DEVICE_ID,
					lastSeen: '2026-07-31 22:04:11',
					model: 'x',
					firmwareVersion: '1.7.2',
					firmwareCommit: 'e91b4c7',
					clientIp: '73.42.118.9',
					organization: 'Comcast Cable',
					country: 'US',
					wifiBand: '2.4 GHz',
					batteryCharging: 'false',
					usbConnected: 'false',
					batteryCapacity: '5210/6000',
					imageCached: '1',
					updateSource: 'timer',
					wakeTime: '4180',
					outcome: 'byos-display',
					filenameTag: 'departs',
					upstreamReason: '',
					signal: -61,
					voltage: 3.82,
					percent: 69,
					batteryTemperature: 24,
					refreshRate: 60,
					width: 1872,
					height: 1404,
				},
			],
			error: '',
		},

		upstreamReasons: {
			rows: [
				{ upstreamReason: 'http-429', count: 361, lastSeen: '2026-07-31 14:31:55' },
				{ upstreamReason: 'timeout', count: 34, lastSeen: '2026-07-30 08:12:40' },
				{ upstreamReason: 'malformed', count: 7, lastSeen: '2026-07-29 17:55:02' },
			],
			error: '',
		},

		renderOutcomes: {
			rows: [
				{ filenameTag: FILENAME_TAGS.departures, count: 18620, lastSeen: '2026-07-31 22:04:11' },
				{ filenameTag: FILENAME_TAGS.upstreamFailed, count: 402, lastSeen: '2026-07-31 14:31:55' },
				{ filenameTag: FILENAME_TAGS.noDepartures, count: 74, lastSeen: '2026-07-31 02:10:09' },
				{ filenameTag: FILENAME_TAGS.renderFailed, count: 6, lastSeen: '2026-07-30 19:44:21' },
			],
			error: '',
		},

		badRequests: {
			rows: [
				// Downtown Seattle samples, per `src/render/CLAUDE.md`. Never the stop this sign points at.
				{ reason: REJECTION_REASONS.invalidStopId, agency: '1', stopIds: '590,43O', count: 2, lastSeen: '2026-07-30 07:02:11' },
				{ reason: REJECTION_REASONS.tooManyStops, agency: '40', stopIds: '621,623,1121', count: 1, lastSeen: '2026-07-29 18:20:44' },
			],
			error: '',
		},

		rejections: {
			sources: [
				{
					country: 'NL',
					organization: 'DigitalOcean',
					userAgent: 'Mozilla/5.0 (compatible; CensysInspect/1.1)',
					count: 1240,
					lastSeen: '2026-07-31 20:59:03',
				},
				{
					country: 'CN',
					organization: 'Chinanet',
					userAgent: injection,
					count: 812,
					lastSeen: '2026-07-31 19:03:47',
				},
			],
			sourcesError: '',
			probePaths: [
				{ probePath: '/', count: 902, lastSeen: '2026-07-31 20:59:03' },
				{ probePath: '/wp-login.php', count: 611, lastSeen: '2026-07-31 18:22:10' },
				{ probePath: '/.env', count: 480, lastSeen: '2026-07-31 17:40:55' },
				{ probePath: '/token/[redacted]/api/display', count: 214, lastSeen: '2026-07-31 12:08:31' },
				{ probePath: injection, count: 9, lastSeen: '2026-07-30 22:14:06' },
			],
			probePathsError: '',
		},

		recent: {
			rows: [
				{
					timestamp: '2026-07-31 20:59:03',
					outcome: OUTCOMES.unshapedPath,
					country: 'NL',
					organization: 'DigitalOcean',
					userAgent: 'Mozilla/5.0 (compatible; CensysInspect/1.1)',
					probePath: '/',
				},
				{
					timestamp: '2026-07-31 19:03:47',
					outcome: OUTCOMES.badToken,
					country: 'CN',
					organization: 'Chinanet',
					userAgent: injection,
					probePath: injection,
				},
			],
			error: '',
		},

		deviceLogs: {
			levels: [
				{ level: 'info', count: 4120, lastSeen: '2026-07-31 22:04:11' },
				{ level: 'debug', count: 1880, lastSeen: '2026-07-31 22:04:11' },
				{ level: 'warn', count: 96, lastSeen: '2026-07-31 18:02:40' },
				{ level: 'error', count: 31, lastSeen: '2026-07-31 14:31:55' },
			],
			levelsError: '',
			entries: [
				logEntry( {
					timestamp: '2026-07-31 22:04:11',
					level: 'info',
					message: 'image unchanged, skipping download',
					sourcePath: 'src/bl.cpp',
					sourceLine: 2235,
					firmwareVersion: '1.6.2',
					wakeReason: 'timer',
					freeHeapSize: 4183524,
					wifiSignal: -58,
				} ),
				logEntry( {
					timestamp: '2026-07-31 18:02:40',
					level: 'warn',
					message: 'refresh rate read from NVS as 0, applying default',
					sourcePath: 'src/bl.cpp',
					sourceLine: 1719,
					firmwareVersion: '1.6.2',
					wakeReason: 'timer',
					freeHeapSize: 3920104,
					wifiSignal: -67,
				} ),
				logEntry( {
					timestamp: '2026-07-31 14:31:55',
					level: 'error',
					message:
						'png decode failed after 41 of 1404 lines: allocation of 15007 bytes for the line buffer ' +
						'returned null, framebuffer left untouched and the previous image remains on the panel',
					sourcePath: 'src/png.cpp',
					sourceLine: 118,
					firmwareVersion: '1.6.2',
					wakeReason: 'timer',
					freeHeapSize: 21440,
					wifiSignal: -71,

					// The clipped case. The kept text is shortened well below the real 1024-byte cap so the
					// mock table stays readable — what matters here is only that the two lengths disagree.
					messageBytes: 1420,
				} ),
				logEntry( {
					timestamp: '2026-07-30 19:44:21',
					level: 'error',
					message: `filesystem purge removed a cached image: ${ logInjection }`,
					sourcePath: 'lib/filesystem/filesystem.cpp',
					sourceLine: 110,
					firmwareVersion: '1.6.2',
					wakeReason: 'reset',
					freeHeapSize: 3011880,
					wifiSignal: -74,
				} ),
				logEntry( {
					timestamp: '2026-07-30 19:44:19',
					level: 'debug',
					message: 'wifi connected before the fuel gauge finished initialising',
					sourcePath: 'src/displayed_image.cpp',
					sourceLine: 9,
					firmwareVersion: '1.6.2',
					wakeReason: 'power on',

					// A cold boot files its first entry before either reading is available, which is the case
					// that must not print -1 on the page.
					freeHeapSize: ABSENT_LOG_NUMBER,
					wifiSignal: ABSENT_LOG_NUMBER,
				} ),
			],
			entriesError: '',
		},
	};

	return scaleMockVolumes( mock, range.days );
}

/**
 * Stretches the mock's volumes to the selected range, and trims its telemetry to the same window.
 *
 * **Rates scale; discrete events do not.** A fortnight's worth of polls really is twice a week's, so
 * every `count` answering "how often" is multiplied. `setupCalls` and the enrollment rows are not:
 * three enrolments happened, and scaling them would claim six on a 30-day view and one on a 7-day
 * one, which is a different statement rather than the same one over a longer window. The
 * recent-rejection, configuration-error and device-log tables are lists of individual rows, for the
 * same reason.
 *
 * The floor of 1 keeps a row that exists from rendering as a zero on a short range, since the whole
 * content of those rows is that the thing happened at all.
 */
function scaleMockVolumes( data, days ) {
	const factor = days / 14;
	const scale = ( value ) => Math.max( 1, Math.round( value * factor ) );
	const scaleRows = ( rows ) => rows.map( ( row ) => ( { ...row, count: scale( row.count ) } ) );

	return {
		...data,

		totals: {
			total: scale( data.totals.total ),
			authorized: scale( data.totals.authorized ),
			rejected: scale( data.totals.rejected ),
		},

		outcomes: scaleRows( data.outcomes ),

		identity: {
			...data.identity,
			networks: scaleRows( data.identity.networks ),
			firmware: scaleRows( data.identity.firmware ),
			authorizedRequests: scale( data.identity.authorizedRequests ),
		},

		panel: {
			...data.panel,
			imageCached: scaleRows( data.panel.imageCached ),
			refreshEcho: scaleRows( data.panel.refreshEcho ),
		},

		// The tail of the 90-day history, which is what the real query's `WHERE timestamp > NOW() -
		// INTERVAL` returns: a short window is the recent end of the same series, not a new one.
		battery: { ...data.battery, series: data.battery.series.slice( -Math.max( 8, days * 4 ) ) },

		renderOutcomes: { ...data.renderOutcomes, rows: scaleRows( data.renderOutcomes.rows ) },
		upstreamReasons: { ...data.upstreamReasons, rows: scaleRows( data.upstreamReasons.rows ) },
		deviceLogs: { ...data.deviceLogs, levels: scaleRows( data.deviceLogs.levels ) },

		rejections: {
			...data.rejections,
			sources: scaleRows( data.rejections.sources ),
			probePaths: scaleRows( data.rejections.probePaths ),
		},
	};
}
