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

import { readConfig } from '../config.js';
import { renderBoard } from '../render/index.js';
import { buildMockStatsData, renderStatsHtml } from '../stats/render.js';
import { sampleBoards } from './sample-boards.js';

const PREVIEW_PREFIX = '/_preview';

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

function contactSheet( boards, nowParam ) {
	const stamp = Date.now();
	const carried = nowParam ? `&now=${ encodeURIComponent( nowParam ) }` : '';

	const cards = boards.map(
		( sample ) =>
			`<figure id="${ sample.slug }"><figcaption><span>${ sample.title }</span>` +
			`<a href="${ PREVIEW_PREFIX }/${ sample.slug }.png" download="${ sample.slug }.png">download png</a></figcaption>` +
			`<img src="${ PREVIEW_PREFIX }/${ sample.slug }.png?t=${ stamp }${ carried }" alt="${ sample.title }"></figure>`
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
		`img{display:block;width:100%;max-width:var(--w);background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.5)}` +
		`</style>` +
		`<h1>1872 &times; 1404 &middot; 4-bit greyscale &middot; shown at 50% &middot; reload to re-render</h1>` +
		`<nav>${ nav }<a href="${ PREVIEW_PREFIX }?now=live">render at the real clock</a>` +
		`<a href="${ PREVIEW_PREFIX }/stats">stats page (mock data)</a></nav>${ cards }`
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
		return new Response( renderStatsHtml( buildMockStatsData( url.searchParams.get( 'range' ) ) ), {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		} );
	}

	// The timezone comes from real config, so the header block and the "Updated at" stamp are produced by
	// the same path the device will get rather than by a fixture string.
	const { timezone } = readConfig( env );
	const boards = sampleBoards( { nowMs: requestedTime( url ), timezone } );

	if ( pathname === PREVIEW_PREFIX || pathname === `${ PREVIEW_PREFIX }/` ) {
		return new Response( contactSheet( boards, url.searchParams.get( 'now' ) ), {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		} );
	}

	if ( ! pathname.startsWith( `${ PREVIEW_PREFIX }/` ) ) {
		return null;
	}

	const slug = pathname.slice( PREVIEW_PREFIX.length + 1 ).replace( /\.png$/, '' );
	const sample = boards.find( ( candidate ) => candidate.slug === slug );

	if ( ! sample ) {
		return null;
	}

	return new Response( await renderBoard( sample.board ), {
		headers: {
			'Content-Type': 'image/png',
			// The device caches on `filename`; a browser must not, or reloads show a stale design.
			'Cache-Control': 'no-store',
		},
	} );
}
