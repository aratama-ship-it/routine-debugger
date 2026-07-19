# 要望フォームの送信先(GAS)セットアップ手順

アプリの「設定 → 機能の要望・バグ報告を送る」で送られた内容を、Googleスプレッドシートに
自動で溜める仕組み。GASの**デプロイはあなたの手作業が必要**(Claudeは代行できない)。
デプロイして URL を教えてくれれば、Claude がアプリに貼り込む。

> URLを貼るまでの間は、フォームは自動的に**メール送信(circusarata@gmail.com宛て)**に
> フォールバックするので、今のままでも要望は届く。GASにすると複数テスターの要望が
> 1枚のシートに一覧で溜まる。

---

## 手順

### 1. スプレッドシートを用意
1. https://sheets.google.com で新しいスプレッドシートを作成(名前は「ルーティンノート 要望」など)
2. 特にタブや見出しは作らなくてよい(スクリプトが自動で作る)

### 2. Apps Script を開く
1. そのスプレッドシートで **拡張機能 → Apps Script** を開く
2. 既存の `function myFunction() {}` を全部消して、下の `Code.gs` を丸ごと貼り付け
3. 💾 で保存

### 3. ウェブアプリとしてデプロイ
1. 右上 **デプロイ → 新しいデプロイ**
2. 歯車(種類の選択) → **ウェブアプリ**
3. 設定:
   - 説明: 任意
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**  ← ここ重要(アプリから匿名でPOSTするため)
4. **デプロイ** → 初回は認可を求められる → 自分のGoogleアカウントで許可
   (「このアプリは確認されていません」が出たら「詳細 → (安全でないページ)に移動」で進む。自分のスクリプトなので問題ない)
5. 表示される **ウェブアプリのURL**(末尾が `/exec`)をコピー

### 4. Claude にURLを渡す
コピーした `/exec` のURLを Claude に貼れば、`app.js` の `FEEDBACK_ENDPOINT` に設定して反映する。

---

## Code.gs(丸ごと貼り付け)

```javascript
// ルーティンノート 要望フォーム 受け口
// アプリからは text/plain のJSONがPOSTされる。Sheet1の末尾に1行ずつ追記する。
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('要望');
    if (!sh) {
      sh = ss.insertSheet('要望');
      sh.appendRow(['受信日時', '種類', '内容', 'お名前', 'アプリ版', '端末(UA)', '送信日時(端末)']);
    }
    sh.appendRow([
      new Date(),
      data.kindLabel || data.kind || '',
      data.body || '',
      data.name || '',
      data.version || '',
      data.ua || '',
      data.date || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ブラウザで /exec を直接開いたときの動作確認用
function doGet() {
  return ContentService.createTextOutput('routine-debugger feedback endpoint OK');
}
```

---

## 注意(scouting-report の教訓)
- **GASに MailApp(メール送信)権限を安易に足さない。** 過去にscouting-reportで権限追加が原因で
  障害が起きURL再発行になった。この受け口はシート書き込みのみに留める。
- コードを変えたら**「デプロイの管理 → 編集(鉛筆) → バージョン: 新バージョン → デプロイ」**で
  更新する(新規デプロイだとURLが変わってしまう)。
