/* ルーティンノート — 通し中の「いまこのシーケンス」表示
 *
 * シーケンスとシーケンスのあいだの空白時間(空間)に、直前のシーケンスの名前と動画が出たままになっていた。
 * 何もしない時間なのにシーケンスが流れていると、いま何をすべきかを取り違える。
 * 空間は空間として見せる。
 *
 * app.js が容量上限に近いため、判定と描画をここに置く。
 * app.js 側の状態(practiceDockStepId など)はトップレベル let で共有されているので、
 * 同じクラシックスクリプトとして読み書きできる。
 */
(() => {
  "use strict";

  // 再生位置から「いまどのステップか」を決める。
  // 直前にキューを過ぎたステップを採用するが、そのシーケンスがすでに終わっていて次がまだ
  // 始まっていなければ gap=true とし、表示側で「空間」を出す。
  // 最後のシーケンスより後ろは空間ではなく「フィニッシュ」として扱う(次が無いので gap にしない)。
  window.plannedPracticeStep = function plannedPracticeStep(steps, cur) {
    if (!steps.length) return null;
    const schedule = practiceSchedule(steps);
    let active = schedule[0];
    for (const item of schedule) {
      if (item.start <= cur + 0.02) active = item;
      else break;
    }
    const next = schedule[active.index + 1] || null;
    const gap = !!next && cur > active.start + stepDur(active.step) + 0.02;
    return { ...active, next, gap };
  };

  // 空間のあいだのドック表示。シーケンス名も動画も出さず、次に来るシーケンスだけを予告する。
  window.renderPracticeGap = function renderPracticeGap(current, rt) {
    const dock = document.getElementById("practice-now");
    if (!dock) return;
    // どのステップIDとも一致しない値を入れる。これで編集画面の行の強調が外れ、
    // 読み込み中だった動画が後から届いても mountPracticeVideo 側で弾かれる。
    practiceDockStepId = "gap";
    const isEdit = view.name === "edit";
    dock.classList.toggle("paused",
      isEdit ? (musicPlayer.paused && !editPreviewManual) : (musicPlayer.paused || musicMissing));
    const name = document.getElementById("practice-now-name");
    const meta = document.getElementById("practice-now-meta");
    const media = document.getElementById("practice-now-media");
    if (name) name.textContent = uiText("空間");
    if (meta) {
      meta.textContent = uiText(
        `♪ ${fmtTime(current.next.start)}　次: ${practiceStepName(rt, current.next.step)}`);
    }
    if (typeof syncEditPreviewButtons === "function") syncEditPreviewButtons();
    // すでに空間の表示なら書き換えない(再生中は毎秒何度も呼ばれるため)
    if (media && !media.querySelector(".practice-gap")) {
      media.innerHTML = `<span class="practice-video-empty practice-gap">${uiText("空間")}</span>`;
    }
  };
})();
