import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    copyFile,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_FILES, build, collectBuildInfo } from '../build.mjs';
import { appInfoRows } from '../extension/app-info.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const now = new Date('2026-10-13T16:00:00.000Z');

test('build captures only a short commit and app-scoped tracked/untracked status', () => {
    const calls = [];
    const info = collectBuildInfo({
        now,
        runGit: (args) => {
            calls.push(args);
            return args[0] === 'log' ? 'abcdef1\n' : '?? new-file.mjs\n';
        },
    });
    assert.deepEqual(info, {
        sourceCommit: 'abcdef1',
        dirty: true,
        builtAt: now.toISOString(),
    });
    assert.deepEqual(calls, [
        ['log', '-1', '--format=%h'],
        ['status', '--porcelain=v1', '--untracked-files=all', '--', '.'],
    ]);
    assert.equal(
        collectBuildInfo({
            now,
            runGit: (args) => (args[0] === 'log' ? 'abcdef1' : ''),
        }).dirty,
        false,
    );
    assert.equal(
        collectBuildInfo({
            now,
            runGit: (args) =>
                args[0] === 'log' ? 'abcdef1' : ' M extension/popup.js',
        }).dirty,
        true,
    );
});

test('Git absence, no commits, malformed commit and partial failure do not invent provenance', () => {
    assert.deepEqual(
        collectBuildInfo({
            now,
            runGit: () => {
                throw new Error('private path');
            },
        }),
        { sourceCommit: null, dirty: null, builtAt: now.toISOString() },
    );
    assert.equal(
        collectBuildInfo({ now, runGit: () => 'private identity' })
            .sourceCommit,
        null,
    );
    assert.deepEqual(
        collectBuildInfo({
            now,
            runGit: (args) => {
                if (args[0] === 'log') throw new Error('no commits');
                return '?? file';
            },
        }),
        { sourceCommit: null, dirty: true, builtAt: now.toISOString() },
    );
    assert.deepEqual(
        collectBuildInfo({
            now,
            runGit: (args) => {
                if (args[0] === 'status') throw new Error('unreadable');
                return 'abcdef1';
            },
        }),
        { sourceCommit: 'abcdef1', dirty: null, builtAt: now.toISOString() },
    );
});

test('distribution embeds build information, matches source assets and retains version across rebuilds', async (t) => {
    const outputRoot = join(projectRoot, 'dist', `test-${randomUUID()}`);
    t.after(() => rm(outputRoot, { recursive: true, force: true }));
    const runGit = (args) => (args[0] === 'log' ? 'abcdef1' : '');
    const first = await build({ now, runGit, outputRoot });
    const second = await build({
        now: new Date(now.getTime() + 1000),
        runGit,
        outputRoot,
    });
    const sourceManifest = JSON.parse(
        await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'),
    );
    for (const result of [first, second]) {
        assert.equal(result.version, sourceManifest.version);
        assert.match(
            result.output,
            new RegExp(`chrome-update-notifier-${sourceManifest.version}-`),
        );
        const extension = join(result.output, 'extension');
        assert.deepEqual(
            (await readdir(extension)).sort(),
            [...APP_FILES, 'build-info.mjs'].sort(),
        );
        for (const file of APP_FILES) {
            assert.deepEqual(
                await readFile(join(extension, file)),
                await readFile(join(projectRoot, 'extension', file)),
                file,
            );
        }
        const { BUILD_INFO } = await import(
            pathToFileURL(join(extension, 'build-info.mjs')).href
        );
        assert.deepEqual(BUILD_INFO, result.buildInfo);
        const manifest = JSON.parse(
            await readFile(join(extension, 'manifest.json'), 'utf8'),
        );
        assert.equal(
            appInfoRows(manifest, BUILD_INFO, {
                os: 'mac',
                arch: 'arm64',
            })[1][1],
            result.version,
        );
        assert.deepEqual(Object.keys(BUILD_INFO), [
            'sourceCommit',
            'dirty',
            'builtAt',
        ]);
    }
    assert.notEqual(first.buildInfo.builtAt, second.buildInfo.builtAt);
    // Source remains a truthful unbuilt fallback; the build never rewrites it.
    const { BUILD_INFO } = await import('../extension/build-info.mjs');
    assert.deepEqual(BUILD_INFO, {
        sourceCommit: null,
        dirty: null,
        builtAt: null,
    });
    await assert.rejects(build({ now, runGit, outputRoot }), {
        code: 'EEXIST',
    });
});

test('build rejects output outside the app before writing', async () => {
    await assert.rejects(
        build({ outputRoot: dirname(projectRoot) }),
        /inside the app/,
    );
});

test('a Git-less source export never borrows an enclosing repository identity', async (t) => {
    const fixture = join(projectRoot, 'dist', `gitless-test-${randomUUID()}`);
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(fixture, { recursive: true });
    await copyFile(join(projectRoot, 'build.mjs'), join(fixture, 'build.mjs'));
    const { collectBuildInfo: collectFromExport } = await import(
        pathToFileURL(join(fixture, 'build.mjs')).href
    );
    assert.deepEqual(collectFromExport({ now }), {
        sourceCommit: null,
        dirty: null,
        builtAt: now.toISOString(),
    });
});

test('a mismatched extension license blocks distribution before output is created', async (t) => {
    const fixture = join(projectRoot, 'dist', `license-test-${randomUUID()}`);
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(join(fixture, 'extension'), { recursive: true });
    await copyFile(join(projectRoot, 'build.mjs'), join(fixture, 'build.mjs'));
    await copyFile(join(projectRoot, 'LICENSE'), join(fixture, 'LICENSE'));
    await copyFile(
        join(projectRoot, 'extension', 'manifest.json'),
        join(fixture, 'extension', 'manifest.json'),
    );
    await writeFile(
        join(fixture, 'extension', 'LICENSE'),
        'different notice\n',
    );
    const { build: isolatedBuild } = await import(
        pathToFileURL(join(fixture, 'build.mjs')).href
    );
    await assert.rejects(
        isolatedBuild({ now, runGit: () => assert.fail('must not run') }),
        /LICENSE must be byte-identical/,
    );
    assert.deepEqual((await readdir(fixture)).sort(), [
        'LICENSE',
        'build.mjs',
        'extension',
    ]);
});

test('the documented CLI builds real provenance and records actual UTC build time', async (t) => {
    const startedAt = Date.now();
    const result = JSON.parse(
        execFileSync(process.execPath, [join(projectRoot, 'build.mjs')], {
            encoding: 'utf8',
        }),
    );
    const finishedAt = Date.now();
    // The CLI writes a real distribution folder; do not leave it behind.
    t.after(() =>
        rm(join(projectRoot, result.output), { recursive: true, force: true }),
    );
    assert.ok(Date.parse(result.buildInfo.builtAt) >= startedAt);
    assert.ok(Date.parse(result.buildInfo.builtAt) <= finishedAt);
    assert.ok(
        result.buildInfo.sourceCommit === null ||
            /^[0-9a-f]{7,40}$/.test(result.buildInfo.sourceCommit),
    );
    assert.ok(
        result.buildInfo.dirty === null ||
            typeof result.buildInfo.dirty === 'boolean',
    );
    const extension = join(projectRoot, result.output, 'extension');
    const { BUILD_INFO } = await import(
        pathToFileURL(join(extension, 'build-info.mjs')).href
    );
    assert.deepEqual(BUILD_INFO, result.buildInfo);
    const manifest = JSON.parse(
        await readFile(join(extension, 'manifest.json'), 'utf8'),
    );
    assert.equal(manifest.version, result.version);
});
