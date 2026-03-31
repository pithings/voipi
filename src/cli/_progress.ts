import { hasTTY, isAgent } from "std-env";
import { renderEyes } from "./_logo.ts";

export function createProgress(opts: { detail?: string }) {
  if (!hasTTY || isAgent) return createSimpleProgress(opts);

  const BAR_WIDTH = 24;
  const startTime = performance.now();
  let detail = opts.detail ?? "";
  let interval: ReturnType<typeof setInterval> | undefined;
  let rendered = false;
  let label = "";
  let duration: number | undefined;
  let phaseStart = startTime;
  let synthRatio = 0;
  let playRatio = 0;
  let phase: "synth" | "play" = "synth";
  let synthLine = "";
  const LINE_COUNT = 7; // empty + empty + 4 logo rows + empty

  const render = (done = false) => {
    const now = performance.now();
    const totalElapsed = (now - startTime) / 1000;
    const phaseElapsed = (now - phaseStart) / 1000;

    if (duration && duration > 0) {
      let ratio: number;
      if (done && phase === "play") {
        ratio = 1;
      } else {
        const r = phaseElapsed / duration;
        ratio = r <= 1 ? r * 0.9 : 1 - 0.1 * Math.exp(-(r - 1) * 3);
      }
      if (phase === "synth") {
        synthRatio = Math.max(synthRatio, ratio);
      } else {
        playRatio = Math.max(playRatio, ratio);
      }
    }
    if (done && phase === "synth") synthRatio = 1;

    const dim = "\x1B[2m";
    const reset = "\x1B[0m";
    const y = "\x1B[38;2;255;217;61m";
    const p = "\x1B[38;2;255;155;155m";

    const eyes: "open" | "happy" | "closed" | "wink" = done
      ? "happy"
      : animateEyes(totalElapsed, phase);
    const [eyeL, eyeR] = renderEyes(eyes);

    const bar = waveBar(BAR_WIDTH, totalElapsed, synthRatio, playRatio);
    const timeStr = formatTime(totalElapsed);
    const detailStr = detail ? `  ${dim}(${detail})${reset}` : "";
    const status = `${dim}${timeStr}${reset}  ${label}${detailStr}`;
    const frozenStatus = synthLine ? `${synthLine}` : "";

    // Two-column: logo left, progress right
    // Row 0: empty
    // Row 1: top border
    // Row 2: eyes row  +  wave bar
    // Row 3: mouth row  +  status (or synth status if in play phase)
    // Row 4: bottom border  +  play status (if in play phase)
    // Row 5: empty
    const gap = "  ";
    const lines = [
      "",
      "",
      `   ${y}╭────────────╮${reset}`,
      `   ${y}│${reset}  ${eyeL}      ${eyeR}  ${y}│${reset}${gap}${bar}`,
      `   ${y}│${reset} ${p}°${reset}  ╰──╯  ${p}°${reset} ${y}│${reset}${gap}${frozenStatus || status}`,
      `   ${y}╰────────────╯${reset}${frozenStatus ? `${gap}${status}` : ""}`,
      "",
    ];

    const up = rendered ? `\x1B[${LINE_COUNT}A\r` : "";
    rendered = true;

    let out = up;
    for (const line of lines) {
      out += `\x1B[2K${line}\n`;
    }
    process.stderr.write(out);
  };

  const onSigint = () => {
    if (interval) clearInterval(interval);
    interval = undefined;
    process.stderr.write("\n");
    process.removeListener("SIGINT", onSigint);
    process.exit(130);
  };

  return {
    start(phaseLabel: string, phaseDuration?: number, phaseType: "synth" | "play" = "synth") {
      if (phase === "synth" && phaseType === "play" && rendered) {
        const dim = "\x1B[2m";
        const reset = "\x1B[0m";
        const elapsed = (performance.now() - startTime) / 1000;
        const detailStr = detail ? `  ${dim}(${detail})${reset}` : "";
        synthLine = `${dim}${formatTime(elapsed)}${reset}  ${label}${detailStr}`;
      }
      label = phaseLabel;
      duration = phaseDuration;
      phase = phaseType;
      phaseStart = performance.now();
      if (!interval) {
        process.on("SIGINT", onSigint);
        render();
        interval = setInterval(() => render(), 100);
      }
    },
    update(opts: { detail?: string; label?: string }) {
      if (opts.detail !== undefined) detail = opts.detail;
      if (opts.label !== undefined) label = opts.label;
    },
    stop(finalDetail?: string) {
      if (interval) clearInterval(interval);
      interval = undefined;
      process.removeListener("SIGINT", onSigint);
      synthRatio = 1;
      playRatio = 1;
      if (finalDetail !== undefined) detail = finalDetail;
      render(true);
    },
  };
}

/** Estimate synthesis time (seconds) from provider name + word count. */
export function estimateSynthTime(provider: string, text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const msPerWord: Record<string, number> = {
    macos: 70,
    "edge-tts": 22,
    "google-tts": 15,
    piper: 40,
  };
  const rate = msPerWord[provider] ?? 30;
  return Math.max(0.3, (words * rate) / 1000);
}

function createSimpleProgress(opts: { detail?: string }) {
  let detail = opts.detail ?? "";
  return {
    start(label: string, _duration?: number, _phase?: "synth" | "play") {
      const suffix = detail ? ` (${detail})` : "";
      process.stderr.write(`${label}${suffix}...`);
    },
    update(opts: { detail?: string; label?: string }) {
      if (opts.detail !== undefined) detail = opts.detail;
    },
    stop(finalDetail?: string) {
      const suffix = finalDetail ? ` ${finalDetail}` : "";
      process.stderr.write(` done${suffix}\n`);
    },
  };
}

// ---- internals ----

function animateEyes(time: number, phase: "synth" | "play"): "open" | "happy" | "closed" | "wink" {
  if (phase === "play") {
    const cycle = time % 2;
    return cycle > 1.85 ? "closed" : "happy";
  }
  // Synth: open with periodic blink every ~1.5s
  const cycle = time % 1.5;
  if (cycle > 1.4) return "closed";
  if (cycle > 1.3) return "wink";
  return "open";
}

const WAVE_CHARS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function rainbow(t: number): string {
  const r = Math.round(Math.sin(t) * 127 + 128);
  const g = Math.round(Math.sin(t + (Math.PI * 2) / 3) * 127 + 128);
  const b = Math.round(Math.sin(t + (Math.PI * 4) / 3) * 127 + 128);
  return `\x1B[38;2;${r};${g};${b}m`;
}

function waveBar(width: number, time: number, synthRatio: number, playRatio: number): string {
  const gray = "\x1B[38;2;100;100;100m";
  const dim = "\x1B[2m";
  const reset = "\x1B[0m";
  let result = "";
  for (let i = 0; i < width; i++) {
    const pos = i / width;
    const zone = pos <= playRatio ? "rainbow" : pos <= synthRatio ? "gray" : "empty";
    if (zone === "empty") {
      result += dim + "·";
    } else {
      const x = i / width;
      const wave =
        0.4 * Math.sin(x * Math.PI * 4 + time * 3) +
        0.3 * Math.sin(x * Math.PI * 7 - time * 5) +
        0.3 * Math.sin(x * Math.PI * 11 + time * 2);
      const idx = Math.round(((wave + 1) / 2) * (WAVE_CHARS.length - 1));
      if (zone === "rainbow") {
        result += rainbow(pos * Math.PI * 2 + time * 2) + WAVE_CHARS[idx]!;
      } else {
        result += gray + WAVE_CHARS[idx]!;
      }
    }
  }
  result += reset;
  return result;
}

function formatTime(s: number): string {
  const ms = s * 1000;
  const str = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  return str.padStart(5);
}
