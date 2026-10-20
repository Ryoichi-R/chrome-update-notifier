import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getLocalChromeVersion,
    normalizeChannel,
    resolveChannel,
    resolvePlatform,
} from '../extension/environment.mjs';
import { chromeNavigator, fakeNavigator } from './support/fake-chrome.mjs';

test('Google Chrome reports its full version', async () => {
    assert.deepEqual(
        await getLocalChromeVersion(chromeNavigator('154.0.8037.98')),
        { status: 'OK', version: '154.0.8037.98' },
    );
});

test('Edge and plain Chromium are unsupported even though they report Chromium', async () => {
    const edge = fakeNavigator([
        { brand: 'Microsoft Edge', version: '154.0.3000.1' },
        { brand: 'Chromium', version: '154.0.8037.98' },
        { brand: 'Not A(Brand', version: '99.0.0.0' },
    ]);
    assert.equal((await getLocalChromeVersion(edge)).status, 'UNSUPPORTED');
    const chromium = fakeNavigator([
        { brand: 'Chromium', version: '154.0.8037.98' },
    ]);
    assert.equal((await getLocalChromeVersion(chromium)).status, 'UNSUPPORTED');
});

test('a missing or broken userAgentData is a LOCAL_VERSION error', async () => {
    const error = { status: 'ERROR', errorKind: 'LOCAL_VERSION' };
    assert.deepEqual(await getLocalChromeVersion({}), error);
    assert.deepEqual(await getLocalChromeVersion(undefined), error);
    assert.deepEqual(
        await getLocalChromeVersion(chromeNavigator('154')),
        error,
    );
    const throwing = {
        userAgentData: {
            getHighEntropyValues: async () => {
                throw new Error('denied');
            },
        },
    };
    assert.deepEqual(await getLocalChromeVersion(throwing), error);
    const noList = {
        userAgentData: { getHighEntropyValues: async () => ({}) },
    };
    assert.deepEqual(await getLocalChromeVersion(noList), error);
});

test('the platform follows the CPU architecture on Mac and Windows only', () => {
    const expected = [
        [{ os: 'mac', arch: 'arm64' }, 'mac_arm64'],
        [{ os: 'mac', arch: 'x86-64' }, 'mac'],
        [{ os: 'win', arch: 'x86-64' }, 'win64'],
        [{ os: 'win', arch: 'arm64' }, 'win_arm64'],
        [{ os: 'win', arch: 'x86-32' }, 'win'],
    ];
    for (const [info, platform] of expected) {
        assert.deepEqual(resolvePlatform(info), { status: 'OK', platform });
    }
    assert.deepEqual(resolvePlatform({ os: 'mac', arch: 'x86-32' }), {
        status: 'UNSUPPORTED',
        reason: 'ARCH',
    });
    assert.deepEqual(resolvePlatform({ os: 'win', arch: 'arm' }), {
        status: 'UNSUPPORTED',
        reason: 'ARCH',
    });
    assert.deepEqual(resolvePlatform({ os: 'win', arch: 'toString' }), {
        status: 'UNSUPPORTED',
        reason: 'ARCH',
    });
    for (const os of ['linux', 'cros', 'android', 'toString']) {
        assert.deepEqual(resolvePlatform({ os, arch: 'x86-64' }), {
            status: 'UNSUPPORTED',
            reason: 'OS',
        });
    }
    assert.deepEqual(resolvePlatform(null), {
        status: 'ERROR',
        errorKind: 'PLATFORM_INFO',
    });
});

test('the channel is stable by default and only an opt-out or invalid value stops it', () => {
    for (const value of [undefined, null, 'unknown', 'stable']) {
        assert.equal(normalizeChannel(value), 'stable', String(value));
        assert.deepEqual(resolveChannel(value), { status: 'OK' });
    }
    assert.deepEqual(resolveChannel('unsupported'), {
        status: 'UNSUPPORTED',
        reason: 'CHANNEL',
    });
    // "extended" was saved only by the unreleased 0.2.0.
    for (const value of ['beta', 'extended', 1, {}, true]) {
        assert.deepEqual(resolveChannel(value), {
            status: 'UNSUPPORTED',
            reason: 'CHANNEL_INVALID',
        });
    }
});
