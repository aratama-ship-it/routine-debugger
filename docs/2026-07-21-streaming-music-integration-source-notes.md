# サブスク楽曲連携調査 source notes

作成日: 2026-07-21（JST）

## Reporting job

- Audience: product stakeholders
- Decision: サブスク契約者の楽曲をルーティンノートへ統合するか、どの方式から試すか
- Product decision (2026-07-21): 初回版ではサブスク音源連携を実装しない。将来候補として、他コンテンツと同期しない音声のみの `Subscription A–B Loop Mode` を保持する
- Scope: Apple Music、Spotify、Amazon Music、現行ローカル音源、外部リンク方式
- Baseline: 現行のMP3等ローカルファイル再生
- Success: 再生可否だけでなく、同期、トリム、ABループ、速度、DRM、商用化、費用を区別して判断できること

## Executive report structure mapping

- Title: `サブスク楽曲連携の実現性`
- Executive summary: `Executive Summary`
- Key findings with evidence: サービス比較、Apple、Spotify、Amazon、機能適合性、費用
- Visual evidence: 現行6機能のうち公式技術資料上確認できる機能数を比較。市場評価ではなく技術適合の単純件数
- Recommended next steps: 初回版はローカル音源のみ。需要確認後にApple Musicの音声ABループを非収益で実機試作し、製品投入前にAppleへ書面照会
- Further questions: `Further Questions`
- Caveats and assumptions: `Caveats and Assumptions`

## Evidence boundary

- 公式資料だけを判断根拠にした。
- AppleとSpotifyについては「再生APIが存在する」という技術面と、「同期・収益化が許されるか」という契約面を分離した。
- Apple規約の `MusicKit Content cannot be synchronized with any other content` と、Spotify規約の `Do not synchronize any sound recordings with any visual media` を本製品の技名、技動画、タイムラインへ照合した。
- Apple MusicKitのQueue Entryは`startTime`と`endTime`を公式に受け取れる。音声だけの区間反復は、技名・動画・歌詞・別音源との同期とは別に評価した。
- Spotifyには専用ABループAPIがない。現在位置を監視し、B点でA点へ`seek`する擬似ループは技術的に可能だが、イベント間隔とシーク遅延から0.1秒精度は保証しない。
- 音声だけのループを同期禁止の直接対象ではないとする判断は、公式の同期定義を照合した製品判断であり、各社による個別許可ではない。
- その照合結果は法律意見ではなく、実装前に書面確認が必要というリスク判定である。
- API費用は各社が公開している固定費・利用者料金だけを記載し、公表されていない従量料金を0円と断定していない。

## Chart map

- Report segment: サービス比較
- Analytical question: 現行ローカル音源の主要6機能を各方式がいくつ再現できるか
- Takeaway: Apple Musicは4項目、Spotifyは3項目の技術候補を持つが、精度と商用条件から現行ローカル音源モードを置き換えられない
- Family and type: Comparison & Ranking / horizontal bar
- Dataset: `technical_feature_coverage`
- Fields: `service`, `covered`; tooltip context is `covered_features`, `important_caveat`
- Data status: 市場実測値や品質スコアではなく、公式資料で確認できる機能の単純件数
- Denominator: アプリ内再生、任意シーク、ABループ、速度変更、音声解析、独自オフライン管理の6項目
- Palette policy: single-root preferred; sequential blue; category identity is carried by labels and order
- Non-color distinction: 方式名、降順、値ラベル
- Delivery: portable HTML report

## Omission and uncertainty notes

- 開発工数の金額換算は、体制・外注単価・認証基盤・ネイティブ化範囲が未確定のため掲載しない。
- Apple Musicの速度変更時のピッチ保持、全楽曲でのrate許容範囲、実際のシーク誤差は公式資料から確定できない。
- Appleの境界付きQueue EntryへRepeat Oneを適用したとき、自動的に開始点へ戻る厳密な挙動は公式文書だけでは確定できない。実機検証事項とする。
- Appleは全曲再生、ユーザー起点の再生、標準操作を要求するため、ループ専用UIだけでは要件を満たさない可能性がある。
- AppleとSpotifyのストリーミング機能を、有料プランを持つアプリ内で無料提供した場合の間接収益化判断は書面確認が必要。
- Amazon Musicの契約条件、API料金、承認基準はclosed Betaのため不明。
- 外部リンク方式も、各社のロゴ・ジャケット・メタデータを表示する場合は別途ブランド・メタデータ利用条件を確認する。最小案はテキストリンクと利用者入力だけ。

## Validation assessment

- Overall: **Decision-ready with legal caveat**
- Verified: 各社の再生方式、AppleとSpotifyの同期・収益化制限、Spotify Development Modeの5ユーザー制限、Amazon closed Beta、開発者年会費、利用者料金
- Interpretation boundary: ルーティン同期が各社規約に該当する可能性は高いが、各社から個別回答を得ていない
- Recommended decision: 初回版はローカル音源のみ。将来案として音声のみのABループを保持し、Apple Musicから非収益の実機試作を行う
- Handoff limitation: portable HTMLはcanonical validationとstructural verificationに合格したが、Chromium不在のためlight/dark、狭幅、source dialogの実ブラウザQAは未実施
