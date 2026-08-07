/* ルーティンノート — パート練習のループ区間プリセット
 *
 * 同じ箇所を繰り返し詰めるうちに、A/Bを何度も置き直すことになる。
 * 一度作った区間を名前で覚えておき、次からはワンタップで戻せるようにする。
 *
 * 設計の要点:
 *  - 上限5件。増やせば探す手間が増え、ワンタップの意味が薄れる
 *  - 押したら即その区間になる(確認を挟まない)。間違えても押し直せばよい
 *  - 名前は任意。空なら時間そのものを見せる。名前を考える手間で保存をためらわせない
 *  - ルーティンに持たせるので、ログインしていれば他の端末にも付いていく
 *
 * app.js が容量上限に近いため、置き場所だけ app.js に作り、中身はここで描く。
 */
(() => {
  "use strict";

  const MAX = 5;
  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh ? window.RoutineI18nZh.text(ja) : ja));

  const currentRoutine = () =>
    (state.routines || []).find((r) => r.id === view.params.id) || null;

  function presetsOf(rt) {
    if (!rt) return [];
    if (!Array.isArray(rt.partPresets)) rt.partPresets = [];
    return rt.partPresets;
  }

  // 「曲末まで」は b を持たない。時間で持つと曲を差し替えたときに意味が変わる
  const label = (p) => `${fmtTimeFine(p.a)} – ${p.b == null ? t("曲末", "end") : fmtTimeFine(p.b)}`;

  function renderPartPresets() {
    const slot = document.getElementById("part-presets");
    if (!slot) return;
    const rt = currentRoutine();
    if (!rt) return;
    const list = presetsOf(rt);
    const { a, b } = partRange(rt);
    const full = list.length >= MAX;
    const invalid = b != null && b <= a;

    const chips = list.map((p) => `
      <div class="pp-chip">
        <button class="pp-apply" onclick="applyPartPreset('${p.id}')">
          <span class="pp-name">${esc(p.name || label(p))}</span>
          ${p.name ? `<span class="pp-range">${label(p)}</span>` : ""}
        </button>
        <button class="pp-del" onclick="deletePartPreset('${p.id}')"
          aria-label="${t("この区間を消す", "Delete this range")}">✕</button>
      </div>`).join("");

    const html = `
      <h2>${t("よく使う区間", "Saved ranges")}</h2>
      ${chips || `<div class="pp-empty">${t(
        "いまのA–Bを保存しておくと、次からワンタップで戻せます。",
        "Save the current A–B to recall it with one tap.")}</div>`}
      <button class="btn small pp-save" onclick="savePartPreset()" ${full || invalid ? "disabled" : ""}>
        ${full
          ? t(`保存は${MAX}件まで`, `Up to ${MAX} saved`)
          : t("＋ いまの区間を保存", "+ Save current range")}
      </button>`;
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }
  window.renderPartPresets = renderPartPresets;

  window.applyPartPreset = (id) => {
    const rt = currentRoutine();
    const p = presetsOf(rt).find((x) => x.id === id);
    if (!rt || !p) return;
    rt.partLoop = rt.partLoop || {};
    rt.partLoop.a = p.a;
    if (p.b == null) delete rt.partLoop.b; else rt.partLoop.b = p.b;
    // 値を変えるだけだと、曲は今の場所を流れ続けて「効いていない」ように見える。
    // 押した区間の頭へ飛ばす。再生中ならそのまま流し続ける。
    const wasPlaying = !musicPlayer.paused;
    musicSetTime(p.a);
    saveState(); render();
    if (wasPlaying) playMedia(musicPlayer, t("楽曲を再生できませんでした", "Could not play the music"));
    toast(t(`区間を ${label(p)} にしました`, `Range set to ${label(p)}`));
  };

  window.savePartPreset = () => {
    const rt = currentRoutine();
    if (!rt) return;
    const list = presetsOf(rt);
    if (list.length >= MAX) return toast(t(`保存は${MAX}件までです`, `You can save up to ${MAX}`));
    const { a, b } = partRange(rt);
    if (b != null && b <= a) return toast(t("終点Bが始点Aより前です", "B comes before A"));
    const range = `${fmtTimeFine(a)} – ${b == null ? t("曲末", "end") : fmtTimeFine(b)}`;
    showSheet(`
      <h3>${t("この区間を保存", "Save this range")}</h3>
      <div class="sheet-sub">${range}</div>
      <div class="add-trick-name">
        <input type="text" id="pp-name" placeholder="${t("名前(なくてもよい)", "Name (optional)")}"
          enterkeyhint="done" onkeydown="if(event.key==='Enter')commitPartPreset()">
        <button class="btn primary" onclick="commitPartPreset()">${t("保存", "Save")}</button>
      </div>
      <p class="sheet-note">${t(
        "「サビ前」「5球の入り」など、後で自分が分かる言い方で構いません。",
        "Anything you will recognise later is fine.")}</p>
      <button class="btn ghost" onclick="hideSheet()">${t("やめる", "Cancel")}</button>`);
    const input = document.getElementById("pp-name");
    if (input) setTimeout(() => input.focus(), 0);
  };

  window.commitPartPreset = () => {
    const rt = currentRoutine();
    if (!rt) return hideSheet();
    const list = presetsOf(rt);
    if (list.length >= MAX) { hideSheet(); return; }
    const input = document.getElementById("pp-name");
    const name = input ? input.value.trim().slice(0, 24) : "";
    const { a, b } = partRange(rt);
    list.push({ id: uid(), name, a: Math.round(a * 10) / 10, b: b == null ? null : Math.round(b * 10) / 10 });
    saveState(); hideSheet(); render();
    toast(t("保存しました", "Saved"));
  };

  window.deletePartPreset = (id) => {
    const rt = currentRoutine();
    const list = presetsOf(rt);
    const p = list.find((x) => x.id === id);
    if (!p) return;
    if (!appConfirm(t(`「${p.name || label(p)}」を消しますか?`, `Delete “${p.name || label(p)}”?`))) return;
    rt.partPresets = list.filter((x) => x.id !== id);
    saveState(); render();
  };

  // 画面が描き直されるたびに埋め直す(#app 直下だけを見る)
  const appEl = document.getElementById("app");
  if (appEl) {
    new MutationObserver(() => {
      if (document.getElementById("part-presets")) renderPartPresets();
    }).observe(appEl, { childList: true });
  }
})();
