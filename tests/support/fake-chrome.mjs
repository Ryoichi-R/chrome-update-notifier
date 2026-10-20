// In-memory stand-ins for the chrome.* APIs used by the extension. Storage,
// alarms and the badge survive a simulated worker restart when the same
// "browser" state object is passed to a new fake.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
    readFileSync(
        new URL('../../extension/manifest.json', import.meta.url),
        'utf8',
    ),
);

function createEvent() {
    const listeners = [];
    return {
        addListener: (fn) => listeners.push(fn),
        listeners,
        fire: (...args) => listeners.map((fn) => fn(...args)),
    };
}

// Without a channel setting the extension uses its default (stable).
export function createBrowserState({ channelConfirmation } = {}) {
    return {
        storage:
            channelConfirmation === undefined ? {} : { channelConfirmation },
        alarms: new Map(),
        badge: { text: '', color: null, title: '' },
        notifications: [],
        tabs: [],
        calls: { alarmsCreate: 0, notificationsCreate: 0 },
    };
}

export function createFakeChrome({
    browser = createBrowserState(),
    platformInfo = { os: 'mac', arch: 'arm64' },
    failNotifications = false,
    failTabs = false,
} = {}) {
    const clone = (value) =>
        value === undefined ? undefined : structuredClone(value);
    const fake = {
        browser,
        failNotifications,
        failTabs,
        runtime: {
            id: 'fake-extension-id',
            getManifest: () => clone(manifest),
            getPlatformInfo: async () => clone(platformInfo),
            onInstalled: createEvent(),
            onStartup: createEvent(),
            onMessage: createEvent(),
        },
        storage: {
            local: {
                async get(keys) {
                    const list = typeof keys === 'string' ? [keys] : keys;
                    return Object.fromEntries(
                        list
                            .filter((key) => key in browser.storage)
                            .map((key) => [key, clone(browser.storage[key])]),
                    );
                },
                async set(values) {
                    const changes = Object.fromEntries(
                        Object.entries(values).map(([key, value]) => [
                            key,
                            {
                                oldValue: clone(browser.storage[key]),
                                newValue: clone(value),
                            },
                        ]),
                    );
                    Object.assign(browser.storage, clone(values));
                    fake.storage.onChanged.fire(changes, 'local');
                },
            },
            onChanged: createEvent(),
        },
        alarms: {
            async get(name) {
                return clone(browser.alarms.get(name));
            },
            async create(name, info) {
                browser.calls.alarmsCreate++;
                browser.alarms.set(name, { name, ...info });
            },
            onAlarm: createEvent(),
        },
        action: {
            async setBadgeText({ text }) {
                browser.badge.text = text;
            },
            async setBadgeBackgroundColor({ color }) {
                browser.badge.color = color;
            },
            async setTitle({ title }) {
                browser.badge.title = title;
            },
        },
        notifications: {
            create(id, options, callback) {
                browser.calls.notificationsCreate++;
                queueMicrotask(() => {
                    if (fake.failNotifications) {
                        fake.runtime.lastError = {
                            message: 'notifications disabled',
                        };
                        try {
                            callback(undefined);
                        } finally {
                            delete fake.runtime.lastError;
                        }
                        return;
                    }
                    browser.notifications = browser.notifications.filter(
                        (item) => item.id !== id,
                    );
                    browser.notifications.push({ id, ...options });
                    callback(id);
                });
            },
            clear(id, callback) {
                const existed = browser.notifications.some(
                    (item) => item.id === id,
                );
                browser.notifications = browser.notifications.filter(
                    (item) => item.id !== id,
                );
                queueMicrotask(() => callback(existed));
            },
            onClicked: createEvent(),
        },
        tabs: {
            async create({ url }) {
                if (fake.failTabs) throw new Error('tab creation failed');
                browser.tabs.push(url);
                return { id: browser.tabs.length };
            },
        },
    };
    return fake;
}

export function fakeNavigator(fullVersionList) {
    return {
        userAgentData: {
            async getHighEntropyValues(hints) {
                return hints.includes('fullVersionList')
                    ? { fullVersionList: structuredClone(fullVersionList) }
                    : {};
            },
        },
    };
}

export function chromeNavigator(version) {
    return fakeNavigator([
        { brand: 'Chromium', version },
        { brand: 'Google Chrome', version },
        { brand: 'Not A(Brand', version: '99.0.0.0' },
    ]);
}

export function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
            typeof body === 'string' ? body : JSON.stringify(body),
    };
}

// A fetch whose responses can be switched between calls; it counts requests.
export function createFakeFetch(initial) {
    const fetchFn = async (url, init) => {
        fetchFn.calls.push(url);
        const next = fetchFn.respond;
        if (fetchFn.gate) await fetchFn.gate;
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next(url, init) : next;
    };
    fetchFn.calls = [];
    fetchFn.respond = initial;
    fetchFn.gate = null;
    return fetchFn;
}

export function releases(...entries) {
    return {
        releases: entries.map(([version, fraction]) => ({ version, fraction })),
        nextPageToken: '',
    };
}
