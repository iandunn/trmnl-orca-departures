import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * `wrangler` turns `.wasm` and `.ttf` imports into binary modules; vitest tries to parse them as
 * JavaScript and fails. Aliasing them to an empty stub keeps the runtime code honest — the real
 * imports stay static, which is what `initWasm()` needs — while letting anything that transitively
 * imports the renderer be unit tested.
 *
 * Nothing that depends on the stub's *contents* can be tested here. Rasterisation is verified by
 * looking at the output of the local preview, not by an assertion.
 */
const binaryStub = fileURLToPath( new URL( './vitest.binary-stub.js', import.meta.url ) );

export default defineConfig( {
	test: {
		/**
		 * A linked git worktree under `.claude/worktrees/` is a full second checkout, so its test
		 * files get collected too and every count silently doubles — 202 tests reported as 404,
		 * with another session's failures mixed into this tree's run. Spread the defaults rather
		 * than replacing them, or `node_modules` comes back in.
		 */
		exclude: [ ...configDefaults.exclude, '**/.claude/**' ],
	},
	resolve: {
		// The pattern has to span the whole specifier: Vite substitutes only the matched portion,
		// so anchoring on the extension alone would splice the stub path onto the original.
		alias: [ { find: /^.*\.(wasm|ttf)$/, replacement: binaryStub } ],
	},
} );
