# 更新チェッカー

## 概要

Google Chrome™向けの非公式拡張機能です。

このMac・WindowsのGoogle Chromeが、VersionHistory APIの条件に合う安定版（以下「比較基準版」）より古いときに、ツールバーのバッジと通知で知らせるChrome拡張機能（Manifest V3）です。古いと判定したときは、比較基準版ごとに1回だけ `chrome://settings/help`（Chromeについて）を自動で開きます。この画面でChrome自身が更新を確認し、利用可能な更新があればダウンロードします。更新の適用には利用者による再起動が必要です。通知またはポップアップからも、クリック1回で同じ画面を開けます。

この拡張機能は「比較基準版より古い」ことだけを知らせます。その端末で今すぐ更新を取得できるか、再起動待ちかどうかは判定できません。Chromeの更新・再起動も行いません。

## 動作要件

実行環境はMac・WindowsのGoogle Chrome 106以降（安定版）です。拡張機能を使うだけならNode.jsは不要です。

このリポジトリは単独でテスト・ビルドできます。以降のコマンドは、`README.md`・`build.mjs`・`extension/`・`tests/` があるリポジトリのルートで実行してください。親workspaceのスクリプトや設定は不要です。

拡張機能・単体テスト・配布ビルドにはNode.js v22以降の標準機能だけを使い、本番依存はありません。リポジトリ直下の `package.json` は不要です。公開前の必須lintには、`tests/lint/` の専用manifest/lockfileで固定した開発用ESLintを使います。lintのNode.js要件はv22.13以降またはv24以降です。

## インストール

ZIP配布物は[Releases](https://github.com/Ryoichi-R/chrome-update-notifier/releases)から入手し、展開して `chrome-update-notifier/manifest.json` があるフォルダを使います。Releaseにまだ配布物がない場合は、自分でビルドしてください。自分でビルドする場合は、下記「ビルド」で生成する `dist/chrome-update-notifier-<バージョン>-<UTC日時>/extension` を使います。ビルドごとにフォルダ名が変わるため、`dist/` 内のフォルダを直接読み込まず、各PCの固定の場所（例: `Documents/chrome-update-notifier`）へ `extension` の中身をコピーして、そのフォルダを読み込んでください（理由は「更新手順」を参照）。開発用の `extension/` を直接読み込む場合、バージョンは表示できますが、ソース識別子・未コミット変更・ビルド日時は未ビルドのため「不明」です。

1. Chromeで `chrome://extensions` を開き、右上の「デベロッパーモード」をオンにする。
2. 「パッケージ化されていない拡張機能を読み込む」で、上記の固定の場所にコピーしたフォルダを選ぶ。
3. 読み込み直後に1回確認する。ツールバーのパズルアイコンから固定すると、バッジが見えるようになる。
4. 延長安定版（Extended Stable）・Beta・Dev・Canaryで使う場合は、ポップアップの「このChromeの種類」で「対象外（延長安定版・Beta・Dev・Canary）」を選び、「設定を保存して確認」を押す。以後、比較用の外部通信と通知を行わない。

「このChromeの種類」の初期値は「安定版」です。設定はこのChromeプロファイル内に保存されます。安定版の確認を必須にしていた以前の版で「未確認」のままだった場合も、安定版として扱い、起動時にすぐ確認します。

通知が許可されていないと、通知は表示されません（バッジは表示されます）。macOSは「システム設定 → 通知」、Windowsは「設定 → システム → 通知」でGoogle Chromeの通知をオンにしてください。Windowsの応答不可（集中モード）中も通知は表示されません。

## 設定

ポップアップの「このChromeの種類」で「安定版」または「対象外」を選び、「設定を保存して確認」を押します。設定と最終試行・最終成功・通知済み・更新画面を開いた版の記録は、このChromeプロファイルの `chrome.storage.local` に保存します。他PCとの同期はしません。自動表示のON/OFF設定はありません。

## アンインストール

`chrome://extensions` のカードで「削除」を選びます。設定と通知等の記録も消えます。読み込み元のフォルダは別途残るため、必要ならバックアップしてください。更新時に設定を保つには削除せず、次の手順で同じ場所の内容を入れ替えます。

## 更新手順

新しい版に入れ替えるときは、最初に読み込んだフォルダをそのまま使います。

1. 読み込んだフォルダ（例: `Documents/chrome-update-notifier`）を、削除・移動・名前変更せず、その中身を新しい版のファイルで置き換える。
2. `chrome://extensions` でこの拡張機能の「再読み込み」（円形の矢印）を押す。
3. カードの版番号が新しい版になったことを確認する。

新しい版のファイルはビルド済み配布フォルダの `extension` から取得してください。0.1.x以前の手順で開発用リポジトリの `extension/` を直接読み込んでいる場合、そこへビルド結果をコピーするとソース（`build-info.mjs`）が書き換わるため、そのPCではビルドせず開発用フォルダのまま使う（ビルド情報は「不明」）か、古い版を削除して固定の場所から読み込み直してください（設定と記録は引き継がれません）。複数PCの比較には、ポップアップの「設定 → バージョン情報」で製品バージョン・ソース識別子・未コミット変更の有無・UTCビルド日時・実行版を確認し、「情報をコピー」を使用できます。リポジトリを分離しただけで読み込み済みフォルダの場所が変わらなければ、読み込み直しや別フォルダへの移動は不要です。

この拡張機能は「パッケージ化されていない拡張機能」なので、拡張機能のIDは読み込んだフォルダの場所で決まります。新しい版を別のフォルダへ展開して読み込むと、別の拡張機能として扱われ、次のことが起きます。

- 「このChromeの種類」の設定と、通知済み・更新画面を開いた版の記録が引き継がれない。そのため、同じ比較基準版で再び通知し、更新画面を開くことがある。
- 古い版が残ったまま、2つが同時に動く。

別のフォルダで読み込んでしまった場合は、古い版を `chrome://extensions` から削除し、新しい版で「このChromeの種類」を選び直してください。拡張機能を削除すると、保存された設定と記録も消えます。

## 使用方法

- 比較基準版: [Chrome VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/guide) の安定版チャンネルで、配信中（`endtime=none`）かつ `fraction` が数値の `1` の版のうち最大のもの。`fraction` が1未満のレコードは比較基準版の候補にしません。ただし、同時に別の配信groupで `fraction=1` の新しい版がある場合、段階配信中の旧版の利用者にも通知します。比較基準版は「全端末へ配信済み」や「この端末で今すぐ取得できる版」を保証するものではありません。
- 取得先: `chrome.runtime.getPlatformInfo()` の `os` と `arch` で決める。`arch` はChromeのビルドの種類を表す（Chromiumの実装からの推論。実機で確かめたのはMacとWindowsの `arm64` だけ）。
  - Mac: `arm64` なら `mac_arm64`、`x86-64`（Rosetta上のIntel版を含む）なら `mac`。
  - Windows: `x86-64` なら `win64`、`arm64` なら `win_arm64`、`x86-32`（32ビット版）なら `win`。
- 現在版: `navigator.userAgentData.getHighEntropyValues(['fullVersionList'])` の `Google Chrome` ブランドの版。
- 対象チャンネル: 安定版だけ。延長安定版・Beta・Dev・Canaryは利用者が「対象外」を選ぶ。Google Chromeブランドだけではチャンネルを識別できないため、自動判定はしません。延長安定版は、組織が管理するWindows・MacのChromeでポリシー（`TargetChannel`）により設定されるチャンネルで（[Google公式ヘルプ](https://support.google.com/chrome/a/answer/16942104)）、安定版より古い版が使われるため、「対象外」を選ばないと誤って「古い」と通知されます。Beta・Dev・Canaryは通常、安定版より新しいため、設定しなくても「古い」とは判定されない見込みです（推論。更新が止まった環境は除く）。

| 状態           | 条件                                                                                   | バッジ                   | 通知                |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------ | ------------------- |
| `OUTDATED`     | 現在版 < 比較基準版                                                                    | 赤 `!`                   | 比較基準版ごとに1回 |
| `UP_TO_DATE`   | 現在版 ≧ 比較基準版                                                                    | なし                     | なし                |
| `NO_REFERENCE` | 応答は正常だが、条件を満たす版がない                                                   | 灰 `?`                   | なし                |
| `UNSUPPORTED`  | Mac・Windows以外、Google Chrome以外（Edge・Chromium等）、対応外のCPU、「対象外」を選択 | なし                     | なし                |
| `ERROR`        | 通信失敗・HTTPエラー・応答形式の違い・タイムアウト（10秒）・現在版を取得できない       | 灰 `?`（下記の例外あり） | なし                |

- 保存されたチャンネル設定が不正な値の場合は、通信せず灰 `?` を表示します（ポップアップで選び直してください）。
- `UNSUPPORTED`（「対象外」の選択・不正な設定・対象外の環境）は比較をしていないため、ポップアップの「最終試行」には「対象外のため比較していません」等と表示し、「比較基準版」は「比較していません」とします。「最終成功」（最後に比較できた確認）は更新しません。
- 確認に失敗しても、前回の成功が `OUTDATED`、現在版が前回と同じ、前回の成功から7日以内なら赤 `!` を残します（「前回の確認では更新対象（今回は確認失敗）」）。
- 現在版が変わっていれば、通信できなくても前回の比較基準版と比べ直し、基準版以上ならバッジを消します。
- 確認のタイミング: インストール時・Chrome起動時（前回成功から24時間以上たっている場合、現在版が前回と変わった場合、チャンネル設定が前回の確認時と違う場合）・6時間おきのアラーム・ポップアップの「今すぐ確認」。定期確認はChromeが動いている間だけ行われるため、6時間はChrome稼働中の目安です。スリープ中や終了中は確認しません。
- 更新画面の自動表示: `OUTDATED` と判定したとき、通知の後に `chrome.tabs.create` で更新画面を前面のタブとして開きます。開けた場合だけ「開いた版」（`autoOpenedKey`）として保存し、同じ比較基準版では再び開きません。失敗した場合は次回の確認でもう一度開きます。通知済みの記録とは別に管理するため、どちらかが失敗しても、もう一方を繰り返したり抑止したりしません。起動時の表示復元や確認失敗（前回の結果で赤 `!` を残す場合を含む）では開きません。
- 表示の頻度: 比較基準版が変わり、動作中のChromeがその版より古い場合は、再び通知し、更新画面を前面に開きます。確認が6時間おきでも、同じ比較基準版で6時間ごとに開くわけではありません。更新を取得済みでも再起動するまでは動作中の版が古いため、新しい比較基準版への切替で再表示されることがあります。猶予期間・日数による頻度制限・自動表示のON/OFF設定はありません。参考として、2026-08-25〜10-06の配信履歴では基準版の切替が約6週間に10回ありました（実際の自動表示回数や将来の頻度を示す値ではありません）。
- 同時に複数の確認が要求されても、実行中の確認を共有し、取得と通知は1回にまとめます。通知は作成に成功した場合だけ「通知済み」として保存し、失敗した場合は次回もう一度通知します。
- 「通知済み」と「開いた版」は、最後に処理した比較基準版を1つだけ覚えます。そのため、比較基準版が新しい版へ変わった後に元の版へ戻った場合（Googleが配信を取り下げた場合等）は、元の版でもう一度通知し、更新画面を開きます。通知の作成や画面の表示に成功した直後に保存が失敗した場合も、次回もう一度通知・表示することがあります。
- 起動時の表示復元と、確認・設定変更は同じキューで順番に処理します。古い保存状態が新しいバッジを上書きすることはありません。
- Chrome 106以降に対応します。通知の作成と消去にはコールバック形式を使い、完了時の `chrome.runtime.lastError` を確認します（通知APIのPromise形式はChrome 116以降）。

## 権限と外部通信

| 権限                                      | 理由                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `alarms`                                  | 6時間おきの確認                                                                                          |
| `notifications`                           | 比較基準版より古いときの通知                                                                             |
| `storage`                                 | 最終試行・最終成功・通知済みの版・更新画面を開いた版・チャンネル確認設定の保存（`chrome.storage.local`） |
| `https://versionhistory.googleapis.com/*` | 比較基準版の取得                                                                                         |

`tabs` 権限は使いません（`chrome.tabs.create` で更新画面を開くだけなら不要）。外部への通信は VersionHistory API への GET だけで、URLに含まれるのはプラットフォーム名（`mac`／`mac_arm64`／`win`／`win64`／`win_arm64`）だけです。自分のバージョンなどは送らず、解析やログ送信もしません。

## 構成

- `extension/`
  - `manifest.json`、`background.js`（service worker の入口）
  - `version-compare.mjs`: 版番号の解析と比較
  - `reference-release.mjs`: 比較基準版の選択と取得
  - `environment.mjs`: 現在版とプラットフォームの取得
  - `checker.mjs`: 1回の確認（保存・通知はしない）
  - `display-state.mjs`: バッジ・タイトル・通知と更新画面の自動表示の要否・保存内容・ポップアップ表示の決定
  - `notifier.mjs`: Chrome APIとの接続（確認の共有、保存、バッジ、通知、更新画面の自動表示、アラーム、起動時処理）
  - `popup.html`／`popup.css`／`popup.js`、`icon.png`
- `tests/`: `node:test` のテスト。`support/fake-chrome.mjs` は `chrome.*` の偽物、`fixtures/` は2026-10-08〜09に取得した安定版のAPI応答。
- `build.mjs`: 配布フォルダとビルド情報の生成。`dist/` は生成物としてGit管理から除外する。
- `.gitignore`／`.gitattributes`: このリポジトリ自身の除外規則と改行設定。

## テスト

外部依存はありません（Node.js v22以降）。

```bash
node --test 'tests/*.test.mjs'
```

テストは `node:test` を使います。`MODULE_TYPELESS_PACKAGE_JSON` 警告が表示される場合がありますが、`popup.js` をES moduleとして読み直す既存の警告です。`package.json` は追加せず、テストの失敗件数が0であることを確認してください。

## 書式と構文の確認

テキストはUTF-8（BOMなし）・LF・末尾改行ありを使い、JavaScriptのインデントは4スペースに合わせます。`.gitattributes` はテキストの改行をLFへ統一し、PNGをバイナリとして扱います。formatter本体は同梱していません。linterの設定・実行入口とlockfileは `tests/lint.mjs`・`tests/lint/` に同梱しています。テストとlintに加えて、構文は次のコマンドで確認できます。

macOS／Linux:

```bash
for file in build.mjs release.mjs extension/*.js extension/*.mjs tests/*.mjs; do
    node --check "$file" || exit
done
```

Windows（PowerShell 7）:

```powershell
$sourceFiles = @(Get-Item ./build.mjs, ./release.mjs) + @(Get-ChildItem ./tests -Filter *.mjs -File) + @(Get-ChildItem ./extension -File | Where-Object { $_.Extension -in @('.js', '.mjs') })
foreach ($file in $sourceFiles) {
    node --check $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "構文エラー: $($file.Name)" }
}
```

### 必須linter

[ESLintの現行サポート系列](https://eslint.org/version-support/)から `eslint@10.12.0` と `@eslint/js@10.0.1` を固定しています。Node.js v22.13以降またはv24以降で、リポジトリのルートから実行します。

```bash
npm ci --prefix tests/lint --ignore-scripts --no-audit --no-fund
node tests/lint.mjs
```

`npm ci` はlockfileの版とintegrityを使い、install scriptsは実行しません。Nodeの単体テスト・ビルドだけを行う場合、この取得は不要です。外部依存はlint専用で、拡張機能やRelease ZIPに同梱しません。ルートと下位の `node_modules/` はGit除外対象です。

lintは公式のrecommended rulesでbuild/release・extension・testsの全JavaScriptを検査します。ブラウザー/ChromeとNodeの実行環境ごとにglobalsを分け、inline configと親のESLint設定の探索を無効にします。未定義変数・未使用変数等を検出し、error/warningが1件でもあれば非0終了します。出力は各ファイルの相対パス・件数・診断を含むJSONです。構文確認やformatterの成功をlintの代用にしません。

公開前の証跡生成でインストール済み依存をソース外へ置く場合は、同じmanifest/lockfileで準備したtoolchainディレクトリを `node tests/lint.mjs --toolchain "そのディレクトリ"` で明示できます。別versionや欠落した直接依存は拒否します。

## バージョン管理

製品名と製品バージョンの定義元は、このアプリ固有の `extension/manifest.json` の `name` と `version` です。設定表示は `chrome.runtime.getManifest()` から読み、Chromeの拡張機能メタデータ・配布フォルダ内のmanifest・配布フォルダ名も同じ番号になります。ネイティブ実行ファイルはありません。他アプリやworkspace全体のバージョンには連動させません。

番号は `major.minor.patch` とし、機能追加はminor、修正はpatch、互換性を壊す変更はmajorを上げます。0.x期間は開発段階で互換性の安定を保証しませんが、この番号規則は同じです。互換性を壊す変更では1.0.0以上へ移行します。今回のバージョン情報追加は機能追加なので0.1.2から0.2.0へ更新します。同じソースの再ビルドや別OS・アーキテクチャでの利用だけでは番号を上げません。同じリリースの配布物はWindows／macOS、x64／ARM64／x86で共通です。

実行版は `chrome.runtime.getPlatformInfo()` の `os`／`arch` で表示します。拡張機能自体は共通のJavaScriptなので、実行中のChromeのアーキテクチャを使います。PC本体のCPUや `nacl_arch` は使いません。`arch` がChromeのビルドアーキテクチャであることは、[Chromiumの実装](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/runtime/chrome_runtime_api_delegate.cc)で確認できます。対応環境はWindowsのx64／ARM64／x86、macOSのx64／ARM64、Chrome 106以降です。

## ビルド

Node.js v22以降だけで実行でき、新しい依存のインストールは不要です。リポジトリのルートで実行します。

```bash
node build.mjs
```

`dist/chrome-update-notifier-<バージョン>-<UTC日時>/` にREADME・LICENSEと読み込み可能な `extension/`（LICENSE同梱）を生成します。毎回新しいフォルダを生成し、既存配布物・開発用フォルダ・インストール済み拡張機能は置換しません。ZIP・ハッシュ一覧の作成と再現性確認は [配布レシピ](RELEASING.md) に従ってください。ZIPの展開先は固定の `chrome-update-notifier/` です。

ビルド時に、Gitの短縮コミットID、このアプリ配下のtracked／untracked変更の有無、実際のビルド日時をUTCのISO 8601形式で `extension/build-info.mjs` に埋め込みます。変更の有無はアプリ配下に限定し、他アプリの変更は含みません。`dist/` はGit除外対象なので再ビルド自体はソース変更になりません。このアプリ自身のGitルートがない場合は親リポジトリを参照しません。Gitがない・取得に失敗した項目は `null` とし、画面・コピーには「不明」と表示します。ビルド日時は起動日時やファイル更新日時から推定しません。

独立リポジトリの初回commit前はソース識別子が「不明」、未コミットのソースがある場合は変更ありになります。親リポジトリのcommit番号は代用しません。`.gitignore` はこのリポジトリ内の `dist/`・`coverage/`・`node_modules/`、ログ、一部のOSメタデータ、`.env` 系ファイルを除外します。親の除外設定の継承には依存しません。

ビルドは指定したアプリファイルだけを同梱し、Git履歴、作者情報、端末名、絶対パス、ローカル設定を埋め込みません。起動後は同梱ファイルとChrome APIだけでバージョン情報を表示・コピーでき、Gitや開発用リポジトリは不要です。バージョン情報表示のための外部通信はありません。この拡張機能自身のオンライン最新版判定・自動更新は対象外です。

## 既知の制限

- VersionHistory APIの応答形式が変わった場合や、`fraction` が想定外の値の場合は、`NO_REFERENCE` か `ERROR` の表示になり、「古い」という通知は出ません。ただし、形式を保ったまま `fraction` などの意味が変わった場合は検出できません。
- 比較基準版の条件に合わない新しい版を受け取れる環境では通知が遅れることがある一方、比較基準版を取得できない端末にも通知することがあります。その場合、Chromeを再起動しても動作中の版が比較基準版未満なら赤 `!` が残ります。更新を取得できるかはChrome側の更新確認で決まります。
- Chromeの更新と再起動はChrome自身が行います。この拡張機能は更新画面を開くだけで、更新の実行や再起動はできません（拡張機能向けのAPIがないため）。更新画面の「再起動」は利用者が押します。
- 更新画面は確認のタイミング（起動時・6時間おき・「今すぐ確認」）で、作業中でも前面に開きます。
- Chromeを再起動しないため、再起動待ちの状態はこの拡張機能では解消しません。通知本文にも「更新済みでも再起動が必要な場合があります」と添えています。
- 対象はMac・WindowsのGoogle Chrome安定版だけです（延長安定版・Linux・ChromeOS等は対象外）。チャンネルは自動判定しないため、「対象外」を選ばずに使うと安定版との比較を行います。延長安定版では誤って「古い」と通知されるため、必ず「対象外」を選んでください。Beta・Dev・Canaryは通常は安定版より新しいため、通知は出ない見込みです。

## ライセンス

[MIT License](LICENSE)。著作権表示は `Copyright (c) 2026 Ryoichi-R and contributors` です。配布ZIPと読み込み対象のフォルダにも同じ [LICENSE](extension/LICENSE) を同梱します。本ソフトウェアはライセンスの条件に従い無保証で提供されます。

本プロジェクトはGoogleの公式製品ではなく、Googleによる提供・承認・提携を示すものではありません。Google ChromeはGoogle LLCの商標です。商標の使用には[Google Permissions](https://about.google/brand-resource-center/)が適用されます。

## 問い合わせと公開準備

一般の窓口にはこのリポジトリのGitHub Issues、脆弱性にはGitHubの非公開報告機能を使います。どちらも、有効化と利用者側からの到達確認が済むまでは受付中として扱いません。リポジトリにIssuesタブがない場合や、Securityタブに「Report a vulnerability」が表示されていない場合は、まだ受付を開始していません。

### 一般の問い合わせ・不具合報告

使い方の質問、機能要望、機密性のない不具合報告は、[このリポジトリのIssues](https://github.com/Ryoichi-R/chrome-update-notifier/issues)へお願いします。製品バージョン、OSとChromeのバージョン、再現手順、期待した動作と実際の動作を記載してください。個人情報・認証情報・非公開URLは載せないでください。

### 脆弱性の非公開報告

セキュリティ上の問題は公開Issuesへ詳しい内容を書かず、[Security → Advisories](https://github.com/Ryoichi-R/chrome-update-notifier/security/advisories)の「Report a vulnerability」から非公開で報告してください。このボタンが表示されていない間は受付前です。その間も、公開の投稿に脆弱性の詳細や機密情報を記載しないでください。

### 素材・第三者への帰属

コードと、青い円に白い上向き矢印を描いた自作アイコンは、このリポジトリのMIT Licenseで提供します。Google/Chromeの公式ロゴやStoreバッジは同梱していません。テストfixtureには公開VersionHistory APIから2026-10-08〜09に取得した安定版の応答データを含みます。開発用ESLint依存は専用manifest/lockfileで管理し、拡張ZIPには同梱しません。Googleの商標や外部APIの権利が本プロジェクトのMITに移ることを意味しません。

### 開発への参加

変更前にテストと必須lintを実行し、変更内容と確認結果を添えてください。再現手順には秘密情報を含めず、意見交換では相手への敬意を保ってください。Node.jsの要件、テスト・lint・ビルドの手順は本書の各節を参照してください。

[配布レシピ](RELEASING.md) と [公開準備policy](release/preparation-policy.draft.json) を同梱しています。2026-10-15に利用者がexact pathを明示してこのpolicyを採用しました。ファイル名の `.draft` は維持しています。policyの採用は公開許可や監査PASSを示すものではありません。

[開発への参加](CONTRIBUTING.md)・[セキュリティ報告](SECURITY.md)・[素材と第三者への帰属](THIRD-PARTY-NOTICES.md)を同梱しています。[行動規範](CODE_OF_CONDUCT.md)にはownerによる運用担当・適用範囲・対応手順・情報保持方針と、採用済みのGmail窓口を記載しています。行動規範窓口はownerが別Gmailとの送受信・返信/新規送信時の表示と日常運用を確認済みです。GitHubの一般Issues・非公開脆弱性報告は、有効化と到達確認が済むまで受付中として扱いません。
