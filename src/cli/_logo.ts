export interface LogoOptions {
  /** Animation state: "idle" = no waves, "speaking" = animated waves, "done" = static waves */
  state?: "idle" | "speaking" | "done";
  /** Eye style: "open" = ●, "happy" = ◠, "closed" = ─, "wink" = ● ─ */
  eyes?: "open" | "happy" | "closed" | "wink";
  /** Animation time in seconds (drives wave cycling) */
  time?: number;
}

export function logo(opts: LogoOptions = {}): string {
  if (!process.stdout.isTTY) return "";

  const hasOpts = Object.keys(opts).length > 0;
  const { state, eyes, time } = hasOpts
    ? { state: opts.state ?? "idle", eyes: opts.eyes ?? "open", time: opts.time ?? 0 }
    : randomLogoState();

  const y = "\x1B[38;2;255;217;61m";
  const o = "\x1B[38;2;255;107;53m";
  const p = "\x1B[38;2;255;155;155m";
  const d = "\x1B[2m"; // dim
  const r = "\x1B[0m";

  const [eyeL, eyeR] = renderEyes(eyes);
  const waves = renderWaves(state, time, o, d, r);

  return [
    "",
    `   ${y}╭────────────╮${r}`,
    `   ${y}│${r}  ${eyeL}      ${eyeR}  ${y}│${r} ${waves[0]}`,
    `   ${y}│${r} ${p}°${r}  ╰──╯  ${p}°${r} ${y}│${r} ${waves[1]}`,
    `   ${y}╰────────────╯${r}`,
    "",
  ].join("\n");
}

/** Start an animated logo that writes to stderr. Returns stop() handle. */
export function animateLogo(opts: Omit<LogoOptions, "time"> = {}): {
  update: (o: Partial<LogoOptions>) => void;
  stop: () => void;
} {
  const LINE_COUNT = 6; // lines in logo() output (including empty top/bottom)
  const startTime = performance.now();
  let current: LogoOptions = { state: "speaking", eyes: "open", ...opts };
  let rendered = false;

  const render = () => {
    const time = (performance.now() - startTime) / 1000;
    const frame = logo({ ...current, time });
    const up = rendered ? `\x1B[${LINE_COUNT}A` : "";
    rendered = true;
    process.stderr.write(up + frame);
  };

  render();
  const interval = setInterval(render, 120);

  return {
    update(o) {
      Object.assign(current, o);
    },
    stop() {
      clearInterval(interval);
      const frame = logo({ ...current, state: "done", eyes: "happy", time: 0 });
      const up = rendered ? `\x1B[${LINE_COUNT}A` : "";
      process.stderr.write(up + frame);
    },
  };
}

// ---- internals ----

function randomLogoState(): {
  state: "idle" | "speaking" | "done";
  eyes: "open" | "happy" | "closed" | "wink";
  time: number;
} {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
  const state = pick(["idle", "speaking", "done"] as const);
  const eyes = pick(["open", "happy", "closed", "wink"] as const);
  const time = Math.random() * 4;
  return { state, eyes, time };
}

export function renderEyes(eyes: "open" | "happy" | "closed" | "wink"): [string, string] {
  switch (eyes) {
    case "open":
      return ["●", "●"];
    case "happy":
      return ["◠", "◠"];
    case "closed":
      return ["─", "─"];
    case "wink":
      return ["●", "─"];
  }
}

function renderWaves(
  state: "idle" | "speaking" | "done",
  time: number,
  o: string,
  d: string,
  r: string,
): [string, string] {
  if (state === "idle") return [`${d}···${r}`, `${d}··${r}`];
  if (state === "done") return [`${o})))${r}`, ` ${o}))${r}`];

  // Cycle through wave patterns based on time
  const cycle = Math.floor(time * 4) % 4;
  const patterns: [string, string][] = [
    [`${o})))${r}`, ` ${o}))${r}`],
    [` ${o}))${r}`, `  ${o})${r}`],
    [`${o})))${r}`, `${o})))${r}`],
    [` ${o}))${r}`, `${o})))${r}`],
  ];
  return patterns[cycle]!;
}
