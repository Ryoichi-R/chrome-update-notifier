import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appInfoRows, appInfoText } from '../extension/app-info.mjs';

const manifest = JSON.parse(
    readFileSync(
        new URL('../extension/manifest.json', import.meta.url),
        'utf8',
    ),
);
const buildInfo = {
    sourceCommit: 'abcdef1',
    dirty: true,
    builtAt: '2026-10-13T16:00:00.000Z',
};

test('the six labels, their order, UTC and copied text agree with the manifest', () => {
    const rows = appInfoRows(manifest, buildInfo, { os: 'win', arch: 'arm64' });
    assert.deepEqual(rows, [
        ['アプリ名', manifest.name],
        ['バージョン', manifest.version],
        ['ソース識別子', 'abcdef1'],
        ['未コミット変更の有無', 'あり'],
        ['ビルド日時', '2026-10-13T16:00:00.000Z（UTC）'],
        ['実行版', 'Windows／ARM64'],
    ]);
    assert.equal(
        appInfoText(rows),
        rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    );
    const html = readFileSync(
        new URL('../extension/popup.html', import.meta.url),
        'utf8',
    );
    const section = html
        .split('<details id="version-info">')[1]
        .split('</details>')[0];
    assert.deepEqual(
        [...section.matchAll(/<dt>(.*?)<\/dt>/g)].map((match) => match[1]),
        rows.map(([label]) => label),
    );
    assert.match(
        html,
        /<details id="settings" open>[\s\S]*<summary>設定<\/summary>[\s\S]*<details id="version-info">/,
    );
});

test('runtime architecture comes from arch even when native/host architecture differs', () => {
    for (const [os, arch, expected] of [
        ['win', 'x86-64', 'Windows／x64'],
        ['win', 'arm64', 'Windows／ARM64'],
        ['win', 'x86-32', 'Windows／x86'],
        ['mac', 'x86-64', 'macOS／x64'],
        ['mac', 'arm64', 'macOS／ARM64'],
    ]) {
        const rows = appInfoRows(
            manifest,
            { ...buildInfo, dirty: false },
            { os, arch, nacl_arch: 'arm64' },
        );
        assert.equal(rows[5][1], expected);
        assert.equal(rows[1][1], manifest.version);
        assert.equal(rows[3][1], 'なし');
    }
});

test('missing or malformed build/platform information is unknown without exposing input', () => {
    for (const info of [
        undefined,
        {},
        {
            sourceCommit: 'C:/private/source',
            dirty: 'false',
            builtAt: '2026-10-14T01:00:00+09:00',
        },
        { builtAt: '2026-02-30T00:00:00.000Z' },
    ]) {
        const rows = appInfoRows(manifest, info, {
            os: 'private-host',
            arch: 'private-cpu',
        });
        assert.deepEqual(
            rows.slice(2).map(([, value]) => value),
            ['不明', '不明', '不明', '不明／不明'],
        );
    }
});
