#!/usr/bin/env node
// Records a voipi CLI demo and converts to SVG for README
// Usage: node scripts/record-demo.ts
// Output: demo.svg (animated SVG, ready for README)

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const CAST_FILE = join(ROOT, "website/demo.cast");
const SVG_FILE = join(ROOT, "website/demo.svg");

// --- Step 1: Record with asciinema ---

const scriptDir = mkdtempSync(join(tmpdir(), "voipi-demo-"));
const scriptFile = join(scriptDir, "demo.sh");

const DEMO_CMD = `bunx voipi speak "Every word deserves a voice." -p edge-tts`;

const innerScript = `#!/bin/bash
type_slow() {
  local text="$1"
  for (( i=0; i<\${#text}; i++ )); do
    printf '%s' "\${text:$i:1}"
    sleep 0.04
  done
}

export PS1='$ '
clear
sleep 0.5
type_slow '${DEMO_CMD}'
sleep 0.3
echo
${DEMO_CMD} 2>&1
sleep 1
`;

try {
  writeFileSync(scriptFile, innerScript, { mode: 0o755 });

  console.log(">> Recording...");
  execSync(
    `asciinema rec ${CAST_FILE} --command "bash ${scriptFile}" --title voipi --cols 100 --rows 12 --overwrite --output-format asciicast-v2 --quiet`,
    { cwd: ROOT, stdio: "inherit" },
  );

  // --- Step 2: Speed up 2x by halving timestamps ---

  console.log(">> Speeding up 2x...");
  const cast = readFileSync(CAST_FILE, "utf8");
  const sped = cast
    .split("\n")
    .map((line) => {
      if (!line.startsWith("[")) return line;
      try {
        const entry = JSON.parse(line) as [number, ...unknown[]];
        entry[0] /= 2;
        return JSON.stringify(entry);
      } catch {
        return line;
      }
    })
    .join("\n");
  writeFileSync(CAST_FILE, sped);

  // --- Step 3: Convert to animated SVG ---

  console.log(">> Converting to SVG...");
  execSync(
    [
      "bunx",
      "svg-term-cli",
      "--in",
      CAST_FILE,
      "--out",
      SVG_FILE,
      "--window",
      "--width",
      "100",
      "--height",
      "12",
      "--padding",
      "10",
      "--no-cursor",
    ].join(" "),
    { cwd: ROOT, stdio: "inherit" },
  );

  console.log(`>> Done! Output: ${SVG_FILE}`);
} finally {
  try {
    unlinkSync(scriptFile);
  } catch {}
  try {
    unlinkSync(CAST_FILE);
  } catch {}
}
