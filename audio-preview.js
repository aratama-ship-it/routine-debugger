/* ルーティンノート — 音源ライブラリの試聴
 *
 * 曲を選ぶ画面が、名前と長さだけで決めさせる作りだった。
 * 自分で入れた音源はともかく、付属サンプルは名前を見ても中身が分からない。
 * 決める前に聴けるようにする。
 *
 * 作りの方針:
 *  - 「聴く」と「決める」を分ける。押し間違えて曲が差し替わるのが一番困る
 *  - 試聴は1つだけ鳴らす。別の曲を押したら前の曲は止める
 *  - シートを閉じたら必ず止める(裏で鳴り続けるのを防ぐ)
 *  - 曲の実体は重い。押されたものだけ読み込む
 *
 * app.js が容量上限に近いため、選択シートごとこちらで作り直している。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  let audio = null;      // 試聴用。1つを使い回す
  let playingKey = null; // いま鳴らしている行
  let objectUrl = null;  // 端末内の音源を鳴らすために作ったURL

  function stopPreview() {
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    playingKey = null;
    syncPreviewButtons();
  }

  function syncPreviewButtons() {
    document.querySelectorAll("#sheet .ap-play").forEach((b) => {
      const on = playingKey && b.dataset.key === playingKey;
      b.textContent = on ? "❚❚" : "▶";
      b.classList.toggle("on", !!on);
      b.setAttribute("aria-label", on
        ? t("試聴を止める", "Stop preview")
        : t("試聴する", "Preview"));
    });
  }

  async function startPreview(key, src) {
    if (!audio) {
      audio = new Audio();
      audio.preload = "none";
      audio.addEventListener("ended", stopPreview);
      audio.addEventListener("error", () => {
        toast(t("この音源を再生できませんでした", "Could not play this audio"));
        stopPreview();
      });
    }
    stopPreview();
    audio.src = src;
    playingKey = key;
    syncPreviewButtons();
    try { await audio.play(); } catch (_) { stopPreview(); }
  }

  // 端末内に保存した音源(実体を読み出してから鳴らす)
  window.previewSavedAudio = async (id) => {
    if (playingKey === `s:${id}`) return stopPreview();
    const a = (state.audios || []).find((x) => x.id === id);
    if (!a) return toast(t("音源が見つかりません", "Audio not found"));
    const blob = await blobGet(a.blobId);
    if (!blob) return toast(t("音源データが見つかりません", "Audio data not found"));
    objectUrl = URL.createObjectURL(blob);
    // objectUrl は stopPreview で開放するが、startPreview 内の stopPreview で
    // 消えないよう、鳴らす直前に持ち直す
    const url = objectUrl;
    objectUrl = null;
    await startPreview(`s:${id}`, url);
    objectUrl = url;
  };

  // 付属サンプル(ファイルをそのまま指す。全部読み込まずに鳴らせる)
  window.previewSampleAudio = async (i) => {
    if (playingKey === `p:${i}`) return stopPreview();
    const s = SAMPLE_MUSIC[i];
    if (!s) return;
    await startPreview(`p:${i}`, s.f);
  };

  function row(key, name, meta, onPick, onPreview) {
    return `<div class="ap-row">
      <button class="ap-play" data-key="${key}" onclick="${onPreview}"
        aria-label="${t("試聴する", "Preview")}">▶</button>
      <button class="ap-pick" onclick="${onPick}">
        <span class="ap-name">${esc(name)}</span>
        <span class="ap-meta">${meta}</span>
      </button>
    </div>`;
  }

  window.sheetPickLibraryMusic = (target) => {
    const list = (state.audios || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const saved = list.map((a) => row(
      `s:${a.id}`, a.name, fmtTime(a.duration || 0),
      `pickLibraryMusic('${a.id}','${target}')`, `previewSavedAudio('${a.id}')`)).join("");
    const samples = SAMPLE_MUSIC.map((s, i) => row(
      `p:${i}`, s.n, t("付属", "Included"),
      `pickSampleMusic(${i},'${target}')`, `previewSampleAudio(${i})`)).join("");
    showSheet(`<h3>${t("音源ライブラリから選ぶ", "Choose from the audio library")}</h3>
      <div class="sheet-sub">${t("▶で試し聴きしてから、曲名を押して決めます。",
        "Tap ▶ to listen first, then tap the title to choose.")}</div>
      ${saved ? `<div class="tag-label" style="margin-top:0">${
        t("追加した音源", "Your audio")}</div>${saved}` : ""}
      <div class="tag-label">${t("付属サンプル(自由に使えます)", "Included samples (free to use)")}</div>
      ${samples}
      <button class="btn ghost" onclick="hideSheet()">${t("やめる", "Cancel")}</button>`);
  };

  // シートが閉じたら必ず止める。裏で鳴り続けると、何の音か分からなくなる
  if (typeof window.hideSheet === "function") {
    const original = window.hideSheet;
    window.hideSheet = function wrappedHideSheet() {
      if (playingKey) stopPreview();
      return original.apply(this, arguments);
    };
  }
  // 曲を決めたときも止める(決めた曲が本編で鳴り出すため)
  for (const name of ["pickLibraryMusic", "pickSampleMusic"]) {
    if (typeof window[name] !== "function") continue;
    const original = window[name];
    window[name] = function wrappedPick() {
      stopPreview();
      return original.apply(this, arguments);
    };
  }
})();
