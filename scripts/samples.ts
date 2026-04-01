#!/usr/bin/env node
// Generates audio samples for each provider and converts to mp4 for GitHub README playback
// Usage: ./scripts/samples.ts [-p edge-tts,piper]
// Output: website/samples/<provider>.mp4

import { mkdirSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { providerMap } from "../src/voipi.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const SAMPLES_DIR = join(ROOT, "website/samples");
const TEXT =
  "VoiPi gives your computer a voice. It can detect language and works with Edge, Google, Piper, eSpeak NG, and MacOS engines, all free.";

// Skip browser provider (requires DOM)
const ALL_PROVIDERS = ["macos", "piper", "edge-tts", "google-tts", "espeak-ng"] as const;

const { values } = parseArgs({
  options: { p: { type: "string" } },
  allowPositionals: true,
});

const filter = values.p?.split(",").map((s) => s.trim());
const PROVIDERS = filter ? ALL_PROVIDERS.filter((p) => filter.includes(p)) : ALL_PROVIDERS;

mkdirSync(SAMPLES_DIR, { recursive: true });

for (const name of PROVIDERS) {
  const factory = providerMap[name];
  if (!factory) continue;

  console.log(`[${name}] Synthesizing...`);
  try {
    const provider = await factory();
    const audio = await provider.toAudio(TEXT, { rate: 1.1 });
    const ext = (audio.ext || ".wav").replace(/^\.?/, ".");
    const tmpPath = join(SAMPLES_DIR, `${name}${ext}`);
    const mp4Path = join(SAMPLES_DIR, `${name}.mp4`);

    writeFileSync(tmpPath, audio.data);

    const size = statSync(tmpPath).size;
    if (size === 0) {
      unlinkSync(tmpPath);
      console.error(`[${name}] Failed: synthesized audio is empty`);
      continue;
    }

    // Convert to mp4 (silent video + audio) for GitHub README inline playback
    console.log(`[${name}] Converting to mp4...`);
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=2x2:r=1 -i "${tmpPath}" -shortest -c:v libx264 -tune stillimage -c:a aac -b:a 64k -ac 1 "${mp4Path}"`,
      { stdio: "pipe" },
    );

    unlinkSync(tmpPath);
    const duration = audio.duration ? ` (${audio.duration.toFixed(1)}s)` : "";
    console.log(`[${name}] Saved: samples/${name}.mp4${duration}`);
  } catch (error) {
    console.error(`[${name}] Failed: ${(error as Error).message}`);
  }
}

console.log("\nDone!");
