import { describeState } from './display-state.mjs';
import { normalizeChannel } from './environment.mjs';
import { appInfoRows, appInfoText } from './app-info.mjs';
import { BUILD_INFO } from './build-info.mjs';

const formatTime = (iso) => new Date(iso).toLocaleString('ja-JP');
const byId = (id) => document.getElementById(id);

// The channel select shows the stored setting only on the first render and
// when the setting itself changes, so a background check finishing while the
// popup is open does not discard a selection that is not saved yet.
let shownChannel = null;
let infoRows = null;

async function renderAppInfo() {
    let platformInfo;
    try {
        platformInfo = await chrome.runtime.getPlatformInfo();
    } catch {
        // Version/build information is still available if the platform fails.
    }
    infoRows = appInfoRows(
        chrome.runtime.getManifest(),
        BUILD_INFO,
        platformInfo,
    );
    const ids = [
        'app-name',
        'app-version',
        'source-commit',
        'source-dirty',
        'built-at',
        'runtime-platform',
    ];
    infoRows.forEach(([, value], index) => {
        byId(ids[index]).textContent = value;
    });
    byId('copy-info').disabled = false;
}

byId('copy-info').addEventListener('click', async () => {
    if (!infoRows) return;
    try {
        await navigator.clipboard.writeText(appInfoText(infoRows));
        byId('copy-status').textContent = 'コピーしました。';
    } catch {
        byId('copy-status').textContent =
            'コピーできませんでした。もう一度お試しください。';
    }
});

async function render() {
    const { lastAttempt, lastSuccess, channelConfirmation } =
        await chrome.storage.local.get([
            'lastAttempt',
            'lastSuccess',
            'channelConfirmation',
        ]);
    const view = describeState({
        lastAttempt,
        lastSuccess,
        now: new Date(),
        formatTime,
    });
    byId('summary').textContent = view.summary;
    byId('summary').classList.toggle('outdated', view.outdated);
    byId('local').textContent = view.local;
    byId('reference').textContent = view.reference;
    byId('last-success').textContent = view.lastSuccessAt;
    byId('last-attempt').textContent = view.lastAttempt;
    const channel = normalizeChannel(channelConfirmation);
    if (channel !== shownChannel) {
        byId('channel').value = channel;
        shownChannel = channel;
    }
}

// The check runs in the background worker, so closing the popup does not
// cancel it; the stored result is shown on the next open.
async function requestCheck(button, message) {
    button.disabled = true;
    byId('summary').textContent = '確認中…';
    try {
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.ok) throw new Error('check request failed');
    } catch (error) {
        console.warn('check request failed', error);
        await render();
        byId('summary').textContent =
            '確認を開始できませんでした。もう一度お試しください。';
        return;
    } finally {
        button.disabled = false;
    }
    await render();
}

byId('check-now').addEventListener('click', () => {
    requestCheck(byId('check-now'), { type: 'CHECK_NOW' });
});

byId('save-channel').addEventListener('click', () => {
    requestCheck(byId('save-channel'), {
        type: 'SET_CHANNEL_CONFIRMATION',
        confirmation: byId('channel').value,
    });
});

byId('open-update').addEventListener('click', async () => {
    await chrome.tabs.create({ url: 'chrome://settings/help' });
    window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (
        area === 'local' &&
        (changes.lastAttempt ||
            changes.lastSuccess ||
            changes.channelConfirmation)
    )
        render();
});

render();
renderAppInfo();
