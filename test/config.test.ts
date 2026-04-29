import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/_config.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/_config.ts")>("../src/_config.ts");
  return {
    ...actual,
    loadConfig: vi.fn(actual.loadConfig),
  };
});

import { loadConfig } from "../src/_config.ts";
import { VoiPi } from "../src/voipi.ts";
import { BaseVoiceProvider, type AudioData } from "../src/_provider.ts";

class StubProvider extends BaseVoiceProvider {
  name = "stub";
  lastOptions?: Record<string, unknown>;
  async synthesize(_text: string, options?: Record<string, unknown>): Promise<AudioData> {
    this.lastOptions = options;
    return { data: Buffer.alloc(0) };
  }

  override async speak(_text: string, options?: Record<string, unknown>): Promise<void> {
    this.lastOptions = options;
  }

  override async save(_text: string, _outputFile: string, options?: Record<string, unknown>): Promise<void> {
    this.lastOptions = options;
  }
}

describe("loadConfig", () => {
  it("returns empty config when no files exist", () => {
    const result = loadConfig(["/nonexistent/path.json"]);
    expect(result.config).toEqual({});
    expect(result.path).toBeUndefined();
  });

  it("reads first existing config file in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "voipi-config-"));
    const file1 = join(dir, "1.json");
    const file2 = join(dir, "2.json");
    writeFileSync(file1, JSON.stringify({ provider: "edge-tts" }));
    writeFileSync(file2, JSON.stringify({ provider: "macos" }));

    const result = loadConfig([file1, file2]);
    expect(result.config.provider).toBe("edge-tts");
    expect(result.path).toBe(file1);

    rmSync(dir, { recursive: true });
  });

  it("ignores unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "voipi-config-"));
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ provider: "piper", pitch: 1.5, unknown: true }));

    const result = loadConfig([file]);
    expect(result.config).toEqual({ provider: "piper" });

    rmSync(dir, { recursive: true });
  });

  it("warns on malformed JSON and falls back to next file", () => {
    const dir = mkdtempSync(join(tmpdir(), "voipi-config-"));
    const bad = join(dir, "bad.json");
    const good = join(dir, "good.json");
    writeFileSync(bad, "not json");
    writeFileSync(good, JSON.stringify({ voice: "test-voice" }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = loadConfig([bad, good]);
    expect(result.config.voice).toBe("test-voice");
    expect(result.path).toBe(good);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("malformed config file"));
    warnSpy.mockRestore();

    rmSync(dir, { recursive: true });
  });

  it("parses all known fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "voipi-config-"));
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ provider: "edge-tts", voice: "v1", lang: "en", rate: 1.2 }));

    const result = loadConfig([file]);
    expect(result.config).toEqual({
      provider: "edge-tts",
      voice: "v1",
      lang: "en",
      rate: 1.2,
    });

    rmSync(dir, { recursive: true });
  });
});

describe("VoiPi config integration", () => {
  it("constructor providers override config provider", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      config: { provider: "macos" },
      path: "/test/.voipirc.json",
    });
    const stub = new StubProvider();
    const v = new VoiPi({ providers: [() => stub] });
    expect((await v.resolveProvider()).name).toBe("stub");
  });

  it("throws for unknown provider in config", () => {
    vi.mocked(loadConfig).mockReturnValue({
      config: { provider: "unknown-provider" },
      path: "/test/.voipirc.json",
    });
    expect(() => new VoiPi()).toThrow('Unknown provider in config: "unknown-provider"');
  });

  it("applies config voice/lang/rate defaults to speak", async () => {
    const stub = new StubProvider();
    vi.mocked(loadConfig).mockReturnValue({
      config: { voice: "test-voice", lang: "en", rate: 1.5 },
      path: "/test/.voipirc.json",
    });
    const v = new VoiPi({ providers: [() => stub] });
    await v.speak("hello");
    expect(stub.lastOptions).toEqual({ voice: "test-voice", lang: "en", rate: 1.5 });
  });

  it("applies config voice/lang/rate defaults to save", async () => {
    const stub = new StubProvider();
    vi.mocked(loadConfig).mockReturnValue({
      config: { voice: "test-voice", lang: "en", rate: 1.5 },
      path: "/test/.voipirc.json",
    });
    const v = new VoiPi({ providers: [() => stub] });
    await v.save("hello", "/tmp/test.mp3");
    expect(stub.lastOptions).toEqual({ voice: "test-voice", lang: "en", rate: 1.5 });
  });

  it("applies config voice/lang/rate defaults to synthesize", async () => {
    const stub = new StubProvider();
    vi.mocked(loadConfig).mockReturnValue({
      config: { voice: "test-voice", lang: "en", rate: 1.5 },
      path: "/test/.voipirc.json",
    });
    const v = new VoiPi({ providers: [() => stub] });
    await v.synthesize("hello");
    expect(stub.lastOptions).toEqual({ voice: "test-voice", lang: "en", rate: 1.5 });
  });

  it("method options override config defaults", async () => {
    const stub = new StubProvider();
    vi.mocked(loadConfig).mockReturnValue({
      config: { voice: "config-voice", rate: 1.5 },
      path: "/test/.voipirc.json",
    });
    const v = new VoiPi({ providers: [() => stub] });
    await v.speak("hello", { voice: "method-voice", lang: "fr" });
    expect(stub.lastOptions).toEqual({ voice: "method-voice", lang: "fr", rate: 1.5 });
  });

  it("uses default providers when config has no provider", () => {
    vi.mocked(loadConfig).mockReturnValue({ config: {}, path: undefined });
    const v = new VoiPi();
    expect(v).toBeInstanceOf(VoiPi);
  });

  it("treats empty provider string as unset", () => {
    vi.mocked(loadConfig).mockReturnValue({
      config: { provider: "" },
      path: "/test/.voipirc.json",
    });
    const v = new VoiPi();
    expect(v).toBeInstanceOf(VoiPi);
  });
});
