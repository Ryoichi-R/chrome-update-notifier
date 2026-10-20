import { parseVersion } from './version-compare.mjs';

const LOCAL_VERSION_ERROR = Object.freeze({
    status: 'ERROR',
    errorKind: 'LOCAL_VERSION',
});

export const CHANNEL_SETTINGS = Object.freeze(['stable', 'unsupported']);

// UA brands identify the product, not its release channel, so the channel is
// a local setting. Checks are on by default: Beta, Dev and Canary are normally
// newer than the fully served stable release, and their users opt out with
// "unsupported". Extended Stable lags behind stable and is not supported, so
// its users opt out too. A missing setting, or "unknown" left by the earlier
// confirm-first version, means the default. Any other value, such as
// "extended" saved by the unreleased 0.2.0, is invalid and fails closed.
export function normalizeChannel(setting) {
    if (setting === undefined || setting === null || setting === 'unknown') {
        return 'stable';
    }
    return setting;
}

// Values other than the known settings fail closed.
export function resolveChannel(setting) {
    const channel = normalizeChannel(setting);
    if (channel === 'stable') return { status: 'OK' };
    return {
        status: 'UNSUPPORTED',
        reason: channel === 'unsupported' ? 'CHANNEL' : 'CHANNEL_INVALID',
    };
}

// Only the "Google Chrome" brand qualifies. Edge and other Chromium browsers
// also report "Chromium", so falling back to it would compare the wrong product.
export async function getLocalChromeVersion(nav) {
    const uaData = nav?.userAgentData;
    if (!uaData || typeof uaData.getHighEntropyValues !== 'function') {
        return LOCAL_VERSION_ERROR;
    }
    let values;
    try {
        values = await uaData.getHighEntropyValues(['fullVersionList']);
    } catch {
        return LOCAL_VERSION_ERROR;
    }
    const list = values?.fullVersionList;
    if (!Array.isArray(list)) return LOCAL_VERSION_ERROR;
    const entry = list.find((item) => item?.brand === 'Google Chrome');
    if (!entry) return { status: 'UNSUPPORTED', reason: 'BROWSER' };
    if (!parseVersion(entry.version)) return LOCAL_VERSION_ERROR;
    return { status: 'OK', version: entry.version };
}

// VersionHistory platform names by getPlatformInfo() os and arch. The arch is
// that of the Chrome build, so an Intel build under Rosetta reports x86-64 and
// is served by "mac", and a 32-bit build on 64-bit Windows is served by "win".
const PLATFORMS = Object.freeze({
    mac: Object.freeze({ arm64: 'mac_arm64', 'x86-64': 'mac' }),
    win: Object.freeze({
        arm64: 'win_arm64',
        'x86-64': 'win64',
        'x86-32': 'win',
    }),
});

// Maps chrome.runtime.getPlatformInfo() to a VersionHistory platform name.
export function resolvePlatform(platformInfo) {
    if (!platformInfo || typeof platformInfo !== 'object') {
        return { status: 'ERROR', errorKind: 'PLATFORM_INFO' };
    }
    if (!Object.hasOwn(PLATFORMS, platformInfo.os))
        return { status: 'UNSUPPORTED', reason: 'OS' };
    const byArch = PLATFORMS[platformInfo.os];
    if (!Object.hasOwn(byArch, platformInfo.arch))
        return { status: 'UNSUPPORTED', reason: 'ARCH' };
    return { status: 'OK', platform: byArch[platformInfo.arch] };
}
