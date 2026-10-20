import { compareVersions, parseVersion } from './version-compare.mjs';

export const STALE_OUTDATED_MS = 7 * 24 * 60 * 60 * 1000;
export const BADGE_RED = '#d93025';
export const BADGE_GRAY = '#5f6368';

const NO_BADGE = Object.freeze({ text: '', color: null });
const RED_BADGE = Object.freeze({ text: '!', color: BADGE_RED });
const GRAY_BADGE = Object.freeze({ text: '?', color: BADGE_GRAY });

export const ERROR_LABELS = Object.freeze({
    NETWORK: '通信に失敗しました',
    HTTP: 'サーバーがエラーを返しました',
    MALFORMED: '応答の形式が想定と異なります',
    TIMEOUT: '時間内に応答がありませんでした',
    LOCAL_VERSION: 'このChromeのバージョンを取得できませんでした',
    PLATFORM_INFO: '動作環境を取得できませんでした',
    UNEXPECTED: '予期しないエラーが発生しました',
});

export function notificationKey(platform, reference) {
    return `outdated:${platform}:${reference}`;
}

export function errorLabel(errorKind) {
    return ERROR_LABELS[errorKind] ?? ERROR_LABELS.UNEXPECTED;
}

// An UNSUPPORTED result compared nothing, so the popup says why instead of
// calling it a success.
export function unsupportedLabel(reason) {
    if (reason === 'CHANNEL') return '対象外のため比較していません';
    if (reason === 'CHANNEL_INVALID') {
        return 'チャンネル設定が不正なため比較していません';
    }
    return '対象外の環境のため比較していません';
}

function successDisplay(result) {
    switch (result.status) {
        case 'OUTDATED':
            return {
                badge: RED_BADGE,
                title: `Chrome ${result.local} は比較基準版 ${result.reference} より古いため、更新画面で確認してください`,
            };
        case 'UP_TO_DATE':
            return {
                badge: NO_BADGE,
                title: `Chrome ${result.local} は比較基準版 ${result.reference} 以上です`,
            };
        case 'NO_REFERENCE':
            return {
                badge: GRAY_BADGE,
                title: '比較基準版が見つかりませんでした',
            };
        default:
            if (result.reason === 'CHANNEL') {
                return {
                    badge: NO_BADGE,
                    title: '対象外（延長安定版・Beta・Dev・Canary）として設定されています（比較と通知をしません）',
                };
            }
            if (result.reason === 'CHANNEL_INVALID') {
                // A broken setting must not leave the extension silently idle.
                return {
                    badge: GRAY_BADGE,
                    title: 'チャンネル設定が不正です。ポップアップで選び直してください',
                };
            }
            return {
                badge: NO_BADGE,
                title: '対象外の環境です（Mac・Windows の Google Chrome 安定版だけに対応）',
            };
    }
}

// A failed check keeps a known "outdated" result only while it still applies:
// the last success was OUTDATED, the local version has not changed, and it is
// no older than seven days. A changed local version is compared again with
// the last known reference without network access.
function errorDisplay(attempt, lastSuccess, now) {
    const failed = `確認に失敗しました（${errorLabel(attempt.errorKind)}）`;
    const local = parseVersion(attempt.local);
    if (lastSuccess?.status === 'OUTDATED' && local) {
        if (attempt.local === lastSuccess.local) {
            const age = now.getTime() - Date.parse(lastSuccess.at);
            if (age >= 0 && age <= STALE_OUTDATED_MS) {
                return {
                    badge: RED_BADGE,
                    title: '前回の確認では更新対象（今回は確認失敗）',
                };
            }
        } else {
            const reference = parseVersion(lastSuccess.reference);
            if (reference && compareVersions(local, reference) >= 0) {
                return {
                    badge: NO_BADGE,
                    title: `Chrome ${attempt.local} は前回の比較基準版 ${lastSuccess.reference} 以上です（今回は確認失敗）`,
                };
            }
        }
    }
    return { badge: GRAY_BADGE, title: failed };
}

// Decides badge, title, notification, opening the update page and the values
// to store for one result. notification and autoOpen are null unless the
// result is OUTDATED for a reference that has not been notified or opened
// yet. They are tracked separately so that one failing does not suppress or
// repeat the other; the caller stores each key only after its action worked.
export function decideDisplay({
    attempt,
    lastSuccess = null,
    notifiedKey = null,
    autoOpenedKey = null,
    now = new Date(),
}) {
    if (attempt.status === 'ERROR') {
        return {
            ...errorDisplay(attempt, lastSuccess, now),
            notification: null,
            autoOpen: null,
            lastAttempt: attempt,
            lastSuccess: lastSuccess ?? null,
        };
    }
    let notification = null;
    let autoOpen = null;
    if (attempt.status === 'OUTDATED') {
        const key = notificationKey(attempt.platform, attempt.reference);
        if (key !== autoOpenedKey) autoOpen = { key };
        if (key !== notifiedKey) {
            notification = {
                id: key,
                key,
                title: 'Chrome の更新を確認してください',
                message:
                    `このChrome（${attempt.local}）は比較基準版 ${attempt.reference} より古いため、更新画面で確認してください。` +
                    '更新済みでも再起動が必要な場合があります。',
            };
        }
    }
    // lastSuccess is the last finished comparison. An UNSUPPORTED result
    // compared nothing and keeps the earlier one.
    return {
        ...successDisplay(attempt),
        notification,
        autoOpen,
        lastAttempt: attempt,
        lastSuccess:
            attempt.status === 'UNSUPPORTED' ? (lastSuccess ?? null) : attempt,
    };
}

// Text for the popup. formatTime turns an ISO string into display text.
export function describeState({
    lastAttempt = null,
    lastSuccess = null,
    now = new Date(),
    formatTime,
}) {
    const format = (iso) => (iso ? formatTime(iso) : '未記録');
    const unsupported = lastAttempt?.status === 'UNSUPPORTED';
    const attemptText = !lastAttempt
        ? '未確認'
        : lastAttempt.status === 'ERROR'
          ? `${format(lastAttempt.at)} 失敗: ${errorLabel(lastAttempt.errorKind)}`
          : unsupported
            ? `${format(lastAttempt.at)} ${unsupportedLabel(lastAttempt.reason)}`
            : `${format(lastAttempt.at)} 成功`;
    const summary = lastAttempt
        ? decideDisplay({
              attempt: lastAttempt,
              lastSuccess,
              notifiedKey: null,
              now,
          })
        : { badge: NO_BADGE, title: 'まだ確認していません' };
    return {
        summary: summary.title,
        outdated: summary.badge.text === '!',
        local: lastAttempt?.local ?? lastSuccess?.local ?? '不明',
        reference: unsupported
            ? '比較していません'
            : (lastSuccess?.reference ?? '不明'),
        lastSuccessAt: format(lastSuccess?.at),
        lastAttempt: attemptText,
    };
}
