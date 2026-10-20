import { compareVersions, parseVersion } from './version-compare.mjs';
import { CheckError, fetchReferenceRelease } from './reference-release.mjs';
import {
    getLocalChromeVersion,
    normalizeChannel,
    resolveChannel,
    resolvePlatform,
} from './environment.mjs';

// One check: resolve the environment, read the local version, then fetch the
// reference. It neither stores nor notifies. The local version is read before
// fetching so that a failed fetch still reports it.
export async function runCheck({
    fetchFn,
    nav,
    platformInfo,
    channelConfirmation,
    now = new Date(),
    timeoutMs,
}) {
    const result = {
        status: 'ERROR',
        platform: null,
        local: null,
        reference: null,
        errorKind: null,
        at: now.toISOString(),
        channelConfirmation: normalizeChannel(channelConfirmation),
    };
    try {
        const platform = resolvePlatform(platformInfo);
        if (platform.status !== 'OK') {
            return {
                ...result,
                status: platform.status,
                errorKind: platform.errorKind ?? null,
            };
        }
        result.platform = platform.platform;

        const local = await getLocalChromeVersion(nav);
        if (local.status !== 'OK') {
            return {
                ...result,
                status: local.status,
                errorKind: local.errorKind ?? null,
            };
        }
        result.local = local.version;

        const channel = resolveChannel(channelConfirmation);
        if (channel.status !== 'OK') {
            return {
                ...result,
                status: channel.status,
                reason: channel.reason,
            };
        }

        const reference = await fetchReferenceRelease({
            fetchFn,
            platform: result.platform,
            timeoutMs,
        });
        if (reference === null) return { ...result, status: 'NO_REFERENCE' };
        result.reference = reference;

        const order = compareVersions(
            parseVersion(result.local),
            parseVersion(reference),
        );
        return { ...result, status: order < 0 ? 'OUTDATED' : 'UP_TO_DATE' };
    } catch (error) {
        return {
            ...result,
            status: 'ERROR',
            errorKind: error instanceof CheckError ? error.kind : 'UNEXPECTED',
        };
    }
}
