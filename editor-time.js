/* ルーティンノート — 編集画面の時間まわり
 *
 * 1) 曲位置の数字入力
 *    スマホでは inputmode=numeric のキーボードに「:」も「.」も無く、
 *    表示形式(0:00.0)どおりに打てなかった。
 *    そこで「:」と「.」は常に入ったままにし、打った数字を右から M:SS.t へ流し込む。
 *    1 → 0:00.1 ／ 11 → 0:01.1 ／ 1111 → 1:11.1
 *    打ちながら整形後の姿がそのまま欄に出るので、規則は説明しなくても分かる。
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
  // 打つたびに M:SS.t へ整形し直す。「:」と「.」は常に入っている状態を保ち、
  // 利用者は数字だけを打てばよい。1→0:00.1、11→0:01.1、1111→1:11.1
  //
  // 一度でも整形を素通りさせると、その後は値に「:」「.」が含まれるせいで
  // 判定が狂い、2文字目以降を受け付けられなくなる。だから例外を作らず常に整形する。
  window.cueDigits = (el) => {
    const raw = String(el.value);
    const all = raw.replace(/\D/g, "");
    if (!all) { el.value = ""; return; } // 全部消したら「指定なし」に戻す
    // 整形するたび先頭に 0 が溜まるので、まず落としてから右6桁だけを見る
    const digits = all.replace(/^0+/, "").slice(-6) || "0";
    const tenth = Number(digits.slice(-1));
    const sec = Number(digits.slice(-3, -1) || 0);
    const min = Number(digits.slice(0, -3) || 0);
    // 59秒を超える打ち方(例: 999)でも壊れないよう、合計してから整形し直す
    el.value = fmtCue(Math.round((min * 60 + sec + tenth / 10) * 10) / 10);
    // 次の数字が末尾に入るよう、カーソルを最後へ送る
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
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

  // ---------- マイナス区間の直し方を2つ出す ----------
  // 前のシーケンスが次のキューへ食い込んだとき、直し方は2通りある。
  //   ・次をずらす(構成の間合いを保ちたいとき)
  //   ・前を短くする(曲の位置を動かしたくないとき)
  // どちらが正しいかは本人にしか決められないので、両方を並べて選ばせる。
  //
  // app.js が容量上限に近く、警告の組み立てもそちらにあるため、
  // 描画後にもう1つのボタンを差し込む形にしている。
  // 押す対象の番号は、既にある「次をずらす」ボタンから読み取る
  // (この書式は release-check が固定しているので、勝手に変わることはない)。
  function addShrinkButtons() {
    if (view.name !== "edit" || !draft) return;
    for (const box of document.querySelectorAll(".cue-overlap-actions")) {
      if (box.querySelector(".cue-shrink")) continue;
      const fit = box.querySelector('button[onclick^="fitCueToPrevious"]');
      const m = fit && /fitCueToPrevious\((\d+)\)/.exec(fit.getAttribute("onclick") || "");
      if (!m) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cue-shrink";
      b.setAttribute("onclick", `shrinkPreviousToFit(${m[1]})`);
      b.textContent = t("前のシーケンスを短くしてFIT", "Shorten previous & FIT");
      box.appendChild(b);
    }
  }

  // i は「次」のシーケンスの番号。その手前のシーケンスを、食い込みが消える長さまで縮める。
  window.shrinkPreviousToFit = (i) => {
    const next = draft && draft.steps[i];
    const prev = draft && draft.steps[i - 1];
    if (!next || !prev) return;
    const prevCue = Number(prev.cue), nextCue = Number(next.cue);
    if (!Number.isFinite(prevCue) || !Number.isFinite(nextCue)) {
      return toast(t("両方のキューを先に決めてください", "Set both cues first"));
    }
    const target = Math.round((nextCue - prevCue) * 10) / 10;
    if (target < 0) {
      // 前のキューが後ろにある。長さの問題ではないので、縮めても直らない
      return toast(t("前のシーケンスの方が後ろにあります", "The previous cue comes after this one"));
    }
    // A/Bは選択肢ごとに長さを持つ。はみ出しているものだけ縮める
    const targets = isSlot(prev) ? prev.options : [prev];
    for (const o of targets) if (editorDurationSource(o) > target) o.dur = target;
    render();
    toast(t(`前のシーケンスを ${target.toFixed(1)}秒 にしました`,
            `Previous sequence set to ${target.toFixed(1)}s`));
  };

  // ---------- スライド中は縦の操作を止める ----------
  // 少しでも縦に動くとブラウザが縦スクロールを始め、こちらへは pointercancel が飛ぶ。
  // 後始末が走らないまま拡大表示が残り、固まったように見えていた。
  // 値を合わせている間は、そもそも縦へ動かせないようにする。
  let slideLock = 0;
  window.beginValueSlide = (el, pointerId) => {
    slideLock++;
    document.body.classList.add("value-sliding");
    // 以降のポインタ操作をこの要素へ固定する(指が要素から外れても追従させる)
    try { el.setPointerCapture(pointerId); } catch (_) {}
  };
  window.endValueSlide = (el, pointerId) => {
    slideLock = Math.max(0, slideLock - 1);
    if (!slideLock) document.body.classList.remove("value-sliding");
    try { el.releasePointerCapture(pointerId); } catch (_) {}
  };
  // touch-action だけでは、動き出したスクロールを止められない。ここで実際に止める
  document.addEventListener("touchmove", (e) => {
    if (slideLock && e.cancelable) e.preventDefault();
  }, { passive: false });

  // ---------- 長さを横スライドで変える ----------
  // 曲位置と同じ操作で長さも変えられるようにする。数値を合わせる動作が2種類あると、
  // どちらがどちらだったか毎回思い出すことになる。
  // 押しただけならシートが開く(細かく決めたいとき)。横に動かしたときだけスライド。
  let durDrag = null;

  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest && e.target.closest("button.es-duration");
    if (!btn || view.name !== "edit" || !draft) return;
    const i = Number(btn.dataset.i);
    const targets = durationTargets(i);
    // A/Bを表示中で長さが2つある行は、どちらを動かすのか決まらないのでシートに任せる
    if (targets.length !== 1) return;
    durDrag = { btn, i, target: targets[0], startX: e.clientX, startY: e.clientY, pointerId: e.pointerId,
      base: editorDurationSource(targets[0]), moved: false, cur: null };
  }, true);

  document.addEventListener("pointermove", (e) => {
    if (!durDrag) return;
    const dx = e.clientX - durDrag.startX, dy = e.clientY - durDrag.startY;
    if (!durDrag.moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { durDrag = null; return; } // 縦スクロール優先
      durDrag.moved = true;
      durDrag.btn.classList.add("sliding");
      beginValueSlide(durDrag.btn, durDrag.pointerId); // 合わせている間は縦へ動かせなくする
    }
    durDrag.cur = Math.min(600, Math.max(0, Math.round((durDrag.base + dx * 0.05) * 10) / 10));
    // 値を実際に入れてからラベルを作り直す。表示の作り方を二重に持つと、
    // A/B非表示時の「長さ A 2.0秒」のような書き分けがすぐずれる
    durDrag.target.dur = durDrag.cur;
    const s = draft.steps[durDrag.i];
    const rt = state.routines.find((r) => r.id === view.params.id) || null;
    durDrag.btn.textContent = editorDurationLabel(s, routineFeatureEnabled(rt, "showSlots", draft.featureSettings));
  });

  // 中断(pointercancel)でも必ず後始末する。欠くと拡大表示が出たまま固まる。
  function endDurDrag(commit) {
    if (!durDrag) return;
    const d = durDrag; durDrag = null;
    d.btn.classList.remove("sliding");
    if (!d.moved) return;
    endValueSlide(d.btn, d.pointerId);
    if (d.cur == null) return;
    swipeSuppressClick = true; // 指を離した拍子にシートが開かないようにする
    setTimeout(() => { swipeSuppressClick = false; }, 80);
    render();
  }
  document.addEventListener("pointerup", () => endDurDrag(true));
  document.addEventListener("pointercancel", () => endDurDrag(false), true);

  // 編集画面が描き直されるたび、マイナス区間のボタンを足し直す。
  // subtree を見るので、自分が足したボタンでも監視が再発火する。
  // 二重に足さない作りにはしてあるが、まとめて1回で済ませる。
  const appEl = document.getElementById("app");
  if (appEl) {
    let queued = false;
    const soon = () => {
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; addShrinkButtons(); }, 0);
    };
    new MutationObserver(soon).observe(appEl, { childList: true, subtree: true });
    addShrinkButtons();
  }
})();
