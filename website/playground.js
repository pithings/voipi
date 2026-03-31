import { BrowserTTS } from "voipi";

const tts = new BrowserTTS();

/** Populate the voice dropdown with browser-available voices */
export async function loadVoices() {
  const voices = await tts.listVoices();
  const select = document.getElementById("pg-voice-select");
  if (!select) return voices;
  for (const voice of voices) {
    const opt = document.createElement("option");
    opt.value = voice.id;
    opt.textContent = voice.lang ? `${voice.name} (${voice.lang})` : voice.name;
    select.appendChild(opt);
  }
  return voices;
}

/** Speak text using the browser's Web Speech API via voipi */
export async function speak(text, options = {}) {
  await tts.speak(text, options);
}

/** Speak text using a server-side provider via /api/speak */
async function speakServer(text, provider, voice, rate) {
  const params = new URLSearchParams({ text, provider });
  if (voice) params.set("voice", voice);
  if (rate !== 1) params.set("rate", String(rate));
  const res = await fetch("/api/speak?" + params);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg);
  }
  const blob = await res.blob();
  const audio = document.getElementById("pg-audio");
  const result = document.getElementById("pg-result");
  audio.src = URL.createObjectURL(blob);
  result.hidden = false;
  audio.play();
}

/** Main playground speak handler */
export async function pgSpeak() {
  const text = document.getElementById("pg-text").value.trim();
  if (!text) return;
  const btn = document.getElementById("pg-speak");
  const error = document.getElementById("pg-error");
  const result = document.getElementById("pg-result");
  const provider = document.getElementById("pg-provider").value;
  const rate = parseFloat(document.getElementById("pg-rate").value) || 1;

  btn.disabled = true;
  error.hidden = true;
  result.hidden = true;

  try {
    if (provider === "browser") {
      btn.textContent = "Speaking...";
      const voice = document.getElementById("pg-voice-select").value || undefined;
      await speak(text, { voice, rate });
    } else {
      btn.textContent = "Generating...";
      const voice = document.getElementById("pg-voice").value.trim();
      await speakServer(text, provider, voice, rate);
    }
  } catch (err) {
    error.textContent = err.message || "Failed to generate speech";
    error.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Speak";
  }
}

// --- init ---

// Toggle voice field based on provider
document.getElementById("pg-provider").addEventListener("change", function () {
  const isBrowser = this.value === "browser";
  document.getElementById("pg-voice-field").hidden = !isBrowser;
  document.getElementById("pg-voice-text-field").hidden = isBrowser;
});

// Expose pgSpeak globally for onclick
window.pgSpeak = pgSpeak;

// Load browser voices
loadVoices().catch(() => {});
