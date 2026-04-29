import { getNodeBuiltin } from "./_utils.ts";

export interface VoipiConfig {
  provider?: string;
  voice?: string;
  lang?: string;
  rate?: number;
}

export function loadConfig(customPaths?: string[]): { config: VoipiConfig; path: string | undefined } {
  const paths = customPaths ?? _configPaths();
  const fs = getNodeBuiltin("node:fs");

  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      const config: VoipiConfig = {};
      if (parsed.provider != null) config.provider = String(parsed.provider);
      if (parsed.voice != null) config.voice = String(parsed.voice);
      if (parsed.lang != null) config.lang = String(parsed.lang);
      if (parsed.rate != null) config.rate = Number(parsed.rate);
      return { config, path: p };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") continue;
      console.warn(`voipi: warning: malformed config file ${p}: ${err.message}`);
    }
  }

  return { config: {}, path: undefined };
}

function _configPaths(): string[] {
  const path = getNodeBuiltin("node:path");
  const paths: string[] = [];

  // 1. $PWD/.voipirc.json
  paths.push(path.join(process.cwd(), ".voipirc.json"));

  // 2. $HOME/.voipirc.json
  const home = process.env.HOME;
  if (home) paths.push(path.join(home, ".voipirc.json"));

  // 3. $XDG_CONFIG_HOME/voipi/config.json
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) paths.push(path.join(xdgConfig, "voipi", "config.json"));

  // 4. $HOME/.config/voipi/config.json
  if (home) paths.push(path.join(home, ".config", "voipi", "config.json"));

  return paths;
}
