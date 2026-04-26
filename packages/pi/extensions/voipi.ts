import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { VoiPi, providerMap, type SpeakOptions, type Voice } from "../../../src/index.ts";

const PROVIDERS = ["auto", "macos", "piper", "edge-tts", "google-tts"] as const;
const MAX_VOICE_RESULTS = 100;
const DEFAULT_VOICE_RESULTS = 25;

type SpeakParams = {
  text: string;
  provider?: string;
  voice?: string;
  lang?: string;
  rate?: number;
  outputFile?: string;
};

type ListVoicesParams = {
  provider?: string;
  lang?: string;
  query?: string;
  limit?: number;
};

export default function voipiExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "voipi_speak",
    label: "VoiPi Speak",
    description: "Synthesize text to speech and play it through the speakers, or save to a file.",
    promptSnippet: "Synthesize text to speech and play it through the speakers, or save to a file.",
    promptGuidelines: [
      "When preparing text for speech: use short, simple sentences; strip markdown, URLs, code blocks, and special characters; expand abbreviations; write numbers as words. The goal is short natural-sounding spoken output.",
      "Use this tool only when the user explicitly asks for spoken output, pronunciation, narration, or an audio file.",
      "Use voipi_list_voices first if the user asks which voices are available for a provider or language.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "The text to speak." }),
      provider: Type.Optional(
        Type.String({
          description:
            "TTS provider name. Leave empty for auto-detection. Prefer edge-tts (online, high quality), macos (native, fast), or piper (offline, neural).",
        }),
      ),
      voice: Type.Optional(Type.String({ description: "Voice identifier." })),
      lang: Type.Optional(Type.String({ description: "Language code (e.g. en, fr)." })),
      rate: Type.Optional(
        Type.Number({
          description: "Speech rate multiplier (1.0 = normal).",
          minimum: 0.25,
          maximum: 4,
        }),
      ),
      outputFile: Type.Optional(
        Type.String({
          description: "Optional path to save audio instead of playing it immediately.",
        }),
      ),
    }) as never,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SpeakParams;
      const text = params.text.trim();
      if (!text) {
        throw new Error("Text cannot be empty");
      }

      const tts = await createProvider(params.provider);
      const options = toSpeakOptions(params, signal);

      if (params.outputFile) {
        const outputFile = resolveOutputPath(params.outputFile, ctx.cwd);
        await mkdir(dirname(outputFile), { recursive: true });
        await suppressPiperConsoleOutput(() => tts.save(text, outputFile, options));

        return {
          content: [
            {
              type: "text",
              text: `Saved speech to ${outputFile} using ${tts.name}.`,
            },
          ],
          details: {
            action: "save",
            provider: tts.name,
            voice: params.voice,
            lang: params.lang,
            rate: params.rate,
            outputFile,
            characters: text.length,
          },
        };
      }

      await suppressPiperConsoleOutput(() => tts.speak(text, options));

      return {
        content: [
          {
            type: "text",
            text: `Played speech aloud using ${tts.name}.`,
          },
        ],
        details: {
          action: "speak",
          provider: tts.name,
          voice: params.voice,
          lang: params.lang,
          rate: params.rate,
          characters: text.length,
        },
      };
    },
  });

  pi.registerTool({
    name: "voipi_list_voices",
    label: "VoiPi Voices",
    description: "List available voices for a provider.",
    promptSnippet:
      "List available voices for a provider, optionally filtered by language or query.",
    promptGuidelines: [
      "Use this tool when the user asks which voices or languages are available before choosing one.",
    ],
    parameters: Type.Object({
      provider: Type.Optional(
        Type.String({
          description: "TTS provider name. Leave empty for auto-detection.",
        }),
      ),
      lang: Type.Optional(
        Type.String({ description: "Optional language filter such as en or fa." }),
      ),
      query: Type.Optional(
        Type.String({ description: "Optional case-insensitive search over voice ids and names." }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: `Maximum number of voices to return. Defaults to ${DEFAULT_VOICE_RESULTS}.`,
          minimum: 1,
          maximum: MAX_VOICE_RESULTS,
        }),
      ),
    }) as never,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as ListVoicesParams;
      const tts = await createProvider(params.provider);
      const allVoices = await tts.listVoices?.();
      const voices = filterVoices(allVoices, params.lang, params.query);
      const limit = clampLimit(params.limit);
      const shown = voices.slice(0, limit);

      const lines = shown.map((voice) => formatVoice(voice));
      if (voices.length > shown.length) {
        lines.push(`… ${voices.length - shown.length} more voice(s) not shown.`);
      }

      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : `No voices found for provider ${tts.name}.`,
          },
        ],
        details: {
          provider: tts.name,
          total: voices.length,
          shown: shown.length,
          voices: shown,
        },
      };
    },
  });

  pi.registerCommand("tts", {
    description: "Speak text aloud using VoiPi",
    handler: async (args, ctx) => {
      const text =
        args.trim() || (await ctx.ui.input("Speak with VoiPi", "Enter text to read aloud"));
      if (!text?.trim()) {
        return;
      }

      const tts = await createProvider();
      await suppressPiperConsoleOutput(() => tts.speak(text.trim(), { signal: ctx.signal }));

      if (ctx.hasUI) {
        ctx.ui.notify(`Spoke text using ${tts.name}.`, "info");
      }
    },
  });

  pi.registerCommand("tts-voices", {
    description: "Browse available VoiPi voices: /tts-voices [provider] [query]",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trim().toLowerCase();
      const items = PROVIDERS.filter((provider) => provider.startsWith(normalized)).map(
        (provider) => ({
          value: provider,
          label: provider,
        }),
      );
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const { provider, query } = parseVoiceCommandArgs(args);
      const tts = await createProvider(provider);
      const voices = filterVoices(await tts.listVoices?.(), undefined, query).slice(
        0,
        MAX_VOICE_RESULTS,
      );

      if (voices.length === 0) {
        ctx.ui.notify(`No voices found for ${tts.name}.`, "warning");
        return;
      }

      const labels = voices.map((voice) => formatVoice(voice));
      const selected = await ctx.ui.select(`VoiPi voices (${tts.name})`, labels);
      if (!selected) {
        return;
      }

      const index = labels.indexOf(selected);
      const voice = voices[index];
      if (!voice) {
        return;
      }

      ctx.ui.notify(`Selected voice: ${voice.id}`, "info");
    },
  });
}

async function createProvider(provider = "auto") {
  if (provider === "auto") {
    return new VoiPi();
  }

  const factory = providerMap[provider];
  if (!factory) {
    throw new Error(`Unknown provider "${provider}". Available providers: ${PROVIDERS.join(", ")}`);
  }

  return factory();
}

function toSpeakOptions(
  params: { voice?: string; lang?: string; rate?: number },
  signal?: AbortSignal,
): SpeakOptions {
  return {
    voice: params.voice,
    lang: params.lang,
    rate: params.rate,
    signal,
  };
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) {
    return DEFAULT_VOICE_RESULTS;
  }
  return Math.max(1, Math.min(MAX_VOICE_RESULTS, Math.floor(limit)));
}

function filterVoices(voices: Voice[] | undefined, lang?: string, query?: string): Voice[] {
  const normalizedLang = lang?.trim().toLowerCase();
  const normalizedQuery = query?.trim().toLowerCase();

  return (voices ?? []).filter((voice) => {
    const voiceLang = voice.lang?.toLowerCase();
    const matchesLang =
      !normalizedLang ||
      voiceLang === normalizedLang ||
      voiceLang?.startsWith(`${normalizedLang}-`);

    const haystack = `${voice.id} ${voice.name} ${voice.lang ?? ""}`.toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);

    return matchesLang && matchesQuery;
  });
}

function parseVoiceCommandArgs(args: string): { provider: string; query?: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { provider: "auto" };
  }

  const [first, ...rest] = trimmed.split(/\s+/) as [string, ...string[]];
  if (PROVIDERS.includes(first as (typeof PROVIDERS)[number])) {
    return {
      provider: first,
      query: rest.join(" ").trim() || undefined,
    };
  }

  return {
    provider: "auto",
    query: trimmed,
  };
}

function formatVoice(voice: Voice): string {
  return voice.lang ? `${voice.id} — ${voice.name} (${voice.lang})` : `${voice.id} — ${voice.name}`;
}

async function suppressPiperConsoleOutput<T>(fn: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && first.startsWith("[piper]")) {
      return;
    }
    originalError(...args);
  };

  try {
    return await fn();
  } finally {
    console.error = originalError;
  }
}

function resolveOutputPath(path: string, cwd: string): string {
  const normalized = path.startsWith("@") ? path.slice(1) : path;
  return resolve(cwd, normalized);
}
