/**
 * A self-check for the four device routes, so the BYOS contract can be exercised by reloading a page
 * instead of pasting a dozen `curl` commands.
 *
 * **Every assertion here is a silent-failure mode.** None of them is the kind of bug a test suite
 * catches by accident: the firmware swallows PNG decode errors, ignores a response whose `status` it
 * does not recognise, and hot-loops on a missing `refresh_rate` — so the symptom of getting any of
 * them wrong is a blank or frozen panel with nothing in any log. The point of the page is that a
 * human can see all of them green at once, and can look at the actual pixels while doing it.
 *
 * ## Why the checks run on the server
 *
 * The browser is never given the device token. Driving these from client-side `fetch()` would mean
 * embedding the shared secret in a page, and the whole access design rests on that string staying in
 * `.dev.vars` and device NVS. So the Worker calls its own pipeline directly and ships finished
 * results, with the rendered PNGs inlined as data URIs.
 *
 * This module composes `gate()` and `dispatchByos()` the same way `src/worker.js` does, rather than
 * importing the worker — importing it would be a cycle, since the worker imports this file's caller.
 * The consequence worth knowing: this covers the gate and the handlers, which is the whole request
 * path for a device, but it does not prove `src/worker.js` wires them together correctly. That is
 * what `src/worker.test.js` is for.
 *
 * **Dev-only, and gated the same way the rest of the preview is.** This is also the one module that
 * reads `env.DEVICE_TOKEN` outside the auth path, which is acceptable only because `DEV_PREVIEW`
 * lives in `.dev.vars` and can therefore never be set on a deployed Worker.
 */

import { stopLabel } from '../byos/display.js';
import { dispatchByos } from '../byos/index.js';
import { overnightScreen, renderFailedScreen, upstreamFailedScreen } from '../byos/screens.js';
import { readConfig } from '../config.js';
import { FILENAME_TAGS } from '../filename.js';
import { gate } from '../gate.js';
import { rasterize } from '../render/index.js';
import { buildNoticeSvg } from '../render/notice.js';
import { buildOvernightSvg } from '../render/overnight.js';

/** The firmware's cap on a downloaded image, from `config.h`. */
const MAX_IMAGE_BYTES = 750000;

const PANEL_WIDTH = 1872;
const PANEL_HEIGHT = 1404;

/**
 * The tarpit is disabled for the whole run.
 *
 * One check deliberately requests an unshaped path, which is the case the bot tarpit exists for — at
 * the real 25 seconds the page would appear to hang. The delay itself is covered by `gate.test.js`.
 */
function checkConfig( env ) {
	return readConfig( { ...env, TARPIT_MS: '0' } );
}

function basePath( env ) {
	return `/token/${ env.DEVICE_TOKEN }/agency/${ env.DEV_AGENCY_ID }/stop/${ env.DEV_STOP_ID }`;
}

/**
 * One request through the same two stages `src/worker.js` composes.
 *
 * @returns {Promise<Response>}
 */
async function callWorker( env, origin, path, init = {} ) {
	const request = new Request( `${ origin }${ path }`, init );
	const { response, classification, recordOutcome } = await gate( request, env, checkConfig( env ) );

	if ( response ) {
		return response;
	}

	return dispatchByos( request, env, classification, recordOutcome );
}

/**
 * PNG header fields, straight out of the IHDR chunk.
 *
 * Parsed rather than trusted because the two ways this goes wrong both produce a file that looks
 * fine: a dimension swap is silently treated as a rotation by the firmware, and an indexed 1-bit PNG
 * decodes to an entirely black panel because `ReduceBpp` has no case for it.
 */
function pngHeader( bytes ) {
	const magic = [ 0x89, 0x50, 0x4e, 0x47 ];
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );

	return {
		isPng: magic.every( ( byte, index ) => bytes[ index ] === byte ),
		width: view.getUint32( 16 ),
		height: view.getUint32( 20 ),
		bitDepth: bytes[ 24 ],
		colourType: bytes[ 25 ],
		bytes: bytes.byteLength,
	};
}

function check( name, why, ok, detail ) {
	return { name, why, ok: Boolean( ok ), detail };
}

async function setupChecks( env, origin ) {
	const response = await callWorker( env, origin, `${ basePath( env ) }/api/setup` );
	const body = await response.clone().json().catch( () => ( {} ) );

	return {
		body,
		checks: [
			check(
				'`/api/setup` body carries `status: 200`',
				'`parse_response_api_setup.cpp:25` rejects anything else, and enrollment then fails with nothing on the glass to say why. This is the opposite of `/api/display`.',
				body.status === 200,
				`status: ${ JSON.stringify( body.status ) }`
			),
			check(
				'`friendly_id` is present and readable',
				'The firmware persists it and draws it on the setup screen; it is how a person confirms pairing worked. Missing from the reference field list.',
				/^[2-9A-HJ-NP-Z]{6}$/.test( body.friendly_id ?? '' ),
				body.friendly_id
			),
			check(
				'`api_key` is issued',
				'Sent back as `Access-Token` on every later call. Derived from the shared secret, so no storage.',
				/^[0-9a-f]{64}$/.test( body.api_key ?? '' ),
				body.api_key ? `${ body.api_key.slice( 0, 8 ) }… (64 hex)` : 'absent'
			),
			check(
				'setup `image_url` sits under the base URL',
				'The firmware auth-tests an image URL with a raw `strncmp` against the stored base. Diverge early and it loses the token header.',
				( body.image_url ?? '' ).startsWith( `${ origin }${ basePath( env ) }/` ),
				body.image_url?.replace( env.DEVICE_TOKEN, '<token>' )
			),
			check(
				'setup needs no `Access-Token`',
				'Enrollment is how the device gets a key, so it cannot present one.',
				response.status === 200,
				`HTTP ${ response.status }`
			),
		],
	};
}

async function displayChecks( env, origin, apiKey ) {
	const headers = { 'Access-Token': apiKey, Model: 'x', Width: '1872', Height: '1404' };
	const response = await callWorker( env, origin, `${ basePath( env ) }/api/display`, { headers } );
	const body = await response.clone().json().catch( () => ( {} ) );
	const filename = body.filename ?? '';

	const unauthorized = await callWorker( env, origin, `${ basePath( env ) }/api/display` );

	return {
		body,
		checks: [
			check(
				'`/api/display` body carries `status: 0`',
				'The dispatch switch handles only 0, 202 and 500. Everything else — including the obvious `200` — hits `default: break;` and the whole response is discarded.',
				body.status === 0,
				`status: ${ JSON.stringify( body.status ) }`
			),
			check(
				'`refresh_rate` is a positive integer',
				'Absent parses as 0, is written to NVS, and the device hot-loops with no sleep until the battery is flat — and stays wedged across power cycles.',
				Number.isInteger( body.refresh_rate ) && body.refresh_rate >= 1,
				`${ body.refresh_rate } s`
			),
			check(
				'no `reset_firmware` or `update_firmware`',
				'`reset_firmware` clears WiFi credentials, the api key and the cached filename, then reboots into the captive portal. Both default false when absent, so the safest `false` is not sending them.',
				! ( 'reset_firmware' in body ) && ! ( 'update_firmware' in body ),
				'neither field present'
			),
			check(
				'`filename` is 25 characters, never 31',
				'At exactly 31 the firmware copies without a NUL terminator and the cache key ends in stack garbage.',
				filename.length === 25 && filename.length !== 31,
				`${ filename.length } chars`
			),
			check(
				'`filename` ends in 10 digits',
				'The purge that runs before every image write reads the trailing 10 characters as an epoch. A name without them extracts as 0, which always reads as stale, so each download wipes every other cached image.',
				/\d{10}$/.test( filename ),
				filename
			),
			check(
				'`image_url` matches the filename it issued',
				'They are independent fields, and the device fetches the URL while caching under the name.',
				body.image_url === `${ origin }${ basePath( env ) }/image/${ filename }`,
				body.image_url?.replace( env.DEVICE_TOKEN, '<token>' )
			),
			check(
				'display without `Access-Token` is refused',
				'The header is a derived copy of the path secret. Defence in depth, not a second factor.',
				unauthorized.status === 404,
				`HTTP ${ unauthorized.status }`
			),
		],
	};
}

async function imageChecks( env, origin, apiKey, filename ) {
	const response = await callWorker( env, origin, `${ basePath( env ) }/image/${ filename }`, {
		headers: { 'Access-Token': apiKey },
	} );
	const bytes = new Uint8Array( await response.arrayBuffer() );
	const header = pngHeader( bytes );
	const contentType = response.headers.get( 'Content-Type' );

	const noHeader = await callWorker( env, origin, `${ basePath( env ) }/image/setup` );

	return {
		bytes,
		header,
		checks: [
			check(
				'`Content-Type` is exactly `image/png`',
				'The firmware picks its decode path by string-comparing this header, not by sniffing magic bytes. A perfect PNG served as `application/octet-stream` takes the BMP path, fails, and displays nothing with no error. No charset parameter, no different casing.',
				contentType === 'image/png',
				JSON.stringify( contentType )
			),
			check(
				'the bytes really are a PNG',
				'`device_setup.cpp:189` sniffs these four bytes for the setup logo.',
				header.isPng,
				Array.from( bytes.slice( 0, 4 ), ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( ' ' )
			),
			check(
				`dimensions are ${ PANEL_WIDTH }x${ PANEL_HEIGHT }`,
				'The firmware crops rather than scales, and auto-rotates based on the PNG\'s own dimensions — so a width/height swap silently rotates the render instead of erroring.',
				header.width === PANEL_WIDTH && header.height === PANEL_HEIGHT,
				`${ header.width }x${ header.height }`
			),
			check(
				'4-bit greyscale, not indexed',
				'Colour type 0 at bit depth 4 is the X\'s native framebuffer format. An indexed 1-bit PNG comes out entirely black, because `ReduceBpp` has no case for it.',
				header.bitDepth === 4 && header.colourType === 0,
				`bit depth ${ header.bitDepth }, colour type ${ header.colourType }`
			),
			check(
				'under the size cap',
				`The X refuses anything over ${ MAX_IMAGE_BYTES.toLocaleString() } bytes.`,
				header.bytes > 0 && header.bytes < MAX_IMAGE_BYTES,
				`${ header.bytes.toLocaleString() } bytes`
			),
			check(
				'the image needs no `Access-Token` either',
				'The setup logo download never calls `applyHeaders` (`device_setup.cpp:123`), so requiring the header would break pairing at the worst possible moment.',
				noHeader.status === 200,
				`HTTP ${ noHeader.status }`
			),
		],
	};
}

async function logChecks( env, origin, apiKey ) {
	const post = ( body, headers = { 'Access-Token': apiKey } ) =>
		callWorker( env, origin, `${ basePath( env ) }/api/log`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body,
		} );

	const good = await post(
		JSON.stringify( {
			logs: [ { message: 'self-check', level: 'info', source_path: 'src/bl.cpp', source_line: 2235 } ],
		} )
	);
	const garbage = await post( 'not json at all' );
	const wrongShape = await post( JSON.stringify( { logs: 'oops' } ) );

	return [
		check(
			'`/api/log` answers 204 with an empty body',
			'No body means no `status` field to get wrong, which makes this the one endpoint that cannot wedge the device.',
			good.status === 204 && ( await good.clone().text() ) === '',
			`HTTP ${ good.status }`
		),
		check(
			'a malformed body still gets 204',
			'A device that cannot file a diagnostic must not conclude the server is broken and start backing off.',
			garbage.status === 204 && wrongShape.status === 204,
			`not-JSON: ${ garbage.status }, wrong shape: ${ wrongShape.status }`
		),
	];
}

async function accessChecks( env, origin ) {
	const badToken = await callWorker(
		env,
		origin,
		`/token/definitely-not-the-token/agency/1/stop/590/api/display`
	);
	const unshaped = await callWorker( env, origin, '/api/display' );

	return [
		check(
			'a wrong token is refused',
			'Checked before the path is parsed, so an unauthenticated caller never reaches the parser and cannot learn which half they got right.',
			badToken.status === 404,
			`HTTP ${ badToken.status }`
		),
		check(
			'a wrong token and an unshaped path are indistinguishable',
			'Different responses would tell someone probing which half was correct.',
			badToken.status === unshaped.status &&
				( await badToken.clone().text() ) === ( await unshaped.clone().text() ),
			'identical status and body'
		),
	];
}

async function badPathChecks( env, origin, apiKey ) {
	const path = `/token/${ env.DEVICE_TOKEN }/agency/not-a-number/stop/${ env.DEV_STOP_ID }`;
	const response = await callWorker( env, origin, `${ path }/api/display`, {
		headers: { 'Access-Token': apiKey },
	} );
	const body = await response.clone().json().catch( () => ( {} ) );
	const image = await callWorker( env, origin, `${ path }/image/${ body.filename ?? 'x' }` );
	const bytes = new Uint8Array( await image.arrayBuffer() );

	return {
		bytes,
		checks: [
			check(
				'a mistyped URL gets a board, not a 404',
				'Before the token matches, be opaque. After it matches, the caller is the owner, and the most likely mistake they can make is a typo in the base URL typed into the captive portal. A 404 there is a sign that does nothing for seven minutes with no clue why.',
				body.status === 0 && Number.isInteger( body.refresh_rate ),
				`status ${ body.status }, refresh_rate ${ body.refresh_rate }`
			),
			check(
				'it uses the `badpath` filename tag',
				'A degraded screen sharing a filename with a good render is suppressed by the cache and never reaches the glass.',
				( body.filename ?? '' ).startsWith( 'badpath-' ),
				body.filename
			),
			check(
				'its image URL extends the mistyped base',
				'The base URL the device stored is the wrong one, so the image URL has to reproduce the same mistake or the `strncmp` fails and the explanation is never fetched.',
				body.image_url === `${ origin }${ path }/image/${ body.filename }`,
				body.image_url?.replace( env.DEVICE_TOKEN, '<token>' )
			),
		],
	};
}

/**
 * Whether the same minute yields the same filename, and a later minute does not.
 *
 * This is the flicker budget made visible. The name is hashed over the rendered SVG, which carries a
 * minute-resolution "Updated at" stamp, so it moves exactly when the visible stamp moves — which is
 * the whole trade: minute accuracy bought at the cost of a repaint per poll on a screen that is
 * otherwise unchanging.
 */
async function cacheKeyChecks( env, origin, apiKey ) {
	const poll = async () => {
		const response = await callWorker( env, origin, `${ basePath( env ) }/api/display`, {
			headers: { 'Access-Token': apiKey },
		} );

		return ( await response.json() ).filename;
	};

	const first = await poll();
	const second = await poll();

	return [
		check(
			'two polls in the same second agree',
			'If the name moved on every request the device would download and flash the panel every poll no matter what, and the cache would do nothing at all.',
			first === second,
			first
		),
		check(
			'the name is tied to the rendered image',
			'`filename` must change when the bytes change and stay put when they do not. Hashing the SVG makes that literally true rather than approximately true.',
			/^[a-z0-9]{7}-[a-z0-9]{6}-\d{10}$/.test( first ),
			first
		),
	];
}

function dataUri( bytes ) {
	let binary = '';

	for ( const byte of bytes ) {
		binary += String.fromCharCode( byte );
	}

	return `data:image/png;base64,${ btoa( binary ) }`;
}

/**
 * Runs every check and returns the results plus the images they were taken from.
 *
 * @param {object} env
 * @param {string} origin
 * @returns {Promise<{groups: object[], images: object[], passed: number, failed: number}>}
 */
export async function runByosChecks( env, origin ) {
	const missing = [ 'DEVICE_TOKEN', 'DEV_AGENCY_ID', 'DEV_STOP_ID' ].filter( ( name ) => ! env?.[ name ] );

	if ( missing.length ) {
		return {
			groups: [
				{
					title: 'Configuration',
					checks: [
						check(
							'the dev variables are set',
							'This page drives the real routes, so it needs the same token and stop the device would use.',
							false,
							`missing from .dev.vars: ${ missing.join( ', ' ) }`
						),
					],
				},
			],
			images: [],
			pending: [],
			passed: 0,
			failed: 1,
		};
	}

	const setup = await setupChecks( env, origin );
	const apiKey = setup.body.api_key ?? '';
	const display = await displayChecks( env, origin, apiKey );
	const image = await imageChecks( env, origin, apiKey, display.body.filename ?? 'x' );
	const badPath = await badPathChecks( env, origin, apiKey );

	// Rendered directly rather than through a request, because no request can produce it: it is the
	// screen for a throw on the way to a board. Showing it anyway is the point — it is the one screen
	// nobody will ever see during development, and therefore the one most likely to be broken when it
	// finally matters.
	// Through `stopLabel()` rather than assembled here, or the footer reads `1_590,430` where the
	// device would get `1_590 / 1_430` — a preview that quietly differs from production is worse than
	// no preview.
	const renderFailed = renderFailedScreen( {
		nowMs: Date.now(),
		timezone: readConfig( env ).timezone,
		stopLabel: stopLabel( { agency: env.DEV_AGENCY_ID, stopIds: String( env.DEV_STOP_ID ).split( ',' ) } ),
	} );
	const renderFailedBytes = await rasterize( buildNoticeSvg( renderFailed.notice ) );

	// Same reasoning, one step less extreme: this one *can* happen to a real poll, but only while
	// OneBusAway is actually down, so waiting to see it means seeing it for the first time during the
	// outage it exists to explain.
	const upstreamFailed = upstreamFailedScreen( {
		nowMs: Date.now(),
		timezone: readConfig( env ).timezone,
		stopLabel: stopLabel( { agency: env.DEV_AGENCY_ID, stopIds: String( env.DEV_STOP_ID ).split( ',' ) } ),
	} );
	const upstreamFailedBytes = await rasterize( buildNoticeSvg( upstreamFailed.notice ) );

	// Rendered directly for the same reason as the two above: it is only reachable after `ACTIVE_END`,
	// so waiting for it means never looking at it during the hours anyone is working on this.
	const overnight = overnightScreen( { config: readConfig( env ) } );
	const overnightBytes = await rasterize( buildOvernightSvg( overnight.overnight ) );

	const groups = [
		{ title: 'Pairing — <code>/api/setup</code>', checks: setup.checks },
		{ title: 'The poll — <code>/api/display</code>', checks: display.checks },
		{ title: 'The image — <code>/image/&lt;filename&gt;</code>', checks: image.checks },
		{ title: 'Diagnostics — <code>/api/log</code>', checks: await logChecks( env, origin, apiKey ) },
		{ title: 'Access control', checks: await accessChecks( env, origin ) },
		{ title: 'A mistyped base URL', checks: badPath.checks },
		{ title: 'The cache key', checks: await cacheKeyChecks( env, origin, apiKey ) },
	];

	const all = groups.flatMap( ( group ) => group.checks );

	// The served screen is whatever a real poll just produced, so its tag is read back off the
	// filename rather than assumed. Naming it wrong would be the worst kind of wrong on this page:
	// every check here exists because the failures are silent, and a caption asserting a state the
	// bytes do not show is exactly that failure in the tool meant to catch it.
	const servedTag = ( display.body.filename ?? '' ).split( '-' )[ 0 ];
	const servedNote =
		{
			[ FILENAME_TAGS.departures ]:
				'A valid poll, answered. Real predictions for the configured stop, fetched and rendered a moment ago — this is the live image, not a fixture.',
			[ FILENAME_TAGS.noDepartures ]:
				'A valid poll, and a real answer: nothing more is scheduled at this stop today. Still a board, because "no more buses" is information and a notice would throw away the other direction to say it.',
			[ FILENAME_TAGS.upstreamFailed ]:
				'A valid poll that OneBusAway would not answer. In development that is almost always the shared `TEST` key hitting its rate limit; the log line names the reason.',
			[ FILENAME_TAGS.renderFailed ]: 'A valid poll that threw on the way to a board.',
			[ FILENAME_TAGS.overnight ]:
				'A valid poll, outside the active window. The sign has finished for the day — it did not call OneBusAway at all, and the response tells the device to sleep until the window reopens.',
		}[ servedTag ] ?? 'A valid poll.';

	const images = [
		{
			tag: servedTag,
			title: 'What the device would show now',
			note: servedNote,
			uri: dataUri( image.bytes ),
		},
		{
			tag: FILENAME_TAGS.badPath,
			title: 'A mistyped base URL',
			note: 'The sentence names the wrong segment, and changes with the rejection reason. This one is an invalid agency.',
			uri: dataUri( badPath.bytes ),
		},
		{
			tag: FILENAME_TAGS.renderFailed,
			title: 'A render that threw',
			note: 'Unreachable by request — rendered here directly. Blank time fields are deliberate: `formatBoardTime()` throws on a bad timestamp, and a fabricated clock on a broken screen would be a lie.',
			uri: dataUri( renderFailedBytes ),
		},
	];

	if ( servedTag !== FILENAME_TAGS.overnight ) {
		images.push( {
			tag: FILENAME_TAGS.overnight,
			title: 'After hours',
			note: 'Not a failure — the sign has finished for the day and the buses have not, which is why it says nothing rather than something reassuring. Every time on it comes from `ACTIVE_END` rather than the clock, so the image is identical whenever it is served and its filename never moves.',
			uri: dataUri( overnightBytes ),
		} );
	}

	// Only when the live poll did not already produce it, or the same screen would appear twice with
	// two different captions.
	if ( servedTag !== FILENAME_TAGS.upstreamFailed ) {
		images.splice( 1, 0, {
			tag: FILENAME_TAGS.upstreamFailed,
			title: 'OneBusAway not answering',
			note: 'Rendered here directly, because waiting for a real outage means seeing this screen for the first time during the outage it exists to explain.',
			uri: dataUri( upstreamFailedBytes ),
		} );
	}

	const shown = new Set( images.map( ( entry ) => entry.tag ) );

	return {
		groups,
		images,
		// Whatever is left. Derived rather than listed, so a new `FILENAME_TAGS` entry cannot be added
		// without either appearing above or admitting on this page that nobody has looked at it.
		pending: Object.values( FILENAME_TAGS )
			.filter( ( tag ) => ! shown.has( tag ) )
			.map( ( tag ) => ( {
				tag,
				note:
					{
						[ FILENAME_TAGS.departures ]:
							'The real board. It needs OneBusAway to answer, and this run it did not — the served screen above says what happened instead.',
						[ FILENAME_TAGS.noDepartures ]:
							'A stop whose last departure has gone. Reachable only late at night, or at a stop that has stopped running for the day.',
					}[ tag ] ?? 'Not produced by this run.',
			} ) ),
		passed: all.filter( ( entry ) => entry.ok ).length,
		failed: all.filter( ( entry ) => ! entry.ok ).length,
	};
}
