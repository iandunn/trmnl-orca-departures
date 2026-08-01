import { describe, expect, it } from 'vitest';
import { encodeGreyscalePng, quantizeToScanlines } from './png.js';

/** Solid-colour RGBA buffer. */
function fill( width, height, [ r, g, b ] ) {
	const rgba = new Uint8Array( width * height * 4 );

	for ( let i = 0; i < rgba.length; i += 4 ) {
		rgba[ i ] = r;
		rgba[ i + 1 ] = g;
		rgba[ i + 2 ] = b;
		rgba[ i + 3 ] = 255;
	}

	return rgba;
}

describe( 'quantizeToScanlines', () => {
	it( 'emits a filter byte plus one byte per two pixels, per row', () => {
		const scanlines = quantizeToScanlines( fill( 4, 3, [ 0, 0, 0 ] ), 4, 3 );

		expect( scanlines ).toHaveLength( ( 4 / 2 + 1 ) * 3 );
	} );

	it( 'uses filter 0 at the start of every row', () => {
		const width = 4;
		const height = 3;
		const scanlines = quantizeToScanlines( fill( width, height, [ 255, 255, 255 ] ), width, height );

		for ( let y = 0; y < height; y++ ) {
			expect( scanlines[ y * ( width / 2 + 1 ) ] ).toBe( 0 );
		}
	} );

	it( 'maps black to 0 and white to 15, packed two per byte', () => {
		expect( quantizeToScanlines( fill( 2, 1, [ 0, 0, 0 ] ), 2, 1 )[ 1 ] ).toBe( 0x00 );
		expect( quantizeToScanlines( fill( 2, 1, [ 255, 255, 255 ] ), 2, 1 )[ 1 ] ).toBe( 0xff );
	} );

	it( 'never exceeds the 4-bit range for any input', () => {
		for ( const value of [ 0, 1, 127, 128, 254, 255 ] ) {
			const byte = quantizeToScanlines( fill( 2, 1, [ value, value, value ] ), 2, 1 )[ 1 ];

			expect( byte >> 4 ).toBeLessThanOrEqual( 15 );
			expect( byte & 0x0f ).toBeLessThanOrEqual( 15 );
		}
	} );

	it( 'weights green most heavily, per Rec.601', () => {
		const green = quantizeToScanlines( fill( 2, 1, [ 0, 255, 0 ] ), 2, 1 )[ 1 ] >> 4;
		const red = quantizeToScanlines( fill( 2, 1, [ 255, 0, 0 ] ), 2, 1 )[ 1 ] >> 4;
		const blue = quantizeToScanlines( fill( 2, 1, [ 0, 0, 255 ] ), 2, 1 )[ 1 ] >> 4;

		expect( green ).toBeGreaterThan( red );
		expect( red ).toBeGreaterThan( blue );
	} );

	it( 'rejects an odd width, which cannot pack two pixels per byte', () => {
		expect( () => quantizeToScanlines( fill( 2, 1, [ 0, 0, 0 ] ), 3, 1 ) ).toThrow( RangeError );
	} );

	it( 'rejects a buffer that does not match the stated dimensions', () => {
		expect( () => quantizeToScanlines( fill( 4, 4, [ 0, 0, 0 ] ), 2, 2 ) ).toThrow( RangeError );
	} );
} );

describe( 'encodeGreyscalePng', () => {
	it( 'starts with the PNG signature', async () => {
		const png = await encodeGreyscalePng( fill( 4, 2, [ 0, 0, 0 ] ), 4, 2 );

		expect( Array.from( png.slice( 0, 8 ) ) ).toEqual( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );
	} );

	it( 'declares 4-bit greyscale, non-interlaced, in the IHDR', async () => {
		// The X's native framebuffer format. An indexed palette at low bit depth renders all-black
		// because the firmware's ReduceBpp has no case for it.
		const png = await encodeGreyscalePng( fill( 8, 4, [ 0, 0, 0 ] ), 8, 4 );
		const view = new DataView( png.buffer, png.byteOffset );

		expect( String.fromCharCode( ...png.slice( 12, 16 ) ) ).toBe( 'IHDR' );
		expect( view.getUint32( 16 ) ).toBe( 8 );
		expect( view.getUint32( 20 ) ).toBe( 4 );
		expect( png[ 24 ] ).toBe( 4 );
		expect( png[ 25 ] ).toBe( 0 );
		expect( png[ 28 ] ).toBe( 0 );
	} );

	it( 'writes IHDR, IDAT and IEND in order', async () => {
		const png = await encodeGreyscalePng( fill( 4, 2, [ 0, 0, 0 ] ), 4, 2 );
		const text = new TextDecoder( 'latin1' ).decode( png );

		expect( text.indexOf( 'IHDR' ) ).toBeLessThan( text.indexOf( 'IDAT' ) );
		expect( text.indexOf( 'IDAT' ) ).toBeLessThan( text.indexOf( 'IEND' ) );
	} );

	it( 'ends with a well-formed IEND chunk', async () => {
		const png = await encodeGreyscalePng( fill( 4, 2, [ 0, 0, 0 ] ), 4, 2 );

		expect( Array.from( png.slice( -12 ) ) ).toEqual( [
			0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82,
		] );
	} );

	it( 'emits a zlib stream, which is what IDAT requires', async () => {
		// CompressionStream('deflate') is RFC1950 rather than raw deflate; a raw stream would
		// produce a PNG that every decoder rejects.
		const png = await encodeGreyscalePng( fill( 4, 2, [ 0, 0, 0 ] ), 4, 2 );
		const text = new TextDecoder( 'latin1' ).decode( png );
		const idat = text.indexOf( 'IDAT' );

		expect( png[ idat + 4 ] & 0x0f ).toBe( 8 );
	} );

	it( 'stays far under the 750000-byte firmware cap at panel resolution', async () => {
		const png = await encodeGreyscalePng( fill( 1872, 1404, [ 255, 255, 255 ] ), 1872, 1404 );

		expect( png.length ).toBeLessThan( 750000 );
	} );
} );
