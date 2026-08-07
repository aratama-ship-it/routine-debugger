/* ルーティンノート — 今日の練習をシェアする
 *
 * セッションを終えた人が、その日の結果(通し本数・クリーン・崩れた場所)を
 * カード画像つきでXなどへ投稿できるようにする。
 * 練習報告の文化がある界隈なので、投稿1枚ごとにアプリの画とURLが載ることが
 * いちばん嘘のない宣伝になる(作者はもう現役ではないため、使う人が主役)。
 *
 * 方式:
 *  - iPhone等: Web Share API(navigator.share)で画像+文面を共有シートへ
 *  - 使えない環境: X のツイート画面(intent)を文面つきで開き、画像は保存ボタンで
 * 送るかどうかは毎回本人がボタンを押して決める。勝手に投稿はしない。
 *
 * app.js が容量上限に近いため、集計・カード描画・共有はここに置く。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : (typeof uiLanguage === "function" && uiLanguage() === "zh" && window.RoutineI18nZh ? window.RoutineI18nZh.text(ja) : ja));
  const APP_URL = "https://routine-note.pygmix.com/";

  // ---------- その日の集計 ----------
  function summarize(sess, rt) {
    const runs = sess.runs || [];
    const clean = runs.filter((r) => r.outcome === "clean").length;
    // どのステップで何回崩れたか(そのセッションの版のステップ名で)
    const ver = (rt.versions || []).find((v) => v.id === sess.versionId)
      || (typeof latestVersion === "function" ? latestVersion(rt) : null);
    const counts = new Map();
    for (const run of runs) {
      for (const ev of (run.events || [])) {
        if (ev.type === "skipped" || ev.type === "not_attempted") continue;
        const step = ver && ver.steps ? ver.steps[ev.stepIndex] : null;
        const name = (step && (step.name || (typeof stepLabel === "function" ? stepLabel(step) : ""))) || "";
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    const misses = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { total: runs.length, clean, misses };
  }

  // ---------- カード画像(1080x1080, ルーズリーフ調) ----------
  function drawCard(sess, rt, sum) {
    const S = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    const c = canvas.getContext("2d");
    if (!c) return null;

    // 紙
    c.fillStyle = "#ECE4D0"; c.fillRect(0, 0, S, S);
    // 罫線(ルーズリーフの気配。文字の可読を邪魔しない薄さ)
    c.strokeStyle = "rgba(73, 99, 124, .12)"; c.lineWidth = 2;
    for (let y = 180; y < S - 120; y += 72) {
      c.beginPath(); c.moveTo(72, y); c.lineTo(S - 72, y); c.stroke();
    }
    // 左端の綴じ側の帯と穴
    c.fillStyle = "#2F332E"; c.fillRect(0, 0, 44, S);
    c.fillStyle = "#aaa598";
    for (let y = 120; y < S; y += 200) {
      c.beginPath(); c.arc(22, y, 9, 0, Math.PI * 2); c.fill();
    }

    const ink = "#2B2A26", muted = "#6B675C", accent = "#B5651D";
    const jp = '-apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';

    // 見出し: 日付と演目名
    const date = new Date(sess.endedAt || Date.now());
    const dateText = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
    c.fillStyle = muted; c.font = `700 34px ${jp}`;
    c.fillText(dateText, 96, 96);
    c.fillStyle = ink; c.font = `800 46px ${jp}`;
    const name = (typeof routineDisplayName === "function" ? routineDisplayName(rt) : rt.name) || "";
    c.fillText(name.length > 16 ? name.slice(0, 15) + "…" : name, 96, 154);

    // 大きな数字: 通し / クリーン
    const half = (S - 96 * 2) / 2;
    const numY = 330;
    c.fillStyle = accent; c.font = `800 120px ${jp}`;
    c.fillText(String(sum.total), 96, numY);
    c.fillStyle = ink; c.font = `700 36px ${jp}`;
    c.fillText(t("通し", "runs"), 96, numY + 52);
    c.fillStyle = "#3F7A4A"; c.font = `800 120px ${jp}`;
    c.fillText(String(sum.clean), 96 + half, numY);
    c.fillStyle = ink; c.font = `700 36px ${jp}`;
    c.fillText(t("クリーン", "clean"), 96 + half, numY + 52);

    // 崩れた場所(上位3つ)。棒は最大値基準
    let y = 500;
    c.fillStyle = muted; c.font = `700 32px ${jp}`;
    c.fillText(sum.misses.length ? t("今日崩れた場所", "Where it broke today") : t("今日はノーミス", "No misses today"), 96, y);
    y += 56;
    const top = sum.misses.slice(0, 3);
    const max = top.length ? top[0][1] : 1;
    for (const [label, count] of top) {
      c.fillStyle = ink; c.font = `700 40px ${jp}`;
      const shown = label.length > 12 ? label.slice(0, 11) + "…" : label;
      c.fillText(shown, 96, y);
      const barY = y + 20, barW = (S - 96 * 2 - 120) * (count / max);
      c.fillStyle = "rgba(181, 101, 29, .25)"; c.fillRect(96, barY, S - 96 * 2 - 120, 18);
      c.fillStyle = accent; c.fillRect(96, barY, Math.max(24, barW), 18);
      c.font = `800 36px ${jp}`;
      c.fillText(`${count}`, S - 96 - 60, y + 36);
      y += 108;
    }
    if (!top.length) {
      c.fillStyle = "#3F7A4A"; c.font = `800 64px ${jp}`;
      c.fillText(t("ALL CLEAN", "ALL CLEAN"), 96, y + 40);
      y += 120;
    }

    // 下部: アプリ名とURL(これが宣伝の役目)
    c.fillStyle = ink; c.fillRect(44, S - 116, S - 44, 4);
    c.font = `800 40px ${jp}`;
    c.fillText(t("ルーティンノート", "Routine Note"), 96, S - 52);
    c.fillStyle = muted; c.font = `600 30px ${jp}`;
    const label = "routine-note.pygmix.com";
    c.fillText(label, S - 96 - c.measureText(label).width, S - 52);
    return canvas;
  }

  // ---------- 文面 ----------
  function shareText(sum) {
    const lines = [];
    lines.push(t(`今日の通し${sum.total}本・クリーン${sum.clean}本。`,
      `Today: ${sum.total} runs, ${sum.clean} clean.`));
    if (sum.misses.length) {
      lines.push(t(`いちばん崩れたのは「${sum.misses[0][0]}」。`,
        `Roughest spot: “${sum.misses[0][0]}”.`));
    } else if (sum.total > 0) {
      lines.push(t("今日はノーミス。", "No misses today."));
    }
    lines.push("");
    lines.push("#ルーティンノート");
    lines.push(APP_URL);
    return lines.join("\n");
  }

  // ---------- 共有の実行 ----------
  async function cardBlob(canvas) {
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  window.sharePracticeNow = async (sessionId) => {
    const sess = (state.sessions || []).find((s) => s.id === sessionId);
    const rt = sess && (state.routines || []).find((r) => r.id === sess.routineId);
    if (!sess || !rt) return;
    const sum = summarize(sess, rt);
    const text = shareText(sum);
    const canvas = drawCard(sess, rt, sum);
    const blob = canvas ? await cardBlob(canvas) : null;
    const file = blob ? new File([blob], "routine-note.png", { type: "image/png" }) : null;

    // iPhone等: 画像+文面を共有シートへ。共有先(XやLINE)は本人が選ぶ
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (_) { /* キャンセルや非対応は下の方式へ */ }
    }
    // 予備: Xのツイート画面を文面つきで開く(画像は付けられないので保存を案内)
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    const link = document.createElement("a");
    link.href = intent; link.target = "_blank"; link.rel = "noopener";
    document.body.appendChild(link); link.click(); link.remove();
  };

  window.savePracticeCard = async (sessionId) => {
    const sess = (state.sessions || []).find((s) => s.id === sessionId);
    const rt = sess && (state.routines || []).find((r) => r.id === sess.routineId);
    if (!sess || !rt) return;
    const canvas = drawCard(sess, rt, summarize(sess, rt));
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `routine-note-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---------- セッション終了後のひと声 ----------
  // 通しが1本以上あるときだけ。勝手に投稿はせず、押した人だけ共有へ進む
  window.offerPracticeShare = (sessionId) => {
    const sess = (state.sessions || []).find((s) => s.id === sessionId);
    const rt = sess && (state.routines || []).find((r) => r.id === sess.routineId);
    if (!sess || !rt || !(sess.runs || []).length) return false;
    const sum = summarize(sess, rt);
    const canvas = drawCard(sess, rt, sum);
    if (!canvas) return false;
    const preview = canvas.toDataURL("image/png");
    showSheet(`
      <h3>${t("おつかれさまでした", "Nice work today")}</h3>
      <div class="sheet-sub">${t("今日の練習をシェアできます(任意)", "Share today’s practice if you like (optional)")}</div>
      <img class="share-card-preview" src="${preview}" alt="${t("今日の練習カード", "Today’s practice card")}">
      <button class="btn primary" onclick="sharePracticeNow('${sess.id}')">${t("シェアする", "Share")}</button>
      <button class="btn" onclick="savePracticeCard('${sess.id}')">${t("画像だけ保存", "Save the image")}</button>
      <button class="btn ghost" onclick="hideSheet()">${t("閉じる", "Close")}</button>`);
    return true;
  };
})();
