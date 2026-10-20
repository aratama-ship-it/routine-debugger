/* 崩れたシーケンスの前後を、既存のパート練習へ渡す。 */
(() => {
  "use strict";
  const t = (ja, en) => typeof isEnglish === "function" && isEnglish() ? en
    : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh
      ? window.RoutineI18nZh.text(ja) : ja);

  function partRangeAroundStep(ver, i, dur) {
    const steps = ver && ver.steps;
    const step = steps && steps[i];
    if (!step || step.cue == null) return null;
    const prev = steps[i - 1], next = steps[Number(i) + 1];
    let a = prev && prev.cue != null ? prev.cue : Math.max(0, step.cue - 2);
    const endOfStep = step.cue + stepDur(step);
    let b = next && next.cue != null ? next.cue + stepDur(next) : endOfStep + 2;
    if (dur != null && dur > 0 && b >= dur - 0.05) b = null;
    a = Math.round(a * 10) / 10;
    if (b != null) b = Math.round(b * 10) / 10;
    if (b != null && b <= a) b = null;
    return { a, b };
  }
  window.partRangeAroundStep = partRangeAroundStep;

  // プレイヤーに別のルーティンの曲が残っている場合、有効長は不明とする。
  const durationFor = (rt) => typeof musicLoadedFor !== "undefined" && musicLoadedFor === rt.id
    ? musicEffectiveDuration() || null : null;
  function practice(rt, range, fromSheet) {
    rt.partLoop = { ...(rt.partLoop || {}), ...range };
    saveState();
    if (fromSheet) hideSheet();
    go("part", { id: rt.id });
  }

  function addDetailButton() {
    if (typeof view === "undefined" || view.name !== "stepdetail"
        || document.getElementById("pf-part-btn")) return;
    const app = document.getElementById("app");
    const overview = app && app.querySelector(".stat-overview");
    const rt = state.routines.find((r) => r.id === view.params.id);
    if (!overview || !rt || !rt.music) return;
    const range = partRangeAroundStep(getVersion(rt, view.params.versionId), view.params.stepIndex, durationFor(rt));
    if (!range) return;
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.id = "pf-part-btn";
    btn.innerHTML = `<span>${t("この前後をパート練習", "Practice this part")}</span> <span class="pf-range" data-user-text>A ${fmtTime(range.a)} – B ${range.b == null ? t("曲末", "end") : fmtTime(range.b)}</span>`;
    btn.onclick = () => practice(rt, range, false);
    overview.after(btn);
  }

  function addRecapButton() {
    const sheet = document.getElementById("sheet");
    if (!sheet || document.getElementById("pf-recap-btn")) return;
    const recap = sheet.querySelector(".recap");
    const start = sheet.querySelector('[onclick^="startSession("]');
    const match = start && start.getAttribute("onclick").match(/^startSession\('([^']+)'\)/);
    if (!recap || !match) return;
    const rt = state.routines.find((r) => r.id === match[1]);
    if (!rt || !rt.music) return;
    const last = state.sessions.filter((s) => s.routineId === rt.id && s.endedAt)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!last) return;
    const counts = new Map();
    for (const run of last.runs || []) {
      if (run.excluded) continue;
      for (const event of run.events || []) {
        if (!countedFailureEvent(event)) continue;
        const i = event.stepIndex;
        if (Number.isInteger(i) && i >= 0) counts.set(i, (counts.get(i) || 0) + 1);
      }
    }
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (!top) return;
    const ver = getVersion(rt, last.versionId);
    const range = partRangeAroundStep(ver, top[0], durationFor(rt));
    if (!range) return;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.id = "pf-recap-btn";
    btn.innerHTML = `<span>${t("前回いちばん崩れた", "Practice last time's weakest spot")}</span>「<span data-user-text>${esc(stepLabel(ver.steps[top[0]]))}</span>」<span>${t("をパート練習", "")}</span>`;
    btn.onclick = () => practice(rt, range, true);
    recap.after(btn);
  }

  for (const [id, add] of [["app", addDetailButton], ["sheet", addRecapButton]]) {
    const root = document.getElementById(id);
    if (!root) continue;
    new MutationObserver(add).observe(root, { childList: true, subtree: true });
    add();
  }
})();
