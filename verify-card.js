/* M1: 記録の観測だけを示す。原因の推定や処方は行わない。 */
(() => {
  "use strict";
  const t = (ja, en) => typeof isEnglish === "function" && isEnglish() ? en
    : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh
      ? window.RoutineI18nZh.text(ja) : ja);

  // Lanczos log-gamma and Numerical Recipes' continued fraction for I_x(a,b).
  function logGamma(z) {
    const c = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
      -176.6150291621406, 12.507343278686905, -0.13857109526572012,
      9.984369578019572e-6, 1.5056327351493116e-7];
    z -= 1;
    let x = 0.9999999999998099;
    c.forEach((v, i) => { x += v / (z + i + 1); });
    const q = z + 7.5;
    return 0.9189385332046727 + (z + 0.5) * Math.log(q) - q + Math.log(x);
  }
  function betacf(a, b, x) {
    const tiny = 1e-300;
    const safe = (v) => Math.abs(v) < tiny ? tiny : v;
    let c = 1, d = 1 / safe(1 - (a + b) * x / (a + 1)), h = d;
    for (let m = 1; m <= 200; m++) {
      let aa = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
      d = 1 / safe(1 + aa * d); c = safe(1 + aa / c); h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 / safe(1 + aa * d); c = safe(1 + aa / c);
      const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < 3e-14) return h;
    }
    return h;
  }
  function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const f = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
      + a * Math.log(x) + b * Math.log1p(-x));
    return x < (a + 1) / (a + b + 2)
      ? f * betacf(a, b, x) / a : 1 - f * betacf(b, a, 1 - x) / b;
  }
  function jeffreysInterval(k, n, level = 0.8) {
    const quantile = (p) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (betaCdf(mid, k + 0.5, n - k + 0.5) < p) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    return { lo: quantile((1 - level) / 2), hi: quantile((1 + level) / 2) };
  }
  const recentRuns = (runs, recent = 10) => runs.filter((r) => !r.excluded).slice(-recent);
  function pickWeakestStep(ver, runs, minAttempted = 5, recent = 10) {
    const used = recentRuns(runs, recent);
    let best = null;
    (ver.steps || []).forEach((step, index) => {
      let reached = 0, n = 0, k = 0;
      for (const run of used) {
        if (!(run.reachedIndex >= index)) continue;
        reached++;
        const events = (run.events || []).filter((e) => e.stepIndex === index);
        const failed = events.some((e) => e.type !== "not_attempted");
        if (failed || !events.some((e) => e.type === "not_attempted")) n++;
        if (failed) k++;
      }
      if (n < minAttempted || k < 1) return;
      if (!best || k * best.n > best.k * n || (k * best.n === best.k * n && k > best.k)) {
        best = { index, step, k, n, reached, runsUsed: used.length };
      }
    });
    return best;
  }
  function tagCounts(runs, index) {
    const counts = new Map();
    for (const run of runs) {
      if (run.excluded || !(run.reachedIndex >= index)) continue;
      for (const e of run.events || []) {
        if (e.stepIndex !== index || e.type === "not_attempted") continue;
        for (const tag of e.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n).slice(0, 3);
  }
  window.RoutineVerifyCard = { jeffreysInterval, pickWeakestStep, tagCounts };

  const value = (s) => `<span data-user-text>${esc(String(s))}</span>`;
  // 翻訳する定型と、翻訳しない名前・数値を分ける。
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => value(values[key]));
  function context(latest = false, routineId = null) {
    if (typeof view === "undefined") return null;
    const id = routineId || (view.params && view.params.id);
    const rt = state.routines.find((r) => r.id === id);
    if (!rt) return null;
    const ver = latest ? latestVersion(rt) : getVersion(rt, view.params.versionId || latestVersion(rt).id);
    if (!ver) return null;
    const runs = recentRuns(runsOfVersion(rt.id, ver.id));
    const pick = pickWeakestStep(ver, runs);
    if (!pick) return !latest && rt.experiment ? { rt, ver, runs, pick } : null;
    const interval = jeffreysInterval(pick.k, pick.n);
    return { rt, ver, runs, pick, values: { N: pick.runsUsed, S: stepLabel(pick.step),
      K: `${pick.k}/${pick.n}`, R: pick.reached, L: `${Math.round(interval.lo * 100)}〜${Math.round(interval.hi * 100)}%` } };
  }
  function addCard() {
    if (typeof view === "undefined" || view.name !== "stats" || document.getElementById("vc-card")) return;
    const topbar = document.querySelector("#app .topbar");
    const data = topbar && context();
    if (!data) return;
    const { rt, ver, runs, pick, values } = data;
    const card = document.createElement("div");
    card.id = "vc-card"; card.className = "card";
    if (rt.experiment && window.RoutineExperimentUI) {
      window.RoutineExperimentUI.mount(card, data); topbar.after(card); return;
    }
    const tags = tagCounts(runs, pick.index);
    card.innerHTML = `<h2>${t("検証支援（観測のみ）", "Verification support (observation only)")}</h2>
      <div class="vc-obs">${fill(t("直近 {N} 本で「{S}」が {K} 崩れた（到達 {R} 本）。80% 区間 {L}",
        "In the last {N} runs, “{S}” broke {K} (reached {R}). 80% interval {L}"), values)}</div>
      <p class="vc-tags">${tags.length ? t("本人の仮説タグ:", "Your hypothesis tags:") + " "
        + tags.map(({ tag, n }) => value(tag) + " ×" + value(n)).join(" ／ ")
        : t("原因タグの記録なし", "No cause tags recorded")}</p>
      <p class="vc-evidence">${t("証拠レベル: 観測のみ（まだ比較していません）", "Evidence level: observation only (not compared yet)")}</p>`;
    const dur = typeof musicLoadedFor !== "undefined" && musicLoadedFor === rt.id ? musicEffectiveDuration() || null : null;
    const range = rt.music && typeof window.partRangeAroundStep === "function"
      && window.partRangeAroundStep(ver, pick.index, dur);
    if (range) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.innerHTML = `${t("この前後をパート練習", "Practice this part")} ${value(`A ${fmtTime(range.a)} – B ${range.b == null ? t("曲末", "end") : fmtTime(range.b)}`)}`;
      btn.onclick = () => {
        rt.partLoop = { ...(rt.partLoop || {}), ...range };
        saveState(); go("part", { id: rt.id });
      };
      card.append(btn);
    }
    if (window.RoutineExperimentUI) window.RoutineExperimentUI.mount(card, data);
    topbar.after(card);
  }
  function addEndLine() {
    if (document.getElementById("vc-end-line")) return;
    const plan = document.querySelector("#sheet #end-plan");
    const label = plan && plan.previousElementSibling;
    if (!label || !label.matches("label.fld")) return;
    // 終了シートは record 画面以外から開かれることもあるので、シート内のボタンから id を拾う
    const finish = document.querySelector('#sheet [onclick^="endSession("]');
    const m = finish && finish.getAttribute("onclick").match(/^endSession\('([^']+)'\)/);
    const data = context(true, m ? m[1] : null);
    if (!data) return;
    const line = document.createElement("div");
    line.id = "vc-end-line";
    line.innerHTML = fill(t("いちばん崩れた: 「{S}」 {K}（80% 区間 {L}）",
      "Weakest spot: “{S}” {K} (80% interval {L})"), data.values);
    label.before(line);
  }
  window.RoutineVerifyCard.refresh = () => {
    document.getElementById("vc-card")?.remove(); addCard();
  };
  for (const [id, add] of [["app", addCard], ["sheet", addEndLine]]) {
    const root = document.getElementById(id);
    if (!root) continue;
    new MutationObserver(add).observe(root, { childList: true, subtree: true });
    add();
  }
})();
