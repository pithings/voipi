import { VoiPi, providerMap } from "../voipi.ts";
import type { SpeakOptions, Voice } from "../types.ts";
import { getNodeBuiltin, resolveVoice } from "../_utils.ts";
import { getAudioDuration, estimateSpeechDuration } from "../_audio.ts";
import pkg from "../../package.json" with { type: "json" };

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
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
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  let outputMode: "line" | "framed" = "line";

  const drain = async (flush = false): Promise<void> => {
    while (true) {
      const frame = _readFrame(buffer, flush);
      if (!frame) break;
      buffer = buffer.subarray(frame.bytesConsumed);
      outputMode = frame.mode;
      if (!frame.body.trim()) continue;

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(frame.body);
      } catch {
        _send(_errorResponse(null, -32700, "Parse error"), outputMode);
        continue;
      }

      if (!("method" in msg)) continue; // ignore responses

      if ("id" in msg) {
        const result = await _handleRequest(msg as JsonRpcRequest);
        _send(result, outputMode);
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    const readBuffered = () => {
      const chunks: Buffer[] = [];
      let chunk: string | Buffer | null;
      while ((chunk = process.stdin.read() as string | Buffer | null) !== null) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
      }
      if (chunks.length === 0) return;

      const data = Buffer.concat(chunks);
      queue = queue.then(async () => {
        buffer = Buffer.concat([buffer, data]);
        await drain();
      });
    };

    process.stdin.on("readable", readBuffered);

    process.stdin.on("end", () => {
      queue.then(() => drain(true)).then(resolve, reject);
    });

    process.stdin.on("error", reject);
    readBuffered();
    if (process.stdin.readableEnded) {
      queue.then(() => drain(true)).then(resolve, reject);
      return;
    }
  });
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

function _send(msg: Record<string, unknown>, mode: "line" | "framed"): void {
  const body = JSON.stringify(msg);
  process.stdout.write(
    mode === "framed"
      ? `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
      : `${body}\n`,
  );
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
      {
        const requestedVersion = params?.protocolVersion;
        const protocolVersion =
          typeof requestedVersion === "string" &&
          SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
            ? requestedVersion
            : PROTOCOL_VERSION;
      return _response(id, {
        protocolVersion,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions:
          "Voice output to speak out loud. Use proactively — no need for the user to ask. Speak to announce completed tasks, alert on blockers, or talk casually. Keep it short and natural — clean plain text only (no markdown, URLs, or code). Always match the conversation language: set `lang` to the appropriate language code (e.g. `fa` for Persian, `fr` for French). For non-English languages, also pick a matching voice. Default to `wait: false` for fire-and-forget.",
      });
      }

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
      content: [
        {
          type: "text",
          text: `Playback finished for "${_truncate(text, 100)}" using ${provider.name}`,
        },
      ],
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

function _readFrame(
  buffer: Buffer,
  flush = false,
): { body: string; bytesConsumed: number; mode: "line" | "framed" } | null {
  const header = _readHeader(buffer);
  if (header) {
    const { headerEnd, separatorLength, contentLength } = header;
    const bodyStart = headerEnd + separatorLength;
    const frameEnd = bodyStart + contentLength;
    if (buffer.length < frameEnd) return null;
    return {
      body: buffer.subarray(bodyStart, frameEnd).toString("utf8"),
      bytesConsumed: frameEnd,
      mode: "framed",
    };
  }

  const newline = buffer.indexOf("\n");
  if (newline === -1) {
    if (!flush || buffer.length === 0) return null;
    return { body: buffer.toString("utf8"), bytesConsumed: buffer.length, mode: "line" };
  }

  const line = buffer.slice(0, newline).toString("utf8").trim();
  if (!line) return { body: "", bytesConsumed: newline + 1, mode: "line" };
  if (!line.startsWith("{")) return null;
  return { body: line, bytesConsumed: newline + 1, mode: "line" };
}

function _readHeader(
  buffer: Buffer,
): { headerEnd: number; separatorLength: number; contentLength: number } | null {
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  const lfIndex = buffer.indexOf("\n\n");

  let headerEnd = -1;
  let separatorLength = 0;
  if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
    headerEnd = crlfIndex;
    separatorLength = 4;
  } else if (lfIndex !== -1) {
    headerEnd = lfIndex;
    separatorLength = 2;
  } else {
    return null;
  }

  const headerText = buffer.subarray(0, headerEnd).toString("utf8");
  const lines = headerText.split(/\r?\n/);
  let contentLength: number | null = null;

  for (const line of lines) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === "content-length") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      contentLength = parsed;
    }
  }

  if (contentLength == null) return null;
  return { headerEnd, separatorLength, contentLength };
}
