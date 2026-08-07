/* ルーティンノート — 初回チュートリアル
 *
 * 機能を順に読み上げるツアーではなく、実際の画面で基本の一周を体験させる。
 *   サンプルを見る → 1か所だけ直す → 通しを1本記録する → 分析で見る → その区間を繰り返す
 *
 * 伝えたい一文:
 *   ルーティンノートは、演技を通した記録から、次に練習する場所を決めるノート。
 *
 * 設計の要点:
 *  - 説明の吹き出しを画面へ重ねない。稽古ノートの付箋のように、1枚だけ下に置く
 *  - 各段は「求める操作は一つ」。押せば目的の画面まで連れて行く
 *  - 進んだかどうかは、こちらで勝手に判定する(利用者に報告させない)。
 *    ただし判定に頼りきらず、いつでも「次へ」で進める。詰まらせない方が大事
 *  - 進み具合は端末内にだけ持つ。「使い方を見たか」は端末ごとの話なので同期しない
 *  - 実データには触らない。読み込むのは既存のサンプル一式だけ
 *
 * 計画書: docs/2026-07-27-tutorial-plan.md
 * app.js が容量上限に近いため、UIも判定もこのファイルで完結させる。
 */
(() => {
  "use strict";

  const TUT_VERSION = 2;
  const LAST = 6;                 // 最後の段(0..6)。7で完了画面
  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh ? window.RoutineI18nZh.text(ja) : ja));

  // ---------- 進み具合 ----------
  function tut() {
    if (!state.settings) state.settings = {};
    const cur = state.settings.tutorial;
    if (!cur || cur.version !== TUT_VERSION) {
      state.settings.tutorial = { version: TUT_VERSION, status: "not_started", step: 0 };
    }
    return state.settings.tutorial;
  }
  const isActive = () => tut().status === "active";
  function setTut(patch) {
    Object.assign(tut(), patch);
    if (typeof saveState === "function") saveState();
  }

  const sampleRoutine = () => (state.routines || []).find((r) => r.sampleSet) || null;

  function runCount() {
    const rt = sampleRoutine();
    if (!rt) return 0;
    return (state.sessions || [])
      .filter((s) => s.routineId === rt.id)
      .reduce((n, s) => n + ((s.runs || []).length), 0);
  }
  function versionCount() {
    const rt = sampleRoutine();
    return rt ? (rt.versions || []).length : 0;
  }

  // 段に入った時点の値を控えておき、「増えたか」で進んだと判定する。
  // サンプルには最初から40本の記録が入っているので、総数では判定できない。
  let baseline = {};

  // ---------- 各段 ----------
  // done() は「利用者がその段の狙いを達成したか」。満たせば自動で次へ進む。
  const STEPS = [
    null, null, // 0,1 はシートで出すので付箋は使わない。サンプルの読み込みも1で済ませる
    {
      title: t("構成を1か所だけ直します", "Change one thing"),
      body: t("ルーティンは、演技の順番を書いた一枚のシートです。並びか名前をひとつ変えて、保存してみましょう。",
              "A routine is one sheet listing the order of your act. Change one thing and save."),
      cta: t("サンプルを開く", "Open the sample"),
      run: () => { const rt = sampleRoutine(); if (rt) go("edit", { id: rt.id }); },
      done: () => versionCount() > (baseline.versions || 0),
      after: t("構成を変えると新しい版として残ります。前の記録と混ざらず、後から比べられます。",
               "Edits are kept as a new version, so past records stay separate and comparable."),
    },
    {
      title: t("通しを1本、記録します", "Record one run"),
      body: t("本番のように構えたら、スタート。崩れた場所だけ、その場でタップして残します。最後まで行けたら「完走」。",
              "Get set, then start. Tap only where it breaks down. Tap Finish when you reach the end."),
      cta: t("練習をひらく", "Open practice"),
      run: () => { const rt = sampleRoutine(); if (rt) go("record", { id: rt.id }); },
      done: () => runCount() > (baseline.runs || 0),
      after: t("記録できました。次は、この1本から何を練習するか見てみます。",
               "Recorded. Now let's see what this run tells you to practise."),
    },
    {
      title: t("崩れた場所を分析で見ます", "See where it broke"),
      body: t("さきほど記録した場所が反映されています。1本では「観察した場所」。記録が増えると、繰り返し崩れる場所が見えてきます。",
              "Your run is reflected here. One run is just an observation; patterns appear as records pile up."),
      cta: t("分析をひらく", "Open analysis"),
      run: () => { const rt = sampleRoutine(); if (rt) go("stats", { id: rt.id }); },
      done: () => view.name === "stats",
    },
    {
      title: t("その区間だけ繰り返します", "Loop just that part"),
      body: t("気になった場所だけを繰り返します。記録 → 分析 → パート練習が、このノートの基本の一周です。",
              "Repeat only the part you care about. Record → analyse → drill is the loop."),
      cta: t("パート練習をひらく", "Open part practice"),
      run: () => { const rt = sampleRoutine(); if (rt) go("part", { id: rt.id }); },
      done: () => view.name === "part",
    },
    {
      title: t("最後に、記録の守り方を", "Finally, keeping your records"),
      body: t("今日の記録は、この端末に保存されました。大切な記録が増えたら「完全バックアップ」からZIPを書き出し、端末の外へ置いてください。",
              "Today's records are stored on this device. As they pile up, export a full backup ZIP and keep it off-device."),
      cta: t("設定をひらく", "Open settings"),
      run: () => go("settings"),
      done: () => view.name === "settings",
    },
  ];

  // ---------- 付箋 ----------
  function bar() {
    let el = document.getElementById("tut-bar");
    if (!el) {
      el = document.createElement("div");
      el.id = "tut-bar";
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", t("チュートリアル", "Tutorial"));
      document.body.appendChild(el);
    }
    return el;
  }
  function hideBar() {
    const el = document.getElementById("tut-bar");
    if (el) el.remove();
    document.body.classList.remove("tut-on", "tut-above-bottombar");
  }

  function renderBar() {
    const s = tut();
    if (!isActive() || s.step < 2 || s.step > LAST) return hideBar();
    const step = STEPS[s.step];
    if (!step) return hideBar();
    const el = bar();
    const html = `
      <div class="tut-head">
        <span class="tut-sheet">SHEET ${String(s.step - 1).padStart(2, "0")} / 05</span>
        <button class="tut-skip" onclick="tutorialSkip()">${t("やめる", "Quit")}</button>
      </div>
      <b class="tut-title">${step.title}</b>
      <p class="tut-body">${step.body}</p>
      <div class="tut-actions">
        <button class="tut-go" onclick="tutorialRun()">${step.cta}</button>
        <button class="tut-next" onclick="tutorialNext()">${t("次へ", "Next")}</button>
      </div>`;
    if (el.innerHTML !== html) el.innerHTML = html; // 同じ内容なら書き換えない
    document.body.classList.add("tut-on");
    // 記録画面には下部の操作バーがあるので、その上へ逃がす
    document.body.classList.toggle("tut-above-bottombar", !!document.querySelector(".bottombar"));
  }

  // ---------- ホームの「前回のルーティン」に置く入口 ----------
  // ダウンロードした直後は、ここに「まだ練習したルーティンはありません」と出るだけで
  // 次に何をすればいいか分からない。最初にやることをその場所へ置く。
  // チュートリアルを終えるとサンプルのルーティンができるので、この案内は自然に消える。
  function renderHomeEntry() {
    const slot = document.querySelector(".home-recent-empty");
    if (!slot) return;
    if ((state.routines || []).length) return; // 1本でもあれば、案内より本人のルーティンが先
    const html = `<button class="home-tutorial-card" onclick="tutorialStart()">
      <span class="htc-kicker">${t("はじめに", "Start here")}</span>
      <b>${t("チュートリアル", "Tutorial")}</b>
      <span class="htc-sub">${t("サンプルの演目で、記録から次の練習を決めるまでを試す（5分ほど）",
        "Use the sample act to go from a run to your next practice (about 5 min)")}</span>
    </button>`;
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }

  // ---------- 読ませる画面(0,1と完了) ----------
  function sheetIntro() {
    showSheet(`
      <h3>${t("通すたびに、次に練習する場所が決まる", "Every run tells you what to practise next")}</h3>
      <p class="tut-lead">${t(
        "ルーティンノートは、シーケンスを並べるだけのアプリではありません。演技を通して、崩れた場所を残し、次の練習へつなげるノートです。",
        "This is not just a place to list tricks. You run your act, leave a mark where it broke, and decide what to practise next.")}</p>
      <p class="sheet-note">${t("サンプルの演目を読み込んで、記録から次の練習を決めるところまで試します（5分ほど）。",
        "We'll use a sample to go from recording to deciding what's next (about 5 minutes).")}</p>
      <button class="btn primary" onclick="tutorialToStep(1)">${t("サンプルで試す", "Try it with the sample")}</button>
      <button class="btn ghost" onclick="tutorialSkip()">${t("あとで", "Later")}</button>`);
  }

  function sheetPromise() {
    showSheet(`
      <h3>${t("はじめに、データのこと", "First, about your data")}</h3>
      <div class="tut-promise">
        <div><b>${t("この端末に保存されます", "Stored on this device")}</b>
          <span>${t("ルーティン、練習の記録、動画、音源は、まずこの端末のブラウザに保存されます。",
            "Routines, records, videos and audio are saved in this device's browser first.")}</span></div>
        <div><b>${t("アカウントは任意です", "An account is optional")}</b>
          <span>${t("作らなくても全部使えます。ログインするとルーティンと記録を端末間で同期しますが、動画・音源はこの端末に残ります。",
            "Everything works without one. Signing in syncs routines and records, but videos and audio stay here.")}</span></div>
        <div><b>${t("大切な記録はバックアップを", "Back up what matters")}</b>
          <span>${t("ブラウザのデータを消すと失われます。大切な記録ができたら、完全バックアップZIPを端末の外へ。",
            "Clearing browser data loses them. Export a full backup ZIP and keep it off-device.")}</span></div>
      </div>
      <button class="btn primary" onclick="tutorialLoadSample()">${
        t("サンプルを読み込んで始める", "Load the sample and start")}</button>
      <button class="btn ghost" onclick="openDocPage('backup.html')">${t("詳しく見る", "Read more")}</button>`);
  }

  // サンプルの読み込みは、段として利用者に任せず最初に済ませる。
  // 「次へ」で飛ばせる作りにしていたため、読み込まないまま進むと以降の画面が空になり、
  // 動画も出ないまま説明だけが続いてしまっていた。
  window.tutorialLoadSample = async () => {
    hideSheet();
    // loadSampleSet は「追加しますか?」と確認する。直前の画面で答えてもらった問いなので、
    // ここでは二度聞かない。読み込みのあいだだけ、その1問に自動で答える。
    const origConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await loadSampleSet();
    } catch (_) { /* 下で結果を見て判断する */ } finally {
      window.confirm = origConfirm;
    }
    if (sampleRoutine()) return enterStep(2);
    // 通信できないとサンプルを取得できない。空の画面へ放り出さず、選べるようにする
    showSheet(`
      <h3>${t("サンプルを読み込めませんでした", "Could not load the sample")}</h3>
      <p class="tut-lead">${t("初回だけ通信が必要です。電波の良い場所で、もう一度お試しください。",
        "The first load needs a connection. Please try again where the signal is better.")}</p>
      <button class="btn primary" onclick="tutorialLoadSample()">${t("もう一度読み込む", "Try again")}</button>
      <button class="btn ghost" onclick="tutorialSkip();go('edit',{})">${
        t("自分のルーティンから始める", "Start with my own routine")}</button>`);
  };

  function sheetDone() {
    setTut({ status: "completed", completedAt: Date.now(), step: LAST + 1 });
    hideBar();
    showSheet(`
      <h3>${t("最初の1本を記録できました", "You recorded your first run")}</h3>
      <p class="tut-lead">${t("次は、自分の曲とシーケンスでルーティンを作ってみましょう。",
        "Next, build a routine with your own music and sequences.")}</p>
      <p class="sheet-note">${t("サンプルは残してあります。要らなくなったら、ルーティン一覧から削除できます。いつでも「使い方 → チュートリアル」からやり直せます。",
        "The sample is still there; delete it from the routine list when you're done. You can redo this any time from Guide → Tutorial.")}</p>
      <button class="btn primary" onclick="hideSheet();newRoutine()">${t("自分のルーティンを作る", "Create my routine")}</button>
      <button class="btn ghost" onclick="hideSheet();go('home')">${t("ホームへ", "Home")}</button>`);
  }

  // ---------- 進行 ----------
  function enterStep(n) {
    baseline = { runs: runCount(), versions: versionCount() };
    setTut({ status: "active", step: n });
    if (n === 0) return sheetIntro();
    if (n === 1) return sheetPromise();
    if (n > LAST) return sheetDone();
    hideSheet();
    renderBar();
  }

  window.tutorialToStep = (n) => enterStep(n);

  window.tutorialStart = () => {
    setTut({ status: "active", step: 0, startedAt: Date.now() });
    enterStep(0);
  };

  window.tutorialSkip = () => {
    setTut({ status: "skipped" });
    hideBar(); hideSheet();
    toast(t("「使い方 → チュートリアル」からいつでも始められます", "You can start it any time from Guide → Tutorial"));
  };

  window.tutorialRun = () => {
    const step = STEPS[tut().step];
    if (step && step.run) step.run();
  };

  window.tutorialNext = () => {
    const s = tut();
    const step = STEPS[s.step];
    if (step && step.after) toast(step.after);
    enterStep(s.step + 1);
  };

  // ---------- 進んだかどうかを見る ----------
  // 判定は控えめに。満たしたら次へ送るが、満たせなくても「次へ」で必ず進める。
  function check() {
    renderHomeEntry();
    if (!isActive()) return hideBar();
    const s = tut();
    if (s.step < 2 || s.step > LAST) return;
    const step = STEPS[s.step];
    if (!step) return;
    let ok = false;
    try { ok = !!step.done(); } catch (_) { ok = false; }
    if (ok) return window.tutorialNext();
    renderBar();
  }
  // タイマーだけに頼らない。タブが背面にあると間引かれて止まってしまう。
  // 判定が要るのは「画面が変わった直後」なので、そこで必ず見る。
  let queued = false;
  function checkSoon() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; check(); }, 0);
  }
  setInterval(check, 700);                                   // 保険
  document.addEventListener("visibilitychange", checkSoon);

  // 画面が差し替わっても付箋を消さない(#app の直下だけ見る。subtreeだと自分の書き換えで再発火する)
  const appEl = document.getElementById("app");
  if (appEl) new MutationObserver(checkSoon).observe(appEl, { childList: true });

  // ---------- 初回 ----------
  // まだ何も作っていない人にだけ、こちらから声をかける。
  // すでに自分のルーティンがある人の邪魔はしない(その人には説明より画面の方が早い)。
  setTimeout(() => {
    if (!state || !state.settings) return;
    const s = tut();
    if (s.status !== "not_started") { if (isActive()) enterStep(s.step); return; }
    if ((state.routines || []).some((r) => !r.sampleSet)) { setTut({ status: "skipped" }); return; }
    window.tutorialStart();
  }, 1400);
})();
