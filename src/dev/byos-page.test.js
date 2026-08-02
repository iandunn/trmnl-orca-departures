import { describe, expect, it } from 'vitest';
import { renderByosCheckHtml } from './byos-page.js';

const RESULTS = {
	passed: 2,
	failed: 0,
	groups: [
		{
			title: 'Pairing',
			checks: [
				{ name: 'body carries `status: 200`', why: 'Anything else fails enrollment.', ok: true, detail: 'status: 200' },
				{ name: '`friendly_id` is present', why: 'Drawn on the setup screen.', ok: true, detail: 'WSJMZ3' },
			],
		},
	],
	images: [
		{ tag: 'noservc', title: 'What the device would show now', note: 'A valid poll.', uri: 'data:image/png;base64,AAAA' },
	],
	pending: [ { tag: 'departs', note: 'Needs live OneBusAway data.' } ],
};

describe( 'renderByosCheckHtml', () => {
	it( 'says everything passed when nothing failed', () => {
		const html = renderByosCheckHtml( RESULTS );

		expect( html ).toContain( 'all 2 passing' );
		expect( html ).toContain( 'summary ok' );
	} );

	it( 'leads with the failure count when something failed', () => {
		const html = renderByosCheckHtml( {
			...RESULTS,
			passed: 1,
			failed: 1,
			groups: [
				{
					title: 'Pairing',
					checks: [
						{ name: 'a', why: 'b', ok: true },
						{ name: 'c', why: 'd', ok: false, detail: 'status: 0' },
					],
				},
			],
		} );

		expect( html ).toContain( '1 failing, 1 passing' );
		expect( html ).toContain( 'summary bad' );
		// Marked at the group level too, so a long page does not need scanning to find the problem.
		expect( html ).toContain( '1 failing</span>' );
	} );

	it( 'turns backticked symbols into code, since the reasons name real identifiers', () => {
		expect( renderByosCheckHtml( RESULTS ) ).toContain( '<code>status: 200</code>' );
	} );

	// Details carry filenames and header values that came off the wire, and the whole page is HTML.
	it( 'escapes a detail that contains markup', () => {
		const html = renderByosCheckHtml( {
			...RESULTS,
			images: [],
			groups: [ { title: 'x', checks: [ { name: 'n', why: 'w', ok: false, detail: '<script>alert(1)</script>' } ] } ],
		} );

		expect( html ).toContain( '&lt;script&gt;' );
		expect( html ).not.toContain( '<script>' );
	} );

	it( 'inlines the rendered images so nothing has to be fetched with a token', () => {
		const html = renderByosCheckHtml( RESULTS );

		expect( html ).toContain( 'src="data:image/png;base64,AAAA"' );
		expect( html ).toContain( 'What the device would show now' );
	} );

	it( 'labels each image with its filename tag', () => {
		expect( renderByosCheckHtml( RESULTS ) ).toContain( '<code>noservc</code>' );
	} );

	// Named rather than left absent, so the rendered set can be checked against FILENAME_TAGS at a
	// glance — a missing degraded screen is invisible otherwise.
	it( 'names the screens that cannot be built yet', () => {
		const html = renderByosCheckHtml( RESULTS );

		expect( html ).toContain( 'Not buildable yet' );
		expect( html ).toContain( '<code>departs</code>' );
		expect( html ).toContain( 'Needs live OneBusAway data.' );
	} );

	it( 'omits both optional sections when there is nothing to show', () => {
		const html = renderByosCheckHtml( { ...RESULTS, images: [], pending: [] } );

		expect( html ).not.toContain( 'currently draw' );
		expect( html ).not.toContain( 'Not buildable yet' );
	} );
} );
