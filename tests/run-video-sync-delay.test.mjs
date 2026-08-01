// 「保存済み映像の同期補正で＋0.1が効かない」の再現と回帰防止。
// 使い方: /Users/arata/.local/node/bin/node tests/run-video-sync-delay.test.mjs [run-video-delay.jsのパス]
//
// run-video-delay.js の実物を読み込み、確認画面のつまみ(HTML)を作って
// ＋0.1／−0.1ボタンの処理をそのまま通す。DOMはつまみ1つ分だけ用意する。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(here, "..", "run-video-delay.js");

const g = globalThis;
g.window = g;
g.isEnglish = () => false;
g.esc = (s) => String(s);
g.saveState = () => { saved++; };
let saved = 0;
const store = new Map();
g.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
g.stoppedRunVideoCapture = null;
g.pendingRunVideo = null;
g.storedRunVideos = () => savedVideos;
let savedVideos = [];
g.runVideoHasEmbeddedAudio = (v) => {
  const mode = v && v.composition && v.composition.audio && v.composition.audio.mode;
  if (mode) return mode === "embedded";
  return !!(v && (v.audioMode === "embedded" || v.audio === true || v.audioEmbedded === true));
};
g.runVideoSyncState = null;
g.bindRunVideoEmbeddedAudioDelay = () => {};

// つまみ1つ分のDOM。runVideoStepSyncDelay は min/max/value しか見ない
let slider = null;
const outputs = new Map();
g.document = {
  getElementById(id) {
    if (id === "run-video-sync-delay") return slider;
    if (!outputs.has(id)) outputs.set(id, { textContent: "" });
    return outputs.get(id);
  },
};

const api = new Function(`${readFileSync(target, "utf8")}
  ;return { runVideoSyncDelayMarkup, runVideoStepSyncDelay, runVideoDesiredAudioDelay,
    runVideoEstimatedAudioDelay, runVideoPlaybackAudioDelay, runVideoRecordingAudioDelay,
    runVideoSavedDelayFields: typeof runVideoSavedDelayFields === "function" ? runVideoSavedDelayFields : null };`)();

// 画面を開いた状態を作る(markupのmin/max/valueをそのままつまみにする)
function openSheet(video) {
  const html = api.runVideoSyncDelayMarkup(video, "saved", video.id);
  if (!html) return null;
  const pick = (name) => {
    const m = new RegExp(`${name}="([-0-9.]+)"`).exec(html);
    return m ? Number(m[1]) : null;
  };
  slider = { min: pick("min"), max: pick("max"), value: pick("value") };
  return slider;
}
function press(video, step) {
  api.runVideoStepSyncDelay("saved", video.id, step);
  return api.runVideoDesiredAudioDelay(video);
}

let failed = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// 保存済み映像の形。estimatedAudioDelaySeconds は保存時に落ちる(app.jsのpersistPendingRunVideo)ため持たせない
function savedVideo({ recorded, sync, id = "v1" }) {
  return {
    id, audio: true, audioMode: "embedded",
    recordingAudioDelaySeconds: recorded,
    syncAudioDelaySeconds: sync,
    playbackAudioDelaySeconds: Math.max(0, sync - recorded),
    composition: {
      engine: "web-post-save", audio: { mode: "embedded" },
      timeline: { recordingAudioDelaySeconds: recorded },
    },
  };
}

// ---------- 1. 合成済み(収録=補正値)。中心＝現在値なので前後へ動く ----------
{
  const v = savedVideo({ recorded: 5.9, sync: 5.9 });
  savedVideos = [v];
  openSheet(v);
  check("合成済み映像: ＋0.1で増える", press(v, 0.1) === 6, `desired=${api.runVideoDesiredAudioDelay(v)}`);
  check("合成済み映像: −0.1で戻る", press(v, -0.1) === 5.9);
}

// ---------- 2. 収録0秒のまま音源が入っている映像(合成待ちを経た・旧版で保存など) ----------
// 中心が0になり、つまみの上限1.00に現在値5.90が張り付く → ＋0.1が効かない
{
  const v = savedVideo({ recorded: 0, sync: 5.9, id: "v2" });
  savedVideos = [v];
  const s = openSheet(v);
  check("収録0秒の映像: 現在値がつまみの範囲に入っている",
    s && api.runVideoDesiredAudioDelay(v) >= s.min && api.runVideoDesiredAudioDelay(v) <= s.max,
    `value=${api.runVideoDesiredAudioDelay(v)} 範囲=${s && s.min}〜${s && s.max}`);
  const after = press(v, 0.1);
  check("収録0秒の映像: ＋0.1で増える", after === 6, `${5.9} → ${after}`);
  check("収録0秒の映像: ボタンで補正値が壊れない(1.00へ落ちない)", after >= 5.9, `desired=${after}`);
}

// ---------- 3. 本人が上へ寄せた後に開き直しても、さらに動かせる ----------
{
  const v = savedVideo({ recorded: 5.9, sync: 6.9, id: "v3" });
  savedVideos = [v];
  openSheet(v);                       // 開き直し
  const after = press(v, 0.1);
  check("上へ寄せた後に開き直しても＋0.1できる", after === 7, `6.9 → ${after}`);
}

// ---------- 4. 下限は0秒で止まる(遅れは負にならない) ----------
{
  const v = savedVideo({ recorded: 0, sync: 0.05, id: "v4" });
  savedVideos = [v];
  openSheet(v);
  const after = press(v, -0.1);
  check("0秒より下へは行かない", after === 0, `desired=${after}`);
}

// ---------- 5. 再生時の補正量は「補正値 − 収録済み」で、負にならない ----------
{
  const v = savedVideo({ recorded: 5.9, sync: 6.2, id: "v5" });
  savedVideos = [v];
  check("再生補正=補正値−収録済み", api.runVideoPlaybackAudioDelay(v) === 0.3,
    `playback=${api.runVideoPlaybackAudioDelay(v)}`);
}

// ---------- 6. 保存する記録に実測(中心)が写る ----------
// これが落ちると、開き直したときの中心が収録済みの値へずれる(2と3の原因)
{
  const pending = {
    id: "p1", audio: true, audioMode: "embedded",
    recordingAudioDelaySeconds: 0,
    estimatedAudioDelaySeconds: 5.9,
    syncAudioDelaySeconds: 5.9,
    composition: { audio: { mode: "embedded" }, timeline: { recordingAudioDelaySeconds: 0 } },
  };
  const fields = api.runVideoSavedDelayFields && api.runVideoSavedDelayFields(pending);
  check("保存する記録へ実測(中心)を写している", !!fields && fields.estimatedAudioDelaySeconds === 5.9,
    fields ? `estimated=${fields.estimatedAudioDelaySeconds}` : "runVideoSavedDelayFieldsが無い");
  check("保存する記録の補正値と再生補正がそろっている",
    !!fields && fields.syncAudioDelaySeconds === 5.9 && fields.playbackAudioDelaySeconds === 5.9,
    fields ? JSON.stringify(fields) : "-");
}

console.log(failed ? `\n${failed} FAILED` : "\nすべて合格");
process.exit(failed ? 1 : 0);
