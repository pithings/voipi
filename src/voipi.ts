import type { SpeakOptions, Voice } from "./types.ts";
import { BaseVoiceProvider } from "./_provider.ts";
import type { AudioData } from "./_provider.ts";
import { resolveVoice } from "./_utils.ts";

export type ProviderFactory = () => BaseVoiceProvider | Promise<BaseVoiceProvider>;

export interface VoiPiOptions {
  /** Custom provider chain. First available provider wins. */
  providers?: ProviderFactory[];
}

/**
 * Named provider factories for explicit provider selection.
 * Keys are the provider names used in CLI and programmatic API.
 */
export const providerMap: Record<string, ProviderFactory> = {
  macos: () => import("./providers/macos.ts").then((m) => new m.MacOS()),
  piper: () => import("./providers/piper.ts").then((m) => new m.Piper()),
  "edge-tts": () => import("./providers/edge-tts.ts").then((m) => new m.EdgeTTS()),
  "google-tts": () => import("./providers/google-tts.ts").then((m) => new m.GoogleTTS()),
  browser: () => import("./providers/browser.ts").then((m) => new m.BrowserTTS()),
};

const _isDarwin = globalThis.process?.platform === "darwin";

/** Default auto-detection chain: macOS (if darwin) → piper → edge-tts → google-tts */
const _defaultProviders = [
  ...(_isDarwin ? [providerMap.macos!] : []),
  providerMap.piper!,
  providerMap["edge-tts"]!,
  providerMap["google-tts"]!,
] satisfies ProviderFactory[];

export class VoiPi extends BaseVoiceProvider {
  get name(): string {
    return this._provider?.name ?? "voipi";
  }

  private _provider: BaseVoiceProvider | undefined;
  private _resolving: Promise<BaseVoiceProvider> | undefined;
  private _factories: ProviderFactory[];

  constructor(options?: VoiPiOptions) {
    super();
    this._factories = options?.providers ?? _defaultProviders;
  }

  /** Resolve the first available provider from the chain. */
  async resolveProvider(): Promise<BaseVoiceProvider> {
    if (this._provider) return this._provider;
    if (this._resolving) return this._resolving;
    this._resolving = _resolve(this._factories);
    this._provider = await this._resolving;
    this._resolving = undefined;
    return this._provider;
  }

  async synthesize(text: string, options?: SpeakOptions): Promise<AudioData> {
    const provider = await this.resolveProvider();
    return provider.synthesize(text, options);
  }

  override async speak(text: string, options?: SpeakOptions): Promise<void> {
    const provider = await this.resolveProvider();
    const voice = await resolveVoice(
      options?.voice,
      provider.listVoices?.bind(provider),
      provider.hasVoice?.bind(provider),
    );
    return provider.speak(text, voice ? { ...options, voice } : options);
  }

  override async listVoices(): Promise<Voice[]> {
    const provider = await this.resolveProvider();
    if (!provider.listVoices) {
      throw new Error(`Provider "${provider.name}" does not support listing voices`);
    }
    return provider.listVoices();
  }
}

// --- internals ---

async function _resolve(factories: ProviderFactory[]): Promise<BaseVoiceProvider> {
  const errors: string[] = [];
  for (const factory of factories) {
    try {
      const provider = await factory();
      return provider;
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  throw new Error(`No provider available:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
}
