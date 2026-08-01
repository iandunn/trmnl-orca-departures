/**
 * Stands in for `.wasm` and `.ttf` imports under vitest. See `vitest.config.js`.
 *
 * Nothing at runtime imports this — the alias only applies to the test run.
 */
export default new Uint8Array();
