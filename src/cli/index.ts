#!/usr/bin/env node

import { parseArgs } from "node:util";
import { getNodeBuiltin, playAudio, resolveVoice } from "../_utils.ts";
import { getAudioDuration } from "../_audio.ts";
import { VoiPi, providerMap } from "../voipi.ts";
import { createProgress, estimateSynthTime } from "./_progress.ts";
import { logo } from "./_logo.ts";
import { serveMCP } from "./_mcp.ts";
import { installMCP } from "./_install.ts";

const providerNames = ["auto", ...Object.keys(providerMap)];

function usage(): void {
  if (!process.stdout.isTTY) {
    console.log(`voipi - text-to-voice and voice-to-text

Usage:
  voipi speak <text> [-v|--voice <name>] [-l|--lang <code>] [-r|--rate <n>] [-o|--output <file>] [-p|--provider <name>]
  voipi voices [-p|--provider <name>]
  voipi mcp [--install] [--no-global]
  voipi --help

Providers: ${providerNames.map((n) => (n === "auto" ? "auto (default)" : n)).join(", ")}`);
    return;
  }

  const y = "\x1B[38;2;255;217;61m"; // yellow
  const o = "\x1B[38;2;255;107;53m"; // orange
  const d = "\x1B[2m"; // dim
  const r = "\x1B[0m"; // reset

  const providers = providerNames
    .map((n) => (n === "auto" ? `${y}auto${d} (default)${r}` : `${d}${n}${r}`))
    .join(`${d}, ${r}`);

  console.log(`${logo()}
${y}voipi${r} ${d}-${r} text-to-voice and voice-to-text

${o}Usage:${r}
  ${y}voipi speak${r} ${d}<text>${r} ${d}[-v|--voice <name>] [-l|--lang <code>] [-r|--rate <n>] [-o|--output <file>] [-p|--provider <name>]${r}
  ${y}voipi voices${r} ${d}[-p|--provider <name>]${r}
  ${y}voipi mcp${r} ${d}— start MCP stdio server${r}
  ${y}voipi mcp --install${r} ${d}— install MCP server to detected agents (global by default)${r}
  ${y}voipi${r} ${d}--help${r}

${o}Providers:${r} ${providers}`);
}

async function showVoices(voipi: VoiPi): Promise<void> {
  const provider = await voipi.resolveProvider();
  if (!provider.listVoices) {
    console.log(`Provider "${provider.name}" does not support listing voices.`);
    return;
  }
  const voices = await provider.listVoices();
  const isTTY = process.stdout.isTTY;
  const o = isTTY ? "\x1B[38;2;255;107;53m" : "";
  const y = isTTY ? "\x1B[38;2;255;217;61m" : "";
  const d = isTTY ? "\x1B[2m" : "";
  const r = isTTY ? "\x1B[0m" : "";

  console.log(`\n${o}Voices${r} ${d}(${provider.name}, ${voices.length}):${r}\n`);

  // Format each entry as "id (lang)" and render in columns
  const entries = voices.map((v) => {
    const label = v.lang ? `${v.id} ${d}${v.lang}${r}` : v.id;
    return { label: `${y}${label}${r}`, width: v.id.length + (v.lang ? v.lang.length + 1 : 0) };
  });

  const termWidth = process.stdout.columns || 80;
  const maxWidth = Math.max(...entries.map((e) => e.width));
  const colWidth = maxWidth + 3; // padding between columns
  const cols = Math.max(1, Math.floor((termWidth - 2) / colWidth));

  for (let i = 0; i < entries.length; i += cols) {
    const row = entries.slice(i, i + cols);
    const line = row
      .map((e, j) => {
        const pad = j < row.length - 1 ? " ".repeat(colWidth - e.width) : "";
        return e.label + pad;
      })
      .join("");
    console.log(`  ${line}`);
  }
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    voice: { type: "string", short: "v" },
    lang: { type: "string", short: "l" },
    rate: { type: "string", short: "r" },
    output: { type: "string", short: "o" },
    provider: { type: "string", short: "p" },
    install: { type: "boolean" },
    global: { type: "boolean", short: "g", default: true },
  },
  allowPositionals: true,
  allowNegative: true,
});

const command = positionals[0];

async function main(): Promise<void> {
  const providerName = values.provider || "auto";
  const voipi = createVoiPi(providerName);

  if (values.help) {
    usage();
    if (values.provider) {
      await showVoices(voipi);
    }
    return;
  }

  if (!command || command === "speak") {
    const textParts = command === "speak" ? positionals.slice(1) : positionals;
    const text = textParts.join(" ");
    if (!text) {
      usage();
      return;
    }
    await speak(voipi, text);
  } else if (command === "voices") {
    await showVoices(voipi);
  } else if (command === "mcp") {
    if (values.install || positionals[1] === "install") {
      await installMCP({ global: values.global !== false });
      return;
    }
    await serveMCP();
  } else {
    // Treat unknown command as text for speak
    const text = positionals.join(" ");
    await speak(voipi, text);
  }
}

async function speak(voipi: VoiPi, text: string): Promise<void> {
  const opts = {
    voice: values.voice,
    lang: values.lang,
    rate: values.rate ? Number(values.rate) : undefined,
  };

  const initialProvider = await voipi.resolveProvider();

  if (values.provider && values.provider !== "auto") {
    const voice = await resolveVoice(
      opts.voice,
      initialProvider.listVoices?.bind(initialProvider),
      initialProvider.hasVoice?.bind(initialProvider),
    );
    if (voice) opts.voice = voice;
  }

  const defaults = initialProvider.getDefaults();
  const overrides: Record<string, string | undefined> = {};
  if (opts.voice) overrides.voice = opts.voice;
  if (opts.lang) overrides.lang = opts.lang;
  if (opts.rate !== undefined) overrides.rate = String(opts.rate);
  if (values.output) overrides.output = values.output;

  const configParts = Object.entries({ ...defaults, ...overrides })
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`);
  const detail = configParts.length > 0 ? configParts.join(", ") : "";

  const bar = createProgress({ detail });

  const synthEst = estimateSynthTime(initialProvider.name, text);
  bar?.start(`synthesizing with ${initialProvider.name}`, synthEst, "synth");
  const audio = await voipi.synthesize(text, opts);
  const sizeKB = (audio.data.length / 1024).toFixed(1);

  if (values.output) {
    bar?.update({ label: `saving to ${values.output}`, detail: `${sizeKB}kB` });
    const fsp = getNodeBuiltin("node:fs/promises");
    await fsp.writeFile(values.output, audio.data);
    bar?.stop(sizeKB + "kB");
  } else {
    const duration = getAudioDuration(audio.data, audio.ext);
    bar?.start("playing", duration, "play");
    bar?.update({ detail: "" });
    await playAudio(audio);
    bar?.stop(sizeKB + "kB");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// ---- internals ----

function createVoiPi(name: string): VoiPi {
  if (!name || name === "auto") return new VoiPi();
  const factory = providerMap[name];
  if (!factory) {
    console.error(`Unknown provider: ${name}\nAvailable: ${providerNames.join(", ")}`);
    process.exit(1);
  }
  return new VoiPi({ providers: [factory] });
}
