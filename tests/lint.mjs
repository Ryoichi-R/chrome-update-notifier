import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const declaration = new URL('./lint/package.json', import.meta.url);

export function createLintConfig(recommended) {
    const web = {
        AbortController: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        queueMicrotask: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
    };
    return [
        { ignores: ['**/node_modules/**', 'dist/**', 'coverage/**'] },
        recommended,
        {
            files: ['**/*.js', '**/*.mjs'],
            linterOptions: { noInlineConfig: true },
            languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
        {
            files: ['extension/**/*.js', 'extension/**/*.mjs'],
            languageOptions: {
                globals: { ...web, chrome: 'readonly' },
            },
        },
        {
            files: ['extension/popup.js'],
            languageOptions: {
                globals: { document: 'readonly', window: 'readonly' },
            },
        },
        {
            files: ['build.mjs', 'release.mjs', 'tests/**/*.mjs'],
            languageOptions: {
                globals: {
                    ...web,
                    Buffer: 'readonly',
                    process: 'readonly',
                    setImmediate: 'readonly',
                },
            },
        },
    ];
}

export async function lintProject({
    toolchainRoot = join(projectRoot, 'tests', 'lint'),
} = {}) {
    const declared = JSON.parse(await readFile(declaration, 'utf8'));
    const load = createRequire(join(resolve(toolchainRoot), 'package.json'));
    const { ESLint } = load('eslint');
    const js = load('@eslint/js');
    for (const name of ['eslint', '@eslint/js']) {
        const installed = JSON.parse(
            await readFile(
                join(toolchainRoot, 'node_modules', name, 'package.json'),
                'utf8',
            ),
        );
        if (installed.version !== declared.devDependencies[name]) {
            throw new Error(`Install the locked ${name} version with npm ci.`);
        }
    }
    const engine = new ESLint({
        cwd: projectRoot,
        overrideConfigFile: true,
        overrideConfig: createLintConfig(js.configs.recommended),
    });
    const results = await engine.lintFiles([
        'build.mjs',
        'release.mjs',
        'extension/**/*.{js,mjs}',
        'tests/**/*.mjs',
    ]);
    return {
        tool: 'eslint',
        version: ESLint.version,
        ruleset: '@eslint/js recommended',
        fileCount: results.length,
        errorCount: results.reduce((sum, file) => sum + file.errorCount, 0),
        warningCount: results.reduce((sum, file) => sum + file.warningCount, 0),
        files: results.map((file) => ({
            path: relative(projectRoot, file.filePath).split('\\').join('/'),
            errors: file.errorCount,
            warnings: file.warningCount,
            messages: file.messages.map(
                ({ ruleId, line, column, message }) => ({
                    ruleId,
                    line,
                    column,
                    message,
                }),
            ),
        })),
    };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--toolchain')) {
        throw new Error(
            'Usage: node tests/lint.mjs [--toolchain <installed-toolchain-directory>]',
        );
    }
    const result = await lintProject(
        args.length ? { toolchainRoot: resolve(args[1]) } : {},
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.fileCount || result.errorCount || result.warningCount)
        process.exitCode = 1;
}
