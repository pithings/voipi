import { estimateSpeechDuration, detectLanguage } from "voipi";
import { providers } from "./providers.js";

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
  const langSelect = document.getElementById("demo-lang");
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

  // Populate language options
  const LANGUAGES = [
    ["auto", "Auto-detect"],
    ["en", "English"],
    ["ar", "Arabic"],
    ["bn", "Bengali"],
    ["cs", "Czech"],
    ["da", "Danish"],
    ["de", "German"],
    ["el", "Greek"],
    ["es", "Spanish"],
    ["fa", "Farsi"],
    ["fr", "French"],
    ["gu", "Gujarati"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["hy", "Armenian"],
    ["ja", "Japanese"],
    ["ka", "Georgian"],
    ["km", "Khmer"],
    ["kn", "Kannada"],
    ["ko", "Korean"],
    ["ml", "Malayalam"],
    ["my", "Myanmar"],
    ["no", "Norwegian"],
    ["pl", "Polish"],
    ["pt", "Portuguese"],
    ["ro", "Romanian"],
    ["ru", "Russian"],
    ["si", "Sinhala"],
    ["sk", "Slovak"],
    ["sv", "Swedish"],
    ["ta", "Tamil"],
    ["te", "Telugu"],
    ["th", "Thai"],
    ["tr", "Turkish"],
    ["uk", "Ukrainian"],
    ["ur", "Urdu"],
    ["vi", "Vietnamese"],
    ["zh", "Chinese"],
  ];
  for (const [code, name] of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code === "auto" ? `Lang: ${name}` : `${name} (${code})`;
    langSelect.append(opt);
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
    "espeak-ng": { import: "voipi/espeak-ng", cls: "EspeakNG" },
    macos: { import: "voipi/macos", cls: "MacOS" },
  };

  function hl(type, text) {
    return `<span class="${type}">${text}</span>`;
  }

  function updateCommand() {
    const provider = providerSelect.value;
    const voice = voiceSelect.value;
    const lang = langSelect.value;
    const rate = rateInput.value;
    const output = outputInput.value.trim();
    const text = textInput.value;
    const cliTextQuoted = `'${text.replace(/'/g, "'\\''")}'`;
    const textQuoted = `"${text.replace(/"/g, '\\"')}"`;

    // CLI command
    let flags = "";
    if (provider !== "auto") flags += ` -p ${provider}`;
    if (voice) {
      const needsQuotes = voice.includes(" ");
      flags += ` -v ${needsQuotes ? `'${voice}'` : voice}`;
    }
    if (lang && lang !== "auto") flags += ` -l ${lang}`;
    if (rate) flags += ` -r ${rate}`;
    if (output) flags += ` -o ${output}`;
    const codeEl = installEl.querySelector("code");
    codeEl.innerHTML = `<span class="prefix">$</span> ${runner} <span class="cmd-bin">voipi</span>${flags} <span class="cmd-arg">${cliTextQuoted}</span>`;

    // JS snippet
    const { import: mod, cls } = providerMeta[provider] || providerMeta.auto;
    const ctorParts = [];
    if (voice) ctorParts.push(`${hl("var", "voice")}: ${hl("str", `"${voice}"`)}`);
    const ctorStr = ctorParts.length ? `{ ${ctorParts.join(", ")} }` : "";

    const callParts = [];
    if (lang && lang !== "auto") callParts.push(`${hl("var", "lang")}: ${hl("str", `"${lang}"`)}`);
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

  const durationEl = document.getElementById("demo-duration");
  const langEl = document.getElementById("demo-detected-lang");

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
    const lang = detectLanguage(text);
    if (text.trim() && lang) {
      langEl.textContent = lang;
      langEl.classList.add("show");
    } else {
      langEl.classList.remove("show");
    }
  }

  function getParams() {
    return {
      provider: providerSelect.value,
      voice: voiceSelect.value,
      lang: langSelect.value,
      rate: rateInput.value,
      output: outputInput.value,
      text: textInput.value,
      runner,
    };
  }

  const DEFAULTS = {
    provider: "edge-tts",
    voice: "",
    lang: "auto",
    rate: "",
    output: "",
    text: "Hello, World!",
    runner: "npx",
  };

  function saveToURL() {
    const params = getParams();
    // Only encode non-default values
    const diff = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== DEFAULTS[k]) diff[k] = v;
    }
    if (Object.keys(diff).length > 0) {
      const encoded = btoa(JSON.stringify(diff));
      history.replaceState(null, "", `?d=${encoded}`);
    } else {
      history.replaceState(null, "", location.pathname);
    }
  }

  function restoreFromURL() {
    const url = new URL(location.href);
    const encoded = url.searchParams.get("d");
    if (!encoded) return false;
    try {
      const params = JSON.parse(atob(encoded));
      if (params.provider) providerSelect.value = params.provider;
      updateVoices(); // populate voices for selected provider before setting voice
      if (params.voice) voiceSelect.value = params.voice;
      if (params.lang) langSelect.value = params.lang;
      if (params.rate) rateInput.value = params.rate;
      if (params.output) outputInput.value = params.output;
      if (params.text) textInput.value = params.text;
      if (params.runner) {
        runner = params.runner;
        for (const b of runnerButtons) {
          b.classList.toggle("active", b.dataset.runner === runner);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  providerSelect.addEventListener("change", () => {
    updateVoices();
    saveToURL();
  });
  voiceSelect.addEventListener("change", () => {
    updateCommand();
    saveToURL();
  });
  langSelect.addEventListener("change", () => {
    updateCommand();
    saveToURL();
  });
  rateInput.addEventListener("change", () => {
    updateCommand();
    updateDuration();
    saveToURL();
  });
  outputInput.addEventListener("input", () => {
    updateCommand();
    saveToURL();
  });
  textInput.addEventListener("input", () => {
    updateCommand();
    updateDuration();
    saveToURL();
  });

  for (const btn of runnerButtons) {
    btn.addEventListener("click", () => {
      for (const b of runnerButtons) b.classList.remove("active");
      btn.classList.add("active");
      runner = btn.dataset.runner;
      updateCommand();
      saveToURL();
    });
  }

  // Restore from URL or use defaults
  if (!restoreFromURL()) {
    providerSelect.value = "edge-tts";
    updateVoices();
  }
  updateCommand();
  updateDuration();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDemo);
} else {
  initDemo();
}
