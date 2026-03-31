import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { exec, getNodeBuiltin, resolveVoice } from "../_utils.ts";

export interface MacOSOptions {
  /** Default voice name (e.g. "Samantha", "Daniel") */
  voice?: string;
  /** Default speech rate multiplier (1.0 = normal, maps to ~175 wpm) */
  rate?: number;
}

export class MacOS extends BaseVoiceProvider {
  name = "macos";
  private _defaults: MacOSOptions;

  constructor(options?: MacOSOptions) {
    super();
    this._defaults = { ...options };
    if (
      typeof globalThis.process?.platform !== "undefined" &&
      globalThis.process.platform !== "darwin"
    ) {
      throw new Error("MacOS provider is only available on macOS");
    }
  }

  override hasVoice(id: string): boolean {
    // Common built-in macOS voices (avoids exec call for fast path)
    return /^(Alex|Daniel|Fiona|Fred|Karen|Moira|Rishi|Samantha|Tessa|Veena|Victoria|Zoe)$/.test(
      id,
    );
  }

  override async synthesize(text: string, options?: SpeakOptions): Promise<AudioData> {
    const { tmpdir } = getNodeBuiltin("node:os");
    const { join } = getNodeBuiltin("node:path");
    const fsp = getNodeBuiltin("node:fs/promises");
    const hex = [...crypto.getRandomValues(new Uint8Array(4))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const tmpFile = join(tmpdir(), `voipi-${hex}.aiff`);
    try {
      await this._say(text, options, ["-o", tmpFile]);
      const data = await fsp.readFile(tmpFile);
      return { data: Buffer.from(data), ext: ".aiff" };
    } finally {
      await fsp.unlink(tmpFile).catch(() => {});
    }
  }

  override async speak(text: string, options?: SpeakOptions): Promise<void> {
    await this._say(text, options);
  }

  override async save(text: string, outputFile: string, options?: SpeakOptions): Promise<void> {
    await this._say(text, options, ["-o", outputFile]);
  }

  private async _say(text: string, options?: SpeakOptions, extraArgs?: string[]): Promise<void> {
    const args: string[] = [];

    const voice = await resolveVoice(
      options?.voice ?? this._defaults.voice,
      () => this.listVoices(),
      (id) => this.hasVoice(id),
    );
    if (voice) {
      args.push("-v", voice);
    }

    const rate = options?.rate ?? this._defaults.rate;
    if (rate != null) {
      args.push("-r", String(Math.round(175 * rate)));
    }

    if (extraArgs) {
      args.push(...extraArgs);
    }

    args.push("--", text);

    await exec("say", args);
  }

  override async listVoices(): Promise<Voice[]> {
    const { stdout } = await exec("say", ["-v", "?"]);
    const voices: Voice[] = [];
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      // Format: "Name    lang_REGION  # description"
      const match = line.match(/^(.+?)\s{2,}(\S+)\s+#/);
      if (!match) continue;
      voices.push({
        id: match[1]!.trim(),
        name: match[1]!.trim(),
        lang: match[2]!.replace("_", "-"),
      });
    }
    return voices;
  }
}
