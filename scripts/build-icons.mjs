#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(projectRoot, "icons", "icon.svg");
const outputDir = join(projectRoot, "icons");
const ffmpeg = process.env.FFMPEG_PATH || join(homedir(), "ffmpeg-static", "ffmpeg");
const quickLook = "/usr/bin/qlmanage";

for (const [label, path] of [["SVG原本", source], ["ffmpeg", ffmpeg], ["Quick Look", quickLook]]) {
  if (!existsSync(path)) throw new Error(`${label}が見つかりません: ${path}`);
}

// Androidのmaskableは円などに切り抜かれるため、絵柄を安全域(中央80%)へ収めて周囲を紙色で埋める。
// 余白を入れずに書き出すと、左端の綴じ穴が切り落とされてアプリらしさが失われる。
const PAPER = "#f8f4e9";   // styles.css の --card と同じ紙色
const MASKABLE_SAFE = 0.8; // 主要な絵柄を収める割合

const outputs = [
  { name: "icon-180.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
];

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label}に失敗しました:\n${result.stderr || result.stdout}`);
  }
}

function verifyRgbPng(path, expectedSize) {
  const png = readFileSync(path);
  const signature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`PNG形式ではありません: ${path}`);
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`サイズ不一致: ${basename(path)} は ${width}x${height}`);
  }
  // PNG color type 2 = Truecolor。アルファチャンネルを持たない。
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(`RGB PNGではありません: ${basename(path)} (bitDepth=${bitDepth}, colorType=${colorType})`);
  }
}

const tempDir = mkdtempSync(join(projectRoot, ".icon-render-"));
try {
  run(quickLook, [
    "-t",
    "-s", "1024",
    "-o", tempDir,
    source,
  ], "SVGの描画");

  const rendered = join(tempDir, `${parse(source).base}.png`);
  if (!existsSync(rendered)) throw new Error(`SVGの描画結果が見つかりません: ${rendered}`);

  for (const output of outputs) {
    const destination = join(outputDir, output.name);
    const inner = Math.round(output.size * MASKABLE_SAFE);
    const filter = output.maskable
      // 絵柄を安全域まで縮め、外周は紙色で埋める(切り抜かれても綴じ穴が残る)
      ? `scale=${inner}:${inner}:flags=lanczos,`
        + `pad=${output.size}:${output.size}:(ow-iw)/2:(oh-ih)/2:color=${PAPER},format=rgb24`
      : `scale=${output.size}:${output.size}:flags=lanczos,format=rgb24`;
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", rendered,
      "-vf", filter,
      "-frames:v", "1",
      destination,
    ], `${output.name}の書き出し`);
    verifyRgbPng(destination, output.size);
    console.log(`OK ${output.name} (${output.size}x${output.size}, RGB)`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
