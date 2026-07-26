# 独自ドメインへの移行手順（実施済みの記録）

作成日: 2026-07-26 / 対象: ルーティンノート（GitHub Pages → 独自ドメイン）

> ## ✅ 2026-07-26 に移行完了
> **現在の公開URL: https://routine-note.pygmix.com/**
> - ドメイン `pygmix.com` を取得（DNS管理は Cloudflare）
> - `routine-note` のCNAMEを `aratama-ship-it.github.io` へ（プロキシOFF＝DNS only）
> - リポジトリに `CNAME` ファイル、GitHub PagesのカスタムドメインとHTTPSを設定
> - Let's Encrypt証明書の発行を確認、Supabase の Site URL / Redirect URLs も新URLへ変更済み
> - 旧 `aratama-ship-it.github.io/routine-debugger/` は新URLへリダイレクトされる
>
> 以下は当時の手順。**別アプリを同様に移行するときの参考**として残す。

**ドメインの取得とDNS設定はあなたの手作業が必要。** 取得してドメイン名を教えてくれれば、
Claudeがリポジトリ側（CNAMEファイル・アプリ内URL）とSupabaseの設定変更を行う。

---

## 0. なぜ移すのか（3行）

1. **保存領域が他アプリと共用**: いま `aratama-ship-it.github.io` には10個近い別アプリが同居しており、
   IndexedDBの容量を奪い合っている。動画を250MB級で扱う本アプリには実害がある
2. **今しか移せない**: オリジンが変わると保存データは引き継がれない。テスター配布後に移すと全員のデータが消える
3. メールの到達率（独自ドメイン＋Resend）と、確認リンクの404問題も同時に解決する

---

## 1. ドメインを取る

### 選び方

- **`.com` が無難**（年1,500円前後）。`.app` は常時HTTPSが強制されるが問題なし（本アプリは元々HTTPS）
- `.jp` は年3,000〜4,000円と高め。日本向けを強く出したい場合のみ
- 候補例: `routinenote.com` / `routine-note.com` / `rn-app.com` など
  （※ 取得前に商標・既存サービスと衝突しないか軽く検索することを勧める）

### 取得先

| | 特徴 |
|---|---|
| **Cloudflare Registrar** | 原価販売で最安クラス。DNS管理も同じ画面でできる。**おすすめ** |
| お名前.com | 国内最大手。初年度が安いが更新料が高い。メール勧誘が多い |
| Google Domains | 現在は Squarespace へ移管済み |

**Cloudflareを推奨**する理由: 更新料が上がらず、DNS設定が同じ画面で完結し、この後の
Resend（メール送信）のDNS設定も同じ場所でできるため。

---

## 2. どう割り当てるか

GitHub Pagesは**1リポジトリに1ドメイン**。本アプリ専用に使うなら、次のどちらでもよい。

| 方式 | URL | 備考 |
|---|---|---|
| **サブドメイン（推奨）** | `https://app.example.com/` | 設定が簡単（CNAME 1本）。将来 `example.com` にLPを置ける |
| ルート（apex） | `https://example.com/` | Aレコード4本が必要。LPを別に持てなくなる |

**サブドメイン方式を推奨。** 将来「紹介ページは `example.com`、アプリは `app.example.com`」と分けられる。

---

## 3. DNSを設定する

### サブドメインの場合（推奨）

DNS管理画面で **CNAMEレコード**を1つ追加する。

| 項目 | 値 |
|---|---|
| Type | `CNAME` |
| Name | `app`（使いたいサブドメイン名） |
| Target / 値 | `aratama-ship-it.github.io`（**末尾にドットが要る場合あり**） |
| Proxy（Cloudflareの場合） | **OFF（DNS only／グレーの雲）** ← 重要 |

> ⚠️ Cloudflareでプロキシ（オレンジの雲）をONにするとGitHub PagesのHTTPS証明書の発行に失敗する。
> 必ず **DNS only** にする。

### ルート（apex）を使う場合

Aレコードを4本追加する（GitHub Pagesの公式IP）。

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

加えて `www` を CNAME で `aratama-ship-it.github.io` に向けておくとよい。

---

## 4. Claudeに伝えること

DNSを設定したら、**決めたURL**（例: `https://app.example.com/`）を伝える。以下はClaudeが行う。

1. リポジトリに `CNAME` ファイルを追加（中身はドメイン名1行）
2. アプリ内に直書きされている旧URLの差し替え（`app.js` と `i18n.js` の案内文1箇所ずつ）
3. `beta.html` など配布用ページの記載を新URLへ
4. `HANDOFF_CODEX.md` 等ドキュメントのURL更新

## 5. GitHub側の設定（Claudeが CNAME を入れた後、あなたが確認）

リポジトリ → **Settings → Pages**

1. **Custom domain** に新しいドメインが入っていること（CNAMEファイルにより自動で入る）
2. DNSチェックが通るまで数分〜数十分待つ
3. **Enforce HTTPS** に**チェックを入れる**（証明書の発行完了後に押せるようになる）

## 6. Supabase側の変更（Claudeが指示、あなたが操作）

**Authentication → URL Configuration**

| 項目 | 新しい値 |
|---|---|
| Site URL | `https://app.example.com/` |
| Redirect URLs | `https://app.example.com/**` |

これを変えないと、確認メール・パスワード再設定のリンクが旧URLへ戻ってしまう。

---

## 7. 移行時の注意（重要）

- **保存データは引き継がれない。** 旧URL（github.io）で作ったルーティン・動画は新URLには現れない。
  移行前に「設定 → 完全バックアップ → ZIPで書き出す」で保存し、新URLで復元すること
- **旧URLはGitHubが新ドメインへ自動リダイレクト**するようになるが、
  上記のとおりデータは移らないので、ZIPでの持ち運びが必要
- **ホーム画面に追加し直す。** PWAはオリジンごとに別アプリ扱いになるため、旧アイコンは削除して入れ直す

## 8. あとでやるとよいこと（任意）

独自ドメインがあると **Resend** が使えるようになり、メールの到達率が上がる。
`SMTP_SETUP.md` の「4. 独自ドメインを取った場合」を参照。
Cloudflareでドメインを取っていれば、DKIM/SPFのDNS設定も同じ画面でできる。

---

## 関連

- `SUPABASE_SETUP.md` … プロジェクト・スキーマ・キー
- `SMTP_SETUP.md` … メール送信の設定
- `HANDOFF_CODEX.md` … プロジェクト全体の現在地
