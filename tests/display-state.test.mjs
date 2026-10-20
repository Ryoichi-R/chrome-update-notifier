import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BADGE_GRAY,
    BADGE_RED,
    decideDisplay,
    describeState,
    notificationKey,
} from '../extension/display-state.mjs';

const now = new Date('2026-10-08T14:00:00.000Z');
const daysAgo = (days) =>
    new Date(now.getTime() - days * 86400000).toISOString();
const result = (status, extra = {}) => ({
    status,
    platform: 'mac_arm64',
    local: '154.0.8037.98',
    reference: '155.0.8059.40',
    errorKind: null,
    at: now.toISOString(),
    ...extra,
});
const outdated = result('OUTDATED');
const failure = (extra = {}) =>
    result('ERROR', { reference: null, errorKind: 'NETWORK', ...extra });

test('each status maps to its badge', () => {
    const cases = [
        [outdated, '!', BADGE_RED],
        [result('UP_TO_DATE', { local: '155.0.8059.40' }), '', null],
        [result('NO_REFERENCE', { reference: null }), '?', BADGE_GRAY],
        [
            result('UNSUPPORTED', {
                platform: null,
                local: null,
                reference: null,
            }),
            '',
            null,
        ],
        [failure(), '?', BADGE_GRAY],
    ];
    for (const [attempt, text, color] of cases) {
        const decision = decideDisplay({ attempt, now });
        assert.deepEqual(decision.badge, { text, color }, attempt.status);
        assert.equal(typeof decision.title, 'string');
    }
});

test('OUTDATED notifies once per reference with a fixed id', () => {
    const first = decideDisplay({ attempt: outdated, now });
    const key = notificationKey('mac_arm64', '155.0.8059.40');
    assert.equal(key, 'outdated:mac_arm64:155.0.8059.40');
    assert.equal(first.notification.id, key);
    assert.equal(first.notification.key, key);
    assert.match(first.notification.message, /再起動が必要な場合があります/);
    assert.match(first.title, /比較基準版 155\.0\.8059\.40 より古い/);
    assert.equal(
        decideDisplay({ attempt: outdated, notifiedKey: key, now })
            .notification,
        null,
    );
    const newer = decideDisplay({
        attempt: { ...outdated, reference: '156.0.8078.12' },
        notifiedKey: key,
        now,
    });
    assert.equal(newer.notification.id, 'outdated:mac_arm64:156.0.8078.12');
});

test('OUTDATED opens the update page once per reference, apart from the notification', () => {
    const key = notificationKey('mac_arm64', '155.0.8059.40');
    assert.deepEqual(decideDisplay({ attempt: outdated, now }).autoOpen, {
        key,
    });
    const notified = decideDisplay({
        attempt: outdated,
        notifiedKey: key,
        now,
    });
    assert.equal(notified.notification, null);
    assert.deepEqual(notified.autoOpen, { key });
    const opened = decideDisplay({
        attempt: outdated,
        autoOpenedKey: key,
        now,
    });
    assert.equal(opened.autoOpen, null);
    assert.equal(opened.notification.key, key);
    assert.deepEqual(
        decideDisplay({
            attempt: { ...outdated, reference: '156.0.8078.12' },
            autoOpenedKey: key,
            now,
        }).autoOpen,
        { key: 'outdated:mac_arm64:156.0.8078.12' },
    );
});

test('only OUTDATED opens the update page', () => {
    const lastSuccess = { ...outdated, at: daysAgo(1) };
    for (const attempt of [
        result('UP_TO_DATE'),
        result('NO_REFERENCE'),
        result('UNSUPPORTED'),
        failure(),
    ]) {
        assert.equal(
            decideDisplay({ attempt, lastSuccess, now }).autoOpen,
            null,
            attempt.status,
        );
    }
});

test('only OUTDATED notifies', () => {
    for (const attempt of [
        result('UP_TO_DATE'),
        result('NO_REFERENCE'),
        result('UNSUPPORTED'),
        failure(),
    ]) {
        assert.equal(
            decideDisplay({ attempt, lastSuccess: outdated, now }).notification,
            null,
            attempt.status,
        );
    }
});

test('a comparison replaces lastSuccess, an unsupported result or a failure keeps it', () => {
    const up = result('UP_TO_DATE', { local: '155.0.8059.40' });
    assert.equal(
        decideDisplay({ attempt: up, lastSuccess: outdated, now }).lastSuccess,
        up,
    );
    const noReference = result('NO_REFERENCE', { reference: null });
    assert.equal(
        decideDisplay({ attempt: noReference, lastSuccess: outdated, now })
            .lastSuccess,
        noReference,
    );
    for (const reason of ['CHANNEL', 'CHANNEL_INVALID', 'OS']) {
        const unsupported = result('UNSUPPORTED', { reference: null, reason });
        const kept = decideDisplay({
            attempt: unsupported,
            lastSuccess: outdated,
            now,
        });
        assert.equal(kept.lastSuccess, outdated, reason);
        assert.equal(kept.lastAttempt, unsupported, reason);
        assert.equal(
            decideDisplay({ attempt: unsupported, now }).lastSuccess,
            null,
            reason,
        );
    }
    const failed = failure();
    const decision = decideDisplay({
        attempt: failed,
        lastSuccess: outdated,
        now,
    });
    assert.equal(decision.lastSuccess, outdated);
    assert.equal(decision.lastAttempt, failed);
    assert.equal(decideDisplay({ attempt: failed, now }).lastSuccess, null);
});

test('a failure keeps the red badge for the same local version within seven days', () => {
    const recent = { ...outdated, at: daysAgo(7) };
    const kept = decideDisplay({
        attempt: failure(),
        lastSuccess: recent,
        now,
    });
    assert.equal(kept.badge.text, '!');
    assert.equal(kept.title, '前回の確認では更新対象（今回は確認失敗）');
    const expired = {
        ...outdated,
        at: new Date(now.getTime() - 7 * 86400000 - 1).toISOString(),
    };
    assert.equal(
        decideDisplay({ attempt: failure(), lastSuccess: expired, now }).badge
            .text,
        '?',
    );
    const future = { ...outdated, at: daysAgo(-1) };
    assert.equal(
        decideDisplay({ attempt: failure(), lastSuccess: future, now }).badge
            .text,
        '?',
    );
});

test('a failure without a known outdated result is gray', () => {
    assert.equal(
        decideDisplay({
            attempt: failure(),
            lastSuccess: result('UP_TO_DATE'),
            now,
        }).badge.text,
        '?',
    );
    assert.equal(
        decideDisplay({
            attempt: failure({ local: null, errorKind: 'LOCAL_VERSION' }),
            lastSuccess: outdated,
            now,
        }).badge.text,
        '?',
    );
});

test('a changed local version is compared with the last reference offline', () => {
    const updated = decideDisplay({
        attempt: failure({ local: '155.0.8059.40' }),
        lastSuccess: outdated,
        now,
    });
    assert.equal(updated.badge.text, '');
    assert.match(updated.title, /前回の比較基準版 155\.0\.8059\.40 以上/);
    const stillOlder = decideDisplay({
        attempt: failure({ local: '154.0.8037.100' }),
        lastSuccess: outdated,
        now,
    });
    assert.equal(stillOlder.badge.text, '?');
    const old = { ...outdated, at: daysAgo(30) };
    assert.equal(
        decideDisplay({
            attempt: failure({ local: '156.0.0.1' }),
            lastSuccess: old,
            now,
        }).badge.text,
        '',
    );
});

test('describeState separates the last success from the last attempt', () => {
    const formatTime = (iso) => `T(${iso})`;
    const view = describeState({
        lastAttempt: failure(),
        lastSuccess: { ...outdated, at: daysAgo(1) },
        now,
        formatTime,
    });
    assert.equal(view.summary, '前回の確認では更新対象（今回は確認失敗）');
    assert.equal(view.outdated, true);
    assert.equal(view.local, '154.0.8037.98');
    assert.equal(view.reference, '155.0.8059.40');
    assert.equal(view.lastSuccessAt, `T(${daysAgo(1)})`);
    assert.equal(
        view.lastAttempt,
        `T(${now.toISOString()}) 失敗: 通信に失敗しました`,
    );
    const empty = describeState({ now, formatTime });
    assert.deepEqual(empty, {
        summary: 'まだ確認していません',
        outdated: false,
        local: '不明',
        reference: '不明',
        lastSuccessAt: '未記録',
        lastAttempt: '未確認',
    });
    const up = result('UP_TO_DATE', { local: '155.0.8059.40' });
    assert.equal(
        describeState({ lastAttempt: up, lastSuccess: up, now, formatTime })
            .lastAttempt,
        `T(${now.toISOString()}) 成功`,
    );
});

test('describeState does not call an unsupported result a success', () => {
    const formatTime = (iso) => `T(${iso})`;
    const lastSuccess = { ...result('UP_TO_DATE'), at: daysAgo(1) };
    const expected = {
        CHANNEL: '対象外のため比較していません',
        CHANNEL_INVALID: 'チャンネル設定が不正なため比較していません',
        BROWSER: '対象外の環境のため比較していません',
    };
    for (const [reason, label] of Object.entries(expected)) {
        const view = describeState({
            lastAttempt: result('UNSUPPORTED', { reference: null, reason }),
            lastSuccess,
            now,
            formatTime,
        });
        assert.equal(view.lastAttempt, `T(${now.toISOString()}) ${label}`);
        assert.equal(view.reference, '比較していません', reason);
        assert.equal(view.lastSuccessAt, `T(${daysAgo(1)})`, reason);
    }
    const never = describeState({
        lastAttempt: result('UNSUPPORTED', {
            reference: null,
            reason: 'CHANNEL',
        }),
        now,
        formatTime,
    });
    assert.equal(never.lastSuccessAt, '未記録');
});

test('channel opt-out shows no badge, an invalid setting shows gray', () => {
    const optedOut = decideDisplay({
        attempt: result('UNSUPPORTED', { reference: null, reason: 'CHANNEL' }),
        now,
    });
    assert.deepEqual(optedOut.badge, { text: '', color: null });
    assert.match(optedOut.title, /延長安定版・Beta・Dev・Canary/);
    assert.equal(optedOut.notification, null);
    const invalid = decideDisplay({
        attempt: result('UNSUPPORTED', {
            reference: null,
            reason: 'CHANNEL_INVALID',
        }),
        now,
    });
    assert.deepEqual(invalid.badge, { text: '?', color: BADGE_GRAY });
    assert.match(invalid.title, /チャンネル設定が不正/);
    assert.equal(invalid.notification, null);
});
