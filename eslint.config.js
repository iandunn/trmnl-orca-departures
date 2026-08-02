import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig( [
	// `.claude/tmp` holds scratch artifacts — spikes, mockups, throwaway measurements. They are
	// kept for reference, not maintained, so they must not gate the project's lint.
	//
	// `assets/sources` is the same thing made permanent: reference material and the throwaway spike
	// that produced the rejected design renders, moved out of `.claude/tmp` on 2026-08-01 so it
	// survives. It is a record, so it is read and never maintained — holding archived code to the
	// project's standards would mean editing history to satisfy a linter.
	globalIgnores( [ 'dist', '.wrangler', '.npm-cache', '.claude', 'assets/sources' ] ),
	{
		files: [ '**/*.js' ],
		extends: [ js.configs.recommended ],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: globals.browser,
		},
	},
] );
