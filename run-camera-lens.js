/* ルーティンノート — 撮影に使うカメラとレンズを選ぶ
 *
 * 三脚に立てて自分を撮るなら背面カメラのほうが画質も画角も有利。
 * とくに超広角は、高く投げる技を切り落とさずに収められる。
 * ただし画面が自分を向かないので、カウントダウンは音で知らせる
 * (iPhoneのフラッシュはSafariから触れない)。
 *
 * iOSの事情: iOS 16.3以降は背面の各レンズが enumerateDevices に出るが、
 * deviceId は開くたびに変わる端末がある。保存してよいのはレンズ名まで。
 * ラベルはカメラを一度許可したあとにしか入らない。
 *
 * app.js が容量上限に近いため、選択の記憶・一覧・音はここに置く。
 */
(() => {
  "use strict";

  const en = () => (typeof isEnglish === "function" ? isEnglish() : false);
  const t = (ja, eng) => (en() ? eng : ja);

  // 画質。既定は標準のまま。上げると合成が重くなり、5本の保存枠も早く埋まる
  const QUALITY_KEY = "rd_run_video_quality";
  const HIGH_SCALE = 2;              // 960x720 → 1920x1440 を要求する
  const STD_BPS = 1_500_000;
  const HIGH_BPS = 4_000_000;

  // 用途ごとに別の設定。通し練習は三脚、技の撮影は手元と、据え方が違う
  const KEYS = {
    run: { facing: "rd_run_camera_facing", lens: "rd_run_camera_lens", 既定: "user" },
    trick: { facing: "rd_trick_camera_facing", lens: "rd_trick_camera_lens", 既定: "environment" },
  };
  const BEEP_KEY = "rd_countdown_beep";

  const read = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) {} };

  const isHighQuality = () => read(QUALITY_KEY, "std") === "high";
  window.runVideoBitrate = () => (isHighQuality() ? HIGH_BPS : STD_BPS);

  // 超広角かどうかの手がかり。ラベルは端末と言語で変わるので断定はしない
  const looksUltraWide = (label) => /ultra|超広角|0\.5/i.test(label || "");
  // Dual / Triple は複数レンズをまとめた仮想デバイス。既定で撮影中に切り替わるため、
  // 通しの途中で画角が変わる。構成を見比べる用途には使えないので選択肢から外す。
  const looksCombined = (label) => /dual|triple|デュアル|トリプル/i.test(label || "");

  const 鍵 = (target) => KEYS[target] || KEYS.run;
  const facing = (target = "run") => {
    const k = 鍵(target);
    return read(k.facing, k.既定) === "environment" ? "environment" : "user";
  };
  // Dual/Triple を選んだ状態が残っていたら捨てる。
  // 撮影中にレンズが変わるため、一覧から外したものを裏で使い続けない。
  const savedLens = (target = "run") => {
    const k = 鍵(target);
    const value = read(k.lens, "");
    if (value && looksCombined(value)) { write(k.lens, ""); return ""; }
    return value;
  };
  const isRear = (target = "run") => facing(target) === "environment";

  window.runCameraIsRear = isRear;
  window.runCameraFacingLabel = (target = "run") =>
    facing(target) === "environment" ? t("背面カメラ", "Rear camera") : t("インカメ", "Front camera");

  const looksFront = (label) => /front|前面|face ?time|self/i.test(label || "");
  const looksTele = (label) => /tele|望遠/i.test(label || "");
  // 端末が返す英語ラベルのままでは選びにくい。役割の名前に言い換える。
  // 元のラベルは併記して、同じ名前が並んだときに見分けられるようにする。
  const 役割名 = (label) => {
    if (looksFront(label)) return t("インカメ", "Front");
    if (looksUltraWide(label)) return t("超広角", "Ultra wide");
    if (looksTele(label)) return t("望遠", "Telephoto");
    return t("広角", "Wide");
  };

  // 一覧は控えておく。開く直前に await を挟むと、Safariが操作起点と見なさず許可が出ない。
  let cachedDevices = [];

  async function refreshVideoDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return cachedDevices;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      cachedDevices = all.filter((d) => d.kind === "videoinput");
    } catch (_) {}
    return cachedDevices;
  }
  window.refreshRunCameraDevices = refreshVideoDevices;

  // deviceId は保存せず、控えた一覧からレンズ名で引き当てる(同期のまま)
  window.runCameraVideoConstraints = (profile, target = "run") => {
    const scale = isHighQuality() ? HIGH_SCALE : 1;
    const base = {
      width: { ideal: profile.width * scale }, height: { ideal: profile.height * scale },
      aspectRatio: { ideal: profile.ratio },
      resizeMode: profile.resizeMode,
      frameRate: { ideal: 24, max: 30 },
    };
    const want = savedLens(target);
    if (want) {
      const hit = cachedDevices.find((d) => d.label === want);
      // exact にしないと、iOSが撮影中に別のレンズへ移ることがある
      if (hit && hit.deviceId) return { ...base, deviceId: { exact: hit.deviceId } };
    }
    return { ...base, facingMode: { ideal: facing(target) } };
  };

  // ---------- 開いたあとの向きの取り直し ----------
  // レンズを名指しすると縦横の希望が無視されることがある。実測して直し、
  // 駄目ならレンズ指定を外して開き直す。
  const frameIsLandscape = (settings) =>
    (Number(settings.width) || 0) >= (Number(settings.height) || 0);

  window.correctRunCameraStream = async (stream, profile, target = "run") => {
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== "function") return stream;
    const first = track.getSettings();
    if (!first.width || !first.height) return stream;
    const wantLandscape = profile.ratio >= 1;
    if (frameIsLandscape(first) === wantLandscape) return stream;

    try {
      await track.applyConstraints({
        width: { ideal: profile.width }, height: { ideal: profile.height },
        aspectRatio: { ideal: profile.ratio },
      });
    } catch (_) {}
    if (frameIsLandscape(track.getSettings()) === wantLandscape) return stream;

    // レンズ指定が原因のことがある。指定を外してもう一度だけ開く
    if (!savedLens(target)) return stream;
    try {
      const retry = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing(target) },
          width: { ideal: profile.width }, height: { ideal: profile.height },
          aspectRatio: { ideal: profile.ratio },
          resizeMode: profile.resizeMode,
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      const retryTrack = retry.getVideoTracks()[0];
      if (retryTrack && frameIsLandscape(retryTrack.getSettings()) === wantLandscape) {
        stream.getTracks().forEach((tr) => tr.stop());
        return retry;
      }
      retry.getTracks().forEach((tr) => tr.stop());
    } catch (_) {}
    return stream;
  };

  // プレビューの縦横は、実際に返ってきた映像そのものに合わせる。
  // 画角の中に自分がいるかを見るためのものなので、切り取ってはいけない。
  window.runCameraFrameRatioCss = (cap, fallback) => {
    const w = Number(cap && cap.frameWidth) || 0;
    const h = Number(cap && cap.frameHeight) || 0;
    return w > 0 && h > 0 ? `${w} / ${h}` : fallback;
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
  window.runCameraLensRowHtml = (routineId, target = "run") => {
    const lens = savedLens(target);
    const name = lens ? 役割名(lens) : window.runCameraFacingLabel(target);
    const beep = target !== "run" ? t("シーケンスの撮影に使います", "Used for sequence clips")
      : beepEnabled() ? t("カウントダウンを音で知らせます", "The countdown beeps")
        : t("カウントダウンの音は鳴りません", "The countdown is silent");
    return `<button type="button" class="rcl-row" onclick="sheetPickRunCameraLens('${routineId}','${target}')">
      <span class="rcl-key">${t("使うカメラ", "Camera")}</span>
      <b class="rcl-val">${esc(name)}</b>
      <span class="rcl-sub">${beep}</span>
      <span class="rcl-go" aria-hidden="true">›</span></button>`;
  };

  window.renderRunCameraLensRow = (routineId, target = "run") => {
    const slot = document.getElementById("run-camera-lens");
    if (!slot) return;
    const html = window.runCameraLensRowHtml(routineId, target);
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

  function qualityRow(routineId) {
    const high = isHighQuality();
    const chip = (value, label) => `<button type="button" class="rcl-chip ${
      (value === "high") === high ? "on" : ""}" onclick="setRunVideoQuality('${value}','${routineId}')">${label}</button>`;
    return `<div class="rcl-beep">
      <b>${t("画質", "Video quality")}</b>
      <div class="rcl-chips">
        ${chip("std", t("標準", "Standard"))}
        ${chip("high", t("高画質", "High"))}
      </div>
      <small>${t(
        "高画質は端末が返せる最大を要求します。そのぶん保存容量が増え、保存時の合成にも時間がかかります。実際に撮れた大きさは撮影ONのときに出ます。",
        "High asks for the largest size the device offers. Files get bigger and composing takes longer.")}</small>
    </div>`;
  }

  window.setRunVideoQuality = async (value, routineId) => {
    write(QUALITY_KEY, value);
    const wasReady = typeof runCameraReady === "function" && runCameraReady(routineId)
      && !(runCamera && runCamera.recording);
    if (wasReady) stopRunCameraNow();
    sheetPickRunCameraLens(routineId);
    if (wasReady) await prepareRunCamera(routineId);
  };

  window.setRunCountdownBeep = (value, routineId) => {
    write(BEEP_KEY, value);
    window.runCountdownBeep(1);       // 選んだ音をその場で確かめられるように
    sheetPickRunCameraLens(routineId);
  };

  window.requestRunCameraPermission = async (routineId, target = "run") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (_) {
      return toast(t("カメラを使えません。端末の許可設定をご確認ください",
        "The camera is unavailable. Check the permission settings."));
    }
    await refreshVideoDevices();
    sheetPickRunCameraLens(routineId, target);
  };

  window.sheetPickRunCameraLens = async (routineId, target = "run") => {
    const list = await refreshVideoDevices();
    const 全部 = list.filter((d) => d.label);
    const named = 全部.filter((d) => !looksCombined(d.label));
    const lens = savedLens(target);

    const auto = (value, label, note) => `<div class="pick-trick-row ${
      !lens && facing(target) === value ? "is-on" : ""}" onclick="pickRunCamera('${value}','','${routineId}','${target}')">
      <span class="nm">${label}</span><span class="kn">${note}</span></div>`;

    const rows = named.map((d) => `<div class="pick-trick-row ${lens === d.label ? "is-on" : ""}"
      onclick="pickRunCamera('${looksFront(d.label) ? "user" : "environment"}','${esc(d.label)}','${routineId}','${target}')">
      <span class="nm">${役割名(d.label)}</span>
      <span class="kn">${esc(d.label)}</span></div>`).join("");

    const combined = 全部.length > named.length ? `<div class="rcl-note">${t(
      "「Dual」「Triple」は複数のレンズをまとめたもので、撮影中に自動で切り替わります。通しの途中で画角が変わるため、一覧には出していません。",
      "“Dual” and “Triple” combine several lenses and switch mid-take, so they are not listed.")}</div>` : "";

    const permission = named.length ? "" : `<div class="rcl-note">${t(
      "レンズの一覧は、カメラを一度許可すると出せます。",
      "Lens names appear once you allow the camera.")}</div>
      <button class="btn primary" onclick="requestRunCameraPermission('${routineId}','${target}')">${
        t("カメラを許可してレンズを出す", "Allow the camera and list lenses")}</button>`;

    showSheet(`<h3>${t("使うカメラを選ぶ", "Choose a camera")}</h3>
      <div class="sheet-sub">${t(
        "三脚に立てて撮るなら背面カメラ。超広角は、高く投げる技も切らずに収まります。",
        "Use the rear camera on a tripod. Ultra wide keeps high throws in frame.")}</div>
      ${named.length ? rows : `${auto("user", t("インカメ", "Front camera"), t("自分で見ながら", "See yourself"))}
      ${auto("environment", t("背面カメラ", "Rear camera"), t("画質がよい", "Better image"))}`}
      ${combined}
      ${permission}
      ${target === "run" ? qualityRow(routineId) + chipRow(routineId) : ""}
      <button class="btn ghost" onclick="closeRunCameraPicker('${routineId}','${target}')">${
        t("戻る", "Back")}</button>`);
  };

  // この一覧は開始シートの上へ出しているので、閉じると開始シートごと消える。
  // 選んだあとは必ず開始シートへ戻す。
  window.closeRunCameraPicker = (routineId, target = "run") => {
    if (target === "run" && typeof confirmRunStart === "function" && routineId && routineId !== "undefined") {
      return confirmRunStart(routineId);
    }
    hideSheet();
  };

  window.pickRunCamera = async (facingValue, lensLabel, routineId, target = "run") => {
    const k = 鍵(target);
    write(k.facing, facingValue === "environment" ? "environment" : "user");
    write(k.lens, lensLabel || "");
    if (target !== "run") {
      closeRunCameraPicker(routineId, target);
      // 開いているカメラを閉じて開き直す。次の描画で新しい設定が使われる
      if (typeof releaseTrickCam === "function") { releaseTrickCam(); render(); }
      const 名 = lensLabel ? 役割名(lensLabel) : window.runCameraFacingLabel(target);
      return toast(t(`${名} を使います`, `Using ${名}`));
    }
    const wasReady = typeof runCameraReady === "function" && runCameraReady(routineId)
      && !(runCamera && runCamera.recording);
    if (wasReady) stopRunCameraNow();
    closeRunCameraPicker(routineId, target);
    // 開いている最中だったなら、新しいカメラで開き直す
    if (wasReady) await prepareRunCamera(routineId);
    const 表示 = lensLabel ? 役割名(lensLabel) : window.runCameraFacingLabel(target);
    toast(t(`${表示} を使います`, `Using ${表示}`));
  };
})();
