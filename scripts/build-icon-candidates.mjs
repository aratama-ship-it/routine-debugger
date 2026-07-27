#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "icons", "candidates");
const variant = process.argv.includes("--minimal")
  ? "minimal"
  : (process.argv.includes("--simple") ? "simple" : "original");
const activeSourceDir = variant === "original" ? sourceDir : join(sourceDir, variant);
const outputDir = join(activeSourceDir, "rendered");
const ffmpeg = process.env.FFMPEG_PATH || join(homedir(), "ffmpeg-static", "ffmpeg");

if (!existsSync(ffmpeg)) {
  throw new Error(`ffmpeg が見つかりません: ${ffmpeg}`);
}

mkdirSync(outputDir, { recursive: true });

const candidates = variant === "minimal"
  ? [
      { id: "a", file: "a-run-route-minimal.svg", label: "A  通しの軌道" },
      { id: "b", file: "b-step-column-minimal.svg", label: "B  三つのステップ" },
      { id: "c", file: "c-practice-interval-minimal.svg", label: "C  練習区間" },
    ]
  : variant === "simple"
    ? [
      { id: "a", file: "a-run-route-simple.svg", label: "A  通しの軌道" },
      { id: "b", file: "b-step-column-simple.svg", label: "B  崩れの一段" },
      { id: "c", file: "c-practice-interval-simple.svg", label: "C  次の練習区間" },
      ]
    : [
      { id: "a", file: "a-run-route.svg", label: "A  通しの軌道" },
      { id: "b", file: "b-step-column.svg", label: "B  崩れの朱印" },
      { id: "c", file: "c-practice-interval.svg", label: "C  次の練習区間" },
      ];

function renderSvg(input, output, width, height = width) {
  const tempDir = mkdtempSync(join(projectRoot, ".icon-render-"));
  try {
    // macOS標準のQuick LookでSVGを高解像度に描画し、ffmpegで縮小とRGB化を行う。
    const qlSize = Math.max(width, height, 1024);
    const quickLook = spawnSync("/usr/bin/qlmanage", [
      "-t", "-s", String(qlSize), "-o", tempDir, input,
    ], { encoding: "utf8" });
    if (quickLook.status !== 0) {
      throw new Error(`Quick LookのSVG描画に失敗しました (${basename(input)}):\n${quickLook.stderr}`);
    }

    const thumbnail = join(tempDir, `${parse(input).base}.png`);
    const result = spawnSync(ffmpeg, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", thumbnail,
      "-vf", `scale=${width}:${height}:flags=lanczos,format=rgb24`,
      "-frames:v", "1",
      output,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`PNG書き出しに失敗しました (${basename(input)}):\n${result.stderr}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const candidate of candidates) {
  const input = join(activeSourceDir, candidate.file);
  renderSvg(input, join(outputDir, `${candidate.id}-512.png`), 512);
  renderSvg(input, join(outputDir, `${candidate.id}-60.png`), 60);
}

const columns = candidates.map((candidate, index) => {
  const x = 40 + index * 568;
  const png512 = `rendered/${candidate.id}-512.png`;
  const png60 = `rendered/${candidate.id}-60.png`;
  const iconX = x + 8;
  return `
    <g>
      <text x="${x}" y="34" class="label">${candidate.label}</text>
      <image href="${png512}" x="${iconX}" y="56" width="512" height="512"/>
      <text x="${x}" y="612" class="caption">60px 実寸</text>
      <rect x="${x}" y="632" width="246" height="116" rx="12" fill="#f8f4e9"/>
      <rect x="${x + 262}" y="632" width="246" height="116" rx="12" fill="#282b27"/>
      <defs>
        <clipPath id="clip-${candidate.id}-light">
          <rect x="${x + 92}" y="660" width="60" height="60" rx="13"/>
        </clipPath>
        <clipPath id="clip-${candidate.id}-dark">
          <rect x="${x + 354}" y="660" width="60" height="60" rx="13"/>
        </clipPath>
      </defs>
      <image href="${png60}" x="${x + 92}" y="660" width="60" height="60"
             clip-path="url(#clip-${candidate.id}-light)"/>
      <image href="${png60}" x="${x + 354}" y="660" width="60" height="60"
             clip-path="url(#clip-${candidate.id}-dark)"/>
    </g>`;
}).join("");

// Quick Lookのサムネイルは正方形なので、比較SVGも正方形で描画し、
// 必要な上部784pxだけを最後に切り出す。
const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1744" height="1744" viewBox="0 0 1744 1744">
  <style>
    .label { fill: #23262c; font: 700 22px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; }
    .caption { fill: #39495b; font: 700 16px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; }
  </style>
  <rect width="1744" height="784" fill="#e9e3d3"/>
  ${columns}
</svg>`;

const comparisonSvgPath = join(activeSourceDir, "comparison.svg");
writeFileSync(comparisonSvgPath, comparisonSvg);
const comparisonSquarePath = join(outputDir, "comparison-square.png");
renderSvg(comparisonSvgPath, comparisonSquarePath, 1744);
const crop = spawnSync(ffmpeg, [
  "-hide_banner",
  "-loglevel", "error",
  "-y",
  "-i", comparisonSquarePath,
  "-vf", "crop=1744:784:0:0,format=rgb24",
  "-frames:v", "1",
  join(activeSourceDir, "comparison.png"),
], { encoding: "utf8" });
rmSync(comparisonSquarePath, { force: true });
if (crop.status !== 0) {
  throw new Error(`比較画像の切り出しに失敗しました:\n${crop.stderr}`);
}

console.log(`候補を書き出しました: ${outputDir}`);
console.log(`比較画像: ${join(activeSourceDir, "comparison.png")}`);
