import type { Lang } from "./types";

const TAGS: Record<Lang, readonly string[]> = {
  en: ["en-gb", "en-us", "en"],
  nl: ["nl-be", "nl-nl", "nl"],
  fr: ["fr-be", "fr-fr", "fr"],
};

export type SpeakCallbacks = { onWord: (index: number) => void; onEnd: () => void };
export type SpeakHandle = { cancel: () => void };
export type SpeakMode = "speech" | "readalong";

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
}

export function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      window.clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = window.setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", done);
  });
}

export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const norm = voices.map((v) => ({ v, tag: v.lang.toLowerCase().replace("_", "-") }));
  for (const tag of TAGS[lang]) {
    const hit = norm.find((n) => n.tag === tag);
    if (hit) return hit.v;
  }
  const primary = TAGS[lang][TAGS[lang].length - 1] ?? lang;
  return norm.find((n) => n.tag.split("-")[0] === primary)?.v ?? null;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function speak(text: string, voice: SpeechSynthesisVoice, rate: number, cb: SpeakCallbacks): SpeakHandle {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  const starts: number[] = [];
  let pos = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const at = text.indexOf(w, pos);
    starts.push(at);
    pos = at + w.length;
  }
  u.onboundary = (e) => {
    if (e.name && e.name !== "word") return;
    let idx = 0;
    for (let i = 0; i < starts.length; i++) if ((starts[i] ?? 0) <= e.charIndex) idx = i;
    cb.onWord(idx);
  };
  u.onend = () => cb.onEnd();
  u.onerror = () => cb.onEnd();
  synth.speak(u);
  return { cancel: () => synth.cancel() };
}

export function readAlong(text: string, rate: number, cb: SpeakCallbacks): SpeakHandle {
  const total = wordCount(text);
  const msPerWord = Math.round(1000 / ((15 * rate) / 5.5));
  let i = 0;
  cb.onWord(0);
  const timer = window.setInterval(() => {
    i += 1;
    if (i >= total) {
      window.clearInterval(timer);
      cb.onEnd();
    } else cb.onWord(i);
  }, msPerWord);
  return {
    cancel: () => {
      window.clearInterval(timer);
    },
  };
}

export function rateFor(tone: string | undefined): number {
  if (tone === "reassuring") return 0.9;
  if (tone === "direct") return 1.05;
  if (tone === "playful") return 1.1;
  return 1;
}
