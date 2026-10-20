import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../extension/checker.mjs';
import {
    chromeNavigator,
    createFakeFetch,
    fakeNavigator,
    jsonResponse,
    releases,
} from './support/fake-chrome.mjs';

const now = new Date('2026-10-08T14:00:00.000Z');
const arm = { os: 'mac', arch: 'arm64' };
const served = (version) =>
    createFakeFetch(
        jsonResponse(releases(['156.0.8078.12', 0.005], [version, 1])),
    );

test('an older local version is OUTDATED against the reference', async () => {
    const result = await runCheck({
        fetchFn: served('155.0.8059.40'),
        nav: chromeNavigator('154.0.8037.98'),
        platformInfo: arm,
        channelConfirmation: 'stable',
        now,
    });
    assert.deepEqual(result, {
        status: 'OUTDATED',
        platform: 'mac_arm64',
        local: '154.0.8037.98',
        reference: '155.0.8059.40',
        errorKind: null,
        at: '2026-10-08T14:00:00.000Z',
        channelConfirmation: 'stable',
    });
});

test('64-bit Windows Chrome is compared with the win64 releases', async () => {
    const fetchFn = served('155.0.8059.40');
    const result = await runCheck({
        fetchFn,
        nav: chromeNavigator('154.0.8037.98'),
        platformInfo: { os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' },
        channelConfirmation: 'stable',
        now,
    });
    assert.equal(result.status, 'OUTDATED');
    assert.equal(result.platform, 'win64');
    assert.equal(result.reference, '155.0.8059.40');
    assert.equal(fetchFn.calls.length, 1);
    assert.match(fetchFn.calls[0], /\/platforms\/win64\/channels\/stable\//);
});

test('an equal or newer local version is UP_TO_DATE', async () => {
    for (const local of ['155.0.8059.40', '156.0.8078.12']) {
        const result = await runCheck({
            fetchFn: served('155.0.8059.40'),
            nav: chromeNavigator(local),
            platformInfo: arm,
            channelConfirmation: 'stable',
            now,
        });
        assert.equal(result.status, 'UP_TO_DATE', local);
    }
});

test('no fully served release is NO_REFERENCE', async () => {
    const fetchFn = createFakeFetch(
        jsonResponse(releases(['156.0.8078.12', 0.5])),
    );
    const result = await runCheck({
        fetchFn,
        nav: chromeNavigator('154.0.8037.98'),
        platformInfo: arm,
        channelConfirmation: 'stable',
        now,
    });
    assert.equal(result.status, 'NO_REFERENCE');
    assert.equal(result.reference, null);
});

test('unsupported environments do not fetch', async () => {
    const fetchFn = served('155.0.8059.40');
    const edge = fakeNavigator([
        { brand: 'Microsoft Edge', version: '154.0.1.1' },
        { brand: 'Chromium', version: '154.0.8037.98' },
    ]);
    assert.equal(
        (
            await runCheck({
                fetchFn,
                nav: edge,
                platformInfo: arm,
                channelConfirmation: 'stable',
                now,
            })
        ).status,
        'UNSUPPORTED',
    );
    assert.equal(
        (
            await runCheck({
                fetchFn,
                nav: chromeNavigator('154.0.8037.98'),
                platformInfo: { os: 'linux', arch: 'x86-64' },
                channelConfirmation: 'stable',
                now,
            })
        ).status,
        'UNSUPPORTED',
    );
    assert.equal(fetchFn.calls.length, 0);
});

test('a failed fetch is ERROR and still reports the local version', async () => {
    const fetchFn = createFakeFetch(new TypeError('offline'));
    const result = await runCheck({
        fetchFn,
        nav: chromeNavigator('154.0.8037.98'),
        platformInfo: arm,
        channelConfirmation: 'stable',
        now,
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.errorKind, 'NETWORK');
    assert.equal(result.local, '154.0.8037.98');
    assert.equal(result.platform, 'mac_arm64');
});

test('missing local version or platform info is ERROR', async () => {
    const fetchFn = served('155.0.8059.40');
    assert.deepEqual(
        {
            ...(await runCheck({
                fetchFn,
                nav: {},
                platformInfo: arm,
                channelConfirmation: 'stable',
                now,
            })),
            at: null,
        },
        {
            status: 'ERROR',
            platform: 'mac_arm64',
            local: null,
            reference: null,
            errorKind: 'LOCAL_VERSION',
            at: null,
            channelConfirmation: 'stable',
        },
    );
    const noInfo = await runCheck({
        fetchFn,
        nav: chromeNavigator('154.0.8037.98'),
        platformInfo: null,
        channelConfirmation: 'stable',
        now,
    });
    assert.equal(noInfo.status, 'ERROR');
    assert.equal(noInfo.errorKind, 'PLATFORM_INFO');
});

test('an unexpected exception becomes ERROR UNEXPECTED', async () => {
    const nav = {
        get userAgentData() {
            throw new Error('boom');
        },
    };
    const result = await runCheck({
        fetchFn: served('155.0.8059.40'),
        nav,
        platformInfo: arm,
        channelConfirmation: 'stable',
        now,
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.errorKind, 'UNEXPECTED');
});

test('a missing or legacy channel setting checks as stable', async () => {
    for (const channelConfirmation of [undefined, null, 'unknown']) {
        const fetchFn = served('155.0.8059.40');
        const result = await runCheck({
            fetchFn,
            nav: chromeNavigator('154.0.8037.98'),
            platformInfo: arm,
            channelConfirmation,
            now,
        });
        assert.equal(result.status, 'OUTDATED', String(channelConfirmation));
        assert.equal(result.channelConfirmation, 'stable');
        assert.equal(fetchFn.calls.length, 1);
    }
});

test('the non-stable opt-out and invalid channel settings never fetch', async () => {
    for (const channelConfirmation of ['unsupported', 'beta', {}, true]) {
        const fetchFn = served('155.0.8059.40');
        const result = await runCheck({
            fetchFn,
            nav: chromeNavigator('154.0.8037.98'),
            platformInfo: arm,
            channelConfirmation,
            now,
        });
        assert.equal(result.status, 'UNSUPPORTED');
        assert.equal(
            result.reason,
            channelConfirmation === 'unsupported'
                ? 'CHANNEL'
                : 'CHANNEL_INVALID',
        );
        assert.equal(fetchFn.calls.length, 0);
    }
});
