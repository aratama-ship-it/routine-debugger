# ルーティンノート (Routine Note)

演技の通し練習を記録し、次に練習する場所を決めるためのウェブアプリ。
ジャグリング・ディアボロ・新体操・ダンスなど、音楽に合わせた演目を練習する人向け。

**公開版: https://aratama-ship-it.github.io/routine-debugger/**
（現在ベータ版です。テスターの方は [ベータ版ガイド](https://aratama-ship-it.github.io/routine-debugger/beta.html) をご覧ください）

---

## できること

- 技と移行を並べて、曲に合わせた演目を組み立てる
- 通し練習の記録（崩れた場所・原因の仮説・曲の再生位置）
- 技ごとの失敗率と、構成を変えた前後の比較
- 気になる区間だけのループ練習（A/B区間・再生速度）
- 技の動画ライブラリ、音源ライブラリ、通しの演技映像の撮影
- 動画・音源まで含めた完全バックアップ（ZIP）
- 日本語 / English、iPhone・iPad・PCブラウザ対応、オフライン動作（PWA）

データは利用者の端末内に保存されます。詳しくは
[プライバシーポリシー](https://aratama-ship-it.github.io/routine-debugger/privacy.html) を参照してください。

## 技術構成

バニラJavaScript（ビルド工程なし）+ IndexedDB + Service Worker による PWA。
外部ライブラリへの依存はありません。

## ライセンス

**© 2026 PYGMIX. All rights reserved.**

本リポジトリはオープンソースではありません。GitHub Pages でウェブ配信するために
公開しているものであり、**利用許諾は付与していません**。
複製・改変・再配布、および本ソフトウェアを用いた製品・サービスの公開を禁じます。

詳細は [LICENSE](LICENSE) を参照してください。

## お問い合わせ

circusarata@gmail.com
