import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 検査対象は引数で渡す。渡さなければ本体の黒板スキンを見る。
const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(here, "..", "skin-blackboard.css");
const source = fs.readFileSync(target, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const allowed = new Set([
  "accent-color",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-bottom-color",
  "border-color",
  "border-left-color",
  "border-radius",
  "border-right-color",
  "border-top-color",
  "box-shadow",
  "caret-color",
  "color",
  "color-scheme",
  "font-family",
  "outline-color",
  "text-decoration-color"
]);

const violations = [];
const blocks = source.matchAll(/([^{}]+)\{([^{}]*)\}/g);

for (const block of blocks) {
  const selector = block[1].trim();
  const declarations = block[2].split(";");

  for (const declaration of declarations) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 1) {
      violations.push(`${selector}: invalid declaration "${trimmed}"`);
      continue;
    }

    const property = trimmed.slice(0, colon).trim();
    if (property.startsWith("--")) continue;
    if (!allowed.has(property)) {
      violations.push(`${selector}: "${property}" is outside the skin contract`);
    }
  }
}

if (/@media\b|@container\b|@supports\b/.test(source)) {
  violations.push("At-rules that could create skin-only layout branches are not allowed");
}

if (/\bcontent\s*:/.test(source)) {
  violations.push("Pseudo-element content is not allowed");
}

if (violations.length) {
  console.error("SKIN CONTRACT: FAIL");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("SKIN CONTRACT: PASS");
console.log("Only color, font-family, border, shadow, outline and background properties were found.");
