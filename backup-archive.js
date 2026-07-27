// 完全バックアップ(ZIP)の読み書き。依存ライブラリ無しの最小実装。
// 方式はSTORE(無圧縮)固定: 動画・音源は既に圧縮済みなので再圧縮しても縮まず、時間とメモリだけ増えるため。
// ZIPの本体は「ヘッダのUint8Array + 元Blobの参照」の配列から組み立てる。Blobはブラウザ側でディスクに
// 裏付けされるため、250MB級でもJSヒープへ全量を載せない(検証のため1本ずつだけ一時的に読む)。
(function () {
  "use strict";

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function bytesToHex(buffer) {
    const u8 = new Uint8Array(buffer);
    let out = "";
    for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
    return out;
  }

  // SHA-256はcrypto.subtle依存(https/localhostのみ)。使えない環境ではnullを返し、検証をスキップする。
  async function sha256Hex(buffer) {
    if (!window.crypto || !crypto.subtle || !crypto.subtle.digest) return null;
    try {
      return bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
    } catch (_) { return null; }
  }

  // ---------- 書き出し ----------
  function createZipBuilder(now) {
    const stamp = dosDateTime(now || new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    function addRaw(name, blob, crc, size) {
      const nameBytes = enc.encode(name);
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);          // version needed
      dv.setUint16(6, 0x0800, true);      // UTF-8 filename
      dv.setUint16(8, 0, true);           // method: store
      dv.setUint16(10, stamp.time, true);
      dv.setUint16(12, stamp.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);       // compressed
      dv.setUint32(22, size, true);       // uncompressed
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, blob);
      central.push({ nameBytes, crc, size, offset });
      offset += local.length + size;
    }

    function finish() {
      const cdParts = [];
      let cdSize = 0;
      for (const e of central) {
        const buf = new Uint8Array(46 + e.nameBytes.length);
        const dv = new DataView(buf.buffer);
        dv.setUint32(0, 0x02014b50, true);
        dv.setUint16(4, 20, true);        // version made by
        dv.setUint16(6, 20, true);        // version needed
        dv.setUint16(8, 0x0800, true);
        dv.setUint16(10, 0, true);
        dv.setUint16(12, stamp.time, true);
        dv.setUint16(14, stamp.date, true);
        dv.setUint32(16, e.crc, true);
        dv.setUint32(20, e.size, true);
        dv.setUint32(24, e.size, true);
        dv.setUint16(28, e.nameBytes.length, true);
        dv.setUint16(30, 0, true);        // extra
        dv.setUint16(32, 0, true);        // comment
        dv.setUint16(34, 0, true);        // disk
        dv.setUint16(36, 0, true);        // internal attrs
        dv.setUint32(38, 0, true);        // external attrs
        dv.setUint32(42, e.offset, true);
        buf.set(e.nameBytes, 46);
        cdParts.push(buf);
        cdSize += buf.length;
      }
      const end = new Uint8Array(22);
      const dv = new DataView(end.buffer);
      dv.setUint32(0, 0x06054b50, true);
      dv.setUint16(4, 0, true);
      dv.setUint16(6, 0, true);
      dv.setUint16(8, central.length, true);
      dv.setUint16(10, central.length, true);
      dv.setUint32(12, cdSize, true);
      dv.setUint32(16, offset, true);
      dv.setUint16(20, 0, true);
      return new Blob([...parts, ...cdParts, end], { type: "application/zip" });
    }

    return {
      // テキスト(JSON等)を追加
      addText(name, text) {
        const bytes = enc.encode(text);
        addRaw(name, new Blob([bytes]), crc32(bytes), bytes.length);
      },
      // Blobを追加し、検証用のsha256とサイズを返す
      async addBlob(name, blob) {
        const buffer = await blob.arrayBuffer();
        const u8 = new Uint8Array(buffer);
        const crc = crc32(u8);
        const sha256 = await sha256Hex(buffer);
        addRaw(name, blob, crc, u8.length);
        return { size: u8.length, sha256 };
      },
      get totalBytes() { return offset; },
      get count() { return central.length; },
      finish,
    };
  }

  // ---------- 読み込み ----------
  async function readZip(file) {
    const size = file.size;
    if (size < 22) throw new Error("zip too small");
    const tailLen = Math.min(size, 65557);
    const tail = new Uint8Array(await file.slice(size - tailLen, size).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("end of central directory not found");
    const edv = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
    const total = edv.getUint16(10, true);
    const cdSize = edv.getUint32(12, true);
    const cdOffset = edv.getUint32(16, true);

    const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const dec = new TextDecoder();
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < total && p + 46 <= cd.length; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, { name, method, compSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    // 実データはlocal headerの直後。必要になった時だけsliceして読む(全展開しない)。
    async function blobOf(entry) {
      const head = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
      const hdv = new DataView(head.buffer);
      if (hdv.getUint32(0, true) !== 0x04034b50) throw new Error("bad local header");
      const start = entry.localOffset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
      const raw = file.slice(start, start + entry.compSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8 && typeof DecompressionStream === "function") {
        return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      }
      throw new Error("unsupported compression method " + entry.method);
    }

    return {
      names: [...entries.keys()],
      has: (name) => entries.has(name),
      async blob(name) {
        const entry = entries.get(name);
        if (!entry) throw new Error("missing entry " + name);
        return blobOf(entry);
      },
      async text(name) {
        return (await this.blob(name)).text();
      },
    };
  }

  window.RoutineBackupArchive = { createZipBuilder, readZip, sha256Hex, crc32 };
})();

// ================================================================
// アプリ統合層: 完全バックアップの書き出し・復元・検証と保存容量まわり。
// app.js のサイズ上限(release-check)を超えないよう、ロジックはこちら側に置く。
// 同じクラシックスクリプト同士でグローバルスコープを共有するため、
// state / blobGet / showLoading などは実行時に app.js の定義を参照する。
// ================================================================
// ========== 完全バックアップ(ZIP: 記録 + 動画・音源・録音) ==========
// 設計方針: 復元できないバックアップは無いのと同じなので、書き出し時に各メディアのSHA-256を控え、
// 復元時に必ず照合する。1件でも壊れていれば state を差し替えずに中止し、現在のデータを守る。
const BACKUP_FORMAT = "routine-note-backup";
const BACKUP_FORMAT_VERSION = 1;
const BLOB_EXT = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/webm": "weba", "audio/ogg": "ogg", "audio/flac": "flac",
};
const blobExt = (type) => BLOB_EXT[String(type || "").split(";")[0].trim().toLowerCase()] || "bin";
const safeBlobName = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

// state から参照されている全Blobを集める。同じblobIdを複数の技が共有する場合があるので必ず重複排除する。
function collectBackupBlobRefs() {
  const refs = new Map();
  const add = (blobId, kind) => { if (blobId && !refs.has(blobId)) refs.set(blobId, { blobId, kind }); };
  for (const rt of state.routines || []) if (rt.music) add(rt.music.blobId, "music");
  for (const t of state.tricks || []) add(t.blobId, "trick");
  for (const a of state.audios || []) add(a.blobId, "audio");
  for (const v of state.runVideos || []) {
    add(v.blobId, "runvideo");
    if (v.music) add(v.music.blobId, "music");
  }
  for (const s of state.sessions || []) for (const r of s.recordings || []) add(r.blobId, "recording");
  return [...refs.values()];
}

function updateLoading(msg) {
  const el = document.getElementById("loading");
  if (el && !el.classList.contains("hidden")) el.innerHTML = loadingMarkup(msg);
}
function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000); // 大きいZIPはダウンロード確定まで時間がかかる
}

window.exportFullBackup = async () => {
  const archive = window.RoutineBackupArchive;
  if (!archive) return toast("バックアップ機能を読み込めませんでした");
  const refs = collectBackupBlobRefs();
  showLoading("バックアップを作成中…");
  try {
    const zip = archive.createZipBuilder(new Date());
    const blobs = [];
    const missing = [];
    for (let i = 0; i < refs.length; i++) {
      updateLoading(`メディアを収集中… ${i + 1}/${refs.length}`);
      const ref = refs[i];
      const blob = await blobGet(ref.blobId);
      if (!blob) { missing.push(ref); continue; }
      const path = `blobs/${safeBlobName(ref.blobId)}.${blobExt(blob.type)}`;
      const info = await zip.addBlob(path, blob);
      blobs.push({ blobId: ref.blobId, kind: ref.kind, path, type: blob.type || "", size: info.size, sha256: info.sha256 });
    }
    updateLoading("記録を書き出し中…");
    const stateJson = JSON.stringify(state);
    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      schemaVersion: state.v == null ? 1 : state.v,
      exportedAt: new Date().toISOString(),
      stateSha256: await archive.sha256Hex(new TextEncoder().encode(stateJson).buffer),
      counts: {
        routines: (state.routines || []).length,
        sessions: (state.sessions || []).length,
        tricks: (state.tricks || []).length,
        audios: (state.audios || []).length,
        runVideos: (state.runVideos || []).length,
        blobs: blobs.length,
      },
      blobs,
      missingBlobs: missing,
    };
    zip.addText("manifest.json", JSON.stringify(manifest, null, 2));
    zip.addText("state.json", stateJson);
    zip.addText("README.txt",
      "ルーティンノート 完全バックアップ\r\n\r\n"
      + `書き出し日時: ${manifest.exportedAt}\r\nアプリ版: ${APP_VERSION}\r\n\r\n`
      + "このZIPには記録(state.json)と、技の動画・通し映像・音源・録音(blobs/)が入っています。\r\n"
      + "復元はアプリの [設定 > 完全バックアップ > ZIPから復元する] から行ってください。\r\n"
      + "ファイル名を変えても復元できます。中のファイルは編集しないでください。\r\n");
    updateLoading("ファイルをまとめています…");
    const out = zip.finish();
    downloadBlob(`routine-note-backup-${today()}.zip`, out);
    hideLoading();
    showSheet(`<h3>完全バックアップを書き出しました</h3>
      <div class="help-body" style="margin-top:8px">
        サイズ: <b>${fmtBytes(out.size)}</b><br>
        メディア: <b>${blobs.length}件</b>${missing.length ? ` <span style="color:var(--danger)">(見つからなかったもの ${missing.length}件)</span>` : ""}<br>
        ルーティン ${manifest.counts.routines} / セッション ${manifest.counts.sessions}
        <br><br>${missing.length
          ? "一部のメディアが端末内に見つかりませんでした。過去に削除されたか、ブラウザに消された可能性があります。<br><br>"
          : ""}
        このZIPは<b>この端末の外</b>(iCloud・PCなど)に保存してください。端末内だけではブラウザにまとめて消される可能性があります。
        <br><br>保存できたら、<b>ZIPを検証する</b>で中身が無事か一度確かめておくと安心です。
      </div>
      <div style="height:16px"></div>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  } catch (err) {
    hideLoading();
    toast(`書き出せませんでした: ${err && err.message ? err.message : err}`);
  }
};

async function loadBackupZip(file) {
  const archive = window.RoutineBackupArchive;
  if (!archive) throw new Error("バックアップ機能を読み込めませんでした");
  const zip = await archive.readZip(file);
  if (!zip.has("manifest.json") || !zip.has("state.json")) throw new Error("このアプリのバックアップではありません");
  const manifest = JSON.parse(await zip.text("manifest.json"));
  if (manifest.format !== BACKUP_FORMAT) throw new Error("このアプリのバックアップではありません");
  if (Number(manifest.formatVersion) > BACKUP_FORMAT_VERSION) throw new Error("新しい版で作られたバックアップです。アプリを更新してください");
  const data = JSON.parse(await zip.text("state.json"));
  return { zip, manifest, data };
}

// manifestの各メディアを照合する。write=true なら照合に通ったものからIndexedDBへ書き戻す。
// 失敗が出ても state は呼び出し側で差し替えないため、現在のデータは壊れない(書き戻し済みの孤立Blobは無害)。
async function processBackupBlobs(zip, manifest, write, onProgress) {
  const archive = window.RoutineBackupArchive;
  const list = Array.isArray(manifest.blobs) ? manifest.blobs : [];
  const result = { total: list.length, ok: 0, failed: [], missing: [], unverified: 0, bytes: 0 };
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (onProgress) onProgress(i + 1, list.length);
    if (!entry || !entry.path || !zip.has(entry.path)) { result.missing.push(entry || {}); continue; }
    const blob = await zip.blob(entry.path);
    if (entry.size != null && blob.size !== entry.size) { result.failed.push(entry); continue; }
    if (entry.sha256) {
      const sha = await archive.sha256Hex(await blob.arrayBuffer());
      if (sha == null) result.unverified++;        // crypto.subtleが無い環境(file://等)ではサイズ照合のみ
      else if (sha !== entry.sha256) { result.failed.push(entry); continue; }
    } else result.unverified++;
    if (write) {
      const typed = entry.type ? new Blob([blob], { type: entry.type }) : blob;
      if (!(await blobPut(entry.blobId, typed))) { result.failed.push(entry); continue; }
    }
    result.ok++;
    result.bytes += blob.size;
  }
  return result;
}

function backupSummaryHtml(manifest, res) {
  const c = manifest.counts || {};
  const bad = res.failed.length + res.missing.length;
  return `書き出し日時: <b>${esc(String(manifest.exportedAt || "").replace("T", " ").slice(0, 16))}</b>（アプリ版 ${esc(manifest.appVersion || "?")}）<br>
    ルーティン ${c.routines == null ? "?" : c.routines} / セッション ${c.sessions == null ? "?" : c.sessions}<br>
    メディア: 照合OK <b>${res.ok}</b> / 全${res.total}件
    ${bad ? `<br><span style="color:var(--danger)">壊れている ${res.failed.length}件・不足 ${res.missing.length}件</span>` : ""}
    ${res.unverified ? `<br><span style="color:var(--muted)">(照合値なし ${res.unverified}件はサイズのみ確認)</span>` : ""}`;
}

window.verifyFullBackup = async (input) => {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  showLoading("バックアップを検証中…");
  try {
    const { zip, manifest, data } = await loadBackupZip(file);
    const shapeOk = validateBackupShape(data);
    const res = await processBackupBlobs(zip, manifest, false, (i, n) => updateLoading(`メディアを検証中… ${i}/${n}`));
    hideLoading();
    const bad = res.failed.length + res.missing.length;
    const healthy = shapeOk && bad === 0;
    showSheet(`<h3>${healthy ? "このバックアップは復元できます" : "問題が見つかりました"}</h3>
      <div class="help-body" style="margin-top:8px">
        ${backupSummaryHtml(manifest, res)}<br>
        記録の形式: ${shapeOk ? "正常" : `<span style="color:var(--danger)">読み取れません</span>`}<br><br>
        ${healthy
          ? "全ファイルの照合値が一致しました。このZIPからそのまま復元できます。"
          : "このZIPからは完全には復元できません。別のバックアップを使うか、いまの端末のデータから新しく書き出してください。"}
      </div>
      <div style="height:16px"></div>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  } catch (err) {
    hideLoading();
    toast(`検証できませんでした: ${err && err.message ? err.message : err}`);
  }
};

window.importFullBackup = async (input) => {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  showLoading("バックアップを読み込み中…");
  let ctx;
  try {
    ctx = await loadBackupZip(file);
    if (!validateBackupShape(ctx.data)) throw new Error("記録の形式が違います");
  } catch (err) {
    hideLoading();
    return toast(`読み込めませんでした: ${err && err.message ? err.message : err}`);
  }
  hideLoading();
  const c = ctx.manifest.counts || {};
  const when = String(ctx.manifest.exportedAt || "").replace("T", " ").slice(0, 16);
  // ログイン中の復元は他の端末にも波及する。黙って消えるのが一番まずいので、必ず伝えてから実行する。
  const signedIn = !!(window.accountUser && window.accountUser());
  const syncWarn = signedIn
    ? `\n\n【ログイン中です】\nこの内容が他の端末にも同期されます。\nバックアップに含まれていないルーティンや記録は、他の端末からも消えます。\nこの端末だけに戻したい場合は、先にログアウトしてください。`
    : "";
  if (!appConfirm(`このバックアップで置き換えます。\n\n書き出し日時: ${when}\nルーティン ${c.routines == null ? "?" : c.routines} / セッション ${c.sessions == null ? "?" : c.sessions}\nメディア ${(ctx.manifest.blobs || []).length}件\n\nいまの端末のデータは失われます。${syncWarn}\n\nよいですか?`)) return;
  showLoading("メディアを検証・復元中…");
  try {
    const res = await processBackupBlobs(ctx.zip, ctx.manifest, true, (i, n) => updateLoading(`メディアを検証・復元中… ${i}/${n}`));
    if (res.failed.length || res.missing.length) {
      hideLoading();
      return showSheet(`<h3>復元を中止しました</h3>
        <div class="help-body" style="margin-top:8px">
          ${backupSummaryHtml(ctx.manifest, res)}<br><br>
          壊れている・見つからないメディアがあったため、<b>復元を中止しました。いまのデータは変更していません。</b>
          <br><br>別のバックアップで試すか、記録だけでも戻したい場合は開発者にご連絡ください。
        </div>
        <div style="height:16px"></div>
        <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
    }
    state = ctx.data;
    migrateState();
    saveState();
    render();
    hideLoading();
    showSheet(`<h3>復元しました</h3>
      <div class="help-body" style="margin-top:8px">
        ${backupSummaryHtml(ctx.manifest, res)}<br><br>
        メディア ${fmtBytes(res.bytes)} を書き戻しました。
      </div>
      <div style="height:16px"></div>
      <button class="btn ghost" onclick="hideSheet()">閉じる</button>`);
  } catch (err) {
    hideLoading();
    toast(`復元できませんでした: ${err && err.message ? err.message : err}`);
  }
};

// ========== 保存容量と永続化 ==========
// iOS/Safariは長期間使わないとブラウザ保存を消すことがある。persist()で消えにくくし、状態を可視化する。
async function refreshStorageInfo() {
  const usageEl = document.getElementById("storage-est");
  const persistEl = document.getElementById("storage-persist");
  if (!usageEl && !persistEl) return;
  if (usageEl) {
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      usageEl.textContent = est && est.usage != null
        ? `${fmtBytes(est.usage)}${est.quota ? ` / ${fmtBytes(est.quota)}` : ""}`
        : "—";
    } catch (_) { usageEl.textContent = "—"; }
  }
  // ※描画後に差し込む要素は i18n の一括置換を通らないので、ここで言語を出し分ける
  if (persistEl) {
    let persisted = false;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (_) {}
    persistEl.innerHTML = persisted
      ? `<span style="color:var(--ok)">${isEnglish() ? "Protected" : "保護中"}</span>`
      : `<button class="btn small" style="margin:0" onclick="requestPersistentStorage()">${
          isEnglish() ? "Turn on protection" : "保護を有効にする"}</button>`;
  }
  refreshOrphanInfo();
}
window.requestPersistentStorage = async () => {
  if (!navigator.storage || !navigator.storage.persist) return toast("この端末では設定できません");
  try {
    const ok = await navigator.storage.persist();
    toast(ok ? "データの保護を有効にしました" : "ブラウザに断られました。ホーム画面に追加すると通りやすくなります");
  } catch (_) { toast("設定できませんでした"); }
  refreshStorageInfo();
};

// ========== この端末のデータを全て削除(初期化) ==========
// 誤操作で全消失すると取り返しがつかないため、ルーティン削除と同じ「右へスライド」方式で確定させる。
// スライドの仕組み(startDeleteSlide / deleteSlideKey / performDeleteSlideAction)は app.js 側。
window.startResetAllSlide = (event) => startDeleteSlide(event, "", "reset-all");
window.resetAllDeleteKey = (event) => deleteSlideKey(event, "", "reset-all");

window.resetAllData = () => {
  const english = isEnglish();
  const runs = state.sessions.reduce((a, s) => a + (s.runs || []).length, 0);
  const media = collectBackupBlobRefs().length;
  const count = english
    ? `${state.routines.length} routines · ${runs} runs · ${media} media files`
    : `ルーティン${state.routines.length}件・通し${runs}本・メディア${media}件`;
  showSheet(`
    <h3>${english ? "Delete all data on this device" : "この端末のデータを全て削除"}</h3>
    <div class="delete-routine-warning">
      <strong>${english ? "This cannot be undone" : "この操作は元に戻せません"}</strong>
      <span>${count}</span>
      <p>${english
        ? "Routines, practice records, sequence and full-run videos, recordings, audio, and settings will all be erased."
        : "ルーティン、練習記録、技と通しの動画、録音、楽曲、設定がすべて消えます。"}</p>
      <p>${english
        ? "Export a full backup (ZIP) first if you want to keep anything."
        : "残したいものがあれば、先に「完全バックアップ」からZIPを書き出してください。"}</p>
    </div>
    <div class="delete-slide-wrap">
      <div class="delete-slide-track" id="delete-slide-track" role="slider" tabindex="0"
        aria-label="右端までスライドして削除" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        onkeydown="resetAllDeleteKey(event)">
        <div class="delete-slide-fill"></div>
        <span class="delete-slide-copy">右へスライドして削除</span>
        <button class="delete-slide-handle" type="button" aria-label="削除スライダー"
          onpointerdown="startResetAllSlide(event)">✕</button>
      </div>
      <div class="delete-slide-help">右端まで動かして指を離すと削除されます</div>
    </div>
    <button class="btn ghost" onclick="hideSheet()">キャンセル</button>`);
};

async function performResetAll() {
  hideSheet();
  showLoading(isEnglish() ? "Deleting…" : "削除しています…");
  try { musicPlayer.pause(); } catch (_) {}
  try { if (db) db.close(); } catch (_) {}
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
    setTimeout(resolve, 3000); // onblocked等で固まらない保険
  });
  try { localStorage.removeItem("rd_state"); localStorage.removeItem("rd_volume"); } catch (_) {}
  location.reload();
}

// ========== 未使用(孤立)データの掃除 ==========
// 保存が途中で中断した等の理由で、どこからも参照されていないBlobがIndexedDBに残ることがある。
// 容量を圧迫し、使用量の見え方も狂うので、確認したうえでまとめて消せるようにする。
function blobKeysAll() {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      const rq = db.transaction("blobs", "readonly").objectStore("blobs").getAllKeys();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });
}

// 参照されていないBlobを洗い出す。安全のため、stateが読めていない疑いがあるときは何も返さない。
async function findOrphanBlobs() {
  const keys = await blobKeysAll();
  if (!keys.length) return { orphans: [], bytes: 0, unsafe: false };
  const used = new Set(collectBackupBlobRefs().map((r) => String(r.blobId)));
  // ★重要な安全弁: stateの読み込みに失敗している場合、全Blobが「未使用」に見えてしまう。
  //   参照が1件も無いのにBlobだけ大量にある状況は異常とみなし、掃除を止める。
  if (!used.size) return { orphans: [], bytes: 0, unsafe: true };
  const orphans = [];
  let bytes = 0;
  for (const key of keys) {
    if (used.has(String(key))) continue;
    const blob = await blobGet(key);
    orphans.push({ key, size: blob ? blob.size : 0 });
    bytes += blob ? blob.size : 0;
  }
  return { orphans, bytes, unsafe: false };
}

window.cleanupOrphanBlobs = async () => {
  showLoading(isEnglish() ? "Checking…" : "確認しています…");
  let found;
  try { found = await findOrphanBlobs(); } finally { hideLoading(); }
  if (found.unsafe) return toast(isEnglish()
    ? "Could not verify your data. Cleanup was cancelled."
    : "データを確認できなかったため中止しました");
  if (!found.orphans.length) return toast(isEnglish() ? "Nothing to clean up" : "未使用データはありません");
  const msg = isEnglish()
    ? `Delete ${found.orphans.length} unused files (${fmtBytes(found.bytes)})?\nFiles still used by your routines are not affected.`
    : `使われていないデータ${found.orphans.length}件(${fmtBytes(found.bytes)})を削除します。\nルーティンで使用中のものは消えません。よいですか?`;
  if (!appConfirm(msg)) return;
  showLoading(isEnglish() ? "Cleaning up…" : "削除しています…");
  let done = 0;
  try {
    for (const item of found.orphans) if (await blobDel(item.key)) done++;
  } finally { hideLoading(); }
  toast(isEnglish() ? `Removed ${done} files (${fmtBytes(found.bytes)})` : `${done}件(${fmtBytes(found.bytes)})を削除しました`);
  refreshStorageInfo();
};

async function refreshOrphanInfo() {
  const el = document.getElementById("storage-orphan");
  if (!el) return;
  try {
    const found = await findOrphanBlobs();
    if (found.unsafe) { el.textContent = "—"; return; }
    const label = isEnglish()
      ? `${found.orphans.length} files · ${fmtBytes(found.bytes)}`
      : `${found.orphans.length}件 ${fmtBytes(found.bytes)}`;
    el.innerHTML = found.orphans.length
      ? `${label}
         <button class="btn small" style="margin:0 0 0 8px" onclick="cleanupOrphanBlobs()">${isEnglish() ? "Clean up" : "掃除する"}</button>`
      : `<span style="color:var(--muted)">${isEnglish() ? "None" : "なし"}</span>`;
  } catch (_) { el.textContent = "—"; }
}

// ========== 新しい版のお知らせ ==========
// βは更新が頻繁なうえ、ホーム画面から起動したPWAは開きっぱなしになりやすい。
// 古い版のまま使い続けて「直したはずの不具合」を報告させないよう、更新に気づける導線を出す。
// 自動では再読み込みしない(練習中に画面が飛ぶと記録が失われるため)。
let updateBannerShown = false;
let lastUpdateCheck = 0;

function showUpdateBanner() {
  if (updateBannerShown || document.getElementById("update-banner")) return;
  updateBannerShown = true;
  const english = isEnglish();
  const el = document.createElement("div");
  el.id = "update-banner";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <span class="ub-text">${english ? "A new version is available" : "新しい版があります"}</span>
    <button class="ub-apply" onclick="applyAppUpdate()">${english ? "Update" : "更新する"}</button>
    <button class="ub-later" onclick="dismissUpdateBanner()" aria-label="${english ? "Later" : "あとで"}">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
}
window.dismissUpdateBanner = () => {
  const el = document.getElementById("update-banner");
  if (el) el.remove();
  // 閉じても次回の起動時や次の更新検知でまた出る(見逃しっぱなしにしない)
};
window.applyAppUpdate = () => {
  // 通し練習の途中なら、記録が失われることを伝えてから
  if (typeof openRun !== "undefined" && openRun && !appConfirm(isEnglish()
    ? "A run is in progress. Updating now will discard it. Continue?"
    : "通しの記録中です。更新すると記録中の通しは失われます。よいですか?")) return;
  location.reload();
};

// ========== 起動時に「データの保護」を自動で申請する ==========
// 設定画面まで辿り着かない利用者のデータが、容量不足でブラウザに消されるのを防ぐ。
// persist() は断られても false が返るだけで、何も壊れない。
// ただし無条件には申請しない。ブラウザによっては確認ダイアログが出るため、
// 「まだ何も作っていない人」に尋ねても意味が伝わらない。守るものができてから申請する。
const PERSIST_TRY_KEY = "rd_persist_try";
async function autoRequestPersist() {
  const s = navigator.storage;
  if (!s || !s.persist || !s.persisted) return;
  try {
    if (await s.persisted()) return; // すでに保護済み
    // state はこの時点で読み込み済みのはず。未了なら hasData が false になり、次回起動でやり直す
    const st = typeof state === "object" && state ? state : null;
    const hasData = !!st && ((st.routines || []).length > 0 || (st.sessions || []).length > 0);
    if (!hasData) return;
    // 断られた直後に何度も申請しない(1日1回まで)。使い込むと通るブラウザがあるので諦めはしない
    const last = Number(localStorage.getItem(PERSIST_TRY_KEY) || 0);
    if (last && Date.now() - last < 86400000) return;
    localStorage.setItem(PERSIST_TRY_KEY, String(Date.now()));
    await s.persist(); // 成否は問わない。結果は設定画面の「データの保護」に出る
  } catch (_) {}
}
// 起動直後は loadState() と描画で忙しいので、落ち着いてから申請する
setTimeout(autoRequestPersist, 12000);

function watchForAppUpdate() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    // すでに新しい版が控えている場合
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        // controllerが居る = 初回インストールではなく「更新」
        if (sw.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner();
      });
    });
    // 開きっぱなしのPWA向け: 画面に戻ってきたタイミングで更新を確認する(30分に1回まで)
    const check = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastUpdateCheck < 1800000) return;
      lastUpdateCheck = now;
      reg.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    setTimeout(check, 5000);
  }).catch(() => {});
}
watchForAppUpdate();
