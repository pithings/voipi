import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { detectLanguage } from "../_lang.ts";
import { exec, getNodeBuiltin, which } from "../_utils.ts";

export interface EspeakNGOptions {
  /** Default voice name (e.g. "en", "en-us+f3") */
  voice?: string;
  /** Default speech rate multiplier (1.0 = normal, maps to ~175 wpm) */
  rate?: number;
}

export class EspeakNG extends BaseVoiceProvider {
  name = "espeak-ng";
  private _defaults: EspeakNGOptions;

  constructor(options?: EspeakNGOptions) {
    super();
    this._defaults = { ...options };
  }

  static async create(options?: EspeakNGOptions): Promise<EspeakNG> {
    if (!(await which("espeak-ng"))) {
      throw new Error("espeak-ng is not installed");
    }
    return new EspeakNG(options);
  }

  override getDefaults() {
    return {
      voice: this._defaults.voice ?? "en",
      rate: this._defaults.rate?.toString(),
    };
  }

  override async synthesize(text: string, options?: SpeakOptions): Promise<AudioData> {
    const args = this._buildArgs(text, options, ["--stdout"]);
    const { stdout } = await _execBinary("espeak-ng", args, options?.signal);
    return { data: stdout, ext: ".wav" };
  }

  override async speak(text: string, options?: SpeakOptions): Promise<void> {
    const args = this._buildArgs(text, options);
    await exec("espeak-ng", args, { signal: options?.signal });
  }

  override async listVoices(): Promise<Voice[]> {
    const { stdout } = await exec("espeak-ng", ["--voices"]);
    return _parseVoiceList(stdout);
  }

  private _buildArgs(text: string, options?: SpeakOptions, extraFlags?: string[]): string[] {
    const args: string[] = [];

    const voice = options?.voice ?? this._defaults.voice;
    const resolvedVoice = typeof voice === "string" ? voice : undefined;

    const lang = options?.lang ?? detectLanguage(text);
    if (resolvedVoice) {
      args.push("-v", resolvedVoice);
    } else if (lang) {
      args.push("-v", lang);
    }

    const rate = options?.rate ?? this._defaults.rate;
    if (rate != null) {
      args.push("-s", String(Math.round(175 * rate)));
    }

    if (extraFlags) args.push(...extraFlags);
    args.push("--", text);
    return args;
  }
}

// ---- internals ----

function _execBinary(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: Buffer; stderr: string }> {
  const { execFile } = getNodeBuiltin("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout: Buffer.from(stdout), stderr: String(stderr) });
      },
    );
  });
}

function _parseVoiceList(stdout: string): Voice[] {
  const voices: Voice[] = [];
  const lines = stdout.split("\n");
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    // Format: " Pty Language       Age/Gender VoiceName          File          Other Languages"
    const match = line.match(/^\s*\d+\s+(\S+)\s+\S+\s+(\S+)/);
    if (!match) continue;
    const lang = match[1]!;
    const name = match[2]!;
    voices.push({ id: name, name, lang });
  }
  return voices;
}
