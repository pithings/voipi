# @pithings/voipi-pi

A [pi](https://pi.dev) package that adds text-to-speech tools and commands powered by [VoiPi](https://github.com/pithings/voipi).

## Install

From GitHub (`pithings/voipi`):

```sh
pi install git:github.com/pithings/voipi
```

<!--
```sh
pi install npm:@pithings/voipi-pi
```
-->

## What it adds

### Tools

- `voipi_speak` — speak text aloud, or save speech audio to a file
- `voipi_list_voices` — list voices for `auto`, `macos`, `piper`, `edge-tts`, or `google-tts`

### Commands

- `/tts` — speak text immediately
- `/tts-voices [provider] [query]` — browse voices for a provider

## Examples

Ask pi:

- “Read your answer aloud.”
- “Use `voipi_speak` to save this paragraph to `./intro.mp3`.”
- “Show me Farsi voices with `voipi_list_voices`.”

Or use the commands directly:

```text
/tts Hello from pi and VoiPi!
/tts-voices edge-tts aria
```

## Notes

- The extension defaults to `auto`, so VoiPi picks the best available provider.
- Use `provider`, `voice`, `lang`, and `rate` tool parameters when you need explicit control.
- You can set persistent defaults in `~/.voipirc.json` (e.g., `{"provider": "edge-tts", "voice": "en-US-GuyNeural", "lang": "en", "rate": 1.2}`).
- Audio file output paths are resolved relative to pi's current working directory.
