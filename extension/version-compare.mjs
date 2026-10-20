// Chrome version strings are exactly four dot-separated non-negative integers.
const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

export function parseVersion(str) {
    if (typeof str !== 'string' || !VERSION_PATTERN.test(str)) return null;
    const parts = str.split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
}

// Compares two parsed versions. Callers validate with parseVersion first.
export function compareVersions(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
        throw new TypeError('INVALID_VERSION');
    }
    for (let i = 0; i < 4; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}
