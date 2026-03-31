// https://github.com/zlargon/google-tts
// Copyright (c) 2016 Leon Huang (MIT License)

import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { resolveVoice } from "../_utils.ts";

export interface GoogleTTSOptions {
  /** Default voice/language code (e.g. "en", "fr", "de"). Default: "en" */
  voice?: string;
  /** Slow speech mode. Default: false */
  slow?: boolean;
}

export class GoogleTTS extends BaseVoiceProvider {
  name = "google-tts";

  private defaultLang: string;
  private slow: boolean;

  override getDefaults() {
    return { lang: this.defaultLang };
  }

  constructor(options?: GoogleTTSOptions) {
    super();
    this.defaultLang = options?.voice ?? "en";
    this.slow = options?.slow ?? false;
  }

  override async synthesize(text: string, speakOpts?: SpeakOptions): Promise<AudioData> {
    const lang =
      (await resolveVoice(speakOpts?.voice, () => this.listVoices())) ?? this.defaultLang;
    const slow = speakOpts?.rate != null ? speakOpts.rate < 0.75 : this.slow;

    const data = await synthesize(text, lang, slow);
    return { data, ext: ".mp3" };
  }

  override async listVoices(): Promise<Voice[]> {
    return LANGUAGES.map((l) => ({
      id: l[0],
      name: l[1],
      lang: l[0],
    }));
  }
}

// ---- internals ----

const TTS_BASE = "https://translate.google.com/translate_tts";
const MAX_CHUNK_LEN = 200;

function buildUrl(text: string, lang: string, slow: boolean, idx: number, total: number): string {
  const params = new URLSearchParams({
    ie: "UTF-8",
    q: text,
    tl: lang,
    total: String(total),
    idx: String(idx),
    textlen: String(text.length),
    client: "tw-ob",
    prev: "input",
    ttsspeed: slow ? "0.24" : "1",
  });
  return `${TTS_BASE}?${params}`;
}

/** Split text into chunks at word boundaries, each <= MAX_CHUNK_LEN */
function chunkText(text: string): string[] {
  if (text.length <= MAX_CHUNK_LEN) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK_LEN) {
    let cut = remaining.lastIndexOf(" ", MAX_CHUNK_LEN);
    if (cut <= 0) cut = MAX_CHUNK_LEN;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function fetchChunk(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(`Google TTS request failed: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

async function synthesize(text: string, lang: string, slow: boolean): Promise<Buffer> {
  const chunks = chunkText(text);
  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const url = buildUrl(chunks[i]!, lang, slow, i, chunks.length);
    buffers.push(await fetchChunk(url));
  }
  return Buffer.concat(buffers.map((b) => new Uint8Array(b)));
}

/** Subset of languages supported by Google Translate TTS */
const LANGUAGES: [code: string, name: string][] = [
  ["af", "Afrikaans"],
  ["ar", "Arabic"],
  ["bg", "Bulgarian"],
  ["bn", "Bengali"],
  ["bs", "Bosnian"],
  ["ca", "Catalan"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["de", "German"],
  ["el", "Greek"],
  ["en", "English"],
  ["es", "Spanish"],
  ["et", "Estonian"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["gu", "Gujarati"],
  ["hi", "Hindi"],
  ["hr", "Croatian"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["is", "Icelandic"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["jw", "Javanese"],
  ["km", "Khmer"],
  ["kn", "Kannada"],
  ["ko", "Korean"],
  ["la", "Latin"],
  ["lv", "Latvian"],
  ["ml", "Malayalam"],
  ["mr", "Marathi"],
  ["ms", "Malay"],
  ["my", "Myanmar"],
  ["ne", "Nepali"],
  ["nl", "Dutch"],
  ["no", "Norwegian"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["si", "Sinhala"],
  ["sk", "Slovak"],
  ["sq", "Albanian"],
  ["sr", "Serbian"],
  ["su", "Sundanese"],
  ["sv", "Swedish"],
  ["sw", "Swahili"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["tl", "Filipino"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["vi", "Vietnamese"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
];
