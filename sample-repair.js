/* ルーティンノート — サンプル素材の自己修復
 *
 * 見つかった不具合:
 *   サンプル技は「記録(名前・長さ)」と「動画の実体(Blob)」が別々に保存されている。
 *   実体だけが失われることがある(容量不足でブラウザに消される、古いバックアップからの
 *   復元、技だけを削除した、など)。
 *   ところが取得処理は「記録があるか」しか見ていなかったため、実体が無くても
 *   「もうある」と判断して取り直さない。
 *   利用者が「サンプルを読み込む」を押しても『既にあります』と出るだけで、
 *   一度消えた動画は二度と戻らなかった。
 *
 * 直し方:
 *   実体の有無まで確かめ、欠けていれば記録ごと捨てて取り直す。
 *   その技を指していたステップの紐付けも外す(外さないと貼り直せない)。
 *   起動時に静かに直すので、利用者は気づかないまま元に戻る。
 *
 * 手を出す範囲はサンプルだけに限る。本人が自分で消した技まで復活させない。
 * app.js が容量上限に近いため、既存関数を包む形でここに置く。
 */
(() => {
  "use strict";

  // 実体が無くなったサンプル技を、記録ごと取り除く。戻り値は取り除いた数。
  async function dropBrokenSampleTricks() {
    const samples = (state.tricks || []).filter((x) => x.sample);
    if (!samples.length) return 0;
    const broken = [];
    for (const t of samples) {
      let alive = false;
      try { alive = !!(await blobGet(t.blobId)); } catch (_) { alive = false; }
      if (!alive) broken.push(t);
    }
    if (!broken.length) return 0;

    const ids = new Set(broken.map((t) => t.id));
    state.tricks = (state.tricks || []).filter((t) => !ids.has(t.id));
    // 紐付けを残したままだと、取り直しても貼り直されない(空いている所にしか貼らないため)
    for (const rt of state.routines || []) {
      for (const ver of rt.versions || []) {
        for (const step of ver.steps || []) {
          if (ids.has(step.trickId)) delete step.trickId;
          for (const opt of step.options || []) {
            if (ids.has(opt.trickId)) delete opt.trickId;
          }
        }
      }
    }
    return broken.length;
  }

  // 消えた技を指したままの紐付けを外す。サンプルのルーティンに限る
  // (本人のルーティンで技を消した場合は、本人の意思なので触らない)。
  function dropDanglingSampleLinks() {
    const alive = new Set((state.tricks || []).map((t) => t.id));
    let n = 0;
    for (const rt of (state.routines || []).filter((r) => r.sampleSet)) {
      for (const ver of rt.versions || []) {
        for (const step of ver.steps || []) {
          if (step.trickId && !alive.has(step.trickId)) { delete step.trickId; n++; }
          for (const opt of step.options || []) {
            if (opt.trickId && !alive.has(opt.trickId)) { delete opt.trickId; n++; }
          }
        }
      }
    }
    return n;
  }

  // 取り直して貼り直す。通信できなければ何もせず諦める(次の起動でまた試す)。
  async function refetchAndRelink() {
    if (!location.protocol.startsWith("http")) return false;
    try {
      await ensureSampleTricks();
    } catch (_) { return false; }
    for (const rt of (state.routines || []).filter((r) => r.sampleSet)) linkSampleVideos(rt);
    return true;
  }

  window.repairSampleMedia = async function repairSampleMedia() {
    const dropped = await dropBrokenSampleTricks();
    const unlinked = dropDanglingSampleLinks();
    if (!dropped && !unlinked) return { repaired: 0 };
    await refetchAndRelink();
    saveState();
    if (view.name === "home" || view.name === "tricks") render();
    return { repaired: dropped + unlinked };
  };

  // 「サンプルを読み込む」を押したときも、まず壊れている分を捨ててから通す。
  // これが無いと『既にあります』で終わり、利用者に打つ手が無くなる。
  if (typeof window.loadSampleSet === "function") {
    const original = window.loadSampleSet;
    window.loadSampleSet = async function wrappedLoadSampleSet() {
      await dropBrokenSampleTricks();
      dropDanglingSampleLinks();
      return original.apply(this, arguments);
    };
  }

  // 起動時に静かに直す。状態の読み込みが済んでから見に行く。
  setTimeout(() => {
    if (!state || !Array.isArray(state.tricks)) return;
    window.repairSampleMedia().catch(() => {});
  }, 2500);
})();
