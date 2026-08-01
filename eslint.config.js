import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig( [
	// `.claude/tmp` holds scratch artifacts — spikes, mockups, throwaway measurements. They are
	// kept for reference, not maintained, so they must not gate the project's lint.
	globalIgnores( [ 'dist', '.wrangler', '.npm-cache', '.claude' ] ),
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
