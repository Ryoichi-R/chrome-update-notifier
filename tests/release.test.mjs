import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_FILES } from '../build.mjs';
import { release } from '../release.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const builtAt = '2026-10-15T13:40:00.000Z';
const runGit = (args) => (args[0] === 'log' ? 'abcdef1' : '');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function outputRoot(t) {
    const path = join(projectRoot, 'dist', `release-test-${randomUUID()}`);
    t.after(() => rm(path, { recursive: true, force: true }));
    return path;
}

// Read the central directory independently of the production ZIP writer.
function unpack(bytes) {
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    assert.equal(bytes.readUInt16LE(end + 20), 0);
    let offset = bytes.readUInt32LE(end + 16);
    const entries = [];
    const count = bytes.readUInt16LE(end + 10);
    for (let index = 0; index < count; index++) {
        assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
        assert.equal(bytes.readUInt16LE(offset + 10), 0); // STORE
        assert.equal(bytes.readUInt16LE(offset + 8), 0x800); // UTF-8
        assert.equal(bytes.readUInt16LE(offset + 12), 0);
        assert.equal(bytes.readUInt16LE(offset + 14), 0x21);
        assert.equal(bytes.readUInt32LE(offset + 38) >>> 16, 0o100644);
        const size = bytes.readUInt32LE(offset + 24);
        const nameSize = bytes.readUInt16LE(offset + 28);
        const name = bytes.subarray(offset + 46, offset + 46 + nameSize);
        const local = bytes.readUInt32LE(offset + 42);
        assert.equal(bytes.readUInt32LE(local), 0x04034b50);
        assert.equal(bytes.readUInt32LE(local + 18), size);
        assert.equal(bytes.readUInt32LE(local + 22), size);
        assert.equal(
            bytes.readUInt32LE(local + 14),
            bytes.readUInt32LE(offset + 16),
        );
        assert.equal(bytes.readUInt16LE(local + 26), nameSize);
        assert.deepEqual(
            bytes.subarray(local + 30, local + 30 + nameSize),
            name,
        );
        const start = local + 30 + nameSize + bytes.readUInt16LE(local + 28);
        entries.push({
            path: name.toString('utf8'),
            bytes: bytes.subarray(start, start + size),
        });
        offset +=
            46 +
            nameSize +
            bytes.readUInt16LE(offset + 30) +
            bytes.readUInt16LE(offset + 32);
    }
    assert.equal(offset, end);
    assert.equal(
        bytes.readUInt32LE(end + 12),
        offset - bytes.readUInt32LE(end + 16),
    );
    return entries;
}

test('root, extension and built LICENSE bytes match the MIT notice', async (t) => {
    const license = await readFile(join(projectRoot, 'LICENSE'));
    assert.match(
        license.toString(),
        /^MIT License\n\nCopyright \(c\) 2026 Ryoichi-R and contributors\n/,
    );
    assert.deepEqual(
        await readFile(join(projectRoot, 'extension', 'LICENSE')),
        license,
    );
    const result = await release({
        builtAt,
        runGit,
        outputRoot: outputRoot(t),
    });
    assert.deepEqual(await readFile(join(result.output, 'LICENSE')), license);
    assert.deepEqual(
        await readFile(join(result.output, 'extension', 'LICENSE')),
        license,
    );
});

test('ZIP has exactly the installable assets in a stable folder and verifiable hashes', async (t) => {
    const result = await release({
        builtAt,
        runGit,
        outputRoot: outputRoot(t),
    });
    const bytes = await readFile(join(result.output, result.archive));
    const entries = unpack(bytes);
    assert.deepEqual(
        entries.map((entry) => entry.path),
        [...APP_FILES, 'build-info.mjs']
            .sort()
            .map((name) => `chrome-update-notifier/${name}`),
    );
    assert.equal(result.fileCount, entries.length);
    for (const entry of entries) {
        assert.deepEqual(
            entry.bytes,
            await readFile(
                join(result.output, 'extension', entry.path.split('/')[1]),
            ),
        );
    }
    const manifest = JSON.parse(
        await readFile(join(result.output, 'files.sha256.json'), 'utf8'),
    );
    assert.deepEqual(
        manifest,
        entries.map((entry) => ({
            path: entry.path,
            bytes: entry.bytes.length,
            sha256: sha256(entry.bytes),
        })),
    );
    assert.equal(result.sha256, sha256(bytes));
    assert.equal(
        await readFile(join(result.output, 'SHA256SUMS'), 'utf8'),
        `${sha256(bytes)}  ${result.archive}\n`,
    );
});

test('same source and metadata produce byte-identical ZIP and manifests at different paths', async (t) => {
    const root = outputRoot(t);
    const first = await release({
        builtAt,
        runGit,
        outputRoot: join(root, 'a'),
    });
    const second = await release({
        builtAt,
        runGit,
        outputRoot: join(root, 'b'),
    });
    for (const file of [first.archive, 'SHA256SUMS', 'files.sha256.json']) {
        assert.deepEqual(
            await readFile(join(first.output, file)),
            await readFile(join(second.output, file)),
        );
    }
    await assert.rejects(
        release({ builtAt, runGit, outputRoot: join(root, 'a') }),
        { code: 'EEXIST' },
    );
});

test('provenance changes alter only generated build information in the ZIP', async (t) => {
    const root = outputRoot(t);
    const before = await release({
        builtAt,
        runGit: () => {
            throw new Error('no commit');
        },
        outputRoot: join(root, 'a'),
    });
    const after = await release({
        builtAt,
        runGit,
        outputRoot: join(root, 'b'),
    });
    const a = unpack(await readFile(join(before.output, before.archive)));
    const b = unpack(await readFile(join(after.output, after.archive)));
    assert.notEqual(before.sha256, after.sha256);
    assert.deepEqual(
        a.map((entry) => entry.path),
        b.map((entry) => entry.path),
    );
    for (let index = 0; index < a.length; index++) {
        if (a[index].path.endsWith('/build-info.mjs')) {
            assert.notDeepEqual(a[index].bytes, b[index].bytes);
            assert.match(a[index].bytes.toString(), /"sourceCommit": null/);
            assert.match(
                b[index].bytes.toString(),
                /"sourceCommit": "abcdef1"/,
            );
        } else assert.deepEqual(a[index].bytes, b[index].bytes);
    }
});

test('invalid or missing UTC dates are rejected before build or Git access', async () => {
    for (const value of [
        undefined,
        '',
        '2026-02-30T00:00:00.000Z',
        '2026-10-15',
        '2026-10-15T13:40:00Z',
        '2026-10-15T13:40:00.000+00:00',
    ]) {
        await assert.rejects(
            release({
                builtAt: value,
                runGit: () => assert.fail('must not run'),
            }),
            /valid UTC timestamp/,
        );
    }
});

test('release output outside the app is rejected', async () => {
    await assert.rejects(
        release({ builtAt, runGit, outputRoot: dirname(projectRoot) }),
        /inside the app/,
    );
});

test('documented release CLI works without dependencies and rejects unknown options', async (t) => {
    const root = outputRoot(t);
    const result = JSON.parse(
        execFileSync(
            process.execPath,
            ['release.mjs', '--built-at', builtAt, '--output-root', root],
            { cwd: projectRoot, encoding: 'utf8' },
        ),
    );
    assert.equal(result.buildInfo.builtAt, builtAt);
    assert.equal(
        sha256(
            await readFile(join(projectRoot, result.output, result.archive)),
        ),
        result.sha256,
    );
    for (const args of [
        ['--unknown', 'x'],
        ['--built-at'],
        ['--built-at', builtAt, '--built-at', builtAt],
    ]) {
        assert.throws(
            () =>
                execFileSync(process.execPath, ['release.mjs', ...args], {
                    cwd: projectRoot,
                    stdio: 'pipe',
                }),
            /Usage/,
        );
    }
});
