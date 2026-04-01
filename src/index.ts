export type { SpeakOptions, Voice } from "./types.ts";
export { BaseVoiceProvider } from "./_provider.ts";
export type { AudioData } from "./_provider.ts";
export { getAudioDuration, estimateSpeechDuration } from "./_audio.ts";
export { detectLanguage } from "./_lang.ts";

export { VoiPi, providerMap } from "./voipi.ts";
export type { VoiPiOptions, ProviderFactory } from "./voipi.ts";
export { MacOS } from "./providers/macos.ts";
export { EdgeTTS } from "./providers/edge-tts.ts";
export type { EdgeTTSOptions } from "./providers/edge-tts.ts";
export { GoogleTTS } from "./providers/google-tts.ts";
export type { GoogleTTSOptions } from "./providers/google-tts.ts";
export { BrowserTTS } from "./providers/browser.ts";
export { Piper } from "./providers/piper.ts";
export type { PiperOptions } from "./providers/piper.ts";
export { EspeakNG } from "./providers/espeak-ng.ts";
export type { EspeakNGOptions } from "./providers/espeak-ng.ts";
