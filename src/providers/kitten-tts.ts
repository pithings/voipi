import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { getNodeBuiltin, resolveVoice } from "../_utils.ts";
import { loadNpz, type NpzArchive } from "../_npz.ts";
import { encodeWav } from "../_wav.ts";

export interface KittenTTSOptions {
  /** Hugging Face model repo. Default: highest-quality official mini model. */
  model?: string;
  /** Default voice name or internal voice ID. Default: Bella */
  voice?: string;
  /** Cache directory for downloaded models. Default: os.tmpdir()/voipi-kittentts */
  cacheDir?: string;
  /** onnxruntime CPU thread count */
  numThreads?: number;
}

interface KittenConfig {
  model_file?: string;
  voices?: string;
  type?: string;
  speed_priors?: Record<string, number>;
  voice_aliases?: Record<string, string>;
  sample_rate?: number;
}

interface PreparedInputs {
  inputIds: number[];
  speed: number;
  style: Float32Array;
  styleDim: number;
}

interface KittenState {
  config: KittenConfig;
  session: Awaited<ReturnType<typeof createSession>>;
  voices: NpzArchive;
}

const DEFAULT_MODEL = "KittenML/kitten-tts-mini-0.8";
const DEFAULT_VOICE = "Bella";
const SAMPLE_RATE = 24_000;
const MAX_CHUNK_CHARS = 400;
const AUDIO_EDGE_THRESHOLD = 7e-4;
const AUDIO_START_PAD = 240;
const AUDIO_END_PAD = 480;
const AUDIO_END_SILENCE_PAD = 720;
const DEFAULT_VOICE_ALIASES: Record<string, string> = {
  Bella: "expr-voice-2-f",
  Jasper: "expr-voice-2-m",
  Luna: "expr-voice-3-f",
  Bruno: "expr-voice-3-m",
  Rosie: "expr-voice-4-f",
  Hugo: "expr-voice-4-m",
  Kiki: "expr-voice-5-f",
  Leo: "expr-voice-5-m",
};
const FRIENDLY_VOICES = Object.keys(DEFAULT_VOICE_ALIASES);
const INTERNAL_VOICES = new Set(Object.values(DEFAULT_VOICE_ALIASES));
const _stateCache = new Map<string, Promise<KittenState>>();

export class KittenTTS extends BaseVoiceProvider {
  name = "kitten-tts";

  private model: string;
  private defaultVoice: string;
  private cacheDir?: string;
  private numThreads?: number;

  override getDefaults() {
    return { voice: this.defaultVoice };
  }

  constructor(options?: KittenTTSOptions) {
    super();
    this.model = options?.model ?? DEFAULT_MODEL;
    this.defaultVoice = options?.voice ?? DEFAULT_VOICE;
    this.cacheDir = options?.cacheDir;
    this.numThreads = options?.numThreads;
  }

  override hasVoice(id: string): boolean {
    return Boolean(DEFAULT_VOICE_ALIASES[id] || INTERNAL_VOICES.has(id));
  }

  override async listVoices(): Promise<Voice[]> {
    return FRIENDLY_VOICES.map((name) => ({ id: name, name, lang: "en" }));
  }

  override async synthesize(text: string, speakOpts?: SpeakOptions): Promise<AudioData> {
    const voice =
      (await resolveVoice(speakOpts?.voice, () => this.listVoices(), (id) => this.hasVoice(id))) ??
      this.defaultVoice;
    const state = await this._getState();
    const aliases = { ...DEFAULT_VOICE_ALIASES, ...state.config.voice_aliases };
    const speedPriors = state.config.speed_priors ?? {};
    const voiceId = resolveVoiceId(voice, aliases);
    const sampleRate = state.config.sample_rate ?? SAMPLE_RATE;
    const speed = speakOpts?.rate ?? 1;
    const chunks = splitText(text);
    const output: Float32Array[] = [];

    for (const chunk of chunks) {
      const prepared = await prepareInputs(chunk, voiceId, speed, {
        speedPriors,
        voices: state.voices,
      });
      output.push(await runInference(state.session, prepared));
    }

    const audio = concatFloat32(output);
    return { data: encodeWav(audio, sampleRate), ext: ".wav" };
  }

  private async _getState(): Promise<KittenState> {
    const cacheKey = [this.model, this.cacheDir ?? "", this.numThreads ?? ""].join("\u0000");
    let pending = _stateCache.get(cacheKey);
    if (!pending) {
      pending = loadState({
        cacheDir: this.cacheDir,
        model: this.model,
        numThreads: this.numThreads,
      });
      _stateCache.set(cacheKey, pending);
    }
    return pending;
  }
}

// ---- internals ----

async function loadState(options: {
  cacheDir?: string;
  model: string;
  numThreads?: number;
}): Promise<KittenState> {
  const files = await ensureModelFiles(options.model, options.cacheDir);
  const fsp = getNodeBuiltin("node:fs/promises");
  const [configText, voicesData] = await Promise.all([
    fsp.readFile(files.configPath, "utf8"),
    fsp.readFile(files.voicesPath),
  ]);
  const config = JSON.parse(configText) as KittenConfig;
  const kind = config.type ?? "ONNX2";
  if (kind !== "ONNX1" && kind !== "ONNX2") {
    throw new Error(`Unsupported KittenTTS model type: ${kind}`);
  }

  return {
    config,
    session: await createSession(files.modelPath, options.numThreads),
    voices: await loadNpz(voicesData),
  };
}

async function createSession(modelPath: string, numThreads?: number) {
  const ort = await import("onnxruntime-node");
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    ...(numThreads && numThreads > 0 ? { intraOpNumThreads: numThreads } : {}),
  });
}

async function prepareInputs(
  text: string,
  voiceId: string,
  speed: number,
  options: {
    speedPriors: Record<string, number>;
    voices: NpzArchive;
  },
): Promise<PreparedInputs> {
  const spoken = text;
  const phonemes = tokenizePhonemes(await phonemize(spoken));
  const inputIds = cleanText(phonemes);
  const voice = options.voices[voiceId];
  if (!voice) {
    throw new Error(`Voice '${voiceId}' not found in voices.npz`);
  }

  const rows = voice.shape[0] ?? 0;
  const styleDim = voice.shape[1] ?? 0;
  if (!rows || !styleDim) {
    throw new Error(`Invalid style embedding for voice '${voiceId}'`);
  }

  const refId = Math.min(spoken.length, rows - 1);
  const style = voice.data.slice(refId * styleDim, (refId + 1) * styleDim);
  const speedPrior = options.speedPriors[voiceId] ?? 1;
  return { inputIds, speed: speed * speedPrior, style, styleDim };
}

async function runInference(
  session: Awaited<ReturnType<typeof createSession>>,
  prepared: PreparedInputs,
): Promise<Float32Array> {
  const ort = await import("onnxruntime-node");
  const inputIds = new ort.Tensor(
    "int64",
    BigInt64Array.from(prepared.inputIds, (value) => BigInt(value)),
    [1, prepared.inputIds.length],
  );
  const style = new ort.Tensor("float32", prepared.style, [1, prepared.styleDim]);
  const speed = new ort.Tensor("float32", new Float32Array([prepared.speed]), [1]);

  const outputs = await session.run({
    input_ids: inputIds,
    speed,
    style,
  });
  const first = Object.values(outputs)[0];
  if (!first) {
    throw new Error("KittenTTS inference returned no outputs");
  }

  const data = first.data;
  const audio = data instanceof Float32Array ? data : new Float32Array(data as ArrayLike<number>);
  return trimAudioEdges(audio);
}

async function ensureModelFiles(
  model: string,
  cacheDir?: string,
): Promise<{
  configPath: string;
  modelPath: string;
  voicesPath: string;
}> {
  const fsp = getNodeBuiltin("node:fs/promises");
  const { join } = getNodeBuiltin("node:path");
  const root = cacheDir ?? defaultCacheDir();
  const dir = join(root, safeName(model));
  await fsp.mkdir(dir, { recursive: true });

  const configPath = join(dir, "config.json");
  if (!(await fileExists(configPath))) {
    await downloadToFile(hfUrl(model, "config.json"), configPath);
  }

  const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as KittenConfig;
  const modelFile = config.model_file;
  const voicesFile = config.voices ?? "voices.npz";
  if (!modelFile) {
    throw new Error(`KittenTTS config missing model_file for ${model}`);
  }

  const modelPath = join(dir, modelFile);
  const voicesPath = join(dir, voicesFile);
  await Promise.all([
    fileExists(modelPath).then((exists) =>
      exists ? undefined : downloadToFile(hfUrl(model, modelFile), modelPath),
    ),
    fileExists(voicesPath).then((exists) =>
      exists ? undefined : downloadToFile(hfUrl(model, voicesFile), voicesPath),
    ),
  ]);

  return { configPath, modelPath, voicesPath };
}

function hfUrl(model: string, file: string): string {
  return `https://huggingface.co/${model}/resolve/main/${file}`;
}

function defaultCacheDir(): string {
  const { tmpdir } = getNodeBuiltin("node:os");
  const { join } = getNodeBuiltin("node:path");
  return join(tmpdir(), "voipi-kittentts");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function fileExists(path: string): Promise<boolean> {
  const fsp = getNodeBuiltin("node:fs/promises");
  return fsp
    .access(path)
    .then(() => true)
    .catch(() => false);
}

async function downloadToFile(url: string, destination: string): Promise<void> {
  const fsp = getNodeBuiltin("node:fs/promises");
  const { dirname, join } = getNodeBuiltin("node:path");
  await fsp.mkdir(dirname(destination), { recursive: true });

  const temp = join(dirname(destination), `.tmp-${safeName(destination)}-${Date.now()}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${url}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(temp, body);
  await fsp.rename(temp, destination).catch(async () => {
    await fsp.writeFile(destination, body);
    await fsp.unlink(temp).catch(() => {});
  });
}

async function phonemize(text: string): Promise<string> {
  const { phonemize } = await import("phonemizer");
  const [result] = await phonemize(text, "en-us");
  return result ?? "";
}

function splitText(text: string): string[] {
  const sentences = text.split(/[.!?]+/);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= MAX_CHUNK_CHARS) {
      chunks.push(ensurePunctuation(trimmed));
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= MAX_CHUNK_CHARS) {
        current = next;
        continue;
      }
      if (current) chunks.push(ensurePunctuation(current));
      current = word;
    }
    if (current) chunks.push(ensurePunctuation(current));
  }

  return chunks.length ? chunks : [ensurePunctuation(text.trim())].filter(Boolean);
}

function ensurePunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return /[.!?,;:]$/.test(trimmed) ? trimmed : `${trimmed},`;
}

function resolveVoiceId(voice: string, aliases: Record<string, string>): string {
  const resolved = aliases[voice] ?? voice;
  if (INTERNAL_VOICES.has(resolved)) {
    return resolved;
  }
  throw new Error(`Unknown KittenTTS voice: ${voice}`);
}

function tokenizePhonemes(text: string): string {
  const regex = /[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_\s]/gu;
  return (text.match(regex) ?? []).join(" ");
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const audio = new Float32Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  return audio;
}

const PAD = "$";
const PUNCTUATION = ';:,.!?¡¿—…"«»"" ';
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETTERS_IPA =
  "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
const SYMBOLS = [PAD, ...PUNCTUATION, ...LETTERS, ...LETTERS_IPA];
const SYMBOL_TO_ID = new Map(SYMBOLS.map((symbol, index) => [symbol, index]));

function cleanText(text: string): number[] {
  const ids: number[] = [0];
  for (const char of text) {
    const id = SYMBOL_TO_ID.get(char);
    if (id != null) ids.push(id);
  }
  ids.push(10, 0);
  return ids;
}

function trimAudioEdges(audio: Float32Array): Float32Array {
  let start = -1;
  let end = -1;

  for (let i = 0; i < audio.length; i++) {
    const value = Math.abs(audio[i]!);
    if (start === -1 && value > AUDIO_EDGE_THRESHOLD) start = i;
    if (value > AUDIO_EDGE_THRESHOLD) end = i;
  }

  if (start === -1 || end === -1) return audio;

  const from = Math.max(0, start - AUDIO_START_PAD);
  const to = Math.min(audio.length, end + AUDIO_END_PAD + 1);
  const trimmed = audio.slice(from, to);
  const padded = new Float32Array(trimmed.length + AUDIO_END_SILENCE_PAD);
  padded.set(trimmed);
  return padded;
}
