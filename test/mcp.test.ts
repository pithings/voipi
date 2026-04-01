import { describe, expect, it } from "vitest";
import { serveMCP } from "../src/cli/_mcp.ts";
import { VoiPi } from "../src/voipi.ts";

function rpc(method: string, id: number, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, params };
}

function notification(method: string) {
  return { jsonrpc: "2.0", method };
}

function frame(message: Record<string, unknown> | string): string {
  const body = typeof message === "string" ? message : JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function parseFrames(stdout: Buffer): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = [];
  let offset = 0;

  while (offset < stdout.length) {
    const current = stdout[offset];
    if (current === 0x7b) {
      const newline = stdout.indexOf("\n", offset, "utf8");
      const lineEnd = newline === -1 ? stdout.length : newline;
      const body = stdout.subarray(offset, lineEnd).toString("utf8").trim();
      if (body) frames.push(JSON.parse(body));
      offset = newline === -1 ? stdout.length : lineEnd + 1;
      continue;
    }

    const headerEnd = stdout.indexOf("\r\n\r\n", offset, "utf8");
    if (headerEnd === -1) break;

    const header = stdout.subarray(offset, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error(`Missing Content-Length header in frame: ${header}`);

    const contentLength = Number.parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    frames.push(JSON.parse(stdout.subarray(bodyStart, bodyEnd).toString("utf8")));
    offset = bodyEnd;
  }

  return frames;
}

async function mcpRequest(
  messages: Array<Record<string, unknown> | string>,
): Promise<{ lines: Record<string, unknown>[]; stderr: string }> {
  const input = messages.map(frame).join("");
  return runServeMcp(input);
}

async function runServeMcp(
  input: string,
): Promise<{ lines: Record<string, unknown>[]; stderr: string }> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");
  const stderrDescriptor = Object.getOwnPropertyDescriptor(process, "stderr");

  const stdoutChunks: Buffer[] = [];
  let stderr = "";

  const stdinListeners = new Map<string, Array<(chunk?: Buffer) => void>>();
  let pendingChunk: Buffer | null = null;
  let started = false;
  const kick = () => {
    if (started) return;
    started = true;
    queueMicrotask(() => {
      pendingChunk = Buffer.from(input);
      for (const handler of stdinListeners.get("readable") ?? []) handler();
      for (const handler of stdinListeners.get("end") ?? []) handler();
    });
  };
  const mockStdin = {
    on(event: string, handler: (chunk?: Buffer) => void) {
      const handlers = stdinListeners.get(event) ?? [];
      handlers.push(handler);
      stdinListeners.set(event, handlers);
      kick();
      return mockStdin;
    },
    read() {
      const chunk = pendingChunk;
      pendingChunk = null;
      return chunk;
    },
    resume() {
      return mockStdin;
    },
    get readableEnded() {
      return false;
    },
  };

  const mockStdout = {
    isTTY: false,
    write(chunk: string | Uint8Array) {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
      return true;
    },
  };

  const mockStderr = {
    isTTY: false,
    write(chunk: string | Uint8Array) {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    },
  };

  Object.defineProperty(process, "stdin", { configurable: true, value: mockStdin });
  Object.defineProperty(process, "stdout", { configurable: true, value: mockStdout });
  Object.defineProperty(process, "stderr", { configurable: true, value: mockStderr });

  try {
    await serveMCP();
    return { lines: parseFrames(Buffer.concat(stdoutChunks)), stderr };
  } finally {
    if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor);
    if (stdoutDescriptor) Object.defineProperty(process, "stdout", stdoutDescriptor);
    if (stderrDescriptor) Object.defineProperty(process, "stderr", stderrDescriptor);
  }
}

describe("mcp server", () => {
  it("responds to initialize with protocol version and capabilities", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
    ]);

    expect(lines).toHaveLength(1);
    const res = lines[0]!;
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo).toMatchObject({ name: "voipi" });
  });

  it("negotiates to the client's supported protocol version", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
    ]);

    const result = lines[0]!.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2025-03-26");
  });

  it("lists tools with correct schema", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
      notification("notifications/initialized"),
      rpc("tools/list", 2),
    ]);

    expect(lines).toHaveLength(2);
    const res = lines[1]!;
    expect(res.id).toBe(2);
    const result = res.result as { tools: { name: string; inputSchema: unknown }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("speak");
    expect(names).toContain("save");
    expect(names).toContain("list_voices");
    expect(names).toContain("list_providers");

    for (const tool of result.tools) {
      expect(tool.inputSchema).toHaveProperty("type", "object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });

  it("responds to ping", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
      rpc("ping", 2),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[1]!.id).toBe(2);
    expect(lines[1]!.result).toEqual({});
  });

  it("returns error for unknown method", async () => {
    const { lines } = await mcpRequest([rpc("nonexistent/method", 1)]);

    expect(lines).toHaveLength(1);
    const res = lines[0]!;
    expect(res.error).toBeDefined();
    const error = res.error as { code: number; message: string };
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("nonexistent/method");
  });

  it("returns error for unknown tool", async () => {
    const { lines } = await mcpRequest([
      rpc("tools/call", 1, { name: "nonexistent_tool", arguments: {} }),
    ]);

    expect(lines).toHaveLength(1);
    const result = lines[0]!.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("nonexistent_tool");
  });

  it("list_providers returns all providers with annotations", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
      rpc("tools/call", 2, { name: "list_providers", arguments: {} }),
    ]);

    expect(lines).toHaveLength(2);
    const result = lines[1]!.result as { content: { type: string; text: string }[] };
    expect(result.content).toHaveLength(1);
    const text = result.content[0]!.text;
    expect(text).toContain("edge-tts");
    expect(text).toContain("google-tts");
    expect(text).toContain("macos");
    expect(text).toContain("piper");
    expect(text).toContain("espeak-ng");
    expect(text).toContain("requires network");
    expect(text).toContain("default");
  });

  it("uses VoiPi fallback path for speak in auto mode", async () => {
    const originalResolveProvider = VoiPi.prototype.resolveProvider;
    const originalSpeak = VoiPi.prototype.speak;

    let fallbackCalled = false;

    VoiPi.prototype.resolveProvider = async function () {
      return {
        name: "edge-tts",
        getDefaults: () => ({}),
        speak: async () => {
          throw new Error("edge-tts failed");
        },
      } as never;
    };

    VoiPi.prototype.speak = async function () {
      fallbackCalled = true;
    };

    try {
      const { lines } = await mcpRequest([
        rpc("initialize", 1, {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1" },
        }),
        rpc("tools/call", 2, { name: "speak", arguments: { text: "hi", wait: true } }),
      ]);

      expect(fallbackCalled).toBe(true);
      const result = lines[1]!.result as { content: { text: string }[] };
      expect(result.content[0]!.text).toContain("Playback finished");
    } finally {
      VoiPi.prototype.resolveProvider = originalResolveProvider;
      VoiPi.prototype.speak = originalSpeak;
    }
  });

  it("ignores notifications without responding", async () => {
    const { lines } = await mcpRequest([
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      }),
      notification("notifications/initialized"),
      notification("notifications/cancelled"),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.id).toBe(1);
  });

  it("handles malformed JSON gracefully", async () => {
    const result = await mcpRequest(["not valid json", rpc("ping", 1)]);

    expect(result.lines).toHaveLength(2);
    expect((result.lines[0]!.error as { code: number }).code).toBe(-32700);
    expect(result.lines[1]!.id).toBe(1);
    expect(result.lines[1]!.result).toEqual({});
  });

  it("responds when the client sends one bare JSON message then closes stdin", async () => {
    const input = `${JSON.stringify(
      rpc("initialize", 1, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-mcp-client", version: "0.118.0-alpha.2" },
      }),
    )}\n`;
    const result = await runServeMcp(input);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.id).toBe(1);
  });
});
