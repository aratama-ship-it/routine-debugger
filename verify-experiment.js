/* M2/M3: 条件の案内とペアの観測。構成は書き換えない。 */
(() => {
  "use strict";
  const t = (ja, en) => typeof isEnglish === "function" && isEnglish() ? en
    : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh
      ? window.RoutineI18nZh.text(ja) : ja);
  const makePairs = (random = Math.random) => Array.from({ length: 3 }, () => ({ order: random() < 0.5 ? "HC" : "CH" }));
  const schedule = (pairs) => pairs.flatMap((p) => p.order === "HC" ? ["H", "C"] : p.order === "CH" ? ["C", "H"] : []);
  function assignConditions(session) {
    if (!session.experiment) return false;
    const conditions = schedule(session.experiment.pairs);
    let changed = false;
    (session.runs || []).slice(0, 6).forEach((run, i) => {
      if (conditions[i] && run.condition !== conditions[i]) { run.condition = conditions[i]; changed = true; }
    });
    return changed;
  }
  function evaluate(session, ver) {
    const xp = session.experiment;
    const result = { pairs: [], completed: 0, support: 0, against: 0, tie: 0 };
    if (!xp) return result;
    const outcome = (run) => {
      if (!run || !(run.reachedIndex >= xp.stepIndex)) return "unattempted";
      const events = (run.events || []).filter((e) => e.stepIndex === xp.stepIndex);
      if (events.some((e) => e.type !== "not_attempted")) return "failed";
      return events.length ? "unattempted" : "clean";
    };
    result.pairs = xp.pairs.map(({ order }, i) => {
      const a = outcome((session.runs || [])[i * 2]), b = outcome((session.runs || [])[i * 2 + 1]);
      const [h, c] = order === "HC" ? [a, b] : [b, a];
      let verdict = "incomplete";
      if (h !== "unattempted" && c !== "unattempted") {
        verdict = h === c ? "tie" : h === "clean" ? "support" : "against";
        result.completed++; result[verdict]++;
      }
      return { order, h, c, verdict };
    });
    return result;
  }
  function evidenceLevel(sessions) {
    const results = sessions.map((s) => evaluate(s));
    const n = results.reduce((sum, r) => sum + r.completed, 0);
    if (!n) return "insufficient";
    if (n < 3) return "pattern";
    const signs = results.filter((r) => r.completed >= 3).map((r) => Math.sign(r.support - r.against));
    return signs.length >= 2 && signs[0] !== 0 && signs.every((s) => s === signs[0]) ? "replicated" : "compared";
  }
  window.RoutineExperiment = { makePairs, schedule, assignConditions, evaluate, evidenceLevel };

  // sync.jsと同じ包み方。元の保存より先に追記し、保存を再帰呼出ししない。
  if (typeof window.saveState === "function") {
    const original = window.saveState;
    window.saveState = function wrappedExperimentSave() {
      for (const session of state.sessions || []) {
        if (!session.experiment && session.endedAt == null && session.runs?.length === 0) {
          const rt = (state.routines || []).find((r) => r.id === session.routineId);
          const xp = rt && rt.experiment;
          if (xp && session.versionId === xp.versionId && valid(rt, xp)) {
            const { id, stepId, stepIndex, versionId, intervention } = xp;
            session.experiment = { id, stepId, stepIndex, versionId, intervention, pairs: makePairs() };
          }
        }
        if (session.experiment) assignConditions(session);
      }
      return original.apply(this, arguments);
    };
  }
  function valid(rt, xp) {
    const ver = latestVersion(rt);
    return ver && ver.id === xp.versionId && ver.steps?.[xp.stepIndex]?.id === xp.stepId;
  }
  const change = (xp) => xp.intervention === "order" ? t("順序を変える", "reorder") : t("直前に間を入れる（1 拍）", "add a pause before it (one beat)");
  const value = (s) => `<span data-user-text>${esc(String(s))}</span>`;
  const fill = (s, values) => s.replace(/\{(\w+)\}/g, (_, k) => value(values[k]));
  function button(parent, label, action) {
    const el = document.createElement("button"); el.className = "btn"; el.textContent = label; el.onclick = action; parent.append(el);
  }
  function refresh() { window.RoutineVerifyCard.refresh(); }
  function mount(card, { rt, ver, pick }) {
    const xp = rt.experiment;
    if (!xp) {
      if (!pick) return;
      const heading = document.createElement("h3"); heading.textContent = t("試せること", "Things to try"); card.append(heading);
      for (const intervention of ["order", "gap"]) {
        button(card, intervention === "order" ? t("順序を変える（この技を前の位置へ）", "Reorder (move this sequence earlier)")
          : t("直前に間を入れる（1 拍）", "Add a pause before it (one beat)"), () => {
          if (rt.experiment) return;
          rt.experiment = { id: uid(), stepId: pick.step.id, stepIndex: pick.index, versionId: ver.id, intervention, createdAt: Date.now() };
          saveState(); toast(t("次のセッションから、現状(C)と変更(H)を 3 ペア試します", "From the next session, try 3 pairs of C (as-is) and H (change)")); refresh();
        });
      }
      return;
    }
    if (!valid(rt, xp)) {
      card.innerHTML = `<p>${t("構成が変わったため、この実験は続けられません", "The routine has changed, so this experiment cannot continue")}</p>`;
    } else {
      const sessions = (state.sessions || []).filter((s) => s.routineId === rt.id && s.experiment?.id === xp.id);
      const sum = sessions.map((s) => evaluate(s)).reduce((a, b) => {
        for (const k of ["completed", "support", "against", "tie"]) a[k] += b[k]; return a;
      }, { completed: 0, support: 0, against: 0, tie: 0 });
      const levels = { insufficient: t("観測不足", "insufficient"), pattern: t("パターン候補", "pattern candidate"),
        compared: t("比較済み", "compared"), replicated: t("再現あり", "replicated") };
      card.innerHTML = `<p>${fill(t("実験中: 「{S}」を {I} ─ 現状(C) と 変更(H) を 3 ペア", "Experiment: “{S}” — {I} — 3 pairs of C (as-is) and H (change)"),
        { S: stepLabel(latestVersion(rt).steps[xp.stepIndex]), I: change(xp) })}</p>
        <p>${fill(t("完了ペア {N} ／ 支持 {S} ・ 反対 {A} ・ 引き分け {T}（複数セッション合計）", "Completed pairs {N} / support {S} · against {A} · tie {T} (all sessions)"),
          { N: sum.completed, S: sum.support, A: sum.against, T: sum.tie })}</p>
        <p>${t("支持 = 変更(H)で通り現状(C)で崩れたペア、反対 = その逆", "Support = H clean and C failed; against = the reverse")}</p>
        <p>${fill(t("証拠レベル: {L}", "Evidence level: {L}"), { L: levels[evidenceLevel(sessions)] })}</p>`;
      if (sum.completed >= 3) {
        const p = document.createElement("p");
        p.textContent = t("別の日にもう 3 ペア試すと「再現あり」になります", "Try 3 more pairs on another day for replication"); card.append(p);
      }
    }
    button(card, t("実験を終える", "End experiment"), () => { delete rt.experiment; saveState(); refresh(); });
  }
  window.RoutineExperimentUI = { mount };
  function banner() {
    if (typeof view === "undefined" || view.name !== "record") return;
    const topbar = document.querySelector("#app .topbar");
    const session = activeSession(view.params.id);
    if (!topbar || !session?.experiment) return;
    const k = session.runs.length, xp = session.experiment;
    const text = k >= 6 ? t("実験の 3 ペアが終わりました。あとは自由に通せます", "The 3 pairs are done. Free runs from here.")
      : fill(t("実験 通し {K}/6 ─ 次は {C}", "Experiment: run {K}/6 — next is {C}"), { K: k,
        C: schedule(xp.pairs)[k] === "H" ? t("H（変更: {I}）", "H (change: {I})").replace("{I}", change(xp)) : t("C（現状どおり）", "C (as-is)") });
    let el = document.getElementById("xp-banner");
    if (el && el.dataset.xpText === text) return;
    if (!el) { el = document.createElement("div"); el.id = "xp-banner"; el.className = "card"; topbar.after(el); }
    el.dataset.xpText = text;
    el.innerHTML = text;
  }
  const root = document.getElementById("app");
  if (root) { new MutationObserver(banner).observe(root, { childList: true, subtree: true }); banner(); refresh(); }
})();
