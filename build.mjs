import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Only these app assets are distributed; no repository or local settings.
export const APP_FILES = Object.freeze([
    'LICENSE',
    'manifest.json',
    'background.js',
    'checker.mjs',
    'display-state.mjs',
    'environment.mjs',
    'version-compare.mjs',
    'reference-release.mjs',
    'notifier.mjs',
    'popup.html',
    'popup.css',
    'popup.js',
    'app-info.mjs',
    'icon.png',
]);

function runProjectGit(args) {
    const options = {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    };
    const gitRoot = execFileSync(
        'git',
        ['rev-parse', '--show-toplevel'],
        options,
    ).trim();
    if (resolve(gitRoot) !== projectRoot) {
        throw new Error('No app-local Git repository.');
    }
    return execFileSync('git', args, options);
}

export function collectBuildInfo({
    now = new Date(),
    runGit = runProjectGit,
} = {}) {
    let sourceCommit = null;
    let dirty = null;
    try {
        const commit = runGit(['log', '-1', '--format=%h']).trim();
        if (/^[0-9a-f]{7,40}$/.test(commit)) sourceCommit = commit;
    } catch {
        // Git is optional; do not embed errors, paths or author information.
    }
    try {
        dirty =
            runGit([
                'status',
                '--porcelain=v1',
                '--untracked-files=all',
                '--',
                '.',
            ]).trim().length > 0;
    } catch {
        // A failed status is unknown, never a claim that the source is clean.
    }
    return { sourceCommit, dirty, builtAt: now.toISOString() };
}

function guardOutput(path) {
    const within = relative(projectRoot, resolve(path));
    if (
        !within ||
        within === '..' ||
        within.startsWith(`..${sep}`) ||
        resolve(path) !== join(projectRoot, within)
    ) {
        throw new Error('Build output must be inside the app project.');
    }
}

export async function build({
    now = new Date(),
    runGit,
    outputRoot = join(projectRoot, 'dist'),
} = {}) {
    guardOutput(outputRoot);
    const manifest = JSON.parse(
        await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'),
    );
    if (
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version) ||
        manifest.version.split('.').some((part) => Number(part) > 65535)
    ) {
        throw new Error(
            'manifest.version must be a Chrome-compatible major.minor.patch.',
        );
    }
    const license = await readFile(join(projectRoot, 'LICENSE'));
    if (
        !license.equals(
            await readFile(join(projectRoot, 'extension', 'LICENSE')),
        )
    ) {
        throw new Error('Root and extension LICENSE must be byte-identical.');
    }
    const buildInfo = collectBuildInfo({ now, runGit });
    const stamp = buildInfo.builtAt.replace(/[-:.]/g, '');
    const output = join(
        outputRoot,
        `chrome-update-notifier-${manifest.version}-${stamp}`,
    );
    guardOutput(output);
    await mkdir(outputRoot, { recursive: true });
    // Never replace an existing distribution or an installed extension.
    await mkdir(output);
    const extension = join(output, 'extension');
    await mkdir(extension);
    for (const file of APP_FILES) {
        await copyFile(
            join(projectRoot, 'extension', file),
            join(extension, file),
        );
    }
    await writeFile(
        join(extension, 'build-info.mjs'),
        `// Generated at build time.\nexport const BUILD_INFO = Object.freeze(${JSON.stringify(buildInfo, null, 4)});\n`,
        'utf8',
    );
    await copyFile(join(projectRoot, 'README.md'), join(output, 'README.md'));
    await copyFile(join(projectRoot, 'LICENSE'), join(output, 'LICENSE'));
    return { output, version: manifest.version, buildInfo };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    const result = await build();
    console.log(
        JSON.stringify(
            { ...result, output: relative(projectRoot, result.output) },
            null,
            2,
        ),
    );
}
