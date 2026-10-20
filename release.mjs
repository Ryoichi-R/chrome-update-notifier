import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_FILES, build } from './build.mjs';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ZIP32 STORE: fixed UTC-independent DOS date, UTF-8 names, regular 0644 files.
// Only our fixed allowlist reaches this writer; no source directory traversal.
function zip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const { path, bytes } of entries) {
        const name = Buffer.from(path, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(0x21, 12); // 1980-01-01, 00:00:00 (no source mtime).
        local.writeUInt32LE(crc32(bytes), 14);
        local.writeUInt32LE(bytes.length, 18);
        local.writeUInt32LE(bytes.length, 22);
        local.writeUInt16LE(name.length, 26);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50, 0);
        directory.writeUInt16LE(0x314, 4);
        local.copy(directory, 6, 4, 30);
        directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        directory.writeUInt32LE(offset, 42);
        central.push(directory, name);
        locals.push(local, name, bytes);
        offset += local.length + name.length + bytes.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

export async function release({ builtAt, outputRoot, runGit } = {}) {
    if (
        typeof builtAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt) ||
        !Number.isFinite(Date.parse(builtAt)) ||
        new Date(builtAt).toISOString() !== builtAt
    ) {
        throw new Error(
            'Provide --built-at as a valid UTC timestamp with milliseconds.',
        );
    }
    const result = await build({ now: new Date(builtAt), outputRoot, runGit });
    const files = [...APP_FILES, 'build-info.mjs'].sort();
    const entries = await Promise.all(
        files.map(async (file) => ({
            path: `chrome-update-notifier/${file}`,
            bytes: await readFile(join(result.output, 'extension', file)),
        })),
    );
    const archive = `chrome-update-notifier-${result.version}.zip`;
    const bytes = zip(entries);
    const sha256 = hash(bytes);
    const manifest = entries.map((entry) => ({
        path: entry.path,
        bytes: entry.bytes.length,
        sha256: hash(entry.bytes),
    }));
    // build() reserved a fresh output folder, and wx also refuses replacement.
    await writeFile(join(result.output, archive), bytes, { flag: 'wx' });
    await writeFile(
        join(result.output, 'SHA256SUMS'),
        `${sha256}  ${archive}\n`,
        { flag: 'wx' },
    );
    await writeFile(
        join(result.output, 'files.sha256.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: 'wx' },
    );
    return { ...result, archive, sha256, fileCount: entries.length };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = { '--built-at': 'builtAt', '--output-root': 'outputRoot' }[
            args[i]
        ];
        if (!key || !args[i + 1] || key in options) {
            throw new Error(
                'Usage: node release.mjs --built-at <UTC ISO> [--output-root dist/<new-name>]',
            );
        }
        options[key] = args[i + 1];
    }
    if (options.outputRoot) options.outputRoot = resolve(options.outputRoot);
    const result = await release(options);
    console.log(
        JSON.stringify(
            { ...result, output: relative(projectRoot, result.output) },
            null,
            2,
        ),
    );
}
