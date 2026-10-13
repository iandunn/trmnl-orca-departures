/**
 * Local design preview. **Never reachable in production.**
 *
 * The gate is `env.DEV_PREVIEW`, which is set in `.dev.vars` — a file `wrangler dev` reads and
 * `wrangler deploy` never uploads. So the variable simply does not exist on a deployed Worker and
 * every route here 404s, matching the rest of the app.
 *
 * Do **not** move `DEV_PREVIEW` into `[vars]` in `wrangler.toml`. That block *is* deployed, and it
 * would expose the preview publicly along with the render cost of anyone hitting it.
 */

import { currentScreen } from '../byos/display.js';
import { readConfig } from '../config.js';
import { GLASS_HIDDEN_LEFT, PANEL_WIDTH } from '../render/board.js';
import { rasterize, renderBoard } from '../render/index.js';
import { buildMockStatsData, buildUnpairedMockStatsData, renderStatsHtml } from '../stats/render.js';
import { runByosChecks } from './byos-check.js';
import { renderByosCheckHtml } from './byos-page.js';
import { edgeCaseBoards } from './edge-case-boards.js';
import { EPAPER_INK, EPAPER_PAPER, GLASS_WIDTH } from './epaper.js';
import { overnightSamples, parkedOvernightSamples } from './overnight-samples.js';
import { sampleBoards } from './sample-boards.js';

const PREVIEW_PREFIX = '/_preview';

/**
 * Boards built from a real OneBusAway call, through the exact path `/api/display` uses.
 *
 * The fixtures above are frozen so the design can be judged without the data moving underneath it;
 * these are the opposite, and they are the only way to see what live predictions actually look like —
 * a stop with one departure left, a headsign nobody thought to invent, an upstream that 429s. They go
 * through `currentScreen()` rather than the renderer directly, so a failure draws the same degraded
 * screen the device would get instead of an error in the browser.
 *
 * **The public sample stops, never the sign's own.** A preview is local, but a screenshot of one is
 * not, and the stop this sign points at must not appear in an image anybody can share.
 */
const LIVE_SAMPLES = [
	{
		slug: 'live-bus',
		title: 'Live — 3rd Ave & Virginia St and 3rd Ave & Pine St',
		parsed: { agency: '1', stopIds: [ '600', '430' ] },
	},
	{
		slug: 'live-rail',
		title: "Live — Int'l District/Chinatown",
		parsed: { agency: '40', stopIds: [ '621', '623' ] },
	},
];

/** 2001-09-09, the same floor the filename epoch uses. Anything earlier is a typo, not a moment. */
const EARLIEST_PINNED_MS = 1000000000000;

/** Only ever true locally: the variable lives in `.dev.vars`, which is never deployed. */
export function isPreviewEnabled( env ) {
	return env?.DEV_PREVIEW === '1' || env?.DEV_PREVIEW === 'true';
}

/**
 * The instant to render at.
 *
 * Defaults to the fixed reference instant rather than the real clock, because the sample rows are
 * fixtures: a live header reading "as of 4:13 am" above a departure at 4:44 pm is internally
 * inconsistent, which is exactly the kind of thing the "Updated at" stamp is being judged on. `?now=live`
 * renders at the real clock instead, which is what exercises `Intl` in the configured timezone; an
 * epoch in milliseconds pins any other moment.
 */
function requestedTime( url ) {
	const requested = url.searchParams.get( 'now' );

	if ( requested === 'live' ) {
		return Date.now();
	}

	const pinned = Number( requested );

	// The floor is not pedantry: `Number( '' )` is 0, and 0 is finite, so without it `?now=` or
	// `?now=0` would render a perfectly plausible board dated December 1969.
	return Number.isFinite( pinned ) && pinned >= EARLIEST_PINNED_MS ? pinned : undefined;
}

/**
 * Shows each render as the glass does rather than as a monitor does, with the same approximation the
 * README screenshots use — see `epaper.js`. Done in the browser as a colour filter plus a crop, so it
 * is page only: the PNG routes still serve the exact bytes the device receives.
 */
const EPAPER_FILTER =
	'<svg width="0" height="0" style="position:absolute"><filter id="epaper" color-interpolation-filters="sRGB"><feComponentTransfer>' +
	[ 'R', 'G', 'B' ]
		.map(
			( channel, index ) =>
				`<feFunc${ channel } type="linear" slope="${ ( ( EPAPER_PAPER[ index ] - EPAPER_INK[ index ] ) / 255 ).toFixed( 4 ) }" intercept="${ ( EPAPER_INK[ index ] / 255 ).toFixed( 4 ) }"/>`
		)
		.join( '' ) +
	'</feComponentTransfer></filter></svg>';

function contactSheet( boards, nowParam, { heading = '', extraNav = '' } = {} ) {
	const stamp = Date.now();
	const carried = nowParam ? `&now=${ encodeURIComponent( nowParam ) }` : '';

	const cards = boards.map(
		( sample ) =>
			`<figure id="${ sample.slug }"><figcaption><span>${ sample.title }</span>` +
			`<a href="${ PREVIEW_PREFIX }/${ sample.slug }.png" download="${ sample.slug }.png">download png</a></figcaption>` +
			`<div class="glass"><img src="${ PREVIEW_PREFIX }/${ sample.slug }.png?t=${ stamp }${ carried }" alt="${ sample.title }"></div></figure>`
	).join( '' );

	const nav = boards.map(
		( sample ) => `<a href="#${ sample.slug }">${ sample.slug }</a>`
	).join( '' );

	return (
		`<!doctype html><meta charset="utf-8"><title>Sign preview</title>` +
		`<style>` +
		`body{margin:0;padding:24px;background:#3a3a3a;font:14px/1.4 system-ui,sans-serif;color:#eee}` +
		`h1{font-size:15px;font-weight:600;margin:0 0 10px}` +
		`nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:22px}` +
		`nav a,figcaption a{color:#9cf;text-decoration:none}` +
		`figure{margin:0 0 30px}` +
		`figcaption{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;font-weight:600;max-width:var(--w)}` +
		`figcaption a{font-weight:400}` +
		// Well under native width: at 1872 the panel fills the screen and you cannot judge it as a
		// whole object, which is how it will actually be read.
		`:root{--w:940px}` +
		// The image is cropped and offset inside a paper-coloured frame the width of the visible glass.
		`.glass{max-width:var(--w);overflow:hidden;background:rgb(${ EPAPER_PAPER.join( ',' ) });box-shadow:0 2px 12px rgba(0,0,0,.5)}` +
		`.glass img{display:block;width:${ ( ( PANEL_WIDTH / GLASS_WIDTH ) * 100 ).toFixed( 4 ) }%;margin-left:-${ ( ( GLASS_HIDDEN_LEFT / GLASS_WIDTH ) * 100 ).toFixed( 4 ) }%;filter:url(#epaper)}` +
		`</style>` +
		EPAPER_FILTER +
		`<h1>${ heading || '1872 &times; 1404 &middot; 4-bit greyscale &middot; shown at 50% &middot; reload to re-render' }</h1>` +
		`<nav>${ nav }<a href="${ PREVIEW_PREFIX }?now=live">render at the real clock</a>` +
		`<a href="${ PREVIEW_PREFIX }/byos">BYOS self-check</a>` +
		`<a href="${ PREVIEW_PREFIX }/stats">stats page (mock data)</a>` +
		`<a href="${ PREVIEW_PREFIX }/stats?unpaired">stats page (no device yet)</a>${ extraNav }</nav>${ cards }`
	);
}

/**
 * @returns {Promise<Response|null>} Null when this is not a preview request, so the caller can fall
 *                                   through to the real routes.
 */
export async function handlePreview( request, env ) {
	if ( ! isPreviewEnabled( env ) ) {
		return null;
	}

	const url = new URL( request.url );
	const { pathname } = url;

	// The stats page against mock data, so its layout can be iterated without an Analytics Engine
	// dataset, a deploy, or waiting for the sign to generate interesting failures. It renders through
	// exactly the function the real route uses, so what is seen here is what ships.
	if ( pathname === `${ PREVIEW_PREFIX }/stats` ) {
		// `?unpaired` is the page as it looks before a device has ever polled, which is a distinct
		// design state rather than an edge case — it is what the owner stares at for the whole gap
		// between deploying and pairing, and it was never looked at until it was found to be
		// describing a device that did not exist.
		const build = url.searchParams.has( 'unpaired' ) ? buildUnpairedMockStatsData : buildMockStatsData;

		return new Response( renderStatsHtml( build( url.searchParams.get( 'range' ) ) ), {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		} );
	}

	// The BYOS self-check, which drives the real device routes and asserts the contract on each one.
	// It runs server-side so the device token is never handed to a browser — see `byos-check.js`.
	if ( pathname === `${ PREVIEW_PREFIX }/byos` ) {
		return new Response( renderByosCheckHtml( await runByosChecks( env, url.origin ) ), {
			headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
		} );
	}

	// The timezone comes from real config, so the header block and the "Updated at" stamp are produced by
	// the same path the device will get rather than by a fixture string.
	const { timezone } = readConfig( env );
	const at = { nowMs: requestedTime( url ), timezone };

	// The reference boards first, then the stress sheet. Both render through the same path the device
	// gets; the edge cases say on themselves that they are not real stops.
	//
	// The overnight samples carry finished SVG rather than a board, because they are not boards — they
	// go through `overnightScreen()`, the same function `/api/display` calls after `ACTIVE_END`, and
	// `?now=` does not apply to them: every time on that screen comes from config, not from a clock.
	const boards = [ ...sampleBoards( at ), ...edgeCaseBoards( at ), ...overnightSamples( env ) ];

	// The variants that lost, on their own page. Keeping them off the main sheet is the point: a
	// contact sheet that mixes what the sign draws with what it was never going to draw stops being a
	// picture of the sign. They stay renderable because the overnight choice is provisional.
	const parked = parkedOvernightSamples( env );

	if ( pathname === `${ PREVIEW_PREFIX }/parked` ) {
		return new Response(
			contactSheet( parked, url.searchParams.get( 'now' ), {
				heading: 'Parked designs &middot; considered and not chosen &middot; nothing here ships',
				extraNav: `<a href="${ PREVIEW_PREFIX }">&larr; back to the sign</a>`,
			} ),
			{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
		);
	}

	if ( pathname === PREVIEW_PREFIX || pathname === `${ PREVIEW_PREFIX }/` ) {
		return new Response(
			contactSheet( [ ...boards, ...LIVE_SAMPLES ], url.searchParams.get( 'now' ), {
				extraNav: `<a href="${ PREVIEW_PREFIX }/parked">parked designs</a>`,
			} ),
			{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
		);
	}

	if ( ! pathname.startsWith( `${ PREVIEW_PREFIX }/` ) ) {
		return null;
	}

	const slug = pathname.slice( PREVIEW_PREFIX.length + 1 ).replace( /\.png$/, '' );

	// A browser must never cache any of these, or a reload shows a stale design — and on the live
	// boards, stale departures.
	const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' };
	const live = LIVE_SAMPLES.find( ( candidate ) => candidate.slug === slug );

	if ( live ) {
		// `?now=` is deliberately ignored here. These boards are stamped with OneBusAway's own
		// `currentTime`, and pinning the header to some other instant would make the stamp claim a
		// freshness the rows do not have — the one thing it exists not to do.
		//
		// The window is widened to the whole day for these two, through the same config path the real
		// thing reads rather than a flag in `currentScreen()`. Without it both samples draw the rest
		// screen after `ACTIVE_END` — correct for the device, useless here, and identical to each
		// other, which is exactly how it was found. Evenings are when this gets worked on, and the
		// rest screen has six samples of its own.
		const alwaysAwake = { ...env, ACTIVE_START: '00:00', ACTIVE_END: '00:00' };
		const { svg } = await currentScreen( { parsed: live.parsed }, alwaysAwake, Date.now() );

		return new Response( await rasterize( svg ), { headers } );
	}

	// Parked slugs resolve here too, or their own page would be a grid of broken images.
	const sample = [ ...boards, ...parked ].find( ( candidate ) => candidate.slug === slug );

	if ( ! sample ) {
		return null;
	}

	return new Response( sample.svg ? await rasterize( sample.svg ) : await renderBoard( sample.board ), {
		headers,
	} );
}
