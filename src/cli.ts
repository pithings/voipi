#!/usr/bin/env node

import { parseArgs } from "node:util";
import { VoiPi, providerMap } from "./voipi.ts";

const providerNames = ["auto", ...Object.keys(providerMap)];

function usage(): void {
  console.log(`voipi - text-to-voice and voice-to-text

Usage:
  voipi speak <text> [-v|--voice <name>] [-r|--rate <n>] [-o|--output <file>] [-p|--provider <name>]
  voipi voices [-p|--provider <name>]
  voipi --help

Providers:
  ${providerNames.map((n) => (n === "auto" ? "auto (default)" : n)).join("\n  ")}`);
}

async function showVoices(voipi: VoiPi): Promise<void> {
  const provider = await voipi.resolveProvider();
  if (!provider.listVoices) {
    console.log(`Provider "${provider.name}" does not support listing voices.`);
    return;
  }
  const voices = await provider.listVoices();
  console.log(`\nVoices (${provider.name}):\n`);
  for (const v of voices) {
    console.log(`  ${v.id}${v.lang ? `\t${v.lang}` : ""}`);
  }
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    voice: { type: "string", short: "v" },
    rate: { type: "string", short: "r" },
    output: { type: "string", short: "o" },
    provider: { type: "string", short: "p" },
  },
  allowPositionals: true,
});

const command = positionals[0];

async function main(): Promise<void> {
  const providerName = values.provider ?? "auto";
  const voipi = _createVoiPi(providerName);

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

    await voipi.speak(text, {
      voice: values.voice,
      rate: values.rate ? Number(values.rate) : undefined,
      outputFile: values.output,
    });
  } else if (command === "voices") {
    await showVoices(voipi);
  } else {
    // Treat unknown command as text for speak
    const text = positionals.join(" ");
    await voipi.speak(text, {
      voice: values.voice,
      rate: values.rate ? Number(values.rate) : undefined,
      outputFile: values.output,
    });
  }
}

function _createVoiPi(name: string): VoiPi {
  if (name === "auto") return new VoiPi();
  const factory = providerMap[name];
  if (!factory) {
    console.error(`Unknown provider: ${name}\nAvailable: ${providerNames.join(", ")}`);
    process.exit(1);
  }
  return new VoiPi({ providers: [factory] });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
