// https://github.com/SchneeHertz/node-edge-tts
// Copyright (c) 2022 SchneeHertz (MIT License)

import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { resolveVoice } from "../_utils.ts";
import { WebSocket } from "../_ws.ts";

export interface EdgeTTSOptions {
  /** Default voice (e.g. "en-US-AriaNeural") */
  voice?: string;
  /** Prosody rate string (e.g. "+50%", "-20%", "default") */
  rate?: string;
  /** Prosody pitch string (e.g. "+10Hz", "default") */
  pitch?: string;
  /** Prosody volume string (e.g. "+20%", "default") */
  volume?: string;
  /** Audio output format */
  outputFormat?: string;
}

export class EdgeTTS extends BaseVoiceProvider {
  name = "edge-tts";

  private defaultVoice: string;
  private defaultRate: string;
  private defaultPitch: string;
  private defaultVolume: string;
  private outputFormat: string;

  // Edge TTS voices follow the pattern: locale-VoiceNameNeural
  override hasVoice(id: string): boolean {
    return /^[a-z]{2,3}(-[A-Z][A-Za-z]+)+-.+Neural$/.test(id);
  }

  constructor(options?: EdgeTTSOptions) {
    super();
    this.defaultVoice = options?.voice ?? "en-US-AriaNeural";
    this.defaultRate = options?.rate ?? "default";
    this.defaultPitch = options?.pitch ?? "default";
    this.defaultVolume = options?.volume ?? "default";
    this.outputFormat = options?.outputFormat ?? "audio-24khz-48kbitrate-mono-mp3";
  }

  override async synthesize(text: string, speakOpts?: SpeakOptions): Promise<AudioData> {
    const voice =
      (await resolveVoice(speakOpts?.voice, () => this.listVoices(), (id) => this.hasVoice(id))) ??
      this.defaultVoice;
    const rate = speakOpts?.rate != null ? rateToString(speakOpts.rate) : this.defaultRate;

    const data = await edgeSynthesize(
      text,
      voice,
      rate,
      this.defaultPitch,
      this.defaultVolume,
      this.outputFormat,
    );
    return { data, ext: ".mp3" };
  }

  override async listVoices(): Promise<Voice[]> {
    const res = await fetch(VOICES_URL);
    const data = (await res.json()) as Array<{
      ShortName: string;
      FriendlyName: string;
      Locale: string;
    }>;
    return data.map((v) => ({
      id: v.ShortName,
      name: v.FriendlyName,
      lang: v.Locale,
    }));
  }
}

// ---- internals ----

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const CHROMIUM_FULL_VERSION = "143.0.3650.75";

const WINDOWS_FILE_TIME_EPOCH = 11_644_473_600n;

function rateToString(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

async function edgeSynthesize(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
  volume: string,
  outputFormat: string,
): Promise<Buffer> {
  const chromeMajor = CHROMIUM_FULL_VERSION.split(".")[0];
  const wsUrl = await buildWsUrl();
  const socket = await WebSocket.connect(wsUrl, {
    host: "speech.platform.bing.com",
    origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36 Edg/${chromeMajor}.0.0.0`,
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    socket.send(
      `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"${outputFormat}"}}}}`,
    );

    const requestId = randomHex(16);
    const ssml = buildSsml(text, voice, rate, pitch, volume);
    socket.send(
      `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`,
    );

    socket.onmessage = ({ data, isBinary }) => {
      if (isBinary) {
        const separator = "Path:audio\r\n";
        const idx = data.indexOf(separator);
        if (idx !== -1) {
          chunks.push(data.subarray(idx + separator.length));
        }
      } else {
        const msg = data.toString();
        if (msg.includes("Path:turn.end")) {
          socket.close();
          resolve(Buffer.concat(chunks));
        }
      }
    };

    socket.onerror = (err) => {
      reject(new Error(`Edge TTS WebSocket error: ${err.message}`));
    };
  });
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes instanceof Uint8Array ? bytes.buffer : bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(length: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(length)));
}

export async function generateSecMsGecToken(): Promise<string> {
  const ticks =
    BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH))) * 10_000_000n;
  const roundedTicks = ticks - (ticks % 3_000_000_000n);
  const data = new TextEncoder().encode(`${roundedTicks}${TRUSTED_CLIENT_TOKEN}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash).toUpperCase();
}

export async function buildWsUrl(): Promise<string> {
  const token = await generateSecMsGecToken();
  return `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
}

export const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

export function escapeXml(str: string): string {
  return str.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  });
}

export function buildSsml(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
  volume: string,
): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
      ${escapeXml(text)}
    </prosody>
  </voice>
</speak>`;
}
