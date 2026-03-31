import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { resolveVoice } from "../_utils.ts";

export class BrowserTTS extends BaseVoiceProvider {
  name = "browser";

  constructor() {
    super();
    if (typeof globalThis.speechSynthesis === "undefined") {
      throw new Error("Web Speech API is not available in this environment");
    }
  }

  async synthesize(_text: string, _options?: SpeakOptions): Promise<AudioData> {
    throw new Error("Browser TTS does not support raw audio export. Use speak() instead.");
  }

  override async save(_text: string, _outputFile: string, _options?: SpeakOptions): Promise<void> {
    throw new Error("Browser TTS does not support saving to file.");
  }

  override hasVoice(id: string): boolean {
    return speechSynthesis.getVoices().some((v) => v.voiceURI === id || v.name === id);
  }

  override async listVoices(): Promise<Voice[]> {
    const voices = await _getVoices();
    return voices.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
    }));
  }

  override async speak(text: string, options?: SpeakOptions): Promise<void> {
    const voiceId = await resolveVoice(
      options?.voice,
      () => this.listVoices(),
      (id) => this.hasVoice(id),
    );

    const utterance = new SpeechSynthesisUtterance(text);

    if (voiceId) {
      const voices = speechSynthesis.getVoices();
      const match = voices.find((v) => v.voiceURI === voiceId || v.name === voiceId);
      if (match) utterance.voice = match;
    }

    if (options?.rate != null) {
      utterance.rate = options.rate;
    }

    return new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`Speech synthesis failed: ${e.error}`));
      speechSynthesis.speak(utterance);
    });
  }
}

// ---- internals ----

/** Voices may load asynchronously in some browsers */
function _getVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  return new Promise((resolve) => {
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}
