# voipi

**Keep AGENTS.md updated with project status**

## Architecture

- `src/types.ts` — Core interfaces (`SpeakOptions`, `Voice`)
- `src/_provider.ts` — `BaseVoiceProvider` abstract class with `AudioData` type. Subclasses implement `synthesize()`, base handles `speak()`, `save()`, `toAudio()`
- `src/_audio.ts` — Audio duration utilities: `getAudioDuration(data, ext)` (parses WAV/AIFF headers, estimates MP3 from bitrate), `estimateSpeechDuration(text, rate)` (pre-synthesis ~150 WPM heuristic)
- `src/_utils.ts` — Shared helpers: `getNodeBuiltin()` (safe `node:` access via `getBuiltinModule`), `exec()`, `playAudio()` (cross-platform: `afplay`/`ffplay`/PowerShell; Linux surfaces backend permission/connection failures), `resolveVoice()` (prioritized voice list matching)
- `src/_ws.ts` — Zero-dep WebSocket client over `node:tls` (used by Edge TTS for custom headers). Handles framing, masking, ping/pong
- `src/voipi.ts` — `VoiPi` class: auto-selecting provider with fallback chain (macOS → Edge TTS → Google TTS → Piper → eSpeak NG). Lazy-resolves on first call
- `src/providers/` — Provider implementations
- `src/cli/index.ts` — CLI entrypoint (`voipi speak`, `voipi voices`, `voipi mcp`, `--provider` flag, default: `auto`)
- `src/cli/_mcp.ts` — Zero-dependency JSON-RPC stdio MCP server exposing `speak`, `save`, and `list_voices`; auto-detects newline-delimited JSON vs standard MCP `Content-Length` framing on stdio
- `src/cli/_utils.ts` — CLI internals: progress bar, synthesis time estimation, logo rendering
- `src/index.ts` — Public API re-exports (types + all providers)

## Provider Pattern

Each provider extends `BaseVoiceProvider` and implements `synthesize()`:

```ts
class MyProvider extends BaseVoiceProvider {
  name = "my-provider";
  async synthesize(text: string, options?: SpeakOptions): Promise<AudioData> { ... }
}
```

Optional overrides: `hasVoice(id)` (fast sync check), `listVoices()`, `speak()`, `save()`.

Providers are exported from both the main entry (`voipi`) and as subpath exports (`voipi/macos`, `voipi/edge-tts`, `voipi/google-tts`, `voipi/piper`, `voipi/espeak-ng`).

## Providers

- **VoiPi** (`src/voipi.ts`) — Auto provider: tries factories in order, first success wins. Lazy-resolves on first call. Accepts custom `providers` array via `VoiPiOptions`. Default chain: macOS (if darwin) → Edge TTS → Google TTS → Piper → eSpeak NG (if linux).
- **MacOS** (`src/providers/macos.ts`) — Uses native `say` command. Outputs AIFF. Overrides `speak()` directly (no temp file needed for playback). `hasVoice()` fast-checks 12 common built-in voices via regex. Darwin only.
- **EdgeTTS** (`src/providers/edge-tts.ts`) — Microsoft Edge online TTS via WebSocket. 322+ neural voices. Uses custom WS client (`_ws.ts`) for required headers (Origin, User-Agent). DRM token via `Sec-MS-GEC` (SHA-256 of time-rounded ticks + trusted client token). SSML-based. Configurable rate/pitch/volume/outputFormat. Default: `en-US-AriaNeural`, `audio-24khz-48kbitrate-mono-mp3`.
- **Piper** (`src/providers/piper.ts`) — Local neural TTS via [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl). Auto-downloads standalone binary + ONNX voice models to `os.tmpdir()/voipi-piper/`. 40+ languages, multiple quality levels. Outputs WAV (16-bit PCM). Supports `lengthScale` (rate), `speaker` (multi-speaker models). Default voice: `en_US-amy-low`. Voices fetched from HuggingFace (`rhasspy/piper-voices`). Fully offline after first download.
- **GoogleTTS** (`src/providers/google-tts.ts`) — Google Translate unofficial TTS endpoint (HTTP GET → MP3). Zero deps. 55+ languages, one voice per lang. 200-char chunk limit with word-boundary auto-splitting. `rate < 0.75` triggers slow mode. Fragile (unofficial API).
- **EspeakNG** (`src/providers/espeak-ng.ts`) — Local TTS via [espeak-ng](https://github.com/espeak-ng/espeak-ng) CLI. Requires `espeak-ng` installed on system. `create()` static factory checks availability. Outputs WAV (`--stdout`). Overrides `speak()` directly (no temp file). Voice selection via language code (e.g. `en`, `en-us+f3`). Rate maps to ~175 WPM base. `listVoices()` parses `espeak-ng --voices` output. Auto-detects language via `detectLanguage()`. Linux-preferred in auto-detection chain.
- **BrowserTTS** (`src/providers/browser.ts`) — Web Speech API (`speechSynthesis`). Browser-only. Overrides `speak()` directly (no raw audio export). `synthesize()` and `save()` throw. Voices load async; `_getVoices()` handles `voiceschanged` event. Matches voices by `voiceURI` or `name`.

## Key Internals

- **No `node:` imports at top level** — all Node.js builtins accessed via `getNodeBuiltin()` which uses `globalThis.process?.getBuiltinModule()`. This avoids bundler issues and enables runtime detection.
- **Voice resolution** — `resolveVoice()` supports `string | string[]`. Fast path: sync `hasVoice()` check. Slow path: `listVoices()` + Set lookup. Falls back to first entry.
- **Audio playback** — `playAudio()` handles `{data, ext}` or `{path}`. Linux uses `ffplay`; backend permission/connection failures are surfaced so MCP callers do not get false-positive playback success. macOS: `afplay`. Windows: PowerShell `SoundPlayer`. Temp files cleaned up in `finally`.
- **Audio duration** — `AudioData.duration` auto-populated by `toAudio()`. WAV/AIFF: exact from headers. MP3: estimated from first frame bitrate (fallback 48kbps). Pre-synthesis estimate via `estimateSpeechDuration()` (~150 WPM heuristic).
- **WebSocket** (`_ws.ts`) — Custom minimal WS implementation over `node:tls`. Supports text send, binary receive, ping/pong. Used instead of `ws` package to enable custom headers without dependencies.
- **Abort signals** — `SpeakOptions.signal` propagates through `synthesize`/`speak`/`save`, all `child_process` spawns (passed via `signal` option), all `fetch()` calls, and the Edge TTS WebSocket. `VoiPi._callWithFallback` short-circuits on `AbortError` so cancellation is not masked as `All providers failed`.

## Best Practices

- Avoid importing `node:` APIs directly. Use `getNodeBuiltin()` from `_utils.ts`
- Prefix internal (non-exported) files with `_` (e.g., `_utils.ts`, `_ws.ts`, `_provider.ts`)
- Place non-exported helpers at the end of files (after `// ---- internals ----` comment)
- Zero external runtime dependencies — everything is built-in or uses web/Node APIs

## Build

- Uses `obuild` with entries in `build.config.mjs`
- Entries: `index.ts`, `cli/index.ts`, and each provider individually
- Subpath exports in `package.json`: `.`, `./macos`, `./edge-tts`, `./google-tts`, `./piper`, `./espeak-ng`, `./browser`
- TypeScript strict mode with `tsgo` (`@typescript/native-preview`)
- Linting: `oxlint` + `oxfmt`

## Adding a New Provider

1. Create `src/providers/<name>.ts` — extend `BaseVoiceProvider`, implement `synthesize()` (and optionally `speak()`, `listVoices()`)
2. Export from `src/index.ts`
3. Add to `providerMap` in `src/voipi.ts` (and update `_defaultProviders` if auto-detection should include it)
4. Add subpath export in `package.json` and entry in `build.config.mjs`
5. Add to `website/providers.js` (label + voices list)
6. Add to `providerMeta` in `website/demo.js` (import path + class name)
7. Add to `PROVIDERS` list in `scripts/samples.ts`
8. Update this file (`AGENTS.md`) with provider description

## Testing

- `vitest` in `test/` directory
- Tests verify provider interface conformance and `listVoices()` for all three providers
- Run single: `pnpm vitest run <path>`
- Run all: `pnpm test` (includes lint + typecheck + coverage)
