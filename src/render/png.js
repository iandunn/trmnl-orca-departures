/**
 * Encodes raw RGBA pixels as a 4-bit greyscale PNG.
 *
 * This exists because resvg's own `asPng()` is both the wrong format and by far the most expensive
 * step in the pipeline — measured at 57.5 ms against 6.5 ms for this encoder on the same frame. It
 * writes RGBA at full resolution, which the panel then has to convert down anyway.
 *
 * PNG colour type 0 at bit depth 4 is the TRMNL X's native framebuffer format: 16 greys, direct
 * path, no conversion. Do not switch to an indexed palette at low bit depths — the firmware's
 * `ReduceBpp` has no case for 1bpp indexed and every pixel comes out black.
 *
 * `CompressionStream('deflate')` emits an RFC1950 zlib stream, which is exactly what a PNG `IDAT`
 * wants, so the whole encoder is a CRC32 table, a one-pass quantise-and-filter loop, and three
 * chunks.
 */

const PNG_SIGNATURE = new Uint8Array( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );

const crcTable = new Uint32Array( 256 );
for ( let n = 0; n < 256; n++ ) {
	let c = n;
	for ( let k = 0; k < 8; k++ ) {
		c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
	}
	crcTable[ n ] = c >>> 0;
}

function crc32( bytes ) {
	let c = 0xffffffff;

	for ( let i = 0; i < bytes.length; i++ ) {
		c = crcTable[ ( c ^ bytes[ i ] ) & 0xff ] ^ ( c >>> 8 );
	}

	return ( c ^ 0xffffffff ) >>> 0;
}

function pngChunk( type, data ) {
	const out = new Uint8Array( 12 + data.length );
	const view = new DataView( out.buffer );

	view.setUint32( 0, data.length );
	for ( let i = 0; i < 4; i++ ) {
		out[ 4 + i ] = type.charCodeAt( i );
	}
	out.set( data, 8 );
	view.setUint32( 8 + data.length, crc32( out.subarray( 4, 8 + data.length ) ) );

	return out;
}

/**
 * RGBA to filter-0 scanlines of 4-bit greyscale, in a single pass.
 *
 * The shift is 12 rather than 8 because the Rec.601 weights already scale by 256; dropping four
 * more bits lands directly on the panel's 16 greys with no intermediate 8-bit buffer.
 *
 * @param {Uint8Array} rgba   Source pixels, 4 bytes each.
 * @param {number}     width  Must be even — two pixels are packed per output byte.
 * @param {number}     height
 * @returns {Uint8Array}
 */
export function quantizeToScanlines( rgba, width, height ) {
	if ( width % 2 !== 0 ) {
		throw new RangeError( `width must be even to pack two 4-bit pixels per byte, got ${ width }` );
	}

	const expected = width * height * 4;
	if ( rgba.length !== expected ) {
		throw new RangeError( `expected ${ expected } RGBA bytes for ${ width }x${ height }, got ${ rgba.length }` );
	}

	const rowBytes = width >> 1;
	const out = new Uint8Array( ( rowBytes + 1 ) * height );
	let src = 0;
	let dst = 0;

	for ( let y = 0; y < height; y++ ) {
		out[ dst++ ] = 0; // filter: None

		for ( let x = 0; x < width; x += 2 ) {
			const high = ( rgba[ src ] * 77 + rgba[ src + 1 ] * 150 + rgba[ src + 2 ] * 29 ) >> 12;
			src += 4;
			const low = ( rgba[ src ] * 77 + rgba[ src + 1 ] * 150 + rgba[ src + 2 ] * 29 ) >> 12;
			src += 4;
			out[ dst++ ] = ( high << 4 ) | low;
		}
	}

	return out;
}

async function deflate( bytes ) {
	const stream = new Blob( [ bytes ] ).stream().pipeThrough( new CompressionStream( 'deflate' ) );

	return new Uint8Array( await new Response( stream ).arrayBuffer() );
}

/**
 * @param {Uint8Array} rgba
 * @param {number}     width
 * @param {number}     height
 * @returns {Promise<Uint8Array>} A complete 4-bit greyscale PNG.
 */
export async function encodeGreyscalePng( rgba, width, height ) {
	const compressed = await deflate( quantizeToScanlines( rgba, width, height ) );

	const ihdr = new Uint8Array( 13 );
	const view = new DataView( ihdr.buffer );
	view.setUint32( 0, width );
	view.setUint32( 4, height );
	ihdr[ 8 ] = 4; // bit depth
	ihdr[ 9 ] = 0; // colour type 0 = greyscale, non-indexed

	const parts = [
		PNG_SIGNATURE,
		pngChunk( 'IHDR', ihdr ),
		pngChunk( 'IDAT', compressed ),
		pngChunk( 'IEND', new Uint8Array( 0 ) ),
	];

	const png = new Uint8Array( parts.reduce( ( sum, part ) => sum + part.length, 0 ) );
	let offset = 0;
	for ( const part of parts ) {
		png.set( part, offset );
		offset += part.length;
	}

	return png;
}
