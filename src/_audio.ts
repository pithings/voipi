/**
 * Audio duration utilities.
 *
 * - `getAudioDuration()` — parse actual audio buffer (WAV/AIFF exact, MP3 estimated)
 * - `estimateSpeechDuration()` — text-based heuristic before synthesis
 */

/** Average words-per-minute for TTS engines at rate=1.0 */
const DEFAULT_WPM = 150;

/** Estimate speaking duration (seconds) from text before synthesis. */
export function estimateSpeechDuration(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / ((DEFAULT_WPM * rate) / 60);
}

/**
 * Get audio duration in seconds from a raw buffer.
 * Supports WAV, AIFF, and MP3 (estimated from size + assumed bitrate).
 */
export function getAudioDuration(data: Buffer, ext?: string): number | undefined {
  const format = ext?.replace(".", "").toLowerCase();
  switch (format) {
    case "wav":
      return wavDuration(data);
    case "aiff":
    case "aif":
      return aiffDuration(data);
    case "mp3":
      return mp3Duration(data);
    default:
      return undefined;
  }
}

// ---- internals ----

function wavDuration(buf: Buffer): number | undefined {
  // Standard WAV: RIFF header (44 bytes minimum)
  if (buf.length < 44) return undefined;
  const tag = buf.toString("ascii", 0, 4);
  if (tag !== "RIFF") return undefined;

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (!sampleRate || !channels || !bitsPerSample) return undefined;

  // Find 'data' chunk — usually at offset 36, but may vary
  let dataSize: number | undefined;
  for (let i = 36; i < buf.length - 8; i++) {
    if (
      buf[i] === 0x64 && // 'd'
      buf[i + 1] === 0x61 && // 'a'
      buf[i + 2] === 0x74 && // 't'
      buf[i + 3] === 0x61 // 'a'
    ) {
      const claimed = buf.readUInt32LE(i + 4);
      // Clamp to actual remaining bytes (streaming encoders may write placeholder size)
      dataSize = Math.min(claimed, buf.length - i - 8);
      break;
    }
  }
  if (dataSize === undefined) return undefined;

  const bytesPerSample = (bitsPerSample / 8) * channels;
  return dataSize / (sampleRate * bytesPerSample);
}

function aiffDuration(buf: Buffer): number | undefined {
  if (buf.length < 12) return undefined;
  const tag = buf.toString("ascii", 0, 4);
  if (tag !== "FORM") return undefined;
  // Accept both AIFF and AIFC (compressed, e.g. macOS `say`)
  const formType = buf.toString("ascii", 8, 12);
  if (formType !== "AIFF" && formType !== "AIFC") return undefined;

  // Find COMM chunk
  for (let i = 12; i < buf.length - 26; i++) {
    if (
      buf[i] === 0x43 && // 'C'
      buf[i + 1] === 0x4f && // 'O'
      buf[i + 2] === 0x4d && // 'M'
      buf[i + 3] === 0x4d // 'M'
    ) {
      // COMM: chunkId(4) + size(4) + channels(2) + numFrames(4) + sampleSize(2) + sampleRate(10)
      const numFrames = buf.readUInt32BE(i + 10);
      const sampleRate = readIeee80(buf, i + 16);
      if (sampleRate > 0) {
        return numFrames / sampleRate;
      }
      break;
    }
  }
  return undefined;
}

/** Read 80-bit IEEE 754 extended precision (big-endian). */
function readIeee80(buf: Buffer, offset: number): number {
  const exponent = ((buf[offset]! & 0x7f) << 8) | buf[offset + 1]!;
  const mantissa = buf.readUInt32BE(offset + 2) * 2 ** 32 + buf.readUInt32BE(offset + 6);
  if (exponent === 0 && mantissa === 0) return 0;
  return mantissa * 2 ** (exponent - 16383 - 63);
}

/** Estimate MP3 duration from buffer size. Tries to read first frame header for bitrate. */
function mp3Duration(buf: Buffer): number | undefined {
  // Find first frame sync (0xFF 0xE0+)
  for (let i = 0; i < Math.min(buf.length, 4096); i++) {
    if (buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0) {
      const header = buf.readUInt32BE(i);
      const bitrate = parseMp3Bitrate(header);
      if (bitrate > 0) {
        // Rough estimate: total buffer bytes / (bitrate_bps / 8)
        return (buf.length * 8) / (bitrate * 1000);
      }
    }
  }
  // Fallback: assume 48kbps (common for TTS)
  return (buf.length * 8) / (48 * 1000);
}

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];

function parseMp3Bitrate(header: number): number {
  const bitrateIdx = (header >> 12) & 0x0f;
  return MP3_BITRATES_V1_L3[bitrateIdx] ?? 0;
}
