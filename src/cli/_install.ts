import { exec, which, getNodeBuiltin } from "../_utils.ts";
import { logo } from "./_logo.ts";

interface Agent {
  name: string;
  /** CLI binary name to detect */
  bin: string;
  /** Install via CLI command */
  install?: (npxCmd: string, global: boolean) => string[];
  /** Remove command (used to replace existing entry) */
  remove?: (global: boolean) => string[];
  /** Check if install step can be skipped */
  installCheck?: () => Promise<boolean>;
  /** Install via JSON config file */
  json?: (
    npxCmd: string,
    mcpArgs: string[],
    global: boolean,
  ) => { path: string; build: () => Record<string, unknown> };
}

const AGENTS: Agent[] = [
  {
    name: "Claude Code",
    bin: "claude",
    install: (npx, global) => [
      "claude",
      "mcp",
      "add",
      "voipi",
      "-s",
      global ? "user" : "local",
      "--",
      npx,
      "-y",
      "voipi@latest",
      "mcp",
    ],
    remove: (global) => ["claude", "mcp", "remove", "voipi", "-s", global ? "user" : "local"],
  },
  {
    name: "Codex",
    bin: "codex",
    install: (npx) => ["codex", "mcp", "add", "voipi", "--", npx, "-y", "voipi@latest", "mcp"],
    remove: () => ["codex", "mcp", "remove", "voipi"],
  },
  {
    name: "Cursor",
    bin: "cursor",
    json: (npx, mcpArgs, global) => ({
      path: _configPath(global ? "~/.cursor/mcp.json" : ".cursor/mcp.json"),
      build: () => ({ mcpServers: { voipi: { command: npx, args: mcpArgs } } }),
    }),
  },
  {
    name: "Windsurf",
    bin: "windsurf",
    json: (npx, mcpArgs, global) => ({
      path: _configPath(global ? "~/.windsurf/mcp.json" : ".windsurf/mcp.json"),
      build: () => ({ mcpServers: { voipi: { command: npx, args: mcpArgs } } }),
    }),
  },
  {
    name: "OpenCode",
    bin: "opencode",
    json: (npx, mcpArgs, global) => ({
      path: _configPath(global ? "~/.config/opencode/.opencode.json" : "opencode.json"),
      build: () => ({ mcp: { voipi: { type: "local", command: [npx, ...mcpArgs] } } }),
    }),
  },
  {
    name: "Pi",
    bin: "pi",
    install: () => ["pi", "install", "npm:pi-mcp-adapter"],
    installCheck: () => _hasPiPackage("npm:pi-mcp-adapter"),
    json: (npx, mcpArgs, global) => ({
      path: _configPath(global ? "~/.pi/agent/mcp.json" : ".pi/mcp.json"),
      build: () => ({ mcpServers: { voipi: { command: npx, args: mcpArgs } } }),
    }),
  },
];

export async function installMCP(opts: { global: boolean }): Promise<void> {
  const isTTY = process.stdout.isTTY;
  const b = isTTY ? "\x1B[1;38;2;120;220;120m" : "";
  const g = isTTY ? "\x1B[38;2;120;220;120m" : "";
  const d = isTTY ? "\x1B[2m" : "";
  const r = isTTY ? "\x1B[0m" : "";

  console.log(logo());

  const npxCmd = await _resolveNpx();
  const mcpArgs = ["-y", "voipi@latest", "mcp"];
  const path = getNodeBuiltin("node:path");
  const fsp = getNodeBuiltin("node:fs/promises");

  let installed = 0;

  for (const agent of AGENTS) {
    if (!(await which(agent.bin))) continue;

    // CLI-based install
    if (agent.install && !(await agent.installCheck?.())) {
      const args = agent.install(npxCmd, opts.global);
      try {
        await exec(args[0]!, args.slice(1));
        if (!agent.json) {
          console.log(`${g}✓${r} ${b}${agent.name}${r} ${d}(${agent.bin})${r}`);
          installed++;
        }
      } catch {
        if (agent.remove) {
          try {
            const rm = agent.remove(opts.global);
            await exec(rm[0]!, rm.slice(1)).catch(() => {});
            await exec(args[0]!, args.slice(1));
            if (!agent.json) {
              console.log(`${g}✓${r} ${b}${agent.name}${r} ${d}(${agent.bin})${r}`);
              installed++;
            }
          } catch {
            if (!agent.json) console.log(`${d}✗ ${agent.name}${r}`);
          }
        } else if (!agent.json) {
          console.log(`${d}✗ ${agent.name}${r}`);
        }
      }
      if (!agent.json) continue;
    }

    // JSON config-based install
    if (agent.json) {
      const cfg = agent.json(npxCmd, mcpArgs, opts.global);
      try {
        const existing = await _readJson(fsp, cfg.path);
        const merged = _deepMerge(existing, cfg.build());
        await fsp.mkdir(path.dirname(cfg.path), { recursive: true });
        await fsp.writeFile(cfg.path, JSON.stringify(merged, null, 2) + "\n");
        const display = cfg.path.startsWith(process.cwd())
          ? path.relative(process.cwd(), cfg.path)
          : cfg.path.replace(_homedir() + "/", "~/");
        console.log(`${g}✓${r} ${b}${agent.name}${r} ${d}(${display})${r}`);
        installed++;
      } catch {
        console.log(`${d}✗ ${agent.name}${r}`);
      }
    }
  }

  if (installed === 0) {
    console.log(`${d}No agents detected. Install manually — see: https://voipi.vercel.app${r}`);
  } else {
    console.log(
      `\n🎙️  ${g}VoiPi${r} MCP server installed to ${b}${installed}${r} agent${installed > 1 ? "s" : ""}`,
    );
  }
}

// ---- internals ----

function _homedir(): string {
  return getNodeBuiltin("node:os").homedir();
}

function _configPath(p: string): string {
  if (p.startsWith("~/")) {
    return getNodeBuiltin("node:path").join(_homedir(), p.slice(2));
  }
  return getNodeBuiltin("node:path").resolve(p);
}

async function _resolveNpx(): Promise<string> {
  if (await which("pnpx")) return "pnpx";
  if (await which("npx")) return "npx";
  if (await which("bunx")) return "bunx";
  return "npx";
}

async function _readJson(
  fsp: typeof import("node:fs/promises"),
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function _hasPiPackage(pkg: string): Promise<boolean> {
  const fsp = getNodeBuiltin("node:fs/promises");
  try {
    const raw = await fsp.readFile(_configPath("~/.pi/agent/settings.json"), "utf8");
    const settings = JSON.parse(raw);
    return Array.isArray(settings.packages) && settings.packages.includes(pkg);
  } catch {
    return false;
  }
}

function _deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && tv && typeof sv === "object" && typeof tv === "object" && !Array.isArray(sv)) {
      result[key] = _deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}
