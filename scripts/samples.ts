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
  "VoiPi is a free and zero-dependency text-to-speech library for JavaScript. It auto-detects languages and picks the best voice across six providers.";

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
    // Use ffprobe to get exact audio duration (parsed durations like MP3 can be inaccurate)
    const dur =
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmpPath}"`, {
        encoding: "utf-8",
      }).trim() || "60";
    console.log(`[${name}] Converting to mp4 (${dur}s)...`);
    execSync(
      `ffmpeg -y -f lavfi -t ${dur} -i color=c=black:s=2x2:r=1 -i "${tmpPath}" -shortest -c:v libx264 -tune stillimage -c:a aac -b:a 64k -ac 1 "${mp4Path}"`,
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
