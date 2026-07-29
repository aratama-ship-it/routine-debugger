/* ルーティンノート — 撮影に使うカメラとレンズを選ぶ
 *
 * 三脚に立てて自分を撮るなら背面カメラのほうが画質も画角も有利。
 * とくに超広角は、高く投げる技を切り落とさずに収められる。
 * ただし画面が自分を向かないので、カウントダウンは音で知らせる
 * (iPhoneのフラッシュはSafariから触れない)。
 *
 * iOSの事情:
 *  - iOS 16.3以降、背面の各レンズが enumerateDevices に出る
 *  - deviceId は開くたびに変わる端末がある。保存してよいのはレンズ名まで
 *  - ラベルはカメラを一度許可したあとにしか入らない
 *
 * app.js が容量上限に近いため、選択の記憶・一覧・音はここに置く。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  const FACING_KEY = "rd_run_camera_facing";
  const LENS_KEY = "rd_run_camera_lens";
  const BEEP_KEY = "rd_countdown_beep";

  const read = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };

  const facing = () => (read(FACING_KEY, "user") === "environment" ? "environment" : "user");
  const savedLens = () => read(LENS_KEY, "");
  const isRear = () => facing() === "environment";

  window.runCameraFacing = facing;
  window.runCameraIsRear = isRear;
  window.runCameraFacingLabel = () =>
    isRear() ? t("背面カメラ", "Rear camera") : t("インカメ", "Front camera");

  // 超広角かどうかの手がかり。ラベルは端末と言語で変わるので断定はしない
  const looksUltraWide = (label) => /ultra|超広角|0\.5/i.test(label || "");
  const looksFront = (label) => /front|前面|face ?time|self/i.test(label || "");

  async function listVideoDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "videoinput");
    } catch (_) { return []; }
  }

  // deviceId は保存せず、開くたびにレンズ名で引き当てる
  window.runCameraVideoConstraints = async (profile) => {
    const base = {
      width: { ideal: profile.width }, height: { ideal: profile.height },
      aspectRatio: { ideal: profile.ratio },
      resizeMode: profile.resizeMode,
      frameRate: { ideal: 24, max: 30 },
    };
    const want = savedLens();
    if (want) {
      const hit = (await listVideoDevices()).find((d) => d.label === want);
      // exact にしないと、iOSが撮影中に別のレンズへ移ることがある
      if (hit && hit.deviceId) return { ...base, deviceId: { exact: hit.deviceId } };
    }
    return { ...base, facingMode: { ideal: facing() } };
  };

  // ---------- カウントダウンの音 ----------
  // 背面で撮ると画面が見えない。既定は「背面のときだけ鳴らす」
  let beepCtx = null;
  const beepMode = () => read(BEEP_KEY, "auto");
  const beepEnabled = () => {
    const mode = beepMode();
    if (mode === "on") return true;
    if (mode === "off") return false;
    return isRear();
  };
  window.runCountdownBeepEnabled = beepEnabled;

  window.runCountdownBeep = (remaining) => {
    if (!beepEnabled()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!beepCtx) beepCtx = new AC();
      if (beepCtx.state === "suspended") beepCtx.resume();
      const at = beepCtx.currentTime;
      const go = Number(remaining) <= 0;
      const length = go ? 0.45 : 0.09;
      const osc = beepCtx.createOscillator();
      const gain = beepCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = go ? 1320 : 880;
      // 立ち上がりと減衰を付けないと、プツッというノイズが頭と尻に乗る
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.55, at + 0.008);
      gain.gain.setValueAtTime(0.55, at + Math.max(0.02, length - 0.03));
      gain.gain.linearRampToValueAtTime(0, at + length);
      osc.connect(gain); gain.connect(beepCtx.destination);
      osc.start(at); osc.stop(at + length + 0.02);
    } catch (_) {}
  };

  // ---------- 開始カードの1行 ----------
  // 初回描画は app.js のテンプレートから直接埋める(あとから差し込むと一瞬空になる)
  window.runCameraLensRowHtml = (routineId) => {
    const lens = savedLens();
    const name = lens || window.runCameraFacingLabel();
    const beep = beepEnabled()
      ? t("カウントダウンを音で知らせます", "The countdown beeps")
      : t("カウントダウンの音は鳴りません", "The countdown is silent");
    return `<button type="button" class="rcl-row" onclick="sheetPickRunCameraLens('${routineId}')">
      <span class="rcl-key">${t("使うカメラ", "Camera")}</span>
      <b class="rcl-val">${esc(name)}</b>
      <span class="rcl-sub">${beep}</span>
      <span class="rcl-go" aria-hidden="true">›</span></button>`;
  };

  window.renderRunCameraLensRow = (routineId) => {
    const slot = document.getElementById("run-camera-lens");
    if (!slot) return;
    const html = window.runCameraLensRowHtml(routineId);
    if (slot.innerHTML !== html) slot.innerHTML = html;
  };

  // ---------- 選ぶ ----------
  function chipRow(routineId) {
    const mode = beepMode();
    const chip = (value, label) => `<button type="button" class="rcl-chip ${mode === value ? "on" : ""}"
      onclick="setRunCountdownBeep('${value}','${routineId}')">${label}</button>`;
    return `<div class="rcl-beep">
      <b>${t("カウントダウンの音", "Countdown sound")}</b>
      <div class="rcl-chips">
        ${chip("auto", t("背面のときだけ", "Rear only"))}
        ${chip("on", t("いつも鳴らす", "Always"))}
        ${chip("off", t("鳴らさない", "Never"))}
      </div>
      <small>${t(
        "背面カメラで撮ると画面が自分を向きません。音があると開始が分かります。",
        "With the rear camera the screen faces away, so the beep tells you when to start.")}</small>
    </div>`;
  }

  window.setRunCountdownBeep = (value, routineId) => {
    write(BEEP_KEY, value);
    window.runCountdownBeep(1);       // 選んだ音をその場で確かめられるように
    sheetPickRunCameraLens(routineId);
  };

  window.sheetPickRunCameraLens = async (routineId) => {
    const list = await listVideoDevices();
    const named = list.filter((d) => d.label);
    const lens = savedLens();

    const auto = (value, label, note) => `<div class="pick-trick-row ${
      !lens && facing() === value ? "is-on" : ""}" onclick="pickRunCamera('${value}','','${routineId}')">
      <span class="nm">${label}</span><span class="kn">${note}</span></div>`;

    const rows = named.map((d) => `<div class="pick-trick-row ${lens === d.label ? "is-on" : ""}"
      onclick="pickRunCamera('${looksFront(d.label) ? "user" : "environment"}','${esc(d.label)}','${routineId}')">
      <span class="nm">${esc(d.label)}</span>
      <span class="kn">${looksUltraWide(d.label) ? t("超広角", "Ultra wide") : ""}</span></div>`).join("");

    const permission = named.length ? "" : `<div class="rcl-note">${t(
      "レンズの一覧は、カメラを一度許可したあとに出せます。撮影をONにしてから開き直してください。",
      "Lens names appear after you allow the camera once. Turn recording ON, then reopen.")}</div>`;

    showSheet(`<h3>${t("使うカメラを選ぶ", "Choose a camera")}</h3>
      <div class="sheet-sub">${t(
        "三脚に立てて撮るなら背面カメラ。超広角は、高く投げる技も切らずに収まります。",
        "Use the rear camera on a tripod. Ultra wide keeps high throws in frame.")}</div>
      ${auto("user", t("インカメ", "Front camera"), t("自分で見ながら", "See yourself"))}
      ${auto("environment", t("背面カメラ", "Rear camera"), t("画質がよい", "Better image"))}
      ${rows}
      ${permission}
      ${chipRow(routineId)}
      <button class="btn ghost" onclick="hideSheet()">${t("閉じる", "Close")}</button>`);
  };

  window.pickRunCamera = async (facingValue, lensLabel, routineId) => {
    write(FACING_KEY, facingValue === "environment" ? "environment" : "user");
    write(LENS_KEY, lensLabel || "");
    hideSheet();
    // 開いている最中なら開き直す。録画中は触らない(その通しが失われる)
    if (typeof runCameraReady === "function" && runCameraReady(routineId)
        && !(runCamera && runCamera.recording)) {
      stopRunCameraNow();
      await prepareRunCamera(routineId);
    } else if (typeof updateRunCameraConfirm === "function") {
      updateRunCameraConfirm(routineId);
    }
    toast(t(`${lensLabel || window.runCameraFacingLabel()} を使います`,
      `Using ${lensLabel || window.runCameraFacingLabel()}`));
  };
})();
