# 素材・第三者への帰属

## 第一者コードとアイコン

コードと、青い円に白い上向き矢印を描いた自作アイコンは、[MIT License](LICENSE)で提供します。拡張機能の配布ZIPには同内容の[extension/LICENSE](extension/LICENSE)を同梱します。Google/Chromeの公式ロゴやStoreバッジは同梱していません。

## 商標・外部API・fixture

Google ChromeはGoogle LLCの商標です。本製品「更新チェッカー」はGoogle Chrome向けの非公式拡張機能で、Googleによる提供・承認・推奨を表明しません。

比較基準版の取得にGoogleのVersionHistory APIを使用します。テストfixtureには、公開APIから2026-10-08〜09に取得した安定版の応答データを含みます。取得時点のサンプルであり、現在の配信状態や全端末への更新提供を保証するものではありません。

Googleの商標、外部APIや第三者の応答データに関する権利が本プロジェクトのMIT Licenseに移ることを意味しません。既存の素材・fixtureの来歴を示すもので、新しい第三者素材の再配布を一括許諾するものではありません。

## 開発用依存と配布物

品質検証には、専用の[manifest](tests/lint/package.json)と[lockfile](tests/lint/package-lock.json)で固定したESLint 10.12.0と@eslint/js 10.0.1を使います。両packageのlicense metadataはMITです。推移依存を含む各packageのlicense/noticeは各配布物を尊重してください。この文書は全推移依存の新たなlicense監査を実施した証明ではありません。

本番コード・テスト・配布生成処理はNode.js標準ライブラリを使用します。拡張ZIPへnode_modules、ESLintやその他の開発用packageを同梱しません。配布内容は[RELEASING.md](RELEASING.md)を参照してください。
