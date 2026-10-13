import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, readConfig } from './config.js';

/**
 * The behaviour under test is mostly "never throw, never return nonsense" — `/api/display` reads
 * this ~1440 times a day and a config error there is a flat battery or a frozen panel, not a 500
 * someone notices.
 */
describe( 'readConfig', () => {
	it( 'is fully usable with no environment at all', () => {
		for ( const env of [ undefined, null, {} ] ) {
			const config = readConfig( env );

			expect( config.timezone ).toBe( CONFIG_DEFAULTS.timezone );
			expect( config.refreshActiveSeconds ).toBe( CONFIG_DEFAULTS.refreshActiveSeconds );
			expect( config.obaBaseUrl ).toBe( CONFIG_DEFAULTS.obaBaseUrl );
			expect( config.directionOverrides ).toEqual( {} );
		}
	} );

	it( 'reads the deployed values', () => {
		const config = readConfig( {
			TIMEZONE: 'America/New_York',
			ACTIVE_START: '05:30',
			ACTIVE_END: '23:45',
			REFRESH_ACTIVE_SECONDS: 45,
			REFRESH_WAKE_LEAD_SECONDS: 8,
			OBA_BASE_URL: 'https://example.test/api/where',
			TARPIT_MS: 4000,
		} );

		expect( config ).toEqual( {
			timezone: 'America/New_York',
			activeStartMinutes: 5 * 60 + 30,
			activeEndMinutes: 23 * 60 + 45,
			refreshActiveSeconds: 45,
			wakeLeadSeconds: 8,
			obaBaseUrl: 'https://example.test/api/where',
			tarpitMs: 4000,
			calibrationScreen: false,
			directionOverrides: {},
		} );
	} );

	describe( 'tarpit duration', () => {
		// Deliberately not the refresh-rate coercer: 0 is a legitimate setting here, meaning no delay,
		// whereas a `refresh_rate` of 0 hot-loops the device until the battery is flat.
		it( 'accepts zero as a way to disable the delay', () => {
			expect( readConfig( { TARPIT_MS: 0 } ).tarpitMs ).toBe( 0 );
			expect( readConfig( { TARPIT_MS: '0' } ).tarpitMs ).toBe( 0 );
		} );

		it.each( [ [ '5000', 5000 ], [ 5000, 5000 ], [ ' 5000 ', 5000 ], [ 5000.9, 5000 ] ] )(
			'coerces %o to %i',
			( value, expected ) => {
				expect( readConfig( { TARPIT_MS: value } ).tarpitMs ).toBe( expected );
			}
		);

		// A negative delay is a typo rather than an intent, so it falls back instead of clamping.
		it.each( [ [ -1 ], [ '-500' ], [ 'soon' ], [ '' ], [ undefined ], [ null ] ] )(
			'falls back for %o',
			( value ) => {
				expect( readConfig( { TARPIT_MS: value } ).tarpitMs ).toBe( CONFIG_DEFAULTS.tarpitMs );
			}
		);
	} );

	describe( 'refresh rates', () => {
		// A number from `[vars]`, a string from `.dev.vars` or a secret. Same name, same meaning.
		it.each( [
			[ 120, 120 ],
			[ '120', 120 ],
			[ ' 120 ', 120 ],
			[ 120.9, 120 ],
		] )( 'accepts %o as %i seconds', ( value, expected ) => {
			expect( readConfig( { REFRESH_ACTIVE_SECONDS: value } ).refreshActiveSeconds ).toBe( expected );
		} );

		// Absent or zero parses as 0 on the device, which hot-loops it with no sleep until the
		// battery is flat — and it persists in NVS, so it survives the power cycle.
		it.each( [ 0, '0', -60, 'soon', '', null, undefined, {} ] )( 'refuses %o', ( value ) => {
			expect( readConfig( { REFRESH_ACTIVE_SECONDS: value } ).refreshActiveSeconds ).toBe(
				CONFIG_DEFAULTS.refreshActiveSeconds
			);
		} );
	} );

	describe( 'active window', () => {
		it.each( [
			[ '00:00', 0 ],
			[ '6:00', 360 ],
			[ '23:59', 1439 ],
		] )( 'parses %s to %i minutes past midnight', ( value, expected ) => {
			expect( readConfig( { ACTIVE_START: value } ).activeStartMinutes ).toBe( expected );
		} );

		it.each( [ '24:00', '6', '06:60', '6:00 am', 600, '', null ] )(
			'falls back to the default for %o',
			( value ) => {
				expect( readConfig( { ACTIVE_START: value } ).activeStartMinutes ).toBe( 6 * 60 + 30 );
			}
		);
	} );

	describe( 'timezone', () => {
		// An unknown zone makes every `Intl.DateTimeFormat` throw, which would be every render.
		it.each( [ 'Mars/Olympus_Mons', 'america/los angeles', '', null, 42 ] )(
			'falls back for %o',
			( value ) => {
				expect( readConfig( { TIMEZONE: value } ).timezone ).toBe( CONFIG_DEFAULTS.timezone );
			}
		);

		it( 'accepts any zone the runtime knows', () => {
			expect( readConfig( { TIMEZONE: 'Europe/Berlin' } ).timezone ).toBe( 'Europe/Berlin' );
		} );

		// Verified against ICU: legacy aliases resolve to the full zone and stay DST-aware, so the
		// guard only has to catch what actually throws.
		it( 'passes a legacy alias through', () => {
			expect( readConfig( { TIMEZONE: 'US/Pacific' } ).timezone ).toBe( 'US/Pacific' );
		} );
	} );

	describe( 'OBA base URL', () => {
		it( 'drops a trailing slash, since paths are appended to it', () => {
			expect( readConfig( { OBA_BASE_URL: 'https://example.test/api/where//' } ).obaBaseUrl ).toBe(
				'https://example.test/api/where'
			);
		} );
	} );

	describe( 'direction overrides', () => {
		it( 'parses the JSON map', () => {
			const config = readConfig( {
				DIRECTION_OVERRIDES: '{"1_590":"Northbound","40_S_KS_T3":"Southbound"}',
			} );

			expect( config.directionOverrides ).toEqual( {
				'1_590': 'Northbound',
				'40_S_KS_T3': 'Southbound',
			} );
		} );

		// A throw here would take down the endpoint that must never fail, for a cosmetic label.
		it.each( [
			[ 'malformed JSON', '{"1_590": ' ],
			[ 'an array', '[ "1_590" ]' ],
			[ 'a bare string', '"Northbound"' ],
			[ 'null', 'null' ],
			[ 'an empty value', '' ],
			[ 'a non-string', 12345 ],
		] )( 'degrades to no overrides for %s', ( _label, value ) => {
			expect( readConfig( { DIRECTION_OVERRIDES: value } ).directionOverrides ).toEqual( {} );
		} );

		it( 'drops entries with an empty key or label', () => {
			const config = readConfig( {
				DIRECTION_OVERRIDES: '{"1_590":"Northbound","1_430":"","":"Southbound","1_600":null}',
			} );

			expect( config.directionOverrides ).toEqual( { '1_590': 'Northbound' } );
		} );
	} );

	// Credentials stay on `env` and are read at their point of use, so no future log line can
	// serialise one by accident. `directionOverrides` is still privacy-sensitive — it names a stop —
	// so this is "carries no credential", not "safe to log".
	it( 'carries no credentials', () => {
		const config = readConfig( { DEVICE_TOKEN: 'shh', OBA_API_KEY: 'also-shh' } );

		expect( JSON.stringify( config ) ).not.toContain( 'shh' );
	} );
} );
