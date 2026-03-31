/**
 * Detect the most likely language of text based on Unicode script analysis.
 * Returns an ISO 639-1 language code (e.g. "ar", "fa", "zh", "ja", "ko", "hi").
 * Falls back to "en" for Latin/unrecognized scripts.
 */
export function detectLanguage(text: string): string {
  const scores: Record<string, number> = {};
  let arabicTotal = 0;
  let farsiChars = 0;
  let urduChars = 0;

  for (const char of text) {
    const cp = char.codePointAt(0)!;

    // Arabic script (shared by Arabic, Farsi, Urdu)
    if (isArabicScript(cp)) {
      arabicTotal++;
      // Farsi-specific: پ چ ژ گ
      if (cp === 0x067e || cp === 0x0686 || cp === 0x0698 || cp === 0x06af) farsiChars++;
      // Urdu-specific: ٹ ڈ ڑ ں ے
      if (cp === 0x0679 || cp === 0x0688 || cp === 0x0691 || cp === 0x06ba || cp === 0x06d2)
        urduChars++;
      continue;
    }

    const lang = classifyCodepoint(cp);
    if (lang) {
      scores[lang] = (scores[lang] ?? 0) + 1;
    }
  }

  // Resolve Arabic script → specific language
  if (arabicTotal > 0) {
    const lang = farsiChars > urduChars ? "fa" : urduChars > 0 ? "ur" : "ar";
    scores[lang] = arabicTotal;
  }

  // Japanese text uses CJK kanji — reassign to ja
  if (scores.ja && scores.zh) {
    scores.ja += scores.zh;
    delete scores.zh;
  }

  // Find dominant script
  let best = "en";
  let bestCount = 0;
  for (const [lang, count] of Object.entries(scores)) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }

  // Latin script — try to disambiguate by diacritics/characters
  if (best === "en") {
    const latin = detectLatinLanguage(text);
    if (latin) return latin;
  }

  return best;
}

// ---- internals ----

function isArabicScript(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

/* eslint-disable no-unreachable */
// Diacritics/characters distinctive to specific Latin-script languages
// Each entry: [charSet, langCode, weight]
const latinSignatures: [string, string, number][] = [
  ["éèêëàâçîïôùûœæ", "fr", 1],
  ["ñ¿¡", "es", 2],
  ["áóúéí", "es", 0.5],
  ["ßäöü", "de", 2],
  ["ãõ", "pt", 2],
  ["çáéêó", "pt", 0.5],
  ["ğşıİ", "tr", 2],
  ["ąęłńśźżó", "pl", 1.5],
  ["ůřžďťň", "cs", 2],
  ["ůřžďťň", "sk", 1],
  ["ăâîșț", "ro", 2],
  ["åæø", "da", 2],
  ["åäö", "sv", 2],
  ["åæø", "no", 1.5],
  ["đơưăâêếềểễệốồổỗộắằẳẵặứừửữự", "vi", 2],
];

function detectLatinLanguage(text: string): string | undefined {
  const scores: Record<string, number> = {};
  const lower = text.toLowerCase();

  for (const char of lower) {
    for (const [chars, lang, weight] of latinSignatures) {
      if (chars.includes(char)) {
        scores[lang] = (scores[lang] ?? 0) + weight;
      }
    }
  }

  let best: string | undefined;
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }

  // Require a minimum signal to avoid false positives on a single accent
  return bestScore >= 2 ? best : undefined;
}

function classifyCodepoint(cp: number): string | undefined {
  if (cp >= 0x4e00 && cp <= 0x9fff) return "zh"; // CJK Unified
  if (cp >= 0x3400 && cp <= 0x4dbf) return "zh"; // CJK Extension A
  if (cp >= 0x3040 && cp <= 0x309f) return "ja"; // Hiragana
  if (cp >= 0x30a0 && cp <= 0x30ff) return "ja"; // Katakana
  if (cp >= 0xac00 && cp <= 0xd7af) return "ko"; // Hangul Syllables
  if (cp >= 0x1100 && cp <= 0x11ff) return "ko"; // Hangul Jamo
  if (cp >= 0x0900 && cp <= 0x097f) return "hi"; // Devanagari
  if (cp >= 0x0400 && cp <= 0x04ff) return "ru"; // Cyrillic
  if (cp >= 0x0e00 && cp <= 0x0e7f) return "th"; // Thai
  if (cp >= 0x0980 && cp <= 0x09ff) return "bn"; // Bengali
  if (cp >= 0x0b80 && cp <= 0x0bff) return "ta"; // Tamil
  if (cp >= 0x0c00 && cp <= 0x0c7f) return "te"; // Telugu
  if (cp >= 0x0c80 && cp <= 0x0cff) return "kn"; // Kannada
  if (cp >= 0x0d00 && cp <= 0x0d7f) return "ml"; // Malayalam
  if (cp >= 0x0a80 && cp <= 0x0aff) return "gu"; // Gujarati
  if (cp >= 0x1000 && cp <= 0x109f) return "my"; // Myanmar
  if (cp >= 0x1780 && cp <= 0x17ff) return "km"; // Khmer
  if (cp >= 0x0d80 && cp <= 0x0dff) return "si"; // Sinhala
  if (cp >= 0x0590 && cp <= 0x05ff) return "he"; // Hebrew
  if (cp >= 0x0370 && cp <= 0x03ff) return "el"; // Greek
  if (cp >= 0x10a0 && cp <= 0x10ff) return "ka"; // Georgian
  if (cp >= 0x0530 && cp <= 0x058f) return "hy"; // Armenian
  return undefined;
}
