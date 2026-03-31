import type { SpeakOptions, Voice } from "./types.ts";
import { BaseVoiceProvider } from "./_provider.ts";
import type { AudioData } from "./_provider.ts";
import { resolveVoice } from "./_utils.ts";

export type ProviderFactory = () => BaseVoiceProvider | Promise<BaseVoiceProvider>;

/** Provider definition: name, [name, options], or factory function */
export type ProviderDef = string | [name: string, options: Record<string, unknown>] | ProviderFactory;

export interface VoiPiOptions {
  /** Custom provider chain. First available provider wins. */
  providers?: ProviderDef[];
}

/**
 * Named provider factories for explicit provider selection.
 * Keys are the provider names used in CLI and programmatic API.
 */
export const providerMap: Record<string, (options?: Record<string, unknown>) => BaseVoiceProvider | Promise<BaseVoiceProvider>> = {
  macos: (opts) => import("./providers/macos.ts").then((m) => new m.MacOS(opts)),
  piper: (opts) => import("./providers/piper.ts").then((m) => new m.Piper(opts)),
  "edge-tts": (opts) => import("./providers/edge-tts.ts").then((m) => new m.EdgeTTS(opts)),
  "google-tts": (opts) => import("./providers/google-tts.ts").then((m) => new m.GoogleTTS(opts)),
  browser: () => import("./providers/browser.ts").then((m) => new m.BrowserTTS()),
};

const _isDarwin = globalThis.process?.platform === "darwin";

/** Default auto-detection chain: macOS (if darwin) → edge-tts → google-tts → piper */
const _defaultProviders = [
  ...(_isDarwin ? [providerMap.macos!] : []),
  providerMap["edge-tts"]!,
  providerMap["google-tts"]!,
  providerMap.piper!,
] satisfies ProviderFactory[];

export class VoiPi extends BaseVoiceProvider {
  get name(): string {
    return this._provider?.name ?? "voipi";
  }

  private _provider: BaseVoiceProvider | undefined;
  private _resolving: Promise<[BaseVoiceProvider, number]> | undefined;
  private _factories: ProviderFactory[];
  private _factoryIndex = 0;

  constructor(options?: VoiPiOptions) {
    super();
    this._factories = options?.providers?.map((p) => _toFactory(p)) ?? _defaultProviders;
  }

  /** Resolve the first available provider from the chain. */
  async resolveProvider(): Promise<BaseVoiceProvider> {
    if (this._provider) return this._provider;
    const pending = this._resolving ?? (this._resolving = _resolve(this._factories, this._factoryIndex));
    try {
      const [provider, index] = await pending;
      this._provider = provider;
      this._factoryIndex = index;
      return provider;
    } finally {
      this._resolving = undefined;
    }
  }

  async synthesize(text: string, options?: SpeakOptions): Promise<AudioData> {
    return this._callWithFallback((provider) =>
      provider.synthesize(text, options),
    );
  }

  override async speak(text: string, options?: SpeakOptions): Promise<void> {
    return this._callWithFallback(async (provider) => {
      const voice = await resolveVoice(
        options?.voice,
        provider.listVoices?.bind(provider),
        provider.hasVoice?.bind(provider),
      );
      return provider.speak(text, voice ? { ...options, voice } : options);
    });
  }

  override async listVoices(): Promise<Voice[]> {
    const provider = await this.resolveProvider();
    if (!provider.listVoices) {
      throw new Error(`Provider "${provider.name}" does not support listing voices`);
    }
    return provider.listVoices();
  }

  /** Try current provider, fallback to remaining on failure. */
  private async _callWithFallback<T>(
    fn: (provider: BaseVoiceProvider) => Promise<T>,
  ): Promise<T> {
    const provider = await this.resolveProvider();
    try {
      return await fn(provider);
    } catch {
      // Current provider failed at runtime — try remaining factories
      const remaining = this._factories.slice(this._factoryIndex + 1);
      if (remaining.length === 0) throw new Error(`All providers failed`);
      this._provider = undefined;
      this._factoryIndex += 1;
      return this._callWithFallback(fn);
    }
  }
}

// --- internals ---

function _toFactory(def: ProviderDef): ProviderFactory {
  if (typeof def === "function") return def;
  const [name, options] = typeof def === "string" ? [def] : def;
  const creator = providerMap[name];
  if (!creator) {
    throw new Error(`Unknown provider: "${name}". Available: ${Object.keys(providerMap).join(", ")}`);
  }
  return () => creator(options);
}

async function _resolve(
  factories: ProviderFactory[],
  startIndex = 0,
): Promise<[BaseVoiceProvider, number]> {
  const errors: string[] = [];
  for (let i = startIndex; i < factories.length; i++) {
    try {
      const provider = await factories[i]!();
      return [provider, i];
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  throw new Error(`No provider available:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
}
