/* ルーティンノート — 編集画面の時間まわり
 *
 * 1) 曲位置の数字入力
 *    スマホでは inputmode=numeric のキーボードに「:」も「.」も無く、
 *    表示形式(0:00.0)どおりに打てなかった。
 *    そこで、打った数字を右から M:SS.t へ流し込む方式にする。
 *    35 → 0:03.5 ／ 305 → 0:30.5 ／ 1234 → 1:23.4
 *    打ちながら整形後の姿がそのまま欄に出るので、規則は説明しなくても分かる。
 *    「:」や「.」を打てる環境(パソコン)では、従来どおり直接書ける。
 *
 * 2) ステップの長さ
 *    動画を紐づけていない技・移行は長さが既定値のままで、変える手段が無かった。
 *    長さの表示をそのまま押せるようにして、ここから直接変えられるようにする。
 *
 * app.js が容量上限に近いため、ここに置く。app.js のトップレベル変数
 * (draft, state など)はクラシックスクリプト間で共有されている。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  // ---------- 曲位置の数字入力 ----------
  // 数字だけを打ったときは、表示形式の右端から埋める。
  // 「:」「.」が含まれる入力には触らない(パソコンで直接書いた場合)。
  window.cueDigits = (el) => {
    const raw = String(el.value);
    if (raw.includes(":") || raw.includes(".")) return;
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    if (!digits) { el.value = ""; return; }
    const tenth = Number(digits.slice(-1));
    const sec = Number(digits.slice(-3, -1) || 0);
    const min = Number(digits.slice(0, -3) || 0);
    // 59秒を超える打ち方(例: 999)でも壊れないよう、合計してから整形し直す
    const total = min * 60 + sec + tenth / 10;
    el.value = fmtCue(Math.round(total * 10) / 10);
  };

  // ---------- ステップの長さ ----------
  function durationRow(label, value, key) {
    return `<label class="dur-row">
      <span>${label}</span>
      <input type="number" inputmode="decimal" step="0.1" min="0" max="600"
        value="${Number(value).toFixed(1)}" data-dur="${key}">
      <span class="dur-unit">${t("秒", "sec")}</span>
    </label>`;
  }

  window.sheetStepDuration = (i) => {
    const s = draft && draft.steps[i];
    if (!s) return;
    const rt = state.routines.find((r) => r.id === view.params.id) || null;
    const showSlots = routineFeatureEnabled(rt, "showSlots", draft.featureSettings);
    // A/Bを使っている間は選択肢ごとに、使っていない間は選択肢Aだけを長さの持ち主として扱う。
    // これは名前欄の扱いと同じで、片方だけ別の考え方にすると混乱する。
    const slot = isSlot(s);
    const targets = slot
      ? (showSlots ? s.options : s.options.slice(0, 1))
      : [s];
    const rows = targets.map((o, k) => durationRow(
      slot && showSlots ? String.fromCharCode(65 + k) : t("長さ", "Duration"),
      editorDurationSource(o), String(k))).join("");
    // 動画から長さを受け継いでいる場合は、それに戻す道を残す
    const linked = targets.some((o) => o.trickId && Number(o.dur) >= 0);
    showSheet(`
      <h3>${t("長さを変える", "Change the duration")}</h3>
      <div class="sheet-sub">${esc(stepDisplayName(s) || t("このステップ", "This step"))}</div>
      <div class="dur-rows">${rows}</div>
      <p class="sheet-note">${t(
        "曲位置(♪)を決めていないステップは、この長さの分だけ前のステップの後ろに続きます。",
        "Steps without a music cue follow the previous step for this long.")}</p>
      ${linked ? `<button class="btn ghost" onclick="resetStepDuration(${i})">${
        t("動画の長さに戻す", "Use the video's length")}</button>` : ""}
      <button class="btn primary" onclick="applyStepDuration(${i})">${t("決定", "Save")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("閉じる", "Close")}</button>`);
    const first = document.querySelector("#sheet .dur-rows input");
    if (first) setTimeout(() => { first.focus(); first.select(); }, 0);
  };

  function durationTargets(i) {
    const s = draft && draft.steps[i];
    if (!s) return [];
    const rt = state.routines.find((r) => r.id === view.params.id) || null;
    const showSlots = routineFeatureEnabled(rt, "showSlots", draft.featureSettings);
    if (!isSlot(s)) return [s];
    return showSlots ? s.options : s.options.slice(0, 1);
  }

  window.applyStepDuration = (i) => {
    const targets = durationTargets(i);
    if (!targets.length) return hideSheet();
    for (const input of document.querySelectorAll("#sheet .dur-rows input")) {
      const o = targets[Number(input.dataset.dur)];
      if (!o) continue;
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < 0) return toast(t("長さは0以上の秒数で", "Enter 0 or more seconds"));
      o.dur = Math.round(Math.min(v, 600) * 10) / 10;
    }
    hideSheet(); render();
  };

  window.resetStepDuration = (i) => {
    for (const o of durationTargets(i)) delete o.dur;
    hideSheet(); render();
    toast(t("動画の長さに戻しました", "Using the video's length again"));
  };
})();
