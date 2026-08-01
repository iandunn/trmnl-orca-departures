import { describe, expect, it } from 'vitest';
import worker from './worker.js';

describe( 'worker', () => {
	it( 'returns 404 for every path while the BYOS endpoints are unimplemented', async () => {
		const paths = [ '/', '/api/setup', '/api/display', '/api/log' ];

		for ( const path of paths ) {
			const response = await worker.fetch( new Request( `https://example.test${ path }` ) );

			expect( response.status ).toBe( 404 );
		}
	} );
} );
