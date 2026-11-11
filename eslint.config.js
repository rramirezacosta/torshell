import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['TorShell@itepo.mx/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // GJS runtime globals
                global: 'readonly',
                imports: 'readonly',
                log: 'readonly',
                print: 'readonly',
                console: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'no-redeclare': 'error',
        },
    },
];
