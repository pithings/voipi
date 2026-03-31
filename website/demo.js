import { estimateSpeechDuration } from 'voipi'

/** @type {Record<string, { label: string, voices: { id: string, label?: string }[] }>} */
const providers = {
  auto: {
    label: "Auto",
    voices: [],
  },
  "edge-tts": {
    label: "Edge TTS",
    voices: [
      { id: "en-US-AriaNeural" },
      { id: "en-US-AvaNeural" },
      { id: "en-US-AndrewNeural" },
      { id: "en-US-EmmaNeural" },
      { id: "en-US-BrianNeural" },
      { id: "en-US-JennyNeural" },
      { id: "en-US-GuyNeural" },
      { id: "en-US-ChristopherNeural" },
      { id: "en-US-EricNeural" },
      { id: "en-US-MichelleNeural" },
      { id: "en-US-RogerNeural" },
      { id: "en-US-SteffanNeural" },
      { id: "en-GB-LibbyNeural" },
      { id: "en-GB-RyanNeural" },
      { id: "en-GB-SoniaNeural" },
      { id: "en-GB-ThomasNeural" },
      { id: "en-AU-NatashaNeural" },
      { id: "en-AU-WilliamMultilingualNeural" },
      { id: "en-IN-NeerjaNeural" },
      { id: "en-IN-PrabhatNeural" },
      { id: "fr-FR-DeniseNeural" },
      { id: "de-DE-KatjaNeural" },
      { id: "es-ES-ElviraNeural" },
      { id: "ja-JP-NanamiNeural" },
      { id: "zh-CN-XiaoxiaoNeural" },
    ],
  },
  "google-tts": {
    label: "Google TTS",
    voices: [
      { id: "en" },
      { id: "fr" },
      { id: "de" },
      { id: "es" },
      { id: "it" },
      { id: "ja" },
      { id: "ko" },
      { id: "pt" },
      { id: "ru" },
      { id: "zh-CN" },
      { id: "ar" },
      { id: "hi" },
      { id: "nl" },
      { id: "pl" },
      { id: "tr" },
      { id: "vi" },
    ],
  },
  piper: {
    label: "Piper",
    voices: [
      { id: "en_US-amy-low" },
      { id: "en_US-amy-medium" },
      { id: "en_US-lessac-medium" },
      { id: "en_US-lessac-high" },
      { id: "en_US-ryan-medium" },
      { id: "en_US-ryan-high" },
      { id: "en_US-joe-medium" },
      { id: "en_US-bryce-medium" },
      { id: "en_US-kristin-medium" },
      { id: "en_US-ljspeech-high" },
      { id: "en_GB-alan-medium" },
      { id: "en_GB-alba-medium" },
      { id: "en_GB-cori-high" },
      { id: "en_GB-jenny_dioco-medium" },
      { id: "de_DE-thorsten-high" },
      { id: "fr_FR-siwis-medium", label: "fr_FR-siwis-medium" },
      { id: "es_ES-sharvard-medium", label: "es_ES-sharvard-medium" },
    ],
  },
  macos: {
    label: "macOS",
    voices: [
      { id: "Samantha" },
      { id: "Daniel" },
      { id: "Karen" },
      { id: "Moira" },
      { id: "Fred" },
      { id: "Albert" },
      { id: "Kathy" },
      { id: "Ralph" },
      { id: "Whisper" },
      { id: "Jester" },
      { id: "Bad News" },
      { id: "Good News" },
      { id: "Bubbles" },
      { id: "Zarvox" },
      { id: "Trinoids" },
      { id: "Junior" },
    ],
  },
};

// --- Bundle size cache (deferred, per-subpath) ---
const bundleSizeCache = new Map();

function fetchBundleSize(pkg) {
  if (bundleSizeCache.has(pkg)) return bundleSizeCache.get(pkg);
  const promise = fetch(`https://deno.bundlejs.com/?q=${encodeURIComponent(pkg)}`)
    .then((r) => r.json())
    .then((d) => {
      const result = { raw: d.size?.rawCompressedSize, label: d.size?.compressedSize };
      bundleSizeCache.set(pkg, Promise.resolve(result));
      return result;
    })
    .catch(() => {
      bundleSizeCache.delete(pkg);
      return null;
    });
  bundleSizeCache.set(pkg, promise);
  return promise;
}

function initDemo() {
  const installEl = document.querySelector(".install");
  if (!installEl) return;

  const providerSelect = document.getElementById("demo-provider");
  const voiceSelect = document.getElementById("demo-voice");
  const rateInput = document.getElementById("demo-rate");
  const outputInput = document.getElementById("demo-output");
  const textInput = document.getElementById("demo-text");
  const snippet = document.querySelector(".demo-snippet");
  const runnerButtons = installEl.querySelectorAll(".runner-opt");
  let runner = "npx";

  // Populate provider options
  for (const [key, { label }] of Object.entries(providers)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key === "auto" ? `Provider: ${label}` : label;
    providerSelect.append(opt);
  }

  function updateVoices() {
    const provider = providerSelect.value;
    const { voices } = providers[provider];
    voiceSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = voices.length ? "Default" : "—";
    voiceSelect.append(defaultOpt);
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label || v.id;
      voiceSelect.append(opt);
    }
    voiceSelect.hidden = voices.length === 0;
    updateCommand();
  }

  const providerMeta = {
    auto: { import: "voipi", cls: "VoiPi" },
    "edge-tts": { import: "voipi/edge-tts", cls: "EdgeTTS" },
    "google-tts": { import: "voipi/google-tts", cls: "GoogleTTS" },
    piper: { import: "voipi/piper", cls: "Piper" },
    macos: { import: "voipi/macos", cls: "MacOS" },
  };

  function hl(type, text) {
    return `<span class="${type}">${text}</span>`;
  }

  function updateCommand() {
    const provider = providerSelect.value;
    const voice = voiceSelect.value;
    const rate = rateInput.value;
    const output = outputInput.value.trim();
    const text = textInput.value;
    const textQuoted = `"${text}"`;

    // CLI command
    let flags = "";
    if (provider !== "auto") flags += ` -p ${provider}`;
    if (voice) {
      const needsQuotes = voice.includes(" ");
      flags += ` -v ${needsQuotes ? `"${voice}"` : voice}`;
    }
    if (rate) flags += ` -r ${rate}`;
    if (output) flags += ` -o ${output}`;
    const codeEl = installEl.querySelector("code");
    codeEl.innerHTML = `<span class="prefix">$</span> ${runner} <span class="cmd-bin">voipi</span>${flags} <span class="cmd-arg">${textQuoted}</span>`;

    // JS snippet
    const { import: mod, cls } = providerMeta[provider] || providerMeta.auto;
    const ctorParts = [];
    if (voice) ctorParts.push(`${hl("var", "voice")}: ${hl("str", `"${voice}"`)}`);
    const ctorStr = ctorParts.length ? `{ ${ctorParts.join(", ")} }` : "";

    const callParts = [];
    if (rate) callParts.push(`${hl("var", "rate")}: ${hl("var", rate)}`);
    const callStr = callParts.length ? `, { ${callParts.join(", ")} }` : "";

    const lines = [
      `${hl("kw", "import")} ${hl("op", "{")} ${hl("var", cls)} ${hl("op", "}")} ${hl("kw", "from")} ${hl("str", `"${mod}"`)}${hl("op", ";")}`,
      ``,
      `${hl("kw", "const")} ${hl("var", "tts")} ${hl("op", "=")} ${hl("kw", "new")} ${hl("fn", cls)}${hl("op", "(")}${ctorStr}${hl("op", ");")}`,
    ];
    if (output) {
      lines.push(
        `${hl("kw", "await")} ${hl("var", "tts")}${hl("op", ".")}${hl("fn", "save")}${hl("op", "(")}${hl("str", textQuoted)}${hl("op", ",")} ${hl("str", `"${output}"`)}${callStr}${hl("op", ");")}`,
      );
    } else {
      lines.push(
        `${hl("kw", "await")} ${hl("var", "tts")}${hl("op", ".")}${hl("fn", "speak")}${hl("op", "(")}${hl("str", textQuoted)}${callStr}${hl("op", ");")}`,
      );
    }
    snippet.innerHTML =
      '<span class="bundle-size" title="Minified + gzipped"></span>' +
      lines.join("\n") +
      '<span class="copied">Copied!</span>';

    // Deferred bundle size fetch
    const sizeEl = snippet.querySelector(".bundle-size");
    fetchBundleSize(mod).then((s) => {
      if (!s || providerSelect.value !== provider) return;
      sizeEl.textContent = s.label;
      sizeEl.classList.add("show");
    });
  }

  for (const btn of runnerButtons) {
    btn.addEventListener("click", () => {
      for (const b of runnerButtons) b.classList.remove("active");
      btn.classList.add("active");
      runner = btn.dataset.runner;
      updateCommand();
    });
  }

  const durationEl = document.getElementById("demo-duration");

  function updateDuration() {
    const text = textInput.value;
    const rate = Number.parseFloat(rateInput.value) || 1;
    const seconds = estimateSpeechDuration(text, rate);
    if (seconds > 0) {
      const s = Math.round(seconds);
      durationEl.textContent = `~${s}s`;
      durationEl.classList.add("show");
    } else {
      durationEl.classList.remove("show");
    }
  }

  providerSelect.addEventListener("change", updateVoices);
  voiceSelect.addEventListener("change", updateCommand);
  rateInput.addEventListener("input", () => { updateCommand(); updateDuration(); });
  outputInput.addEventListener("input", updateCommand);
  textInput.addEventListener("input", () => { updateCommand(); updateDuration(); });
  providerSelect.value = "edge-tts";
  updateVoices();
  updateDuration();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDemo);
} else {
  initDemo();
}
