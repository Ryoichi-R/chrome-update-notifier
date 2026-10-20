const UNKNOWN = '不明';
const OS_NAMES = Object.freeze({
    win: 'Windows',
    mac: 'macOS',
    linux: 'Linux',
    cros: 'ChromeOS',
    android: 'Android',
    openbsd: 'OpenBSD',
});
const ARCH_NAMES = Object.freeze({
    'x86-64': 'x64',
    'x86-32': 'x86',
    arm64: 'ARM64',
    arm: 'ARM',
    mips: 'MIPS',
    mips64: 'MIPS64',
    riscv64: 'RISC-V64',
});

// arch is Chrome's build architecture, not nacl_arch or the host CPU.
export function appInfoRows(manifest, buildInfo, platformInfo) {
    const builtAt = buildInfo?.builtAt;
    const validTime =
        typeof builtAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt) &&
        Number.isFinite(Date.parse(builtAt)) &&
        new Date(builtAt).toISOString() === builtAt;
    const source = buildInfo?.sourceCommit;
    const os = Object.hasOwn(OS_NAMES, platformInfo?.os)
        ? OS_NAMES[platformInfo.os]
        : UNKNOWN;
    const arch = Object.hasOwn(ARCH_NAMES, platformInfo?.arch)
        ? ARCH_NAMES[platformInfo.arch]
        : UNKNOWN;
    return [
        ['アプリ名', manifest.name],
        ['バージョン', manifest.version],
        ['ソース識別子', /^[0-9a-f]{7,40}$/.test(source) ? source : UNKNOWN],
        [
            '未コミット変更の有無',
            buildInfo?.dirty === true
                ? 'あり'
                : buildInfo?.dirty === false
                  ? 'なし'
                  : UNKNOWN,
        ],
        ['ビルド日時', validTime ? `${builtAt}（UTC）` : UNKNOWN],
        ['実行版', `${os}／${arch}`],
    ];
}

export function appInfoText(rows) {
    return rows.map(([label, value]) => `${label}: ${value}`).join('\n');
}
