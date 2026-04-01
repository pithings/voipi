<p align="center">
  <a href="https://voipi.vercel.app/"><img src="logo.svg" alt="voipi" width="128" height="128"></a>
</p>

<h1 align="center"><a href="https://voipi.vercel.app/">voipi</a></h1>

Give your apps, CLIs, and agents a voice. VoiPi is a universal, zero-dependency, free text-to-speech library for JavaScript.

- Pure JS, Zero deps, Less than 100kB total install size and 10kB bundled providers
- No API keys required
- **Multiple providers:** [Browser TTS](#browser-tts), [macOS](#macos), [Edge TTS](#edge-tts), [Google TTS](#google-tts), [Piper](#piper), [eSpeak NG](#espeak-ng)
- **Auto fallback:** Picks the best available provider per platform
- **Auto language detection:** Detects script (Arabic, Farsi, CJK, Cyrillic, etc.) and Latin-script languages (French, Spanish, German, Portuguese, etc.) — picks the best voice automatically
- **[MCP Server](#mcp-server):** Give AI agents a voice — works with Claude Code, Cursor, and any MCP client

## Demo

<p align="center">
  <a href="https://voipi.vercel.app/#samples"><img src="./website/demo.svg" alt="voipi demo" width="600"></a>
  <br>
  <a href="https://voipi.vercel.app/#samples"><img src="https://img.shields.io/badge/%F0%9F%94%8A_VoiPi-Listen_to_Samples-yellow?style=flat" alt="Listen to Samples" /></a>
</p>

## CLI

You can use `voipi` directly with npx/pnpx/bunx.

```sh
# Speak text (auto-selects best available provider)
npx voipi "The quick brown fox jumps over the lazy dog"
npx voipi speak "Hello world"

# Choose a specific voice and speed
npx voipi "Hi" -v en-US-BrianNeural -r 1.5

# Save to file instead of playing
npx voipi speak "Hi" -o hello.mp3

# Use a specific provider
npx voipi "Bonjour le monde" -p edge-tts -v fr-FR-DeniseNeural

# List available voices
npx voipi voices

# List voices for a specific provider
npx voipi voices -p edge-tts

# Start MCP server (stdio transport)
npx voipi mcp
```

## MCP Server

VoiPi includes a built-in [MCP](https://modelcontextprotocol.io/) server that exposes text-to-speech tools over the stdio transport. This lets AI agents and LLM clients (Claude Code, Cursor, etc.) speak text, save audio files, and list voices.

Add VoiPi as an MCP server to your agent:

```sh
# Claude Code
claude mcp add voipi -- npx -y voipi@latest mcp

# Codex
codex mcp add voipi -- npx -y voipi@latest mcp
```

```jsonc
// .vscode/mcp.json
{ "servers": { "voipi": { "command": "npx", "args": ["-y", "voipi@latest", "mcp"] } } }
```

```jsonc
// .cursor/mcp.json
{ "mcpServers": { "voipi": { "command": "npx", "args": ["-y", "voipi@latest", "mcp"] } } }
```

```jsonc
// opencode.json
{ "mcp": { "voipi": { "type": "local", "command": ["npx", "-y", "voipi@latest", "mcp"] } } }
```

**Available tools:**

| Tool          | Description                               |
| ------------- | ----------------------------------------- |
| `speak`       | Synthesize text and play through speakers |
| `save`        | Synthesize text and save to a file        |
| `list_voices` | List available voices for a provider      |

All tools accept an optional `provider` parameter (`edge-tts`, `google-tts`, `piper`, `macos`, `espeak-ng`) and voice/language/rate options.

## Programmatic Usage

`VoiPi` automatically picks the best available provider with fallback chain (macOS → Edge TTS → Google TTS → Piper → eSpeak NG):

```ts
import { VoiPi } from "voipi";

const voice = new VoiPi();

// Speak text
await voice.speak("Hello world!");

// With a prioritized voice list (first available wins)
await voice.speak("Hello!", { voice: ["Samantha", "en-US-AriaNeural"], rate: 1.5 });

// Save to file
await voice.save("Hello!", "output.mp3");

// Get audio data with duration
const audio = await voice.toAudio("Hello world!");
console.log(`Duration: ${audio.duration}s`);

// List available voices
const voices = await voice.listVoices();
```

You can also provide a custom provider chain using names, `[name, options]` tuples, or factory functions:

```ts
import { VoiPi } from "voipi";

// Using provider names
const voice = new VoiPi({
  providers: ["edge-tts", "macos"],
});

// Using [name, options] tuples for provider configuration
const voice2 = new VoiPi({
  providers: [["edge-tts", { voice: "en-US-GuyNeural" }], "macos"],
});

// Using factory functions for full control
import { MacOS, EdgeTTS } from "voipi";

const voice3 = new VoiPi({
  providers: [() => new EdgeTTS({ voice: "en-US-GuyNeural" }), () => new MacOS()],
});
```

### Language Detection

VoiPi automatically detects the language of input text and selects an appropriate voice. This works across all providers — no manual voice selection needed for non-English text:

```ts
await voice.speak("سلام دنیا"); // Farsi → picks a Farsi voice
await voice.speak("مرحبا بالعالم"); // Arabic → picks an Arabic voice
await voice.speak("こんにちは"); // Japanese → picks a Japanese voice
await voice.speak("你好世界"); // Chinese → picks a Chinese voice
await voice.speak("L'éducation française est très appréciée"); // French → picks a French voice
await voice.speak("Straßenbahn und Gemütlichkeit"); // German → picks a German voice
await voice.speak("¿Cómo estás?"); // Spanish → picks a Spanish voice
```

Detects 30+ languages: unique scripts (Arabic, Farsi, Urdu, CJK, Cyrillic, Devanagari, etc.) and Latin-script languages via diacritics analysis (French, Spanish, German, Portuguese, Turkish, Polish, Czech, Romanian, Vietnamese, and more). You can also use the detection utility directly:

```ts
import { detectLanguage } from "voipi";

detectLanguage("سلام دنیا"); // "fa"
detectLanguage("Hello world"); // "en"
detectLanguage("こんにちは世界"); // "ja"
detectLanguage("L'éducation française"); // "fr"
detectLanguage("Straßenbahn"); // "de"
```

### Duration Estimation

Estimate playback duration before or after synthesis:

```ts
import { estimateSpeechDuration, getAudioDuration } from "voipi";

// Pre-synthesis: estimate from text (~150 WPM heuristic)
const seconds = estimateSpeechDuration("Hello world!", 1.0);

// Post-synthesis: parse actual audio buffer (WAV/AIFF exact, MP3 estimated)
const audio = await voice.toAudio("Hello world!"); // duration auto-populated
console.log(audio.duration); // seconds
```

## Providers

### macOS

Uses the native `say` command. Only available on macOS.

```ts
import { MacOS } from "voipi/macos";

const voice = new MacOS({ voice: "Samantha", rate: 1.2 });
await voice.speak("Hello world!");

// Override defaults per call
await voice.speak("Hello!", { voice: "Daniel", rate: 1.5 });
```

### Edge TTS

Cross-platform online TTS using Microsoft Edge's neural speech service. 322+ voices with configurable rate, pitch, and volume.

```ts
import { EdgeTTS } from "voipi/edge-tts";

const voice = new EdgeTTS({ voice: "en-US-AriaNeural" });
await voice.speak("Hello world!");

// List all available voices
const voices = await voice.listVoices();
```

### Google TTS

Cross-platform online TTS using Google Translate's speech endpoint. 55+ languages, zero config.

```ts
import { GoogleTTS } from "voipi/google-tts";

const voice = new GoogleTTS({ voice: "en" });
await voice.speak("Hello world!");

// Different language
const fr = new GoogleTTS({ voice: "fr" });
await fr.speak("Bonjour le monde!");
```

### Piper

Local neural TTS powered by [Piper](https://github.com/OHF-Voice/piper1-gpl). 40+ languages, fully offline after first download. Uses an existing `piper` install if found in PATH, otherwise auto-installs a standalone binary (Linux x86_64/aarch64) or pip venv (macOS/Windows). Voice models (ONNX) are downloaded on demand from HuggingFace and cached locally.

```ts
import { Piper } from "voipi/piper";

const voice = new Piper();
await voice.speak("Hello world!");

// Custom voice, speed, and speaker
const voice2 = new Piper({ voice: "en_US-lessac-medium", lengthScale: 0.8, speaker: 0 });
await voice2.speak("Hello!");

// List all available voices
const voices = await voice.listVoices();
```

### eSpeak NG

Local TTS using the [eSpeak NG](https://github.com/espeak-ng/espeak-ng) speech synthesizer. Requires `espeak-ng` installed on the system (available in KDE, etc). Supports 100+ languages with formant-based synthesis.

**Note:** It produces robotic-sounding output, for natural-sounding voices, prefer [Piper](#piper) which uses neural TTS.

```ts
import { EspeakNG } from "voipi/espeak-ng";

const voice = await EspeakNG.create();
await voice.speak("Hello world!");

// Custom voice and speed
const voice2 = await EspeakNG.create({ voice: "en-us+f3", rate: 1.2 });
await voice2.speak("Hello!");

// List all available voices
const voices = await voice.listVoices();
```

### Browser TTS

Uses the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) (`speechSynthesis`). Works in browsers only — speaks directly without producing audio files.

```ts
import { BrowserTTS } from "voipi/browser";

const voice = new BrowserTTS();
await voice.speak("Hello world!");

// Pick a specific voice
await voice.speak("Hello!", { voice: "Google US English", rate: 1.2 });

// List available voices (varies by browser/OS)
const voices = await voice.listVoices();
```

> **Note:** Browser TTS plays audio directly and does not support `save()` or raw audio export.

## Sponsors

<p align="center">
  <a href="https://sponsors.pi0.io/">
    <img src="https://sponsors.pi0.io/sponsors.svg?xyz">
  </a>
</p>

## License

Published under the [MIT](https://github.com/pithings/voipi/blob/main/LICENSE) license 💛.
