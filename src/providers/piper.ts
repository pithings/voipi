import type { SpeakOptions, Voice } from "../types.ts";
import { BaseVoiceProvider, type AudioData } from "../_provider.ts";
import { detectLanguage } from "../_lang.ts";
import { getNodeBuiltin, resolveVoice } from "../_utils.ts";

export interface PiperOptions {
  /** Default voice model (e.g. "en_US-libritts-high"). Default: "en_US-libritts-high" */
  voice?: string;
  /** Speech rate scale (< 1 faster, > 1 slower). Default: 1.0 */
  lengthScale?: number;
  /** Speaker ID for multi-speaker models. Default: 0 */
  speaker?: number;
}

const PIPER_BINARY_VERSION = "2023.11.14-2";
const PIPER_PIP_VERSION = "1.4.1";
const DEFAULT_VOICE = "en_US-libritts-high";
const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

export class Piper extends BaseVoiceProvider {
  name = "piper";

  private defaultVoice: string;
  private lengthScale: number;
  private speaker: number;

  override getDefaults() {
    return { voice: this.defaultVoice };
  }

  constructor(options?: PiperOptions) {
    super();
    this.defaultVoice = options?.voice ?? DEFAULT_VOICE;
    this.lengthScale = options?.lengthScale ?? 1.0;
    this.speaker = options?.speaker ?? 0;
  }

  defaultVoiceForLanguage(lang: string): string | undefined {
    return LANG_VOICES[lang];
  }

  override async synthesize(text: string, speakOpts?: SpeakOptions): Promise<AudioData> {
    const voiceId =
      (await resolveVoice(speakOpts?.voice, () => this.listVoices())) ??
      this.defaultVoiceForLanguage(speakOpts?.lang ?? detectLanguage(text)) ??
      this.defaultVoice;

    const piper = await ensurePiper();
    const modelPath = await ensureVoice(voiceId);

    const lengthScale = speakOpts?.rate != null ? 1 / speakOpts.rate : this.lengthScale;

    const data = await runPiper(piper, modelPath, text, {
      lengthScale,
      speaker: this.speaker,
    });

    return { data, ext: ".wav" };
  }

  override async listVoices(): Promise<Voice[]> {
    const index = await fetchVoicesIndex();
    return Object.entries(index).map(([id, info]) => ({
      id,
      name: (info as any).name ?? id,
      lang: (info as any).language?.code,
    }));
  }
}

// ---- internals ----

const LANG_VOICES: Record<string, string> = {
  ar: "ar_JO-kareem-medium",
  cs: "cs_CZ-jirka-medium",
  da: "da_DK-talesyntese-medium",
  de: "de_DE-thorsten-high",
  el: "el_GR-rapunzelina-medium",
  es: "es_MX-claude-high",
  fa: "fa_IR-amir-medium",
  fr: "fr_FR-mls-medium",
  hi: "hi_IN-pratham-medium",
  ka: "ka_GE-natia-medium",
  no: "no_NO-nvcc-medium",
  pl: "pl_PL-bass-high",
  pt: "pt_BR-cadu-medium",
  ro: "ro_RO-mihai-medium",
  ru: "ru_RU-denis-medium",
  sk: "sk_SK-lili-medium",
  sv: "sv_SE-alma-medium",
  te: "te_IN-maya-medium",
  tr: "tr_TR-dfki-medium",
  uk: "uk_UA-ukrainian_tts-medium",
  vi: "vi_VN-vais1000-medium",
  zh: "zh_CN-chaowen-medium",
};

/** Resolved piper command: either a binary path or ["python3", "-m", "piper"] */
interface PiperCmd {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

function getCacheDir(): string {
  const { tmpdir } = getNodeBuiltin("node:os");
  const { join } = getNodeBuiltin("node:path");
  // console.log(join(tmpdir(), "voipi-piper"))
  return join(tmpdir(), "voipi-piper");
}

async function ensureDir(dir: string): Promise<void> {
  const fsp = getNodeBuiltin("node:fs/promises");
  await fsp.mkdir(dir, { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  const fsp = getNodeBuiltin("node:fs/promises");
  return fsp
    .access(path)
    .then(() => true)
    .catch(() => false);
}

async function download(url: string, dest: string): Promise<void> {
  const fsp = getNodeBuiltin("node:fs/promises");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(dest, buf);
}

function execSimple(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = getNodeBuiltin("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

/** Check if `piper` is already available in PATH */
async function findSystemPiper(): Promise<PiperCmd | undefined> {
  try {
    await execSimple("piper", ["--version"]);
    return { cmd: "piper", args: [] };
  } catch {}

  // Check python module
  for (const py of ["python3", "python"]) {
    try {
      await execSimple(py, ["-m", "piper", "--version"]);
      return { cmd: py, args: ["-m", "piper"] };
    } catch {}
  }
  return undefined;
}

let _piperPromise: Promise<PiperCmd> | undefined;

async function ensurePiper(): Promise<PiperCmd> {
  if (_piperPromise) return _piperPromise;
  _piperPromise = _ensurePiper();
  return _piperPromise;
}

async function _ensurePiper(): Promise<PiperCmd> {
  // 1. Check system PATH
  const system = await findSystemPiper();
  if (system) return system;

  // 2. Check cached installation
  const cached = await findCachedPiper();
  if (cached) return cached;

  // 3. Install: standalone binary on Linux, pip venv elsewhere
  if (process.platform === "linux") {
    return installBinary();
  }
  return installPipVenv();
}

async function findCachedPiper(): Promise<PiperCmd | undefined> {
  const { join } = getNodeBuiltin("node:path");
  const cacheDir = getCacheDir();

  // Check standalone binary (Linux)
  const binPath = join(cacheDir, "bin", "piper", "piper");
  if (await fileExists(binPath)) {
    const { dirname } = getNodeBuiltin("node:path");
    return {
      cmd: binPath,
      args: [],
      env: { LD_LIBRARY_PATH: dirname(binPath) },
    };
  }

  // Check pip venv
  const venvPiper = join(cacheDir, "venv", "bin", "piper");
  if (await fileExists(venvPiper)) {
    return { cmd: venvPiper, args: [] };
  }

  return undefined;
}

async function installBinary(): Promise<PiperCmd> {
  const { join, dirname } = getNodeBuiltin("node:path");
  const cacheDir = getCacheDir();
  const binDir = join(cacheDir, "bin");
  const binPath = join(binDir, "piper", "piper");

  await ensureDir(binDir);

  const arch = process.arch;
  const file = arch === "arm64" ? "piper_linux_aarch64" : "piper_linux_x86_64";
  const url = `https://github.com/rhasspy/piper/releases/download/${PIPER_BINARY_VERSION}/${file}.tar.gz`;
  const archivePath = join(binDir, `${file}.tar.gz`);

  console.error(`[piper] Downloading piper binary...`);
  await download(url, archivePath);

  const { execFile } = getNodeBuiltin("node:child_process");
  await new Promise<void>((resolve, reject) => {
    execFile("tar", ["xzf", archivePath, "-C", binDir], (err) => (err ? reject(err) : resolve()));
  });

  const fsp = getNodeBuiltin("node:fs/promises");
  await fsp.chmod(binPath, 0o755);
  await fsp.unlink(archivePath).catch(() => {});

  console.error(`[piper] Installed to ${binPath}`);
  return {
    cmd: binPath,
    args: [],
    env: { LD_LIBRARY_PATH: dirname(binPath) },
  };
}

async function installPipVenv(): Promise<PiperCmd> {
  const { join } = getNodeBuiltin("node:path");
  const venvDir = join(getCacheDir(), "venv");

  // Find python3
  let python = "python3";
  try {
    await execSimple("python3", ["--version"]);
  } catch {
    python = "python";
  }

  console.error(`[piper] Creating venv and installing piper-tts...`);
  await ensureDir(venvDir);
  await execSimple(python, ["-m", "venv", venvDir]);

  const pip = join(venvDir, "bin", "pip");
  await execSimple(pip, ["install", `piper-tts==${PIPER_PIP_VERSION}`, "pathvalidate"]);

  const piperBin = join(venvDir, "bin", "piper");
  console.error(`[piper] Installed to ${piperBin}`);
  return { cmd: piperBin, args: [] };
}

async function ensureVoice(voiceId: string): Promise<string> {
  const { join } = getNodeBuiltin("node:path");
  const voicesDir = join(getCacheDir(), "voices");
  const modelPath = join(voicesDir, `${voiceId}.onnx`);
  const configPath = join(voicesDir, `${voiceId}.onnx.json`);

  if (await fileExists(modelPath)) return modelPath;

  await ensureDir(voicesDir);

  // Voice ID format: en_US-lessac-medium → en/en_US/lessac/medium/
  const parts = voiceId.split("-");
  const langCode = parts[0]!; // en_US
  const lang = langCode.split("_")[0]!; // en
  const voiceName = parts.slice(1, -1).join("-"); // lessac
  const quality = parts.at(-1)!; // medium
  const basePath = `${lang}/${langCode}/${voiceName}/${quality}/${voiceId}`;

  console.error(`[piper] Downloading voice "${voiceId}"...`);
  await Promise.all([
    download(`${HF_BASE}/${basePath}.onnx?download=true`, modelPath),
    download(`${HF_BASE}/${basePath}.onnx.json?download=true`, configPath),
  ]);

  console.error(`[piper] Voice "${voiceId}" ready`);
  return modelPath;
}

let _voicesIndexCache: Record<string, unknown> | undefined;

async function fetchVoicesIndex(): Promise<Record<string, unknown>> {
  if (_voicesIndexCache) return _voicesIndexCache;
  const res = await fetch(`${HF_BASE}/voices.json?download=true`);
  if (!res.ok) throw new Error(`Failed to fetch voices index: ${res.status}`);
  _voicesIndexCache = (await res.json()) as Record<string, unknown>;
  return _voicesIndexCache;
}

function runPiper(
  piper: PiperCmd,
  modelPath: string,
  text: string,
  opts: { lengthScale: number; speaker: number },
): Promise<Buffer> {
  const { spawn } = getNodeBuiltin("node:child_process");

  return new Promise((resolve, reject) => {
    const args = [
      ...piper.args,
      "--model",
      modelPath,
      "--output_file",
      "-",
      "--length_scale",
      String(opts.lengthScale),
      "--speaker",
      String(opts.speaker),
    ];

    const env = piper.env ? { ...process.env, ...piper.env } : process.env;

    const child = spawn(piper.cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`piper exited with code ${code}: ${stderr}`));
      }
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}
