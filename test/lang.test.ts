import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/_lang.ts";

describe("detectLanguage", () => {
  // Non-Latin scripts
  const scriptTests: [string, string, string][] = [
    ["Arabic", "مرحبا بالعالم", "ar"],
    ["Farsi (پ چ ژ گ markers)", "سلام دنیا پچ", "fa"],
    ["Urdu (ٹ ڈ markers)", "ٹھیک ہے", "ur"],
    ["Chinese", "你好世界", "zh"],
    ["Japanese (hiragana)", "こんにちは", "ja"],
    ["Japanese (mixed kanji + hiragana)", "こんにちは世界", "ja"],
    ["Korean", "안녕하세요", "ko"],
    ["Hindi (Devanagari)", "नमस्ते दुनिया", "hi"],
    ["Russian (Cyrillic)", "Привет мир", "ru"],
    ["Thai", "สวัสดีชาวโลก", "th"],
    ["Bengali", "হ্যালো বিশ্ব", "bn"],
    ["Hebrew", "שלום עולם", "he"],
    ["Greek", "Γειά σου κόσμε", "el"],
    ["Tamil", "வணக்கம் உலகம்", "ta"],
    ["Telugu", "హలో ప్రపంచం", "te"],
  ];

  for (const [label, text, expected] of scriptTests) {
    it(`detects ${label}`, () => {
      expect(detectLanguage(text)).toBe(expected);
    });
  }

  // Latin-script languages (diacritics-based)
  const latinTests: [string, string, string][] = [
    ["French", "L'éducation française est très appréciée", "fr"],
    ["Spanish", "¿Cómo estás? Niño pequeño", "es"],
    ["German", "Straßenbahn und Gemütlichkeit", "de"],
    ["Portuguese", "Obrigação e coração", "pt"],
    ["Turkish", "İstanbul'da güneşli günler yaşıyoruz", "tr"],
    ["Vietnamese", "Việt Nam đẹp lắm", "vi"],
    ["Polish", "Łódź jest piękną częścią Polski", "pl"],
    ["Romanian", "România și Țara Bârsei", "ro"],
  ];

  for (const [label, text, expected] of latinTests) {
    it(`detects ${label} via diacritics`, () => {
      expect(detectLanguage(text)).toBe(expected);
    });
  }

  // Defaults and edge cases
  it("defaults to en for plain ASCII", () => {
    expect(detectLanguage("Hello world")).toBe("en");
  });

  it("defaults to en for a single ambiguous accent", () => {
    // Single accent is below threshold — not enough signal
    expect(detectLanguage("café")).toBe("en");
  });

  it("handles empty string", () => {
    expect(detectLanguage("")).toBe("en");
  });

  it("handles mixed script — dominant wins", () => {
    // Mostly Arabic with a few English words
    expect(detectLanguage("مرحبا hello بالعالم")).toBe("ar");
  });
});
