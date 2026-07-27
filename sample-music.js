// 付属サンプル音源の一覧。
// 実体のファイル名はURLで扱いやすいASCIIに統一し、表示名(n)は原題のまま持つ。
// 初回表示では取得せず、利用者が選んだときだけ読み込む(初期の転送量を増やさないため)。
// app.js がサイズ上限に達しているため、ここに分離している。app.js より前に読み込むこと。
const SAMPLE_MUSIC = [
  { f: "samples/spiral-of-light.mp3", n: "Spiral of Light" },
  { f: "samples/clockwork-duet.mp3", n: "Clockwork Duet" },
  { f: "samples/brushstroke-silence.mp3", n: "Brushstroke Silence" },
  { f: "samples/sumi-no-kokyu.mp3", n: "墨の呼吸" },
  { f: "samples/same-train-strangers.mp3", n: "Same Train Strangers" },
  { f: "samples/challie-lav.mp3", n: "challie lav" },
  { f: "samples/verse1.mp3", n: "Verse 1" },
];
