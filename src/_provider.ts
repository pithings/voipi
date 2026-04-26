import type { SpeakOptions, Voice } from "./types.ts";
import { getNodeBuiltin, playAudio } from "./_utils.ts";
import { getAudioDuration } from "./_audio.ts";

export interface AudioData {
  data: Buffer;
  ext?: string;
  /** Estimated duration in seconds */
  duration?: number;
}

/**
 * Base class for providers that generate audio data.
 * Subclasses implement `synthesize()` — this class handles speak/save/toAudio.
 */
export abstract class BaseVoiceProvider {
  /** Provider name */
  abstract name: string;

  abstract synthesize(text: string, options?: SpeakOptions): Promise<AudioData>;

  /** Return provider defaults for logging (voice, rate, etc.) */
  getDefaults(): Record<string, string | undefined> {
    return {};
  }

  /** Fast sync check if a voice ID is likely supported (avoids listVoices call) */
  hasVoice?(id: string): boolean;

  /** List available voices */
  listVoices?(): Promise<Voice[]>;

  async speak(text: string, options?: SpeakOptions): Promise<void> {
    const audio = await this.synthesize(text, options);
    await playAudio(audio, options?.signal);
  }

  async save(text: string, outputFile: string, options?: SpeakOptions): Promise<void> {
    const audio = await this.synthesize(text, options);
    const fsp = getNodeBuiltin("node:fs/promises");
    await fsp.writeFile(outputFile, audio.data);
  }

  async toAudio(text: string, options?: SpeakOptions): Promise<AudioData> {
    const audio = await this.synthesize(text, options);
    audio.duration ??= getAudioDuration(audio.data, audio.ext);
    return audio;
  }
}
