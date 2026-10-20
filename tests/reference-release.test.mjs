import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CheckError,
    fetchReferenceRelease,
    releasesUrl,
    selectReferenceRelease,
} from '../extension/reference-release.mjs';
import {
    createFakeFetch,
    jsonResponse,
    releases,
} from './support/fake-chrome.mjs';

const measured = JSON.parse(
    readFileSync(
        new URL('./fixtures/stable-mac_arm64-20261008.json', import.meta.url),
        'utf8',
    ),
);

test('the measured 2026-10-08 response selects the fully served 155.0.8059.40', () => {
    assert.equal(selectReferenceRelease(measured), '155.0.8059.40');
});

test('only a numeric fraction of exactly 1 with a valid version qualifies', () => {
    const json = releases(
        ['160.0.0.1', '1'],
        ['159.0.0.1', 1.2],
        ['158.0.0.1', null],
        ['157.0.0.1', 0.999],
        ['bad.version', 1],
        ['156.0.0', 1],
        ['150.0.0.1', 1],
        ['151.0.0.1', 1],
    );
    json.releases.push(null, 'text', { fraction: 1 });
    assert.equal(selectReferenceRelease(json), '151.0.0.1');
});

test('no qualifying release yields null, a missing releases array is MALFORMED', () => {
    assert.equal(selectReferenceRelease(releases(['156.0.0.1', 0.5])), null);
    assert.equal(selectReferenceRelease({ releases: [] }), null);
    for (const bad of [{}, { releases: {} }, null, [], 'x']) {
        assert.throws(
            () => selectReferenceRelease(bad),
            (e) => e instanceof CheckError && e.kind === 'MALFORMED',
        );
    }
});

test('the request URL depends on the platform and never carries the local version', () => {
    assert.equal(
        releasesUrl('mac_arm64'),
        'https://versionhistory.googleapis.com/v1/chrome/platforms/mac_arm64/channels/stable/versions/all/releases?filter=endtime=none&order_by=version%20desc',
    );
    assert.match(releasesUrl('mac'), /\/platforms\/mac\/channels\/stable\//);
    for (const platform of ['win', 'win64', 'win_arm64']) {
        assert.match(
            releasesUrl(platform),
            new RegExp(`/platforms/${platform}/channels/stable/`),
        );
    }
    assert.throws(() => releasesUrl('linux'), /UNSUPPORTED_PLATFORM/);
});

test('the measured 2026-10-09 Windows 64-bit response selects 155.0.8059.40', () => {
    const win64 = JSON.parse(
        readFileSync(
            new URL('./fixtures/stable-win64-20261009.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(selectReferenceRelease(win64), '155.0.8059.40');
});

test('fetchReferenceRelease uses the platform URL and returns the reference', async () => {
    const fetchFn = createFakeFetch(jsonResponse(measured));
    assert.equal(
        await fetchReferenceRelease({ fetchFn, platform: 'mac' }),
        '155.0.8059.40',
    );
    assert.deepEqual(fetchFn.calls, [releasesUrl('mac')]);
});

async function kindOf(promise) {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof CheckError, String(error));
        return error.kind;
    }
    return 'NO_ERROR';
}

test('fetch failures are distinguishable', async () => {
    const run = (respond, timeoutMs) =>
        kindOf(
            fetchReferenceRelease({
                fetchFn: createFakeFetch(respond),
                platform: 'mac_arm64',
                timeoutMs,
            }),
        );
    assert.equal(await run(jsonResponse('server error', 500)), 'HTTP');
    assert.equal(await run(jsonResponse('<html>not json</html>')), 'MALFORMED');
    assert.equal(await run(jsonResponse({ items: [] })), 'MALFORMED');
    assert.equal(await run(new TypeError('Failed to fetch')), 'NETWORK');
    assert.equal(await run(undefined), 'HTTP');
    assert.equal(await run(() => new Promise(() => {}), 20), 'TIMEOUT');
    const slowBody = () => ({
        ok: true,
        status: 200,
        text: () => new Promise(() => {}),
    });
    assert.equal(await run(slowBody, 20), 'TIMEOUT');
});

test('a timeout aborts the request signal', async () => {
    let signal;
    const fetchFn = (url, init) => {
        signal = init.signal;
        return new Promise(() => {});
    };
    assert.equal(
        await kindOf(
            fetchReferenceRelease({ fetchFn, platform: 'mac', timeoutMs: 10 }),
        ),
        'TIMEOUT',
    );
    assert.equal(signal.aborted, true);
});
