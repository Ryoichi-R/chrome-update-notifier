import { compareVersions, parseVersion } from './version-compare.mjs';

export const SUPPORTED_PLATFORMS = Object.freeze([
    'mac',
    'mac_arm64',
    'win',
    'win64',
    'win_arm64',
]);

export class CheckError extends Error {
    constructor(kind, detail) {
        super(detail ? `${kind}: ${detail}` : kind);
        this.name = 'CheckError';
        this.kind = kind;
    }
}

export function releasesUrl(platform) {
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
        throw new TypeError('UNSUPPORTED_PLATFORM');
    }
    return (
        'https://versionhistory.googleapis.com/v1/chrome/platforms/' +
        `${platform}/channels/stable/versions/all/releases` +
        '?filter=endtime=none&order_by=version%20desc'
    );
}

// The reference is the highest serving version whose fraction is exactly the
// number 1. This API comparison baseline does not guarantee availability to
// every device. Partial-rollout records and malformed entries are ignored;
// null means no release qualifies.
export function selectReferenceRelease(json) {
    if (
        json === null ||
        typeof json !== 'object' ||
        !Array.isArray(json.releases)
    ) {
        throw new CheckError('MALFORMED', 'releases is not an array');
    }
    let best = null;
    for (const release of json.releases) {
        if (release === null || typeof release !== 'object') continue;
        const { fraction, version } = release;
        if (typeof fraction !== 'number' || fraction !== 1) continue;
        const parsed = parseVersion(version);
        if (!parsed) continue;
        if (!best || compareVersions(parsed, best.parsed) > 0) {
            best = { version, parsed };
        }
    }
    return best ? best.version : null;
}

// Resolves to the reference version string or null. Rejects with a CheckError
// whose kind is NETWORK, HTTP, MALFORMED or TIMEOUT.
export async function fetchReferenceRelease({
    fetchFn,
    platform,
    timeoutMs = 10000,
}) {
    const url = releasesUrl(platform);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new CheckError('TIMEOUT', `${timeoutMs}ms`));
            controller.abort();
        }, timeoutMs);
    });
    const request = (async () => {
        let response;
        try {
            response = await fetchFn(url, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'omit',
                signal: controller.signal,
            });
        } catch (error) {
            throw new CheckError('NETWORK', error?.message);
        }
        if (!response || !response.ok) {
            throw new CheckError('HTTP', String(response?.status));
        }
        let json;
        try {
            json = JSON.parse(await response.text());
        } catch {
            if (controller.signal.aborted) throw new CheckError('TIMEOUT');
            throw new CheckError('MALFORMED', 'not JSON');
        }
        return selectReferenceRelease(json);
    })();
    try {
        return await Promise.race([request, timeout]);
    } finally {
        clearTimeout(timer);
        // The losing promise must not surface as an unhandled rejection.
        request.catch(() => {});
    }
}
