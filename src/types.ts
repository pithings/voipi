/** Options for text-to-speech synthesis */
export interface SpeakOptions {
  /** Voice identifier or prioritized list (first available wins) */
  voice?: string | string[];

  /** Language code (e.g. "en", "fr", "zh"). Overrides auto-detection */
  lang?: string;

  /** Speech rate multiplier (1.0 = normal) */
  rate?: number;

  /** Output file path. If set, audio is written to file instead of played */
  outputFile?: string;
}

/** A voice available from the provider */
export interface Voice {
  id: string;
  name: string;
  lang?: string;
}
