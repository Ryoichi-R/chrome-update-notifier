import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_INFO } from '../extension/build-info.mjs';
import { appInfoRows, appInfoText } from '../extension/app-info.mjs';
import { build } from '../build.mjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
    createBrowserState,
    createFakeChrome,
} from './support/fake-chrome.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeElement() {
    const listeners = {};
    return {
        textContent: '',
        value: '',
        disabled: false,
        classList: { toggle() {} },
        addEventListener: (type, fn) => {
            listeners[type] = fn;
        },
        listeners,
    };
}

// Loads a fresh copy of popup.js against fake document and chrome globals.
// popup.js keeps using the globals after loading, so they are restored only
// when the test ends.
async function openPopup(
    t,
    browser,
    {
        failCopy = false,
        failPlatform = false,
        popupUrl = new URL('../extension/popup.js', import.meta.url),
    } = {},
) {
    const chrome = createFakeChrome({ browser });
    const sent = [];
    const copied = [];
    if (failPlatform)
        chrome.runtime.getPlatformInfo = async () => {
            throw new Error('unavailable');
        };
    chrome.runtime.sendMessage = async (message) => {
        sent.push(message);
        if (message.type === 'SET_CHANNEL_CONFIRMATION') {
            await chrome.storage.local.set({
                channelConfirmation: message.confirmation,
            });
        }
        return { ok: true };
    };
    const elements = {};
    const saved = {
        chrome: globalThis.chrome,
        document: globalThis.document,
        navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
        window: globalThis.window,
    };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                writeText: async (text) => {
                    if (failCopy) throw new Error('denied');
                    copied.push(text);
                },
            },
        },
    });
    globalThis.chrome = chrome;
    globalThis.window = {
        close: () => {
            browser.closed = true;
        },
    };
    globalThis.document = {
        getElementById: (id) => (elements[id] ??= fakeElement()),
    };
    t.after(() => {
        globalThis.chrome = saved.chrome;
        globalThis.document = saved.document;
        globalThis.window = saved.window;
        if (saved.navigator)
            Object.defineProperty(globalThis, 'navigator', saved.navigator);
        else delete globalThis.navigator;
    });
    await import(`${popupUrl}?instance=${Math.random()}`);
    await settle();
    return { chrome, elements, sent, copied };
}

test('the channel select defaults to stable and keeps an unsaved choice', async (t) => {
    const browser = createBrowserState();
    const { chrome, elements } = await openPopup(t, browser);
    const select = elements.channel;
    assert.equal(select.value, 'stable');

    // The user picks a value but has not saved it yet when a background
    // check stores its result.
    select.value = 'unsupported';
    await chrome.storage.local.set({
        lastAttempt: { status: 'UP_TO_DATE', at: new Date().toISOString() },
    });
    await settle();
    assert.equal(select.value, 'unsupported');

    // A change of the setting itself is shown.
    await chrome.storage.local.set({ channelConfirmation: 'unsupported' });
    await settle();
    assert.equal(select.value, 'unsupported');
    select.value = 'stable';
    await chrome.storage.local.set({ channelConfirmation: 'stable' });
    await settle();
    assert.equal(select.value, 'stable');
});

test('version information and the copy button use the same six values', async (t) => {
    const { chrome, elements, copied, sent } = await openPopup(
        t,
        createBrowserState(),
    );
    const rows = appInfoRows(
        chrome.runtime.getManifest(),
        BUILD_INFO,
        await chrome.runtime.getPlatformInfo(),
    );
    const ids = [
        'app-name',
        'app-version',
        'source-commit',
        'source-dirty',
        'built-at',
        'runtime-platform',
    ];
    assert.deepEqual(
        ids.map((id) => elements[id].textContent),
        rows.map(([, value]) => value),
    );
    assert.equal(elements['copy-info'].disabled, false);
    await elements['copy-info'].listeners.click();
    assert.deepEqual(copied, [appInfoText(rows)]);
    assert.equal(elements['copy-status'].textContent, 'コピーしました。');
    assert.deepEqual(sent, []);
});

test('clipboard errors are visible and do not change displayed information', async (t) => {
    const { elements, copied } = await openPopup(t, createBrowserState(), {
        failCopy: true,
    });
    const version = elements['app-version'].textContent;
    await elements['copy-info'].listeners.click();
    assert.match(elements['copy-status'].textContent, /コピーできませんでした/);
    assert.equal(elements['app-version'].textContent, version);
    assert.deepEqual(copied, []);
});

test('platform failure still displays and copies product/build information', async (t) => {
    const { elements, copied } = await openPopup(t, createBrowserState(), {
        failPlatform: true,
    });
    assert.equal(elements['runtime-platform'].textContent, '不明／不明');
    assert.notEqual(elements['app-version'].textContent, '不明');
    await elements['copy-info'].listeners.click();
    assert.match(copied[0], /実行版: 不明／不明$/);
});

test('built popup displays and copies embedded provenance without querying Git at runtime', async (t) => {
    const outputRoot = fileURLToPath(
        new URL(`../dist/popup-test-${randomUUID()}`, import.meta.url),
    );
    t.after(() => rm(outputRoot, { recursive: true, force: true }));
    const result = await build({
        now: new Date('2026-10-13T16:00:00.000Z'),
        runGit: (args) =>
            args[0] === 'log' ? 'abcdef1' : ' M extension/popup.js',
        outputRoot,
    });
    const { chrome, elements, copied } = await openPopup(
        t,
        createBrowserState(),
        {
            popupUrl: pathToFileURL(
                join(result.output, 'extension', 'popup.js'),
            ),
        },
    );
    const rows = appInfoRows(
        chrome.runtime.getManifest(),
        result.buildInfo,
        await chrome.runtime.getPlatformInfo(),
    );
    assert.equal(elements['source-commit'].textContent, 'abcdef1');
    assert.equal(elements['source-dirty'].textContent, 'あり');
    assert.equal(
        elements['built-at'].textContent,
        '2026-10-13T16:00:00.000Z（UTC）',
    );
    await elements['copy-info'].listeners.click();
    assert.equal(copied[0], appInfoText(rows));
});

test('saving sends the selected channel to the background worker', async (t) => {
    const browser = createBrowserState({ channelConfirmation: 'unknown' });
    const { elements, sent } = await openPopup(t, browser);
    assert.equal(elements.channel.value, 'stable');
    elements.channel.value = 'unsupported';
    elements['save-channel'].listeners.click();
    await settle();
    await settle();
    assert.deepEqual(sent, [
        { type: 'SET_CHANNEL_CONFIRMATION', confirmation: 'unsupported' },
    ]);
    assert.equal(browser.storage.channelConfirmation, 'unsupported');
    assert.equal(elements.channel.value, 'unsupported');
    assert.equal(elements['save-channel'].disabled, false);
});

test('a popup remains usable after copy/check failures: retry, save settings and open Chrome settings', async (t) => {
    const browser = createBrowserState();
    const { chrome, elements } = await openPopup(t, browser, {
        failCopy: true,
    });
    await elements['copy-info'].listeners.click();
    assert.match(elements['copy-status'].textContent, /コピーできませんでした/);
    let copied;
    navigator.clipboard.writeText = async (text) => {
        copied = text;
    };
    await elements['copy-info'].listeners.click();
    assert.ok(
        copied
            .split('\n')
            .includes(`バージョン: ${chrome.runtime.getManifest().version}`),
    );
    assert.equal(elements['copy-status'].textContent, 'コピーしました。');
    for (const sendMessage of [
        async () => ({ ok: false }),
        async () => {
            throw new Error('request unavailable');
        },
    ]) {
        chrome.runtime.sendMessage = sendMessage;
        elements['check-now'].listeners.click();
        await settle();
        await settle();
        assert.equal(elements['check-now'].disabled, false);
        assert.match(
            elements.summary.textContent,
            /確認を開始できませんでした/,
        );
    }
    chrome.runtime.sendMessage = async () => ({ ok: true });
    elements['check-now'].listeners.click();
    await settle();
    await settle();
    assert.equal(elements['check-now'].disabled, false);
    elements.channel.value = 'unsupported';
    elements['save-channel'].listeners.click();
    await settle();
    await settle();
    assert.equal(elements['save-channel'].disabled, false);
    await chrome.storage.local.set({ channelConfirmation: 'unsupported' });
    await settle();
    assert.equal(elements.channel.value, 'unsupported');
    await elements['open-update'].listeners.click();
    assert.deepEqual(browser.tabs, ['chrome://settings/help']);
    assert.equal(browser.closed, true);
});
