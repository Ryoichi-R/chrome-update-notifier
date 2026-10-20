import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    ALARM_NAME,
    CHECK_PERIOD_MINUTES,
    createNotifier,
    installNotifier,
    UPDATE_PAGE_URL,
} from '../extension/notifier.mjs';
import {
    chromeNavigator,
    createBrowserState,
    createFakeChrome,
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
const start = new Date('2026-10-08T14:00:00.000Z');
const HOUR = 3600000;

function setup({
    browser = createBrowserState(),
    local = '154.0.8037.98',
    respond = jsonResponse(measured),
    failNotifications = false,
    clockAt = start,
} = {}) {
    const chrome = createFakeChrome({ browser, failNotifications });
    const fetchFn = createFakeFetch(respond);
    const clock = { now: clockAt };
    const nav = { version: local };
    const navProxy = {
        get userAgentData() {
            return chromeNavigator(nav.version).userAgentData;
        },
    };
    const deps = {
        chrome,
        fetchFn,
        nav: navProxy,
        clock: () => clock.now,
        timeoutMs: 50,
    };
    return { chrome, browser, fetchFn, clock, nav, deps };
}

test('simultaneous startup, alarm and check-now share one fetch and one notification', async () => {
    const { chrome, browser, fetchFn, deps } = setup();
    let release;
    fetchFn.gate = new Promise((resolve) => {
        release = resolve;
    });
    const { ready } = installNotifier(deps);
    chrome.runtime.onStartup.fire();
    chrome.alarms.onAlarm.fire({ name: ALARM_NAME });
    const responses = [];
    const handled = chrome.runtime.onMessage.fire(
        { type: 'CHECK_NOW' },
        { id: chrome.runtime.id },
        (r) => responses.push(r),
    );
    assert.deepEqual(handled, [true]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await ready;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(browser.calls.notificationsCreate, 1);
    assert.equal(
        browser.notifications[0].id,
        'outdated:mac_arm64:155.0.8059.40',
    );
    assert.equal(
        browser.storage.notifiedKey,
        'outdated:mac_arm64:155.0.8059.40',
    );
    assert.deepEqual(browser.badge.text, '!');
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].attempt.status, 'OUTDATED');
});

test('a later check for the same reference does not notify again', async () => {
    const { browser, deps } = setup();
    const notifier = createNotifier(deps);
    await notifier.check();
    await notifier.check();
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('a failed notification is not stored as notified and is retried', async () => {
    const { chrome, browser, deps } = setup({ failNotifications: true });
    const notifier = createNotifier(deps);
    await notifier.check();
    assert.equal(browser.calls.notificationsCreate, 1);
    assert.equal(browser.storage.notifiedKey, undefined);
    assert.equal(browser.badge.text, '!');
    chrome.failNotifications = false;
    await notifier.check();
    assert.equal(browser.calls.notificationsCreate, 2);
    assert.equal(
        browser.storage.notifiedKey,
        'outdated:mac_arm64:155.0.8059.40',
    );
});

test('messages from other senders or of other types are ignored', () => {
    const { chrome, fetchFn, deps } = setup({ browser: createBrowserState() });
    deps.chrome.storage.local.set({
        lastSuccess: { status: 'UP_TO_DATE', at: start.toISOString() },
    });
    installNotifier(deps);
    assert.deepEqual(
        chrome.runtime.onMessage.fire(
            { type: 'CHECK_NOW' },
            { id: 'other' },
            () => {},
        ),
        [false],
    );
    assert.deepEqual(
        chrome.runtime.onMessage.fire(
            { type: 'OTHER' },
            { id: chrome.runtime.id },
            () => {},
        ),
        [false],
    );
    assert.equal(fetchFn.calls.length, 0);
});

test('the alarm is created only when missing', async () => {
    const { browser, deps } = setup();
    const notifier = createNotifier(deps);
    assert.equal(await notifier.ensureAlarm(), true);
    assert.deepEqual(browser.alarms.get(ALARM_NAME), {
        name: ALARM_NAME,
        periodInMinutes: CHECK_PERIOD_MINUTES,
    });
    assert.equal(await notifier.ensureAlarm(), false);
    assert.equal(browser.calls.alarmsCreate, 1);
    browser.alarms.clear();
    assert.equal(await notifier.ensureAlarm(), true);
    assert.equal(browser.calls.alarmsCreate, 2);
});

test('startup checks only when the last success is missing or 24 hours old', async () => {
    const { browser, fetchFn, clock, deps } = setup();
    await createNotifier(deps).startup();
    assert.equal(fetchFn.calls.length, 1);
    clock.now = new Date(start.getTime() + 24 * HOUR - 1);
    await createNotifier(deps).startup();
    assert.equal(fetchFn.calls.length, 1);
    clock.now = new Date(start.getTime() + 24 * HOUR);
    await createNotifier(deps).startup();
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(browser.calls.alarmsCreate, 1);
});

test('a relaunch with a new local version checks at once even within 24 hours', async () => {
    const first = setup();
    await createNotifier(first.deps).check();
    assert.equal(first.browser.badge.text, '!');

    // Updated and relaunched one hour later while offline.
    const browser = first.browser;
    browser.badge = { text: '', color: null, title: '' };
    const second = setup({
        browser,
        local: '155.0.8059.40',
        respond: new TypeError('offline'),
        clockAt: new Date(start.getTime() + HOUR),
    });
    await installNotifier(second.deps).ready;
    assert.equal(second.fetchFn.calls.length, 1);
    assert.equal(browser.badge.text, '');
    assert.equal(browser.storage.lastAttempt.local, '155.0.8059.40');

    // The next relaunch with the same version does not fetch again.
    const third = setup({
        browser,
        local: '155.0.8059.40',
        clockAt: new Date(start.getTime() + 2 * HOUR),
    });
    await installNotifier(third.deps).ready;
    assert.equal(third.fetchFn.calls.length, 0);
    assert.equal(browser.badge.text, '');
});

test('outdated -> offline keeps red -> recovered -> updated and relaunched clears the badge', async () => {
    const { browser, fetchFn, clock, nav, deps } = setup();
    const notifier = createNotifier(deps);

    await notifier.check();
    assert.equal(browser.badge.text, '!');
    assert.equal(browser.storage.lastSuccess.status, 'OUTDATED');

    fetchFn.respond = new TypeError('offline');
    clock.now = new Date(start.getTime() + 6 * HOUR);
    await notifier.check();
    assert.equal(browser.badge.text, '!');
    assert.match(
        browser.badge.title,
        /前回の確認では更新対象（今回は確認失敗）/,
    );
    assert.equal(browser.storage.lastAttempt.status, 'ERROR');
    assert.equal(browser.storage.lastSuccess.status, 'OUTDATED');

    fetchFn.respond = jsonResponse(measured);
    clock.now = new Date(start.getTime() + 12 * HOUR);
    await notifier.check();
    assert.equal(browser.badge.text, '!');
    assert.equal(browser.calls.notificationsCreate, 1);

    // After updating, the relaunch happens while offline: the new local
    // version is compared with the last reference.
    nav.version = '155.0.8059.40';
    fetchFn.respond = new TypeError('offline');
    clock.now = new Date(start.getTime() + 13 * HOUR);
    await notifier.check();
    assert.equal(browser.badge.text, '');

    fetchFn.respond = jsonResponse(measured);
    await notifier.check();
    assert.equal(browser.badge.text, '');
    assert.equal(browser.storage.lastSuccess.status, 'UP_TO_DATE');
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('the red badge after a failure expires after seven days', async () => {
    const { browser, fetchFn, clock, deps } = setup();
    const notifier = createNotifier(deps);
    await notifier.check();
    fetchFn.respond = jsonResponse('unavailable', 503);
    clock.now = new Date(start.getTime() + 7 * 24 * HOUR + 1);
    await notifier.check();
    assert.equal(browser.badge.text, '?');
    assert.equal(browser.storage.lastAttempt.errorKind, 'HTTP');
});

test('a restarted worker restores the same display from storage without fetching', async () => {
    const first = setup();
    await createNotifier(first.deps).check();
    const shown = structuredClone(first.browser.badge);

    // A new worker on the same browser state, with the badge reset as after a
    // browser restart.
    const browser = first.browser;
    browser.badge = { text: '', color: null, title: '' };
    const second = setup({
        browser,
        clockAt: new Date(start.getTime() + HOUR),
    });
    const { ready } = installNotifier(second.deps);
    await ready;
    assert.deepEqual(browser.badge, shown);
    assert.equal(second.fetchFn.calls.length, 0);
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('clicking the notification opens the update page and clears it', async () => {
    const { chrome, browser, deps } = setup();
    const { ready } = installNotifier(deps);
    await ready;
    const id = browser.notifications[0].id;
    // The first OUTDATED result has already opened the page once.
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
    chrome.notifications.onClicked.fire('unrelated');
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
    chrome.notifications.onClicked.fire(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL, UPDATE_PAGE_URL]);
    assert.deepEqual(browser.notifications, []);
});

test('an unsupported platform shows no badge and does not fetch', async () => {
    const browser = createBrowserState();
    const chrome = createFakeChrome({
        browser,
        platformInfo: { os: 'linux', arch: 'x86-64' },
    });
    const fetchFn = createFakeFetch(jsonResponse(measured));
    await createNotifier({
        chrome,
        fetchFn,
        nav: chromeNavigator('154.0.8037.98'),
    }).check();
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(browser.badge.text, '');
    assert.equal(browser.storage.lastAttempt.status, 'UNSUPPORTED');
    assert.equal(browser.storage.lastSuccess, null);
});

test('opting out keeps the last comparison as the last success', async () => {
    const { chrome, browser, fetchFn, deps } = setup();
    await installNotifier(deps).ready;
    const compared = browser.storage.lastSuccess;
    assert.equal(compared.status, 'OUTDATED');
    const send = (confirmation) =>
        new Promise((resolve) => {
            chrome.runtime.onMessage.fire(
                { type: 'SET_CHANNEL_CONFIRMATION', confirmation },
                { id: chrome.runtime.id },
                resolve,
            );
        });
    const response = await send('unsupported');
    assert.equal(response.attempt.status, 'UNSUPPORTED');
    assert.equal(browser.storage.lastAttempt.reason, 'CHANNEL');
    assert.deepEqual(browser.storage.lastSuccess, compared);
    assert.equal(browser.badge.text, '');
    assert.equal(fetchFn.calls.length, 1);
    await send('stable');
    assert.equal(browser.storage.lastSuccess.status, 'OUTDATED');
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(browser.notifications.length, 1);
});

test('the manifest keeps the planned permissions', () => {
    const manifest = JSON.parse(
        readFileSync(
            new URL('../extension/manifest.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.minimum_chrome_version, '106');
    assert.deepEqual(manifest.permissions, [
        'alarms',
        'notifications',
        'storage',
    ]);
    assert.deepEqual(manifest.host_permissions, [
        'https://versionhistory.googleapis.com/*',
    ]);
    assert.deepEqual(manifest.background, {
        service_worker: 'background.js',
        type: 'module',
    });
});

test('a delayed startup restoration cannot overwrite an updated check', async () => {
    const first = setup();
    await createNotifier(first.deps).check();
    const second = setup({ browser: first.browser, local: '155.0.8059.40' });
    const get = second.chrome.storage.local.get;
    let releaseRestore;
    let readStarted;
    const gate = new Promise((resolve) => {
        releaseRestore = resolve;
    });
    const read = new Promise((resolve) => {
        readStarted = resolve;
    });
    let firstRead = true;
    second.chrome.storage.local.get = async (keys) => {
        const snapshot = await get(keys);
        if (firstRead) {
            firstRead = false;
            readStarted();
            await gate;
        }
        return snapshot;
    };
    const { notifier, ready } = installNotifier(second.deps);
    await read;
    const check = notifier.check();
    assert.equal(second.fetchFn.calls.length, 0);
    releaseRestore();
    await Promise.all([ready, check]);
    assert.equal(second.browser.storage.lastAttempt.status, 'UP_TO_DATE');
    assert.equal(second.browser.badge.text, '');
    assert.match(second.browser.badge.title, /155\.0\.8059\.40 以上/);
    assert.equal(second.fetchFn.calls.length, 1);
});

test('restoration requested during a check reads the new saved result', async () => {
    const { browser, fetchFn, nav, deps } = setup();
    const notifier = createNotifier(deps);
    await notifier.check();
    nav.version = '155.0.8059.40';
    let release;
    fetchFn.gate = new Promise((resolve) => {
        release = resolve;
    });
    const check = notifier.check();
    const restore = notifier.restoreDisplay();
    release();
    await Promise.all([check, restore]);
    assert.equal(browser.storage.lastAttempt.status, 'UP_TO_DATE');
    assert.equal(browser.badge.text, '');
});

test('a failed restoration does not poison the operation queue', async () => {
    const { chrome, browser, deps } = setup();
    const get = chrome.storage.local.get;
    chrome.storage.local.get = async () => {
        throw new Error('temporary storage failure');
    };
    const notifier = createNotifier(deps);
    await assert.rejects(
        notifier.restoreDisplay(),
        /temporary storage failure/,
    );
    chrome.storage.local.get = get;
    await notifier.check();
    assert.equal(browser.storage.lastAttempt.status, 'OUTDATED');
});

test('callback-only notifications are stored only after successful completion', async () => {
    const { chrome, browser, deps } = setup();
    let complete;
    chrome.notifications.create = (id, options, callback) => {
        assert.equal(typeof callback, 'function');
        complete = () => callback(id);
        return undefined;
    };
    const checking = createNotifier(deps).check();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(browser.storage.notifiedKey, undefined);
    complete();
    await checking;
    assert.equal(
        browser.storage.notifiedKey,
        'outdated:mac_arm64:155.0.8059.40',
    );
});

test('a synchronous notification failure or missing callback id remains retryable', async () => {
    for (const create of [
        () => {
            throw new Error('API failure');
        },
        (id, options, callback) => queueMicrotask(() => callback(undefined)),
    ]) {
        const { chrome, browser, deps } = setup();
        const workingCreate = chrome.notifications.create;
        chrome.notifications.create = create;
        const notifier = createNotifier(deps);
        await notifier.check();
        assert.equal(browser.storage.notifiedKey, undefined);
        chrome.notifications.create = workingCreate;
        await notifier.check();
        assert.equal(browser.notifications.length, 1);
    }
});

test('first startup checks and notifies without any channel setting', async () => {
    const { browser, fetchFn, deps } = setup();
    assert.equal('channelConfirmation' in browser.storage, false);
    await installNotifier(deps).ready;
    assert.equal(browser.storage.lastAttempt.status, 'OUTDATED');
    assert.equal(browser.storage.lastAttempt.channelConfirmation, 'stable');
    assert.equal(browser.badge.text, '!');
    assert.equal(browser.notifications.length, 1);
    assert.equal(fetchFn.calls.length, 1);
});

test("the confirm-first version's unconfirmed state is checked again at once", async () => {
    const legacy = {
        status: 'UNSUPPORTED',
        reason: 'CHANNEL_UNCONFIRMED',
        platform: 'mac_arm64',
        local: '154.0.8037.98',
        reference: null,
        errorKind: null,
        at: start.toISOString(),
        channelConfirmation: 'unknown',
    };
    const browser = createBrowserState({ channelConfirmation: 'unknown' });
    Object.assign(browser.storage, {
        lastAttempt: legacy,
        lastSuccess: legacy,
    });
    const { fetchFn, deps } = setup({ browser });
    await installNotifier(deps).ready;
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(browser.storage.lastAttempt.status, 'OUTDATED');
    assert.equal(browser.badge.text, '!');
});

test('a state stored before channel settings existed is checked again at once', async () => {
    const { browser, fetchFn, deps } = setup();
    await createNotifier(deps).check();
    delete browser.storage.lastAttempt.channelConfirmation;
    delete browser.storage.lastSuccess.channelConfirmation;
    await installNotifier(deps).ready;
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(browser.storage.lastAttempt.channelConfirmation, 'stable');
    assert.equal(browser.badge.text, '!');
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('opting out as non-stable stops checks and returning to stable resumes them', async () => {
    const { browser, fetchFn, deps } = setup();
    const { notifier, ready } = installNotifier(deps);
    await ready;
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(browser.calls.notificationsCreate, 1);
    await notifier.setChannelConfirmation('unsupported');
    await notifier.check();
    await notifier.startup();
    assert.equal(browser.storage.channelConfirmation, 'unsupported');
    assert.equal(browser.storage.lastAttempt.reason, 'CHANNEL');
    assert.equal(browser.badge.text, '');
    assert.equal(fetchFn.calls.length, 1);
    await notifier.setChannelConfirmation('stable');
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(browser.badge.text, '!');
    // The same reference was already notified.
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('an invalid stored channel setting shows a gray badge and does not fetch', async () => {
    // "extended" was saved only by the unreleased 0.2.0.
    for (const channelConfirmation of ['beta', 'extended']) {
        const { browser, fetchFn, deps } = setup({
            browser: createBrowserState({ channelConfirmation }),
        });
        await installNotifier(deps).ready;
        assert.equal(browser.storage.lastAttempt.reason, 'CHANNEL_INVALID');
        assert.equal(browser.badge.text, '?');
        assert.match(browser.badge.title, /チャンネル設定が不正/);
        assert.equal(fetchFn.calls.length, 0);
    }
});

test('channel messages validate values and sender and persist through restart', async () => {
    const { chrome, browser, fetchFn, deps } = setup();
    const { ready } = installNotifier(deps);
    await ready;
    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(
        chrome.runtime.onMessage.fire(
            { type: 'SET_CHANNEL_CONFIRMATION', confirmation: 'unsupported' },
            { id: 'other' },
            () => {},
        ),
        [false],
    );
    const send = (confirmation) =>
        new Promise((resolve) => {
            assert.deepEqual(
                chrome.runtime.onMessage.fire(
                    { type: 'SET_CHANNEL_CONFIRMATION', confirmation },
                    { id: chrome.runtime.id },
                    resolve,
                ),
                [true],
            );
        });
    assert.deepEqual(await send('invalid'), { ok: false });
    assert.deepEqual(await send('unknown'), { ok: false });
    assert.deepEqual(await send('extended'), { ok: false });
    assert.equal('channelConfirmation' in browser.storage, false);
    const response = await send('unsupported');
    assert.equal(response.ok, true);
    assert.equal(response.attempt.status, 'UNSUPPORTED');
    assert.equal(response.attempt.reason, 'CHANNEL');
    await installNotifier(deps).ready;
    assert.equal(browser.storage.channelConfirmation, 'unsupported');
    assert.equal(browser.badge.text, '');
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('an OUTDATED result opens the update page once per reference version', async () => {
    const { browser, fetchFn, deps } = setup();
    const notifier = createNotifier(deps);
    await notifier.check();
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
    assert.equal(
        browser.storage.autoOpenedKey,
        'outdated:mac_arm64:155.0.8059.40',
    );
    await notifier.check();
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
    fetchFn.respond = jsonResponse(releases(['156.0.8078.12', 1]));
    await notifier.check();
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL, UPDATE_PAGE_URL]);
    assert.equal(
        browser.storage.autoOpenedKey,
        'outdated:mac_arm64:156.0.8078.12',
    );
});

test('a failed update page is not stored as opened and is retried without notifying again', async () => {
    const { chrome, browser, deps } = setup();
    chrome.failTabs = true;
    const notifier = createNotifier(deps);
    await notifier.check();
    assert.deepEqual(browser.tabs, []);
    assert.equal(browser.storage.autoOpenedKey, undefined);
    assert.equal(
        browser.storage.notifiedKey,
        'outdated:mac_arm64:155.0.8059.40',
    );
    chrome.failTabs = false;
    await notifier.check();
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
    assert.equal(browser.calls.notificationsCreate, 1);
});

test('a version notified before this feature still opens the page once', async () => {
    const browser = createBrowserState();
    browser.storage.notifiedKey = 'outdated:mac_arm64:155.0.8059.40';
    const { deps } = setup({ browser });
    await createNotifier(deps).check();
    assert.equal(browser.calls.notificationsCreate, 0);
    assert.deepEqual(browser.tabs, [UPDATE_PAGE_URL]);
});

test('up-to-date, failed and unsupported checks never open the update page', async () => {
    const upToDate = setup({ local: '155.0.8059.40' });
    await createNotifier(upToDate.deps).check();
    const failed = setup({ respond: new TypeError('offline') });
    await createNotifier(failed.deps).check();
    const optedOut = setup({
        browser: createBrowserState({ channelConfirmation: 'unsupported' }),
    });
    await createNotifier(optedOut.deps).check();
    for (const { browser } of [upToDate, failed, optedOut]) {
        assert.deepEqual(browser.tabs, []);
        assert.equal(browser.storage.autoOpenedKey, undefined);
    }
});

test('restoring the display after a restart does not open the update page again', async () => {
    const first = setup();
    await installNotifier(first.deps).ready;
    assert.deepEqual(first.browser.tabs, [UPDATE_PAGE_URL]);
    const second = setup({
        browser: first.browser,
        clockAt: new Date(start.getTime() + HOUR),
    });
    await installNotifier(second.deps).ready;
    assert.deepEqual(first.browser.tabs, [UPDATE_PAGE_URL]);
});
