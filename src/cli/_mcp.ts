import { VoiPi, providerMap } from "../voipi.ts";
import type { SpeakOptions, Voice } from "../types.ts";
import { getNodeBuiltin, resolveVoice } from "../_utils.ts";
import { getAudioDuration, estimateSpeechDuration } from "../_audio.ts";
import pkg from "../../package.json" with { type: "json" };

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: pkg.name, version: pkg.version };

const CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: "speak",
    description: "Synthesize text to speech and play it through the speakers",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to speak" },
        voice: { type: "string", description: "Voice identifier" },
        lang: { type: "string", description: "Language code (e.g. en, fr)" },
        rate: { type: "number", description: "Speech rate multiplier (1.0 = normal)" },
        provider: {
          type: "string",
          description:
            "TTS provider name. Leave empty for auto-detection. Prefer edge-tts (online, high quality), macos (native, fast), or piper (offline, neural).",
        },
        wait: {
          type: "boolean",
          description:
            "Wait for playback to finish before returning. Default: false (returns immediately while audio plays in background). Only set to true if user explicitly asks to wait or a subsequent action depends on playback finishing.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "save",
    description: "Synthesize text to speech and save to file",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to speak" },
        output: { type: "string", description: "Output file path" },
        voice: { type: "string", description: "Voice identifier" },
        lang: { type: "string", description: "Language code (e.g. en, fr)" },
        rate: { type: "number", description: "Speech rate multiplier (1.0 = normal)" },
        provider: {
          type: "string",
          description: "TTS provider name. Leave empty for auto-detection.",
        },
      },
      required: ["text", "output"],
    },
  },
  {
    name: "list_voices",
    description: "List available voices for a provider",
    inputSchema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          description: "TTS provider name. Leave empty for auto-detection.",
        },
      },
    },
  },
];

export async function serveMCP(): Promise<void> {
  let buffer = "";

  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        _send(_errorResponse(null, -32700, "Parse error"));
        continue;
      }

      if (!("method" in msg)) continue; // ignore responses

      if ("id" in msg) {
        const result = await _handleRequest(msg as JsonRpcRequest);
        _send(result);
      }
      // notifications — no response needed
    }
  }
}

// ---- internals ----

interface JsonRpcMessage {
  jsonrpc: "2.0";
  method?: string;
  id?: string | number;
  params?: Record<string, unknown>;
}

interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number;
  method: string;
}

function _send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function _response(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function _errorResponse(
  id: string | number | null,
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function _createVoiPi(providerName?: string): VoiPi {
  if (!providerName || providerName === "auto") return new VoiPi();
  const factory = providerMap[providerName];
  if (!factory) throw new Error(`Unknown provider: ${providerName}`);
  return new VoiPi({ providers: [factory] });
}

async function _handleRequest(req: JsonRpcRequest): Promise<Record<string, unknown>> {
  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      return _response(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions:
          "Text-to-speech tools. When preparing text for speech: use short, simple sentences; strip markdown, URLs, code blocks, and special characters; expand abbreviations; write numbers as words. The goal is short natural-sounding spoken output.",
      });

    case "ping":
      return _response(id, {});

    case "tools/list":
      return _response(id, { tools: TOOLS });

    case "tools/call":
      return _handleToolCall(id, params as { name: string; arguments?: Record<string, unknown> });

    default:
      return _errorResponse(id, -32601, `Method not found: ${method}`);
  }
}

async function _handleToolCall(
  id: string | number,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const args = params.arguments ?? {};

  try {
    switch (params.name) {
      case "speak":
        return _response(id, await _toolSpeak(args));
      case "save":
        return _response(id, await _toolSave(args));
      case "list_voices":
        return _response(id, await _toolListVoices(args));
      default:
        return _response(id, {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
        });
    }
  } catch (err) {
    return _response(id, {
      isError: true,
      content: [{ type: "text", text: (err as Error).message }],
    });
  }
}

async function _toolSpeak(args: Record<string, unknown>): Promise<unknown> {
  const text = args.text as string;
  const wait = args.wait === true;
  const voipi = _createVoiPi(args.provider as string | undefined);
  const provider = await voipi.resolveProvider();
  const opts = await _buildOpts(args, provider);

  if (wait) {
    await provider.speak(text, opts);
    return {
      content: [{ type: "text", text: `Spoke "${_truncate(text, 100)}" using ${provider.name}` }],
    };
  }

  // Fire-and-forget: start playback but return immediately
  const speakPromise = provider.speak(text, opts);
  speakPromise.catch(() => {}); // prevent unhandled rejection
  const duration = estimateSpeechDuration(text, (args.rate as number) ?? 1);
  return {
    content: [
      {
        type: "text",
        text: `Playing "${_truncate(text, 100)}" using ${provider.name} (~${duration.toFixed(1)}s)`,
      },
    ],
  };
}

async function _toolSave(args: Record<string, unknown>): Promise<unknown> {
  const text = args.text as string;
  const output = args.output as string;
  const voipi = _createVoiPi(args.provider as string | undefined);
  const provider = await voipi.resolveProvider();
  const opts = await _buildOpts(args, provider);
  const audio = await provider.synthesize(text, opts);
  const fsp = getNodeBuiltin("node:fs/promises");
  await fsp.writeFile(output, audio.data);
  const duration = getAudioDuration(audio.data, audio.ext);
  const sizeKB = (audio.data.length / 1024).toFixed(1);
  return {
    content: [
      {
        type: "text",
        text: `Saved to ${output} (${sizeKB}kB${duration ? `, ${duration.toFixed(1)}s` : ""})`,
      },
    ],
  };
}

async function _toolListVoices(args: Record<string, unknown>): Promise<unknown> {
  const voipi = _createVoiPi(args.provider as string | undefined);
  const provider = await voipi.resolveProvider();
  if (!provider.listVoices) {
    return {
      content: [
        { type: "text", text: `Provider "${provider.name}" does not support listing voices` },
      ],
    };
  }
  const voices = await provider.listVoices();
  const lines = voices.map((v) => (v.lang ? `${v.id} (${v.lang})` : v.id));
  return {
    content: [
      {
        type: "text",
        text: `${provider.name}: ${voices.length} voices\n\n${lines.join("\n")}`,
      },
    ],
  };
}

async function _buildOpts(
  args: Record<string, unknown>,
  provider: { listVoices?(): Promise<Voice[]>; hasVoice?(id: string): boolean },
): Promise<SpeakOptions> {
  const opts: SpeakOptions = {};
  if (args.lang) opts.lang = args.lang as string;
  if (args.rate) opts.rate = args.rate as number;
  if (args.voice) {
    const voice = await resolveVoice(
      args.voice as string,
      provider.listVoices?.bind(provider),
      provider.hasVoice?.bind(provider),
    );
    if (voice) opts.voice = voice;
  }
  return opts;
}

function _truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
