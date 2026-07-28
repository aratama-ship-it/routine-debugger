/* ルーティンノート — サンプル素材の自己修復と後片付け
 *
 * 見つかった不具合:
 *   サンプルシーケンスは「記録(名前・長さ)」と「動画の実体(Blob)」が別々に保存されている。
 *   実体だけが失われることがある(容量不足でブラウザに消される、古いバックアップからの
 *   復元、シーケンスだけを削除した、など)。
 *   ところが取得処理は「記録があるか」しか見ていなかったため、実体が無くても
 *   「もうある」と判断して取り直さない。
 *   利用者が「サンプルを読み込む」を押しても『既にあります』と出るだけで、
 *   一度消えた動画は二度と戻らなかった。
 *
 * 直し方:
 *   実体の有無まで確かめ、欠けていれば同じ入れ物へ取り直す。
 *   記録ごと作り直すとIDが変わり、そのシーケンスを借りていた本人のルーティンの
 *   紐付けまで切れてしまうため、記録には触らない。
 *   起動時に静かに直すので、利用者は気づかないまま元に戻る。
 *
 * もう一つ: サンプル演目を消してもシーケンスライブラリにシーケンス9本が残り続けていた。
 * ひとまとめで入れたものなので、演目を消したらシーケンスも一緒に片付ける。
 * ただし本人のルーティンで使っているシーケンスは残す。
 *
 * 手を出す範囲はサンプルだけに限る。本人が自分で消したシーケンスまで復活させない。
 * app.js が容量上限に近いため、既存関数を包む形でここに置く。
 */
(() => {
  "use strict";

  // 実体が無くなったサンプルシーケンスを、元の場所へ取り直す。戻り値は直した数。
  //
  // 記録ごと捨てて作り直すとシーケンスのIDが変わる。すると、そのシーケンスを使っていた
  // 「本人のルーティン」の紐付けまで切れてしまう(サンプルから借りたシーケンスはよくある)。
  // なので記録はそのままに、同じ入れ物へ実体だけ書き戻す。
  async function refetchBrokenSampleBlobs() {
    const samples = (state.tricks || []).filter((x) => x.sample);
    if (!samples.length || !location.protocol.startsWith("http")) return 0;
    let fixed = 0;
    for (const t of samples) {
      let alive = false;
      try { alive = !!(await blobGet(t.blobId)); } catch (_) { alive = false; }
      if (alive) continue;
      // 元ファイルの割り出しは、取得処理(ensureSampleTricks)と同じ名前の照合に合わせる
      const src = SAMPLE_TRICKS.find((s) => t.name.startsWith(s.n));
      if (!src) continue;
      try {
        const resp = await fetch(src.f);
        if (!resp.ok) continue;
        if (await blobPut(t.blobId, await resp.blob())) fixed++;
      } catch (_) { /* 通信できないだけ。次の起動でまた試す */ }
    }
    return fixed;
  }

  // 消えたシーケンスを指したままの紐付けを外す。サンプルのルーティンに限る
  // (本人のルーティンでシーケンスを消した場合は、本人の意思なので触らない)。
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

  window.repairSampleMedia = async function repairSampleMedia() {
    // 取り直すのは「実体だけ失われた」場合に限る。
    // シーケンスの記録ごと無いのは本人が消したからかもしれず、勝手に戻すと削除の意味がなくなる。
    const fixed = await refetchBrokenSampleBlobs();
    // 消えたシーケンスを指したままの紐付けは、取り直しとは関係なく外しておく
    const unlinked = dropDanglingSampleLinks();
    if (!fixed && !unlinked) return { repaired: 0 };
    saveState();
    if (view.name === "home" || view.name === "tricks") render();
    return { repaired: fixed + unlinked };
  };

  // ---------- サンプル演目を消したら、シーケンスも一緒に片付ける ----------
  // サンプルは「演目+シーケンス9本」をひとまとめで入れている。演目だけ消えてシーケンスが残ると、
  // 片付けたつもりの人のシーケンスライブラリにサンプルが居座り続ける。
  // ただし本人のルーティンで使っているシーケンスは残す(消すと本人の構成が壊れる)。
  async function removeUnusedSampleTricks() {
    if ((state.routines || []).some((r) => r.sampleSet)) return 0; // 別のサンプル演目がまだある
    const used = new Set();
    for (const rt of state.routines || []) {
      for (const ver of rt.versions || []) {
        for (const step of ver.steps || []) {
          if (step.trickId) used.add(step.trickId);
          for (const opt of step.options || []) if (opt.trickId) used.add(opt.trickId);
        }
      }
    }
    const doomed = (state.tricks || []).filter((t) => t.sample && !used.has(t.id));
    if (!doomed.length) return 0;
    const ids = new Set(doomed.map((t) => t.id));
    state.tricks = (state.tricks || []).filter((t) => !ids.has(t.id));
    for (const t of doomed) {
      if (!(state.tricks || []).some((x) => x.blobId === t.blobId)) await blobDel(t.blobId);
    }
    saveState(); render();
    return doomed.length;
  }
  window.removeUnusedSampleTricks = removeUnusedSampleTricks;

  if (typeof window.performRoutineDelete === "function") {
    const originalDelete = window.performRoutineDelete;
    window.performRoutineDelete = async function wrappedPerformRoutineDelete(id) {
      const target = (state.routines || []).find((r) => r.id === id);
      const wasSample = !!(target && target.sampleSet);
      const out = await originalDelete.apply(this, arguments);
      if (!wasSample) return out;
      const n = await removeUnusedSampleTricks();
      if (n) {
        toast(isEnglish()
          ? `Sample removed (${n} sample sequences too)`
          : `サンプルを削除しました(シーケンス${n}本も一緒に片付けました)`);
      }
      return out;
    };
  }

  // 「サンプルを読み込む」を押したときも、まず壊れている分を捨ててから通す。
  // これが無いと『既にあります』で終わり、利用者に打つ手が無くなる。
  if (typeof window.loadSampleSet === "function") {
    const original = window.loadSampleSet;
    window.loadSampleSet = async function wrappedLoadSampleSet() {
      await refetchBrokenSampleBlobs();
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
