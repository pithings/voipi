interface NodeBuiltinMap {
  "node:child_process": typeof import("node:child_process");
  "node:fs": typeof import("node:fs");
  "node:fs/promises": typeof import("node:fs/promises");
  "node:os": typeof import("node:os");
  "node:path": typeof import("node:path");
  "node:tls": typeof import("node:tls");
}

export function getNodeBuiltin<T extends keyof NodeBuiltinMap>(id: T): NodeBuiltinMap[T] {
  const mod = globalThis.process?.getBuiltinModule?.(id);
  if (!mod) throw new Error(`${id} module not available`);
  return mod as NodeBuiltinMap[T];
}

export function exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = getNodeBuiltin("node:child_process");
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function execPipe(cmd: string, args: string[], input: Buffer): Promise<void> {
  const { spawn } = getNodeBuiltin("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

import type { Voice } from "./types.ts";

/** Resolve a voice preference (string or prioritized list) against available voices. */
export async function resolveVoice(
  voice: string | string[] | undefined,
  listVoices?: () => Promise<Voice[]>,
  hasVoice?: (id: string) => boolean,
): Promise<string | undefined> {
  if (!voice) return undefined;
  if (typeof voice === "string") return voice;
  // Fast path: sync check via hasVoice without calling listVoices
  if (hasVoice) {
    const match = voice.find((v) => hasVoice(v));
    if (match) return match;
  }
  // Slow path: fetch full voice list
  if (listVoices) {
    const available = new Set((await listVoices()).map((v) => v.id));
    const match = voice.find((v) => available.has(v));
    if (match) return match;
  }
  return voice[0];
}

export async function playAudio(
  input: { path: string } | { data: Buffer; ext?: string },
): Promise<void> {
  // Linux ffplay supports stdin — pipe buffer directly
  if ("data" in input && process.platform === "linux") {
    return execPipe("ffplay", ["-nodisp", "-autoexit", "pipe:0"], input.data);
  }

  // Resolve file path or write temp file
  let tmpFile: string | undefined;
  let filePath: string;
  if ("path" in input) {
    filePath = input.path;
  } else {
    const { tmpdir } = getNodeBuiltin("node:os");
    const { join } = getNodeBuiltin("node:path");
    const ext = input.ext ?? ".mp3";
    const hex = [...crypto.getRandomValues(new Uint8Array(4))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    tmpFile = join(tmpdir(), `voipi-${hex}${ext}`);
    const fsp = getNodeBuiltin("node:fs/promises");
    await fsp.writeFile(tmpFile, input.data);
    filePath = tmpFile;
  }

  try {
    const player =
      process.platform === "darwin"
        ? "afplay"
        : process.platform === "win32"
          ? "powershell"
          : "ffplay";
    const args =
      process.platform === "win32"
        ? ["-c", `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`]
        : process.platform === "linux"
          ? ["-nodisp", "-autoexit", filePath]
          : [filePath];
    await exec(player, args);
  } finally {
    if (tmpFile) {
      const fsp = getNodeBuiltin("node:fs/promises");
      await fsp.unlink(tmpFile).catch(() => {});
    }
  }
}
