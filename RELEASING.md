# 配布レシピ

## 対象と前提

拡張機能・単体テスト・配布生成はNode.js v22以降の標準ライブラリだけを使います。Gitはソース識別子の取得に使います。品質検証のlintはNode.js v22.13以降またはv24以降と、`tests/lint/` のlockfileで固定した開発用ESLintを使います。コマンドはこのリポジトリのルートで実行します。バージョンの定義元は `extension/manifest.json` です。

この手順はローカルの配布候補を作ります。公開前には別途、採用済みpolicy、品質証跡、実配布ZIPの採用policyで必須とする受入、名称・素材の確認、同意を得た秘密情報・公開Git履歴の正式監査が必要です。この文書への方針の採用は配布の承認ではありません。

## 検証

```bash
node --test 'tests/*.test.mjs'
npm ci --prefix tests/lint --ignore-scripts --no-audit --no-fund
node tests/lint.mjs
```

初回のlinter取得にはネットワークを使います。公開候補を固定する作業では、依存をソース外のtoolchainへ導入し、`--toolchain` で指定できます。source exportへnode_modulesを入れず、lintがerror/warning 0件であることを確認します。ESLintの版・recommended rules・実行方法はREADMEの「必須linter」を参照してください。

READMEの構文確認も行います。`LICENSE` と `extension/LICENSE` はbyte単位で同じ内容である必要があり、ビルド時にも検査します。

## ZIPとハッシュの生成

今回のビルド日時をUTCで一度だけ記録し、同じ候補の再生成にも同じ値を使います。下の日時は書式例です。実際のビルド日時へ置き換えてください。

```bash
node release.mjs --built-at 2026-10-15T13:40:00.000Z --output-root dist/candidate-a
```

`dist/candidate-a/chrome-update-notifier-<version>-<UTC日時>/` に以下を作ります。既存の同名出力は上書きしません。失敗時も既存出力を削除せず、新しい出力先でやり直します。

- `chrome-update-notifier-<version>.zip`: `chrome-update-notifier/` 内に拡張機能本体、生成した `build-info.mjs`、LICENSEを格納。
- `SHA256SUMS`: ZIP全体のSHA-256。ファイル名との組で配布・照合に使います。
- `files.sha256.json`: ZIP内の全ファイルの相対パス・byte数・SHA-256。
- `extension/`、`README.md`、`LICENSE`: ローカル確認用の展開済みビルド。

ZIPは `build.mjs` の明示allowlistと生成したビルド情報だけから作ります。テスト・fixture・Git情報ディレクトリ・policy・配布レシピ・READMEはZIPに入りません。無圧縮のZIP32（STORE）、ファイル名昇順、固定日時1980-01-01、権限0644で格納し、OSのmtime・タイムゾーン・圧縮ライブラリの違いを取り除きます。これは拡張機能の署名やChrome Web Store用パッケージではありません。

ビルド情報は現在のGitの短縮commit、変更の有無、指定UTC日時です。Git不在・初回commit前は不明な値を `null` のまま残します。sourceの `extension/build-info.mjs` は書き換えません。未commit・dirty・不明の出力は開発候補として扱い、正式配布には使いません。

## 再現性と配布内容の確認

同じソース・Git状態・UTC日時を保ち、別の新規出力先 `dist/candidate-b` で同じコマンドを実行します。ZIP全体、`SHA256SUMS`、`files.sha256.json` がbyte単位で一致することを確認します。異なれば配布を停止します。

受入ではZIPを展開し、READMEのインストール・更新手順を使います。最初に読み込んだ固定の場所を保ち、画面の「再読み込み」を使って旧版から更新しても、拡張機能ID・チャンネル設定・通知等の記録が残ることをMacとWindowsで確認します。ビルド済みフォルダや以前のCDP検証だけでは、この受入を完了したことにしません。2026-10-16の利用者判断により、今回候補のWindows C1/U1とMacの残手動確認は省略し、policyの該当2項目を必須対象から除外しています。未実施の手動確認を成功扱いにはせず、Mac実Chromeの自動補助とclean export・テスト・lint・ZIP整合性の検証結果を記録します。これは全OSの手動受入完了を意味せず、将来の変更や異なる版番号間の更新の確認まで省略する判断ではありません。

## commit前とcommit後

採用済みpolicyによる候補exportと正式監査は別の公開準備工程で行います。commit前の候補とcommit後の配布では `sourceCommit` と `dirty` が変わるため、ZIP全体の一致を要求しません。

commit後は、承認済みのクリーンなソースと固定UTC日時で配布物を2回生成し直します。commit前候補との比較では生成 `build-info.mjs` 以外の全ファイルのSHA-256が一致し、差分が期待したビルド情報だけであることを検証します。最終ZIP、ファイル一覧、ソースcommitとそのメール情報を新しいcandidate・snapshotに結び直し、正式監査gateで受理するまで公開しません。旧candidateの監査をそのまま流用しません。

## 公開準備policy案

`release/preparation-policy.draft.json` は2026-10-15に利用者がexact pathを明示して採用したpolicyです。ファイル名の `.draft` と本見出しは参照互換性のため維持しています。ソース公開のallowlist、必要文書、テスト・coverage、配布ZIP・実機受入・ハッシュ・clean installの要件を定義します。コマンドや承認を埋め込むものではありません。評価にはこのexact pathを `-PreparationPolicyPath` で渡します。policyの内容を変更した場合はdigestを更新し、旧receiptを失効させます。

名称・商標、アイコンの来歴、公開連絡先・非公開の脆弱性連絡方法、GitHub発行のID付きnoreply、正式監査toolの導入は公開前に確認します。連絡先を推測して埋め込んだり、commit・push・remote作成・公開・Release uploadをこのレシピから実行したりしません。

## 公開時の問い合わせ・非公開報告経路

一般窓口は独立リポジトリのIssues、脆弱性はGitHub private vulnerability reportingを使用します。公開前の文書reviewでは、選択済みの経路・用途の分離・commit用noreply・未稼働の表示を確認します。窓口の実有効化・到達確認は公開操作に依存する別の完了条件として保持し、準備段階のreview成功と混同しません。GitHubの非公開報告機能はpublic repositoryで有効化する必要があるため、初期private段階で稼働済みと扱いません。公開操作計画に有効化と利用者側からの到達確認を含め、完了するまでREADMEを受付中の表記へ変更しません。必要な非公開受付を用意できなければ公開手順を確定済みとせず、代替の非公開窓口についてownerへ確認します。外部設定の実行には別の明示依頼と該当gateが必要です。

表示名は「更新チェッカー」、互換性の説明は「Google Chrome™向けの非公式拡張機能」です。repository・ローカルフォルダ・ZIP名はchrome-update-notifierのままです。名称や文書だけの変更でもcandidate/ZIPのhashが変わるため、旧digestの品質・実機受入・監査証跡を新candidateへ無条件に流用しません。

## 行動規範の確認済み事項と確認範囲

CODE_OF_CONDUCT.mdの運用担当・適用範囲・対応手順・再検討/利益相反・情報保持方針はownerの選択を反映しています。行動規範用の公開メール窓口はowner指定のGmailを採用し、Proton Mail Freeの登録を進める方針から切り替えました。ownerが確認手順M0〜M5を実施し、別Gmailとの受信・返信・再返信・新規送信、表示名/署名、アクセス/日常確認/保持見直しについて問題なしと報告しました。採用policyの要件は維持し、code-of-conduct-governanceはこの本人報告とcandidateの照合に基づくmanual証跡でpassedとします。実操作日時・端末の詳細は補完せず、他のメールサービスやGitHub窓口の到達性へ確認範囲を拡張しません。一般Issues・脆弱性報告・commit用noreplyの用途は変更しません。秘密情報の再スキャン・stage・commit・push・公開は別の明示指示に従います。

## 採用済みの公開先と初回Release計画

2026-10-17に採用した公開先は **Ryoichi-R/chrome-update-notifier**、default branchは **main** です。この独立リポジトリから、最初はprivate、最終的にpublicへ進める計画です。この方針だけでrepository作成、push、public化、Release uploadを実行しません。

初回0.2.0は **Pre-release** とし、予定tagは **v0.2.0** です。最終的に公開するsource commitと、そこから生成したZIPのSHA-256をRelease本文へ記載し、次の3点を添付します。

- `chrome-update-notifier-0.2.0.zip`
- `SHA256SUMS`
- `files.sha256.json`

文書同期後のcandidateを再検証・監査してから、別途許可されたcommitを行います。そのclean commitから正式ZIPを2回生成し、再現性とcommit前候補との差が生成build-infoだけであることを確認します。最終commitと正式ZIP/hashはこの段階で再固定します。文書を変更する前のcommitから生成したZIPを、変更後のcandidateの正式配布物として自動採用しません。未commit・Git識別子不明・dirtyのビルドは開発候補です。

Release本文には「更新チェッカー — Google Chrome™向けの非公式拡張機能」、動作要件、導入/更新方法、既知の制限を明示します。今回candidateのWindows C1/U1とMacの残手動確認の省略、異なる版番号間の更新U2が未確認である点も記載し、全OSの手動受入完了とは表記しません。Pre-releaseも公開情報です。

公開の順序は、candidate固定と正式監査 → 許可されたcommitとcleanな正式配布物の再生成/監査 → 公開先の確認 → private repository作成/検証 → privateへの初回push → public化 → Issues・非公開脆弱性報告の有効化と利用者側到達確認 → Pre-release配布 → 公開面のsource commit/tag/ZIP/hash/リンク照合です。各外部操作は別途許可と対応する監査gateを必要とします。非公開脆弱性報告を用意できなければRelease配布前に停止します。結果が不明な外部操作を再試行せず、まずread-onlyで実態を確認します。

## 配布停止と復旧

1. Ryoichi-Rが問題のある版・ZIP/hash・影響範囲を記録し、影響する配布の停止または撤回を判断します。外部の配布物や設定の変更は、対象を明示して許可された操作として行います。
2. 必要最小限の調査証跡を非公開で保持し、利用者向けには影響する版、停止状態、回避策と分かる範囲の見通しを案内します。導入済み拡張の停止が必要なら、Chromeの拡張機能管理で無効化/削除する手順を添えます。
3. 原因を是正し、修正版candidateについて品質・clean export・ZIP再現性/整合性・必要な受入・正式監査を確認します。検証済みの新commit/tag/ZIP/hashを使い、別途許可された修正版Releaseを配布します。
4. 公開面から取得し直したsource commit/tag、ZIPと2種類のhash資料、窓口/リンクを照合して復旧を確認します。正常な旧公開版が存在する場合も、利用可否と互換性を確認してから復帰先を選びます。

初回Releaseでは正常な旧公開版が存在する前提を置きません。Git履歴書換え、force push、repositoryの自動削除を復旧手段にしません。public化以後に取得済みの情報や配布物を完全に回収できるとは保証しません。
