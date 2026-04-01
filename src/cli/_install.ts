import { exec, which, getNodeBuiltin } from "../_utils.ts";
import { logo } from "./_logo.ts";

interface Agent {
  name: string;
  /** CLI binary name to detect */
  bin: string;
  /** Install via CLI command */
  install?: (launcher: McpLauncher, global: boolean) => string[];
  /** Remove command (used to replace existing entry) */
  remove?: (global: boolean) => string[];
  /** Check if install step can be skipped */
  installCheck?: () => Promise<boolean>;
  /** Install via JSON config file */
  json?: (
    launcher: McpLauncher,
    global: boolean,
  ) => { path: string; build: () => Record<string, unknown> };
}

type McpLauncher = {
  command: string;
  args: string[];
};

const AGENTS: Agent[] = [
  {
    name: "Claude Code",
    bin: "claude",
    install: (launcher, global) => {
      const sl = shellMcpLauncher(launcher);
      return [
        "claude",
        "mcp",
        "add",
        "voipi",
        "-s",
        global ? "user" : "local",
        "--",
        sl.command,
        ...sl.args,
      ];
    },
    remove: (global) => ["claude", "mcp", "remove", "voipi", "-s", global ? "user" : "local"],
  },
  {
    name: "Codex",
    bin: "codex",
    install: (launcher) => {
      const sl = shellMcpLauncher(launcher);
      return [
        "codex",
        "mcp",
        "add",
        "voipi",
        "--",
        sl.command,
        ...sl.args,
      ];
    },
    remove: () => ["codex", "mcp", "remove", "voipi"],
  },
  {
    name: "Cursor",
    bin: "cursor",
    json: (launcher, global) => {
      const sl = shellMcpLauncher(launcher);
      return {
        path: _configPath(global ? "~/.cursor/mcp.json" : ".cursor/mcp.json"),
        build: () => ({ mcpServers: { voipi: { command: sl.command, args: sl.args } } }),
      };
    },
  },
  {
    name: "Windsurf",
    bin: "windsurf",
    json: (launcher, global) => {
      const sl = shellMcpLauncher(launcher);
      return {
        path: _configPath(global ? "~/.windsurf/mcp.json" : ".windsurf/mcp.json"),
        build: () => ({ mcpServers: { voipi: { command: sl.command, args: sl.args } } }),
      };
    },
  },
  {
    name: "OpenCode",
    bin: "opencode",
    json: (launcher, global) => {
      const sl = shellMcpLauncher(launcher);
      return {
        path: _configPath(global ? "~/.config/opencode/.opencode.json" : "opencode.json"),
        build: () => ({
          mcp: { voipi: { type: "local", command: [sl.command, ...sl.args] } },
        }),
      };
    },
  },
  {
    name: "Pi",
    bin: "pi",
    install: () => ["pi", "install", "npm:pi-mcp-adapter"],
    installCheck: () => _hasPiPackage("npm:pi-mcp-adapter"),
    json: (launcher, global) => {
      const sl = shellMcpLauncher(launcher);
      return {
        path: _configPath(global ? "~/.pi/agent/mcp.json" : ".pi/mcp.json"),
        build: () => ({ mcpServers: { voipi: { command: sl.command, args: sl.args } } }),
      };
    },
  },
];

export async function installMCP(opts: { global: boolean }): Promise<void> {
  const isTTY = process.stdout.isTTY;
  const b = isTTY ? "\x1B[1;38;2;120;220;120m" : "";
  const g = isTTY ? "\x1B[38;2;120;220;120m" : "";
  const d = isTTY ? "\x1B[2m" : "";
  const r = isTTY ? "\x1B[0m" : "";

  console.log(logo());

  const launcher = resolveMcpLauncher(await _resolveNpx());
  const path = getNodeBuiltin("node:path");
  const fsp = getNodeBuiltin("node:fs/promises");

  const results = await Promise.all(AGENTS.map((agent) => _installAgent(agent, launcher, opts.global, { fsp, path })));
  let installed = 0;

  for (const { agent, ok, detail } of results) {
    if (ok === undefined) continue; // agent not found
    if (ok) {
      console.log(`${g}✓${r} ${b}${agent.name}${r} ${d}(${detail})${r}`);
      installed++;
    } else {
      console.log(`${d}✗ ${agent.name}${r}`);
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

type InstallResult = { agent: Agent; ok?: boolean; detail?: string };

async function _installAgent(
  agent: Agent,
  launcher: McpLauncher,
  global: boolean,
  ctx: { fsp: typeof import("node:fs/promises"); path: typeof import("node:path") },
): Promise<InstallResult> {
  if (!(await which(agent.bin))) return { agent };

  // CLI-based install
  if (agent.install && !(await agent.installCheck?.())) {
    const args = agent.install(launcher, global);
    try {
      await exec(args[0]!, args.slice(1));
    } catch {
      if (agent.remove) {
        try {
          const rm = agent.remove(global);
          await exec(rm[0]!, rm.slice(1)).catch(() => {});
          await exec(args[0]!, args.slice(1));
        } catch {
          if (!agent.json) return { agent, ok: false };
        }
      } else if (!agent.json) {
        return { agent, ok: false };
      }
    }
    if (!agent.json) return { agent, ok: true, detail: agent.bin };
  }

  // JSON config-based install
  if (agent.json) {
    const cfg = agent.json(launcher, global);
    try {
      const existing = await _readJson(ctx.fsp, cfg.path);
      const merged = _deepMerge(existing, cfg.build());
      await ctx.fsp.mkdir(ctx.path.dirname(cfg.path), { recursive: true });
      await ctx.fsp.writeFile(cfg.path, JSON.stringify(merged, null, 2) + "\n");
      const display = cfg.path.startsWith(process.cwd())
        ? ctx.path.relative(process.cwd(), cfg.path)
        : cfg.path.replace(_homedir() + "/", "~/");
      return { agent, ok: true, detail: display };
    } catch {
      return { agent, ok: false };
    }
  }

  return { agent };
}

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

export function resolveMcpLauncher(command: string): McpLauncher {
  const args = command === "npx" ? ["-y", "voipi@latest", "mcp"] : ["voipi@latest", "mcp"];
  return { command, args };
}

export function shellMcpLauncher(launcher: McpLauncher): McpLauncher {
  const shell = _userShell();
  return {
    command: shell,
    args: ["-lc", [launcher.command, ...launcher.args].join(" ")],
  };
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

function _userShell(): string {
  return process.env.SHELL || "/bin/sh";
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
