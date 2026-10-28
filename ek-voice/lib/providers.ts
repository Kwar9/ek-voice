import { splitGoogleText, splitPlainText, stripPauseTags, toGoogleSsml } from "@/lib/chunking";

export type TTSProvider = "google" | "openai" | "elevenlabs";
export type VoiceInfo = {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  languageCode?: string;
  languageCodes?: string[];
  accent?: string;
  quality?: string;
  description?: string;
};

const OPENAI_VOICES: VoiceInfo[] = [
  { id: "alloy", name: "Alloy", gender: "neutral", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Balanced and clear" },
  { id: "ash", name: "Ash", gender: "male", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Direct and composed" },
  { id: "ballad", name: "Ballad", gender: "male", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Warm and expressive" },
  { id: "coral", name: "Coral", gender: "female", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Warm and professional" },
  { id: "echo", name: "Echo", gender: "male", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Smooth and assured" },
  { id: "fable", name: "Fable", gender: "neutral", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Storytelling style" },
  { id: "onyx", name: "Onyx", gender: "male", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Deep and authoritative" },
  { id: "nova", name: "Nova", gender: "female", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Bright and friendly" },
  { id: "sage", name: "Sage", gender: "neutral", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Measured and thoughtful" },
  { id: "shimmer", name: "Shimmer", gender: "female", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Light and clear" },
  { id: "verse", name: "Verse", gender: "neutral", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Expressive narration" },
  { id: "marin", name: "Marin", gender: "female", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Natural and engaging" },
  { id: "cedar", name: "Cedar", gender: "male", languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"], description: "Steady and intimate" },
];

function requireGoogleKey() {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error("Google Cloud TTS is not configured. Add GOOGLE_TTS_API_KEY to your server environment.");
  return key;
}

function boundedSignal(signal?: AbortSignal, timeoutMs = 25000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function googleFetch(url: string, init?: RequestInit, signal?: AbortSignal) {
  const response = await fetch(url, { ...init, signal: boundedSignal(signal, 25000), cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 400) throw new Error("The selected voice or language could not process this text. Check the language and try again.");
    if (response.status === 403) throw new Error("Google Cloud TTS rejected the request. Check that the API is enabled, the key is valid, and billing/quota settings are correct.");
    if (response.status === 429) throw new Error("The speech provider is busy or its quota has been reached. Please try again later.");
    throw new Error(`Speech provider error (${response.status}). ${detail.slice(0, 180)}`);
  }
  return response;
}

export async function listGoogleVoices(): Promise<VoiceInfo[]> {
  const key = requireGoogleKey();
  const url = new URL("https://texttospeech.googleapis.com/v1/voices");
  url.searchParams.set("key", key);
  const response = await googleFetch(url.toString());
  const json = (await response.json()) as { voices?: Array<{ name: string; languageCodes?: string[]; ssmlGender?: string }> };
  return (json.voices ?? [])
    // The Basic tier intentionally limits the default provider to the Standard/WaveNet free-allowance classes.
    .filter((voice) => /-(Standard|WaveNet)-/i.test(voice.name))
    .map((voice) => {
      const languageCode = voice.languageCodes?.[0] ?? "en-US";
      const rawGender = String(voice.ssmlGender || "NEUTRAL").toUpperCase();
      const gender: VoiceInfo["gender"] = rawGender.includes("FEMALE") ? "female" : rawGender.includes("MALE") ? "male" : "neutral";
      return {
        id: voice.name,
        name: voice.name,
        gender,
        languageCode,
        languageCodes: voice.languageCodes ?? [languageCode],
        accent: languageCode,
        quality: voice.name.includes("WaveNet") ? "WaveNet" : "Standard",
        description: voice.name.includes("WaveNet") ? "WaveNet voice" : "Standard voice",
      };
    });
}

export async function listVoices(provider: TTSProvider, providerKey?: string): Promise<VoiceInfo[]> {
  if (provider === "google") return listGoogleVoices();
  if (provider === "openai") return OPENAI_VOICES;
  if (!providerKey) throw new Error("Add your ElevenLabs API key to load your voices. The key is used for this request only.");
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": providerKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("ElevenLabs rejected this API key. Check it and try again.");
    throw new Error(`ElevenLabs voice list failed (${response.status}).`);
  }
  const json = (await response.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string>; description?: string }> };
  return (json.voices ?? []).map((voice) => {
    const rawGender = (voice.labels?.gender || "neutral").toLowerCase();
    const gender: VoiceInfo["gender"] = rawGender.includes("female") ? "female" : rawGender.includes("male") ? "male" : "neutral";
    const accent = voice.labels?.accent || "Voice library";
    return {
      id: voice.voice_id,
      name: voice.name,
      gender,
      languageCode: "en-US",
      languageCodes: ["en-US", "en-GB", "fr-FR", "es-ES", "de-DE", "zh-CN"],
      accent,
      quality: "Premium",
      description: voice.labels?.description || voice.description || "ElevenLabs voice",
    };
  });
}

async function synthesizeGoogleChunk(chunk: string, voiceId: string, languageCode: string, speed: number, signal?: AbortSignal) {
  const key = requireGoogleKey();
  const url = new URL("https://texttospeech.googleapis.com/v1/text:synthesize");
  url.searchParams.set("key", key);
  const response = await googleFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      input: { ssml: toGoogleSsml(chunk) },
      voice: { languageCode, name: voiceId },
      audioConfig: { audioEncoding: "MP3", speakingRate: Math.min(4, Math.max(0.25, speed)) },
    }),
  }, signal);
  const json = (await response.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("The speech provider returned an empty audio file. Please try again.");
  return Buffer.from(json.audioContent, "base64");
}

async function synthesizeOpenAIChunk(text: string, voiceId: string, speed: number, apiKey: string, signal?: AbortSignal) {
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice: voiceId, input: text, response_format: "mp3", speed: Math.min(4, Math.max(0.25, speed)) }),
    signal: boundedSignal(signal, 30000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("OpenAI rejected this API key. Check it and try again.");
    if (response.status === 429) throw new Error("The OpenAI rate limit or credit balance has been reached.");
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI speech generation failed (${response.status}). ${detail.slice(0, 160)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeElevenLabsChunk(text: string, voiceId: string, speed: number, apiKey: string, signal?: AbortSignal) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, speed)) },
    }),
    signal: boundedSignal(signal, 30000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("ElevenLabs rejected this API key. Check your key and account access.");
    if (response.status === 429) throw new Error("The ElevenLabs rate limit or credit balance has been reached.");
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs speech generation failed (${response.status}). ${detail.slice(0, 160)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeSpeech(args: {
  provider: TTSProvider;
  text: string;
  voiceId: string;
  languageCode: string;
  speed: number;
  providerKey?: string;
}, signal?: AbortSignal) {
  const { provider, text, voiceId, languageCode, speed } = args;
  if (!text.trim()) throw new Error("Enter some text before generating speech.");
  if (!voiceId || voiceId.length > 180) throw new Error("Select a valid voice.");

  if (provider === "google") {
    if (!/^[A-Za-z0-9-]+$/.test(voiceId) || !/^[a-z]{2,3}-[A-Z]{2,4}(?:-[A-Za-z0-9]+)?$/.test(languageCode)) {
      throw new Error("The selected Google voice or language code is invalid.");
    }
    const chunks = splitGoogleText(text, 4250);
    const audio: Buffer[] = [];
    for (const chunk of chunks) {
      if (signal?.aborted) throw new Error("Speech generation was cancelled.");
      audio.push(await synthesizeGoogleChunk(chunk, voiceId, languageCode, speed, signal));
    }
    return Buffer.concat(audio);
  }

  const apiKey = args.providerKey?.trim();
  if (!apiKey) throw new Error(`Add your ${provider === "openai" ? "OpenAI" : "ElevenLabs"} API key in Voice engine settings. It is not saved by EK Voice.`);

  const plain = stripPauseTags(text);
  const chunks = splitPlainText(plain, provider === "openai" ? 3500 : 4300);
  const audio: Buffer[] = [];
  for (const chunk of chunks) {
    if (signal?.aborted) throw new Error("Speech generation was cancelled.");
    audio.push(provider === "openai"
      ? await synthesizeOpenAIChunk(chunk, voiceId, speed, apiKey, signal)
      : await synthesizeElevenLabsChunk(chunk, voiceId, speed, apiKey, signal));
  }
  return Buffer.concat(audio);
}

export async function synthesizePreview(args: { provider: TTSProvider; voiceId: string; languageCode: string; speed: number; providerKey?: string }) {
  const fixedSample = "Hello. This is a short voice preview from EK Voice. Clear, natural speech for your everyday listening.";
  return synthesizeSpeech({ ...args, text: fixedSample });
}

export function safeFileName(text: string) {
  const slug = text
    .replace(/<break\s+time\s*=\s*(['"])(0\.5|1|1\.5|2)s\1\s*\/>/gi, " ")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .slice(0, 48);
  return `ek-voice-${slug || "speech"}.mp3`;
}
