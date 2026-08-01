import { describe, expect, it } from 'vitest';
import { isPreviewEnabled } from './preview.js';

/**
 * The gate itself, tested without touching the renderer — importing `preview.js` wholesale would
 * pull in resvg's wasm, which does not load under the test runner.
 *
 * What matters here is that production, where `DEV_PREVIEW` is simply absent, is always off.
 */
describe( 'isPreviewEnabled', () => {
	it.each( [ '1', 'true' ] )( 'is on for %o', ( value ) => {
		expect( isPreviewEnabled( { DEV_PREVIEW: value } ) ).toBe( true );
	} );

	describe( 'production', () => {
		it( 'is off when the variable is absent, which is the deployed case', () => {
			// `.dev.vars` is never uploaded by `wrangler deploy`, so a deployed Worker sees no
			// DEV_PREVIEW at all and every preview route falls through to the 404.
			expect( isPreviewEnabled( {} ) ).toBe( false );
		} );

		it.each( [ undefined, null, '', '0', 'false', 'yes', 1, true ] )(
			'is off for %o',
			( value ) => {
				expect( isPreviewEnabled( { DEV_PREVIEW: value } ) ).toBe( false );
			}
		);

		it( 'is off when there is no env at all', () => {
			expect( isPreviewEnabled( undefined ) ).toBe( false );
			expect( isPreviewEnabled( null ) ).toBe( false );
		} );
	} );
} );
