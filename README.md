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

## CLI

You can use `voipi` directly with npx/pnpx/bunx.

```sh
# Speak text (auto-selects best available provider)
npx voipi speak "Hello world"

# Choose a specific voice and speed
npx voipi speak "Hello" -v en-US-AriaNeural -r 1.5

# Save to file instead of playing
npx voipi speak "Hello" -o hello.mp3

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
await voice.speak("Hello!", { outputFile: "output.mp3" });

// List available voices
const voices = await voice.listVoices();
```

You can also provide a custom provider chain:

```ts
import { VoiPi, MacOS, EdgeTTS } from "voipi";

const voice = new VoiPi({
  providers: [() => new EdgeTTS({ voice: "en-US-GuyNeural" }), () => new MacOS()],
});
```

## Providers

### macOS

Uses the native `say` command. Only available on macOS.

```ts
import { MacOS } from "voipi/macos";

const voice = new MacOS();
await voice.speak("Hello world!");
await voice.speak("Hello!", { voice: "Samantha", rate: 1.5 });
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

Local neural TTS powered by [Piper](https://github.com/rhasspy/piper). 40+ languages, fully offline after first download. Auto-installs the Piper binary (Linux) or pip package (macOS/Windows) and downloads ONNX voice models on demand.

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

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## License

Published under the [MIT](https://github.com/unjs/voipi/blob/main/LICENSE) license 💛.
