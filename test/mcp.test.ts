import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";

const CLI = new URL("../src/cli/index.ts", import.meta.url).pathname;

function mcpRequest(
  messages: Record<string, unknown>[],
): Promise<{ lines: Record<string, unknown>[]; stderr: string }> {
  const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  return new Promise((resolve, reject) => {
    execFile("node", [CLI, "mcp"], { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err && (err as Error & { killed?: boolean }).killed) {
        reject(new Error("MCP process timed out"));
        return;
      }
      const lines = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      resolve({ lines, stderr });
    }).stdin!.end(input);
  });
}

function rpc(method: string, id: number, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, params };
}

function notification(method: string) {
  return { jsonrpc: "2.0", method };
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

    // Only initialize gets a response
    expect(lines).toHaveLength(1);
    expect(lines[0]!.id).toBe(1);
  });

  it("handles malformed JSON gracefully", async () => {
    const input = "not valid json\n" + JSON.stringify(rpc("ping", 1)) + "\n";
    const result = await new Promise<{ lines: Record<string, unknown>[] }>((resolve, reject) => {
      execFile("node", [CLI, "mcp"], { timeout: 15_000 }, (err, stdout) => {
        if (err && (err as Error & { killed?: boolean }).killed) {
          reject(new Error("timeout"));
          return;
        }
        const lines = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        resolve({ lines });
      }).stdin!.end(input);
    });

    // Should get parse error for bad JSON, then valid ping response
    expect(result.lines).toHaveLength(2);
    expect((result.lines[0]!.error as { code: number }).code).toBe(-32700);
    expect(result.lines[1]!.id).toBe(1);
    expect(result.lines[1]!.result).toEqual({});
  });
});
