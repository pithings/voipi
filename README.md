<p align="center">
  <img src="logo.svg" alt="voipi" width="128" height="128">
</p>

<h1 align="center">voipi</h1>

<!-- automd:badges color=yellow -->

[![npm version](https://img.shields.io/npm/v/voipi?color=yellow)](https://npmjs.com/package/voipi)
[![npm downloads](https://img.shields.io/npm/dm/voipi?color=yellow)](https://npm.chart.dev/voipi)

<!-- /automd -->

Give your apps, CLIs, and agents a voice. VoiPi is a universal, zero-dependency, free text-to-speech library for JavaScript.

- Pure JS, Zero deps, &lt; 50kB total install size!
- No API keys required
- **Multiple providers:** [Browser TTS](#browser-tts), [macOS](#macos), [Edge TTS](#edge-tts), [Google TTS](#google-tts), [Piper](#piper)
- **Auto fallback:** Picks the best available provider per platform

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
npx voipi speak "Bonjour" -p google-tts -v fr

# List available voices
npx voipi voices

# List voices for a specific provider
npx voipi voices -p edge-tts
```

## Programmatic Usage

`VoiPi` automatically picks the best available provider with fallback chain (macOS native → Edge TTS → Google TTS):

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

const voice = new GoogleTTS({ lang: "en" });
await voice.speak("Hello world!");

// Different language
const fr = new GoogleTTS({ lang: "fr" });
await fr.speak("Bonjour le monde!");
```

### Piper

Local neural TTS powered by [Piper](https://github.com/rhasspy/piper). 40+ languages, fully offline after first download. Uses an existing `piper` install if found in PATH, otherwise auto-installs a standalone binary (Linux x86_64/aarch64) or pip venv (macOS/Windows). Voice models (ONNX) are downloaded on demand from HuggingFace and cached locally.

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

Published under the [MIT](https://github.com/unjs/voipi/blob/main/LICENSE) license 💛.
