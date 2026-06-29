import { describe, expect, it } from "vitest";
import { MacOS, EdgeTTS, GoogleTTS, KittenTTS, BaseVoiceProvider } from "../src/index.ts";

const isMacOS = process.platform === "darwin";

const MAGIC_HEADERS: Record<string, { bytes: number[]; label: string; mask?: number[] }[]> = {
  macos: [{ bytes: [0x46, 0x4f, 0x52, 0x4d], label: "AIFF (FORM)" }],
  "edge-tts": [
    { bytes: [0xff, 0xe0], label: "MP3 (sync word)", mask: [0xff, 0xe0] },
    { bytes: [0x49, 0x44, 0x33], label: "MP3 (ID3)" },
  ],
  "google-tts": [
    { bytes: [0xff, 0xe0], label: "MP3 (sync word)", mask: [0xff, 0xe0] },
    { bytes: [0x49, 0x44, 0x33], label: "MP3 (ID3)" },
  ],
};

const providers = [
  { name: "macos", factory: () => new MacOS(), skip: !isMacOS },
  { name: "edge-tts", factory: () => new EdgeTTS(), skip: false },
  { name: "google-tts", factory: () => new GoogleTTS(), skip: false },
] as const;

describe("voipi", () => {
  describe("kitten-tts provider", () => {
    it("lists the built-in KittenTTS voices", async () => {
      const provider = new KittenTTS();
      expect(provider.name).toBe("kitten-tts");
      expect(provider.hasVoice?.("Bella")).toBe(true);
      expect(provider.hasVoice?.("expr-voice-5-m")).toBe(true);
      expect(provider.hasVoice?.("unknown")).toBe(false);

      const voices = await provider.listVoices();
      expect(voices.map((voice) => voice.id)).toEqual([
        "Bella",
        "Jasper",
        "Luna",
        "Bruno",
        "Rosie",
        "Hugo",
        "Kiki",
        "Leo",
      ]);
    });

    it("trims leading silence without clipping the ending", async () => {
      const provider = new KittenTTS({ model: "KittenML/kitten-tts-nano-0.8-int8" });
      const audio = await provider.synthesize("hello world");
      const pcm = new Int16Array(
        audio.data.buffer,
        audio.data.byteOffset + 44,
        (audio.data.length - 44) / 2,
      );

      let start = -1;
      let end = -1;
      for (let i = 0; i < pcm.length; i++) {
        const level = Math.abs(pcm[i]!);
        if (start === -1 && level > 20) start = i;
        if (level > 20) end = i;
      }

      expect(start / 24_000).toBeLessThan(0.12);
      expect((pcm.length - 1 - end) / 24_000).toBeGreaterThan(0.015);
    });
  });

  for (const { name, factory, skip } of providers) {
    describe.skipIf(skip)(`${name} provider`, () => {
      it("creates a provider with correct interface", () => {
        const provider: BaseVoiceProvider = factory();
        expect(provider.name).toBe(name);
        expect(typeof provider.speak).toBe("function");
        expect(typeof provider.synthesize).toBe("function");
        expect(typeof provider.listVoices).toBe("function");
      });

      it("lists voices", async () => {
        const provider = factory();
        const voices = await provider.listVoices!();
        expect(Array.isArray(voices)).toBe(true);
        expect(voices.length).toBeGreaterThan(0);
        expect(voices[0]).toHaveProperty("id");
        expect(voices[0]).toHaveProperty("name");
        expect(voices[0]).toHaveProperty("lang");
      });

      it("synthesizes audio", async () => {
        const provider = factory();
        const audio = await provider.synthesize("hi");
        expect(audio).toHaveProperty("data");
        expect(audio.data).toBeInstanceOf(Buffer);
        expect(audio.data.length).toBeGreaterThan(0);
      });

      it("synthesizes audio with correct format magic header", async () => {
        const provider = factory();
        const audio = await provider.synthesize("hi");
        const headers = MAGIC_HEADERS[name]!;
        const matches = headers.some((h) =>
          h.bytes.every((b, i) => (audio.data[i]! & (h.mask?.[i] ?? 0xff)) === b),
        );
        const actual = [...audio.data.subarray(0, 4)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        expect(
          matches,
          `expected ${headers.map((h) => h.label).join(" or ")}, got [${actual}]`,
        ).toBe(true);
      });
    });
  }
});
