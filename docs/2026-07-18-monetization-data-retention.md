# ルーティンノート — 無料／有料設計とデータ保持

作成日: 2026-07-18（JST）  
位置づけ: リリース前の技術・プロダクト判断メモ。料金や無料範囲の最終決定ではない。

## 今回の前提

- 正式リリース時は有料化を想定する。
- 無料でも、価値を理解できる範囲までは使えるようにする。
- テスト中を含め、利用者が保存したルーティン、練習履歴、メモを、無料期間終了やプラン変更を理由に消さない。
- 「2週間の試用」と「機能限定の無料版」のうち、Web／App Storeで安全かつ実装しやすい方法を選ぶ。

## 結論

最初の正式版は、**期限のない無料コア＋有料Pro機能**を推奨する。

2週間試用を最初から中心に据えるより、次の順番が実装しやすく、保存データにも安全である。

1. 無料ユーザーも基本的な記録・閲覧・書き出しを継続できる。
2. Proでは、利用数の拡張、高度分析、クラウド同期、完全バックアップなどを解放する。
3. 無料／Proの判定と、利用者の記録データを別レイヤーにする。
4. アカウント同期と権利判定が安定してから、「14日間Pro試用」を追加する。

これはAppleの公式な推奨ではなく、現行コードと配布形態を踏まえた設計判断である。

## なぜ機能限定版を先に推すか

### 期限なし無料＋Pro

実装負荷: **比較的低い**

- 日付計算、端末時計の改変対策、再インストールによる試用リセット対策が不要。
- 無料状態が恒久的なので、期限切れ時の複雑な画面遷移や例外が少ない。
- テスト利用者が間隔を空けて戻ってきても、突然使えなくならない。
- 「保存データは残るが、Pro機能だけ閉じる」という扱いを一貫させやすい。
- App Storeでは、買い切りならNon-Consumable IAP、継続サービスならAuto-Renewable Subscriptionを使える。

### 14日間の試用を中心にする場合

実装負荷: **中〜高**

- Webでは、端末内の `trialStartedAt` だけでは、ストレージ消去や別端末で試用を繰り返せる。正しく運用するにはログイン、サーバー時刻、試用資格、権利状態が必要。
- App Storeの自動更新サブスクリプションでは、Appleが2週間のIntroductory Offerを提供できる。ただし、購読開始、更新、キャンセル、猶予期間、失効などの状態処理が増える。
- 非サブスクリプションアプリでも、Appleの審査ガイドライン3.1.1は、価格0のNon-Consumable IAPを `XX-day Trial` と命名する時間制試用を認めている。ただし、StoreKitによる試用資格と本体解放の実装は必要。
- 試用終了時に利用者を完全に締め出すと、自分の練習記録を人質に取られた感覚を生みやすい。少なくとも閲覧・書き出しは残すべき。

## 配布形態ごとの比較

| 配布形態 | 期限なし無料＋Pro | 14日間Pro試用 | 実装上の注意 |
|---|---|---|---|
| 現行Web／PWA | UI上の機能制限だけなら最も簡単。ただし、クライアントだけのProフラグは改変可能 | 正確に行うにはSupabase Auth等のアカウントとサーバー権利判定が必要 | 有料販売を始めるなら決済とアカウントを結ぶバックエンドが必要 |
| App Store・買い切り | Non-Consumable IAPでPro解放。比較的単純 | 価格0の `14-day Trial` IAP＋有料の全機能解放IAP | StoreKit権利確認と復元導線が必要 |
| App Store・サブスク | Auto-Renewable SubscriptionでPro解放 | Appleの2週間Introductory Offerを利用可能 | 更新・失効・猶予期間・解約後の権利判定が必要 |
| Web＋App Store共通アカウント | サーバー側の共通Entitlementが必要 | 同左。試用資格の出所も統合する | Apple購入をWebでも有効にするなら、ログインとサーバー側検証が必要 |

## 現行版の保存状態

コードで確認できる現在地:

- ルーティン、セッション、設定などはIndexedDBの `routine-debugger / kv / state` に保存。
- IndexedDBが使えない場合は `localStorage` の `rd_state` へフォールバック。
- 楽曲、録音、技動画はIndexedDBの別ストア `blobs` に保存。
- JSONバックアップには、楽曲、録音、技動画が含まれない。
- メディア込み完全バックアップと、SupabaseによるJSONメタデータ同期は計画済みだが未実装。
- `navigator.storage.persist()` による永続ストレージ要求は未実装。

したがって、現時点では「ずっと残る」と約束できない。WebKitは、通常のWebストレージを既定ではbest-effortとしており、容量逼迫、ストレージ圧迫、長期未利用などでオリジン単位の削除が起き得るとしている。ホーム画面へ追加したWebアプリはITPの7日制限から除外されるが、ユーザーによる削除やストレージ圧迫まで防ぐ保証ではない。

## データ保持の絶対ルール

無料・試用・有料のどの方式でも、次を共通仕様にする。

1. **権利状態の変化で保存データを削除しない。**
2. 試用終了・解約・Pro失効後も、既存データの閲覧と書き出しを許可する。
3. 無料上限を超える既存ルーティンがある場合も削除しない。新規作成や一部編集だけを止める。
4. 再購入・再購読したときは、保存済みデータとPro表示をそのまま復帰させる。
5. `plan`、`trialEndsAt`、StoreKitの権利情報をルーティン本体へ混ぜない。
6. アカウント削除や「全データ削除」は、課金失効とは別の明示操作にする。
7. StoreKitの「購入を復元」は購入権利を戻すものであり、練習データそのものの復元とは分けて説明する。

## 無料／Proの境界案

以下は検証用の仮説。人数・料金・上限値は利用テスト後に決める。

### 無料で残す候補

- 少数のアクティブなルーティン作成
- 基本的な通し練習と成功／失敗記録
- 履歴の閲覧
- 自分のデータのJSON／CSV書き出し
- 既存データの閲覧と削除

### Pro候補

- ルーティン数、技ライブラリ数、履歴期間の拡張
- 高度分析、比較、バージョン間分析
- 音楽同期、録音、技動画、構成ビルダー
- A/B選択スロットや実験モード
- Supabaseアカウント同期
- メディア込み完全バックアップ
- 将来のAI支援

無料テスト中は、どの機能が継続利用の価値を作るかを調べるため、現行機能を広めに開放してよい。リリース直前に、利用頻度と困り方を見て境界を決める。

## 推奨する実装順

### 1. 課金より先に保存を強くする

1. `navigator.storage.persisted()` で現在の永続状態を確認する。
2. ユーザー操作を伴う適切な場面で `navigator.storage.persist()` を要求する。
3. `navigator.storage.estimate()` でメディア容量と残容量を表示する。
4. メディアを含む完全バックアップ／復元を実装する。
5. Supabaseで軽量メタデータをアカウント同期する。

### 2. Entitlement層を一つ作る

画面ごとに `if (isPaid)` を散らさず、次のような一つの判定口を置く。

```text
Entitlement
  plan: free | pro
  source: none | web | app_store
  trialEndsAt: nullable
  can(feature): boolean
```

保存処理はEntitlementを参照しない。機能入口と新規作成だけが `can(feature)` を参照する。

### 3. 最初の有料版

- Webβ: まずは無料のまま保存基盤と現場検証を優先。
- App Store: 継続的なクラウド費用が小さい間は、Non-Consumable IAPによる買い切りProが最も単純。
- クラウド同期、継続的な分析、AI機能など、運用費が定常的に発生する段階でサブスクリプションを再検討。

### 4. 試用を追加する場合

- App Storeサブスク: Appleの2週間Introductory Offerを使い、端末内独自タイマーは使わない。
- App Store買い切り: ガイドラインに沿った価格0の `14-day Trial` Non-Consumable IAPを検討。
- Web: Supabaseアカウントとサーバー時刻が入った後に実装する。
- どの方式でも試用終了後は無料版へ戻し、データは保持する。

## リリース前の必須テスト

- 無料 → Pro → 無料へ戻しても、データ件数と内容が変わらない。
- 試用終了時刻の前後で、閲覧・書き出しが維持される。
- 無料上限を超えた既存データが削除されず、適切な説明が出る。
- オフラインでも保存でき、再接続後に同期できる。
- バックアップ後、別環境へ復元してメタデータとメディアが揃う。
- App Store購入の復元後、Pro権利が戻る。
- 課金権利が戻っても、クラウドに存在しないローカルデータを「復元済み」と誤表示しない。

## 公式資料

- Apple App Review Guidelines 3.1.1: https://developer.apple.com/app-store/review/guidelines/
- Apple「Set up introductory offers」: https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions/
- Apple StoreKit `Transaction.currentEntitlements`: https://developer.apple.com/documentation/storekit/transaction/currententitlements
- Apple「Offering a Subscription Across Multiple Apps」: https://developer.apple.com/documentation/storekit/offering-a-subscription-across-multiple-apps
- WebKit「Updates to Storage Policy」: https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit「Tracking Prevention in WebKit」: https://webkit.org/tracking-prevention/

Appleの審査・課金仕様は変更され得るため、実装開始時と提出直前に再確認する。
