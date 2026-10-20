import { runCheck } from './checker.mjs';
import { decideDisplay } from './display-state.mjs';
import {
    CHANNEL_SETTINGS,
    getLocalChromeVersion,
    normalizeChannel,
} from './environment.mjs';

export const ALARM_NAME = 'check';
export const CHECK_PERIOD_MINUTES = 360;
export const STARTUP_STALE_MS = 24 * 60 * 60 * 1000;
export const UPDATE_PAGE_URL = 'chrome://settings/help';
const STORAGE_KEYS = [
    'lastAttempt',
    'lastSuccess',
    'notifiedKey',
    'autoOpenedKey',
];

// Connects the pure check and display logic to the Chrome APIs. Every trigger
// (startup, alarm, "check now") shares the in-flight check, and one check runs
// fetch -> store -> badge -> notification -> update page in order, so a late
// result can never overwrite a newer one.
export function createNotifier({
    chrome,
    fetchFn,
    nav,
    clock = () => new Date(),
    timeoutMs,
}) {
    let inFlight = null;
    let operationTail = Promise.resolve();

    // Restoration and checks both write the badge. Queue the entire operation,
    // including its storage read, so restoration cannot paint an old snapshot
    // after a newer check. A failure must not prevent later operations.
    function serialize(operation) {
        const result = operationTail.then(operation);
        operationTail = result.catch(() => {});
        return result;
    }

    async function applyDisplay(decision) {
        await chrome.action.setBadgeText({ text: decision.badge.text });
        if (decision.badge.color) {
            await chrome.action.setBadgeBackgroundColor({
                color: decision.badge.color,
            });
        }
        await chrome.action.setTitle({
            title: `更新チェッカー\n${decision.title}`,
        });
    }

    async function notify(notification) {
        try {
            const options = {
                type: 'basic',
                iconUrl: 'icon.png',
                title: notification.title,
                message: notification.message,
                priority: 0,
            };
            // Promise support starts at Chrome 116. The callback form also
            // works on the declared minimum (106); lastError is valid only
            // inside this callback.
            await new Promise((resolve, reject) => {
                chrome.notifications.create(notification.id, options, (id) => {
                    const error = chrome.runtime.lastError;
                    if (error) reject(new Error(error.message));
                    else if (!id) reject(new Error('notification id missing'));
                    else resolve(id);
                });
            });
        } catch (error) {
            // Not stored as notified, so the next check tries again.
            console.warn('notification failed', error);
            return false;
        }
        await chrome.storage.local.set({ notifiedKey: notification.key });
        return true;
    }

    // Opens the update page once per reference version. Loading the page
    // makes Chrome check for an update and download it if available. Update
    // availability is decided by Chrome; relaunch remains a user action.
    async function autoOpenUpdatePage(autoOpen) {
        try {
            await openUpdatePage();
        } catch (error) {
            // Not stored as opened, so the next check tries again.
            console.warn('opening the update page failed', error);
            return false;
        }
        await chrome.storage.local.set({ autoOpenedKey: autoOpen.key });
        return true;
    }

    async function performCheck() {
        const { channelConfirmation } = await chrome.storage.local.get(
            'channelConfirmation',
        );
        let platformInfo = null;
        try {
            platformInfo = await chrome.runtime.getPlatformInfo();
        } catch {
            // runCheck reports a missing platform as PLATFORM_INFO.
        }
        const attempt = await runCheck({
            fetchFn,
            nav,
            platformInfo,
            channelConfirmation,
            now: clock(),
            timeoutMs,
        });
        const stored = await chrome.storage.local.get(STORAGE_KEYS);
        const decision = decideDisplay({
            attempt,
            lastSuccess: stored.lastSuccess ?? null,
            notifiedKey: stored.notifiedKey ?? null,
            autoOpenedKey: stored.autoOpenedKey ?? null,
            now: clock(),
        });
        await chrome.storage.local.set({
            lastAttempt: decision.lastAttempt,
            lastSuccess: decision.lastSuccess,
        });
        await applyDisplay(decision);
        if (decision.notification) await notify(decision.notification);
        if (decision.autoOpen) await autoOpenUpdatePage(decision.autoOpen);
        return decision.lastAttempt;
    }

    function check() {
        if (!inFlight) {
            inFlight = serialize(performCheck).finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    }

    // Shows the stored state again after the worker or the browser restarted.
    async function performRestore() {
        const stored = await chrome.storage.local.get(STORAGE_KEYS);
        if (!stored.lastAttempt) return;
        await applyDisplay(
            decideDisplay({
                attempt: stored.lastAttempt,
                lastSuccess: stored.lastSuccess ?? null,
                notifiedKey: stored.notifiedKey ?? null,
                now: clock(),
            }),
        );
    }

    function restoreDisplay() {
        return serialize(performRestore);
    }

    function setChannelConfirmation(confirmation) {
        if (!CHANNEL_SETTINGS.includes(confirmation)) {
            return Promise.reject(
                new TypeError('INVALID_CHANNEL_CONFIRMATION'),
            );
        }
        return serialize(async () => {
            await chrome.storage.local.set({
                channelConfirmation: confirmation,
            });
            return performCheck();
        });
    }

    // Recreating an existing alarm would push its next run back, so an alarm
    // is created only when it is missing (alarms can be lost on restart).
    async function ensureAlarm() {
        const existing = await chrome.alarms.get(ALARM_NAME);
        if (existing) return false;
        await chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: CHECK_PERIOD_MINUTES,
        });
        return true;
    }

    // Checks at once when the last success is missing or 24 hours old, when
    // the channel setting differs from the one of the last attempt, or when
    // the local version differs from the stored one (Chrome was updated and
    // relaunched), so a stale badge is not restored for hours.
    async function checkIfNeeded() {
        const { lastAttempt, lastSuccess, channelConfirmation } =
            await chrome.storage.local.get([
                'lastAttempt',
                'lastSuccess',
                'channelConfirmation',
            ]);
        const at = Date.parse(lastSuccess?.at);
        const fresh =
            Number.isFinite(at) && clock().getTime() - at < STARTUP_STALE_MS;
        const sameChannel =
            lastAttempt?.channelConfirmation ===
            normalizeChannel(channelConfirmation);
        if (fresh && sameChannel) {
            const local = await getLocalChromeVersion(nav);
            const known = lastAttempt?.local ?? lastSuccess?.local ?? null;
            if (local.status === 'OK' && local.version === known) return null;
        }
        return check();
    }

    async function startup() {
        await restoreDisplay();
        await ensureAlarm();
        return checkIfNeeded();
    }

    function openUpdatePage() {
        return chrome.tabs.create({ url: UPDATE_PAGE_URL });
    }

    return {
        check,
        restoreDisplay,
        ensureAlarm,
        checkIfNeeded,
        startup,
        openUpdatePage,
        setChannelConfirmation,
    };
}

// Registers the listeners synchronously, as a service worker requires, and
// runs the startup routine once per worker instance.
export function installNotifier(deps) {
    const { chrome } = deps;
    const notifier = createNotifier(deps);
    let started = null;
    const startOnce = () => {
        started ??= notifier
            .startup()
            .catch((error) => console.error('startup failed', error));
        return started;
    };

    chrome.runtime.onInstalled.addListener(startOnce);
    chrome.runtime.onStartup.addListener(startOnce);
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM_NAME)
            notifier
                .check()
                .catch((error) => console.error('check failed', error));
    });
    chrome.notifications.onClicked.addListener((notificationId) => {
        if (!notificationId.startsWith('outdated:')) return;
        notifier
            .openUpdatePage()
            .catch((error) => console.warn('update page failed', error));
        chrome.notifications.clear(notificationId, () => {
            const error = chrome.runtime.lastError;
            if (error) console.warn('notification clear failed', error.message);
        });
    });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (sender?.id !== chrome.runtime.id) return false;
        let operation;
        if (message?.type === 'CHECK_NOW') operation = notifier.check();
        else if (message?.type === 'SET_CHANNEL_CONFIRMATION')
            operation = notifier.setChannelConfirmation(message.confirmation);
        else return false;
        operation.then(
            (attempt) => sendResponse({ ok: true, attempt }),
            () => sendResponse({ ok: false }),
        );
        return true;
    });

    return { notifier, ready: startOnce() };
}
