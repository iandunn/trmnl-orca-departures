/**
 * Regenerates `assets/bus.png` and `assets/light-rail.png`, the README's screenshots.
 *
 * They show the sample boards as the glass shows them — e-paper colours and the panel's crop, via
 * `epaper.js` — rather than the raw bytes the device receives, because a picture of the sign is for
 * people deciding what it looks like. The raw render is one click away on `/_preview`.
 *
 * Run with `npm run screenshots` whenever the rendered design changes, and update the README's alt
 * text in the same commit.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { buildBoardSvg, PANEL_HEIGHT, PANEL_WIDTH, SIGN_FONT } from '../render/board.js';
import { quantizeToScanlines } from '../render/png.js';
import { onGlass } from './epaper.js';
import { BUS_BOARD, RAIL_BOARD } from './sample-boards.js';

const root = new URL( '../../', import.meta.url );

await initWasm( readFileSync( new URL( 'node_modules/@resvg/resvg-wasm/index_bg.wasm', root ) ) );

const fonts = [ '400Regular/FiraSans_400Regular.ttf', '700Bold/FiraSans_700Bold.ttf' ].map(
	( file ) => new Uint8Array( readFileSync( new URL( `node_modules/@expo-google-fonts/fira-sans/${ file }`, root ) ) )
);

for ( const [ name, board ] of [ [ 'bus', BUS_BOARD ], [ 'light-rail', RAIL_BOARD ] ] ) {
	const pixels = new Resvg( buildBoardSvg( board ), {
		font: { fontBuffers: fonts, defaultFontFamily: SIGN_FONT },
	} ).render().pixels;

	const glass = onGlass( quantizeToScanlines( pixels, PANEL_WIDTH, PANEL_HEIGHT ), PANEL_WIDTH, PANEL_HEIGHT );

	writeFileSync( new URL( `assets/${ name }.png`, root ), rgbPng( glass.rgb, glass.width, glass.height ) );
}

/** A plain 8-bit RGB PNG. Not the device's encoder, which only does 4-bit greyscale. */
function rgbPng( rgb, width, height ) {
	const stride = width * 3 + 1;
	const raw = new Uint8Array( stride * height );

	for ( let y = 0; y < height; y++ ) {
		raw.set( rgb.subarray( y * width * 3, ( y + 1 ) * width * 3 ), y * stride + 1 );
	}

	const header = new Uint8Array( 13 );
	const view = new DataView( header.buffer );

	view.setUint32( 0, width );
	view.setUint32( 4, height );
	header[ 8 ] = 8;
	header[ 9 ] = 2;

	return concat( [
		new Uint8Array( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ),
		chunk( 'IHDR', header ),
		chunk( 'IDAT', new Uint8Array( deflateSync( raw ) ) ),
		chunk( 'IEND', new Uint8Array( 0 ) ),
	] );
}

function chunk( type, data ) {
	const body = concat( [ new TextEncoder().encode( type ), data ] );
	const out = new Uint8Array( body.length + 8 );
	const view = new DataView( out.buffer );

	view.setUint32( 0, data.length );
	out.set( body, 4 );
	view.setUint32( body.length + 4, crc32( body ) );

	return out;
}

function crc32( bytes ) {
	let crc = -1;

	for ( const byte of bytes ) {
		crc ^= byte;

		for ( let bit = 0; bit < 8; bit++ ) {
			crc = ( crc >>> 1 ) ^ ( 0xedb88320 & -( crc & 1 ) );
		}
	}

	return ( crc ^ -1 ) >>> 0;
}

function concat( parts ) {
	const out = new Uint8Array( parts.reduce( ( sum, part ) => sum + part.length, 0 ) );
	let offset = 0;

	for ( const part of parts ) {
		out.set( part, offset );
		offset += part.length;
	}

	return out;
}
