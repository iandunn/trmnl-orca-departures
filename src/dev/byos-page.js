/**
 * The HTML for the BYOS self-check. Pure — it takes results and returns markup, so the page's layout
 * can be reasoned about without running a Worker.
 *
 * Separate from `byos-check.js` for the same reason `stats/render.js` is separate from its query
 * layer: the thing that decides pass or fail should not also be deciding what colour it is.
 */

const PREVIEW_PREFIX = '/_preview';

/** Everything here comes from our own checks, but a detail can carry a filename or a header value. */
function escapeHtml( value ) {
	return String( value ?? '' )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

/** Backticks to `<code>`, so the `why` lines can name a symbol without hand-written markup. */
function inlineCode( value ) {
	return escapeHtml( value ).replace( /`([^`]+)`/g, '<code>$1</code>' );
}

function renderCheck( entry ) {
	return (
		`<li class="${ entry.ok ? 'ok' : 'bad' }">` +
		`<span class="mark">${ entry.ok ? '✓' : '✗' }</span>` +
		`<div><p class="name">${ inlineCode( entry.name ) }</p>` +
		`<p class="why">${ inlineCode( entry.why ) }</p>` +
		( entry.detail ? `<p class="detail">${ escapeHtml( entry.detail ) }</p>` : '' ) +
		`</div></li>`
	);
}

function renderGroup( group ) {
	const failed = group.checks.filter( ( entry ) => ! entry.ok ).length;

	return (
		`<section><h2>${ group.title }` +
		( failed ? ` <span class="badge">${ failed } failing</span>` : '' ) +
		`</h2><ul>${ group.checks.map( renderCheck ).join( '' ) }</ul></section>`
	);
}

/**
 * @param {object} results From `runByosChecks()`.
 * @returns {string}
 */
export function renderByosCheckHtml( results ) {
	const { passed, failed } = results;
	const status = failed ? `${ failed } failing, ${ passed } passing` : `all ${ passed } passing`;

	return (
		`<!doctype html><meta charset="utf-8"><title>BYOS self-check</title>` +
		`<style>` +
		`body{margin:0;padding:24px;background:#1f1f1f;font:15px/1.5 system-ui,sans-serif;color:#e8e8e8;max-width:1000px}` +
		`h1{font-size:17px;margin:0 0 4px}` +
		`h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#9a9a9a;margin:30px 0 10px;font-weight:600}` +
		`p{margin:0}` +
		`nav{margin:14px 0 6px;display:flex;gap:16px;flex-wrap:wrap}` +
		`a{color:#8cf}` +
		`.summary{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;margin-top:8px}` +
		`.summary.ok{background:#1d4023;color:#9fe6ab}` +
		`.summary.bad{background:#4a1f1f;color:#ffb3b3}` +
		`ul{list-style:none;margin:0;padding:0}` +
		`li{display:flex;gap:12px;padding:11px 0;border-top:1px solid #333}` +
		`.mark{flex:0 0 20px;font-weight:700;font-size:16px}` +
		`li.ok .mark{color:#63c774}` +
		`li.bad .mark{color:#ff7676}` +
		`li.bad .name{color:#ffb3b3}` +
		`li.pending .mark{color:#777}` +
		`figure .why{margin:0 0 8px;max-width:760px}` +
		`.name{font-weight:600}` +
		`.why{color:#9a9a9a;font-size:13.5px;margin-top:2px}` +
		`.detail{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:#c9a227;margin-top:4px;word-break:break-all}` +
		`.badge{background:#4a1f1f;color:#ffb3b3;font-size:11px;padding:2px 7px;border-radius:99px;letter-spacing:0}` +
		`code{background:#2c2c2c;padding:1px 5px;border-radius:3px;font-size:12.5px}` +
		`figure{margin:0 0 24px}` +
		`figcaption{font-weight:600;margin-bottom:6px}` +
		`img{display:block;width:100%;max-width:760px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.6)}` +
		`</style>` +
		`<h1>BYOS self-check</h1>` +
		`<p class="why">Every assertion below is a silent-failure mode: get one wrong and the panel goes blank or freezes with nothing in any log. Reload to re-run.</p>` +
		`<p class="summary ${ failed ? 'bad' : 'ok' }">${ status }</p>` +
		`<nav><a href="${ PREVIEW_PREFIX }">design preview</a>` +
		`<a href="${ PREVIEW_PREFIX }/stats">stats page (mock data)</a></nav>` +
		results.groups.map( renderGroup ).join( '' ) +
		( results.images.length
			? `<h2>Every screen the sign can currently draw</h2>` +
				`<p class="why">One per <code>FILENAME_TAGS</code> entry, because a degraded screen sharing a filename with a good render is suppressed by the device's cache and never reaches the glass. Look at them — a textless render is a valid PNG of a plausible size, and more than one afternoon has gone to a 200 that drew nothing.</p>` +
				results.images
					.map(
						( image ) =>
							`<figure><figcaption>${ escapeHtml( image.title ) }` +
							( image.tag ? ` <code>${ escapeHtml( image.tag ) }</code>` : '' ) +
							`</figcaption>` +
							( image.note ? `<p class="why">${ inlineCode( image.note ) }</p>` : '' ) +
							`<img src="${ image.uri }" alt="${ escapeHtml( image.title ) }"></figure>`
					)
					.join( '' )
			: '' ) +
		( results.pending?.length
			? `<h2>Not buildable yet</h2>` +
				`<p class="why">Named rather than left absent, so the set above can be checked for completeness against <code>FILENAME_TAGS</code> at a glance.</p><ul>` +
				results.pending
					.map(
						( entry ) =>
							`<li class="pending"><span class="mark">·</span><div>` +
							`<p class="name"><code>${ escapeHtml( entry.tag ) }</code></p>` +
							`<p class="why">${ inlineCode( entry.note ) }</p></div></li>`
					)
					.join( '' ) +
				`</ul>`
			: '' )
	);
}
