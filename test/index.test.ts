import { describe, expect, it } from "vitest";
import { MacOS, EdgeTTS, GoogleTTS, BaseVoiceProvider } from "../src/index.ts";

const providers = [
  { name: "macos", factory: () => new MacOS() },
  { name: "edge-tts", factory: () => new EdgeTTS() },
  { name: "google-tts", factory: () => new GoogleTTS() },
] as const;

describe("voipi", () => {
  for (const { name, factory } of providers) {
    describe(`${name} provider`, () => {
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
    });
  }
});
