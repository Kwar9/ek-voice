"use client";

import { franc } from "franc-min";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Provider = "google" | "openai" | "elevenlabs";
type Voice = {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  languageCode?: string;
  languageCodes?: string[];
  accent?: string;
  quality?: string;
  description?: string;
};
type HistoryEntry = {
  id: string;
  input_text: string;
  provider: Provider;
  voice_id: string;
  language_code: string;
  speed: number;
  character_count: number;
  download_name: string;
  created_at: string;
  download_url: string | null;
};
type Pronunciation = { id: number; from: string; to: string };

const LANGUAGES = [
  { value: "en", label: "English", detect: "eng" },
  { value: "fr", label: "French", detect: "fra" },
  { value: "es", label: "Spanish", detect: "spa" },
  { value: "de", label: "German", detect: "deu" },
  { value: "zh", label: "Mandarin Chinese", detect: "cmn" },
];
const ACCENT_LABELS: Record<string, string> = {
  "en-US": "United States", "en-GB": "United Kingdom", "en-AU": "Australia", "en-IN": "India", "en-CA": "Canada",
  "fr-FR": "France", "fr-CA": "Canada", "es-ES": "Spain", "es-MX": "Mexico", "de-DE": "Germany", "zh-CN": "Mainland China",
};
const DEFAULT_ACCENTS: Record<string, string[]> = {
  en: ["en-US", "en-GB", "en-AU", "en-IN", "en-CA"],
  fr: ["fr-FR", "fr-CA"],
  es: ["es-ES", "es-MX"],
  de: ["de-DE"],
  zh: ["zh-CN"],
};
const EXAMPLE_TEXT = "Welcome to EK Voice, your focused text-to-speech workspace. Paste an article, choose a voice, and create a natural-sounding MP3 for listening, learning, or your next creative project. You can adjust the speed, preview voices, and download your audio when you are signed in.";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, ReactNode> = {
    play: <><path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" /></>,
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor" stroke="none" /></>,
    stop: <><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" /></>,
    download: <><path d="M12 3v11m-4-4 4 4 4-4"/><path d="M5 17v3h14v-3"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z"/>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    x: <><path d="m18 6-12 12M6 6l12 12"/></>,
    chevron: <path d="m6 9 6 6 6-6"/>,
    wand: <><path d="m15 4 5 5M4 20l11-11M5 6l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Zm12 10 1.5 2.5L21 20l-2.5 1.5L17 24l-1.5-2.5L13 20l2.5-1.5L17 16Z"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    audio: <><path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4M23 8v8"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></>,
    arrowUpRight: <><path d="M7 17 17 7M7 7h10v10"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.audio}</svg>;
}

function languageBase(code: string) {
  return code.split("-")[0].toLowerCase();
}
function sanitizeError(raw: string) {
  return raw.replace(/<[^>]*>/g, "").slice(0, 280);
}
function replacePronunciations(text: string, entries: Pronunciation[]) {
  return entries.reduce((result, entry) => {
    if (!entry.from.trim() || !entry.to.trim()) return result;
    const escaped = entry.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return result.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu"), entry.to);
    } catch {
      return result;
    }
  }, text);
}
function filenameFromHeader(header: string | null, text: string) {
  if (header && /^[\w.-]+\.mp3$/i.test(header)) return header;
  const slug = text.replace(/<break\s+time=["'](?:0\.5|1|1\.5|2)s["']\s*\/>/gi, " ").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().split(/\s+/).slice(0, 6).join("-").toLowerCase().slice(0, 48);
  return `ek-voice-${slug || "speech"}.mp3`;
}

export default function EKVoiceApp() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [text, setText] = useState("");
  const [lastGeneratedText, setLastGeneratedText] = useState("");
  const [provider, setProvider] = useState<Provider>("google");
  const [providerKey, setProviderKey] = useState(""); // Intentionally memory-only. Never persisted to localStorage.
  const [language, setLanguage] = useState("en");
  const [accent, setAccent] = useState("en-US");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.9);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audioSrc, setAudioSrc] = useState("");
  const [audioName, setAudioName] = useState("ek-voice-speech.mp3");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [pronunciations, setPronunciations] = useState<Pronunciation[]>([]);
  const [nextPronunciationId, setNextPronunciationId] = useState(1);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [showPronunciations, setShowPronunciations] = useState(false);
  const [showArticle, setShowArticle] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef("");
  const audioUrlRef = useRef("");

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const charCount = text.length;
  const allowedChars = !user ? 200 : (provider !== "google" && providerKey.trim()) ? 5000 : 2000;
  const hardLimitExceeded = charCount > 5000;
  const tierLimitExceeded = charCount > allowedChars;
  const selectedVoice = voices.find((voice) => voice.id === voiceId);
  const textChanged = Boolean(lastGeneratedText) && text !== lastGeneratedText;
  const canGenerate = Boolean(text.trim()) && !hardLimitExceeded && !tierLimitExceeded && !loading && Boolean(voiceId) && (provider === "google" || Boolean(providerKey.trim()));

  const availableAccents = useMemo(() => {
    const fromVoiceList = voices.flatMap((voice) => voice.languageCodes ?? (voice.languageCode ? [voice.languageCode] : []))
      .filter((code) => languageBase(code) === language)
      .filter((code) => ACCENT_LABELS[code] || code);
    const distinct = Array.from(new Set(fromVoiceList));
    return distinct.length ? distinct : (DEFAULT_ACCENTS[language] ?? []);
  }, [voices, language]);

  const filteredVoices = useMemo(() => {
    if (provider === "openai" || provider === "elevenlabs") return voices;
    return voices.filter((voice) => {
      const codes = voice.languageCodes ?? (voice.languageCode ? [voice.languageCode] : []);
      return codes.includes(accent) || voice.languageCode === accent;
    });
  }, [voices, provider, accent]);

  const groupedVoices = useMemo(() => ({
    female: filteredVoices.filter((voice) => voice.gender === "female"),
    male: filteredVoices.filter((voice) => voice.gender === "male"),
    neutral: filteredVoices.filter((voice) => voice.gender === "neutral"),
  }), [filteredVoices]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("ekvoice-theme");
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    const storedDraft = window.localStorage.getItem("ekvoice-draft");
    if (storedDraft) setText(storedDraft);
    const client = getSupabaseBrowserClient();
    if (client) {
      client.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null));
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
      });
      return () => listener.subscription.unsubscribe();
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("ekvoice-theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!user) window.localStorage.setItem("ekvoice-draft", text);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [text, user]);

  const loadVoices = useCallback(async (keyOverride?: string) => {
    setVoicesLoading(true);
    setVoicesError("");
    try {
      const response = await fetch(`/api/voices?provider=${provider}`, {
        headers: (keyOverride !== undefined ? keyOverride : providerKey) ? { "x-provider-key": keyOverride !== undefined ? keyOverride : providerKey } : {},
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load voice options.");
      const items: Voice[] = payload.voices ?? [];
      setVoices(items);
      if (items.length) {
        let initialVoice = items[0];
        if (provider === "google") {
          initialVoice = items.find((item) => (item.languageCodes ?? [item.languageCode]).some((code) => code && languageBase(code) === language)) ?? items[0];
          const matchingCode = (initialVoice?.languageCodes ?? [initialVoice?.languageCode]).find((code) => code && languageBase(code) === language);
          if (matchingCode) setAccent(matchingCode);
        }
        setVoiceId((current) => items.some((item) => item.id === current) ? current : (initialVoice?.id ?? ""));
      } else setVoiceId("");
    } catch (loadError) {
      setVoices([]);
      setVoiceId("");
      setVoicesError(sanitizeError(loadError instanceof Error ? loadError.message : "Could not load voices."));
    } finally {
      setVoicesLoading(false);
    }
  }, [provider, providerKey, language]);

  useEffect(() => {
    setVoiceId("");
    if (provider === "elevenlabs") {
      setVoices([]);
      setVoicesError("Enter your ElevenLabs API key in Voice engine settings, then load voices.");
      return;
    }
    void loadVoices("");
    // The selected provider is the only automatic refresh trigger. BYOK voice lists load on explicit click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    if (availableAccents.length && !availableAccents.includes(accent)) setAccent(availableAccents[0]);
  }, [availableAccents, accent]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (previewAudioRef.current) previewAudioRef.current.volume = volume;
  }, [volume, audioSrc]);

  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const detectLanguage = () => {
    if (text.trim().length < 20) {
      setNotice("Paste a little more text to improve language detection.");
      return;
    }
    const detected = franc(text.slice(0, 3000), { minLength: 20 });
    const found = LANGUAGES.find((item) => item.detect === detected);
    if (!found) {
      setNotice("That language could not be confidently detected. Choose a language manually.");
      return;
    }
    setLanguage(found.value);
    const candidates = DEFAULT_ACCENTS[found.value] ?? [];
    if (candidates.length) setAccent(candidates[0]);
    setNotice(`Detected ${found.label}. Review the voice accent before generating.`);
  };

  const updateText = (value: string) => {
    setText(value);
    setError("");
    setNotice("");
  };

  const clearText = () => {
    updateText("");
    textareaRef.current?.focus();
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 1500);
    } catch {
      setError("Your browser blocked clipboard access. Select the text and copy it manually.");
    }
  };

  const insertPause = () => {
    const textarea = textareaRef.current;
    const tag = "<break time='1s'/>";
    if (!textarea) {
      updateText(`${text}${text && !text.endsWith(" ") ? " " : ""}${tag}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${text.slice(0, start)}${tag}${text.slice(end)}`;
    updateText(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  const addPronunciation = () => {
    setPronunciations((current) => [...current, { id: nextPronunciationId, from: "", to: "" }]);
    setNextPronunciationId((id) => id + 1);
  };

  const handlePreview = async () => {
    if (!voiceId) {
      setError("Choose a voice first.");
      return;
    }
    setError("");
    setNotice("");
    setPreviewLoading(true);
    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
        previewAudioRef.current.src = "";
      }
      if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(providerKey.trim() ? { "x-provider-key": providerKey.trim() } : {}) },
        body: JSON.stringify({ provider, voiceId, languageCode: accent || "en-US", speed: 1 }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Voice preview failed.");
      }
      const blob = await response.blob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      if (previewAudioRef.current) {
        previewAudioRef.current.src = previewUrlRef.current;
        previewAudioRef.current.volume = volume;
        await previewAudioRef.current.play();
      }
    } catch (previewError) {
      setError(sanitizeError(previewError instanceof Error ? previewError.message : "Voice preview failed."));
    } finally {
      setPreviewLoading(false);
    }
  };

  const generateSpeech = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) {
      setError("Paste or type some text to get started.");
      return;
    }
    if (hardLimitExceeded) {
      setError("Your text is over 5,000 characters. Please shorten it before generating.");
      return;
    }
    if (tierLimitExceeded) {
      setError(!user ? "Guest generations are limited to 200 characters. Sign in to generate longer text and download MP3s." : "Free accounts can generate up to 2,000 characters per conversion. Add a premium provider key for up to 5,000 characters.");
      return;
    }
    if (!voiceId) {
      setError(voicesError || "Choose a voice before generating speech.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    generationControllerRef.current = controller;
    const processedText = replacePronunciations(text, pronunciations);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(providerKey.trim() ? { "x-provider-key": providerKey.trim() } : {}) },
        body: JSON.stringify({ provider, text: processedText, originalText: text, voiceId, languageCode: accent || "en-US", speed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Speech generation failed. Try again.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The speech provider returned an empty audio file.");
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = URL.createObjectURL(blob);
      setAudioSrc(audioUrlRef.current);
      setAudioName(filenameFromHeader(response.headers.get("x-audio-filename"), text));
      setLastGeneratedText(text);
      setCurrentTime(0);
      setDuration(0);
      setPlaying(false);
      setNotice(response.headers.get("x-history-saved") === "true" ? "Audio generated and saved to your history." : "Audio is ready. Press play to listen or download it when signed in.");
      if (user) void loadHistory();
    } catch (generateError) {
      if (generateError instanceof DOMException && generateError.name === "AbortError") setNotice("Generation cancelled. Your previous audio remains available.");
      else setError(sanitizeError(generateError instanceof Error ? generateError.message : "Speech generation failed. Please try again."));
    } finally {
      generationControllerRef.current = null;
      setLoading(false);
    }
  };

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load history.");
      setHistory(payload.history ?? []);
    } catch (historyError) {
      setAuthMessage(sanitizeError(historyError instanceof Error ? historyError.message : "Could not load history."));
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && historyOpen) void loadHistory();
  }, [user, historyOpen, loadHistory]);

  const signInOrUp = async (event: FormEvent) => {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!client) {
      setAuthMessage("Accounts are not configured yet. Add the Supabase URL and anonymous key to the deployment environment, then redeploy.");
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      if (authMode === "signin") {
        const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        setAuthMessage("You are signed in.");
        setShowAuth(false);
      } else {
        const { data, error: authError } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (authError) throw authError;
        if (data.session) {
          setAuthMessage("Your account is ready.");
          setShowAuth(false);
        } else setAuthMessage("Check your email to confirm the account, then sign in.");
      }
    } catch (authError) {
      setAuthMessage(sanitizeError(authError instanceof Error ? authError.message : "Authentication failed."));
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    const client = getSupabaseBrowserClient();
    if (client) await client.auth.signOut();
    setUser(null);
    setHistory([]);
    setHistoryOpen(false);
    setNotice("You are signed out. Your guest draft stays saved on this device.");
  };

  const handleExtract = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!urlInput.trim()) return;
    setExtracting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/article", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not extract article text.");
      updateText(payload.text || "");
      setShowArticle(false);
      setNotice(payload.truncated ? `Extracted “${payload.title}”. Text was shortened to the 5,000-character limit.` : `Extracted article: ${payload.title}`);
    } catch (extractError) {
      setError(sanitizeError(extractError instanceof Error ? extractError.message : "Article extraction failed."));
    } finally {
      setExtracting(false);
    }
  };

  const playPause = async () => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError("Your browser could not play this audio. Try tapping Play again or download the file.");
      }
    } else audio.pause();
  };

  const stopAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setPlaying(false);
  };

  const seekAudio = (value: number) => {
    if (audioRef.current && Number.isFinite(audioRef.current.duration)) audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const requestDownload = () => {
    if (!user) {
      setAuthMode("signin");
      setAuthMessage("");
      setShowAuth(true);
      return;
    }
    if (!audioSrc) return;
    const anchor = document.createElement("a");
    anchor.href = audioSrc;
    anchor.download = audioName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const timeLabel = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remaining}`;
  };

  const languageLabel = LANGUAGES.find((item) => item.value === language)?.label ?? "English";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="EK Voice home">
          <span className="brand-mark"><Icon name="audio" size={20} /></span>
          <span className="brand-name">EK Voice</span>
          <span className="brand-byline">by EK Graphics</span>
        </a>
        <div className="topbar-actions">
          <button className="quiet-button history-trigger" onClick={() => user ? setHistoryOpen(true) : (setAuthMode("signin"), setShowAuth(true))} aria-label={user ? "Open history" : "Sign in to view history"}>
            <Icon name="clock" size={17} /><span className="hide-small">History</span>
          </button>
          {user ? (
            <button className="account-button" onClick={() => void signOut()} title="Sign out">
              <span className="avatar"><Icon name="user" size={15} /></span><span className="account-label">{user.email?.split("@")[0] || "Account"}</span>
            </button>
          ) : (
            <button className="quiet-button sign-in-button" onClick={() => { setAuthMode("signin"); setShowAuth(true); setAuthMessage(""); }}><Icon name="user" size={16} /> Sign in</button>
          )}
          <span className="topbar-divider" />
          <button className="theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
            <Icon name={theme === "light" ? "moon" : "sun"} size={18} />
          </button>
        </div>
      </header>

      <section id="main" className="workspace">
        <div className="page-heading">
          <div className="eyebrow"><span className="status-dot" /> YOUR PERSONAL VOICE WORKSPACE</div>
          <h1>Words, <span>spoken naturally.</span></h1>
          <p>Turn your text into clear, lifelike speech. Read, listen, and create — all in one focused space.</p>
        </div>

        <form className="converter-card" onSubmit={generateSpeech}>
          <div className="editor-toolbar">
            <div className="editor-label"><span className="label-icon"><Icon name="file" size={16} /></span><span>Text input</span><span className="subtle-label">Paste or write anything</span></div>
            <div className="toolbar-actions">
              <button type="button" className="mini-button" onClick={() => setShowArticle((value) => !value)} aria-expanded={showArticle}><Icon name="link" size={15} /> From URL</button>
              <button type="button" className="mini-button" onClick={() => updateText(EXAMPLE_TEXT)}><Icon name="wand" size={15} /> Example</button>
            </div>
          </div>

          {showArticle && <div className="url-extractor">
            <div className="url-field-wrap"><Icon name="link" size={17} /><input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="Paste a public article URL (https://...)" type="url" aria-label="Article URL" maxLength={2048} /></div>
            <button type="button" className="secondary-button" onClick={() => void handleExtract()} disabled={!urlInput.trim() || extracting}>{extracting ? <><span className="spinner small" /> Extracting</> : "Extract text"}</button>
          </div>}

          <div className="textarea-wrap">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => updateText(event.target.value)}
              placeholder="Paste an article, add your script, or type something you’d like to hear…"
              aria-label="Text to convert to speech"
              spellCheck
            />
            <div className={`editor-footer ${(hardLimitExceeded || tierLimitExceeded) ? "counter-error" : ""}`}>
              <div className="editor-footer-left">
                <button type="button" className="text-action" onClick={insertPause} title="Insert a one-second speech pause"><Icon name="plus" size={14} /> Add pause</button>
                <button type="button" className="text-action" onClick={() => setShowPronunciations((value) => !value)} aria-expanded={showPronunciations}><Icon name="audio" size={14} /> Pronunciation</button>
              </div>
              <div className="editor-footer-right">
                <button type="button" className="icon-text-button" onClick={() => void copyText()} disabled={!text} title="Copy text"><Icon name={copyDone ? "check" : "copy"} size={14} />{copyDone ? "Copied" : "Copy"}</button>
                <button type="button" className="icon-text-button" onClick={clearText} disabled={!text} title="Clear text"><Icon name="trash" size={14} />Clear</button>
                <span className="counter" aria-live="polite">{charCount.toLocaleString()} / {allowedChars.toLocaleString()}<span className="counter-max"> · 5,000 max</span></span>
              </div>
            </div>
          </div>

          {showPronunciations && <div className="pronunciation-panel">
            <div className="panel-title-row"><div><strong>Custom pronunciation</strong><p>Replace names, abbreviations, or technical terms before speaking.</p></div><button type="button" className="secondary-button compact" onClick={addPronunciation}><Icon name="plus" size={14} /> Add rule</button></div>
            {pronunciations.length === 0 ? <p className="empty-inline">No pronunciation rules yet. Example: replace “EKG” with “E-K-G”.</p> : <div className="pronunciation-list">{pronunciations.map((entry) => <div className="pronunciation-row" key={entry.id}><input value={entry.from} onChange={(event) => setPronunciations((items) => items.map((item) => item.id === entry.id ? { ...item, from: event.target.value } : item))} placeholder="Word to find" aria-label="Word to find" /><span className="replace-arrow">→</span><input value={entry.to} onChange={(event) => setPronunciations((items) => items.map((item) => item.id === entry.id ? { ...item, to: event.target.value } : item))} placeholder="Pronunciation" aria-label="Replacement pronunciation" /><button type="button" className="icon-only danger" onClick={() => setPronunciations((items) => items.filter((item) => item.id !== entry.id))} aria-label="Remove pronunciation rule"><Icon name="x" size={15} /></button></div>)}</div>}
          </div>}

          <div className="controls-heading"><span>VOICE SETTINGS</span><span className="settings-line" /></div>
          <div className="controls-grid">
            <label className="control-field">
              <span className="field-label">Language <button type="button" className="tiny-link" onClick={detectLanguage}>Auto-detect</button></span>
              <span className="select-wrap"><select value={language} onChange={(event) => { setLanguage(event.target.value); const defaults = DEFAULT_ACCENTS[event.target.value] ?? []; if (defaults[0]) setAccent(defaults[0]); setVoiceId(""); }} aria-label="Language">
                {LANGUAGES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select><Icon name="chevron" size={15} /></span>
            </label>
            <label className="control-field">
              <span className="field-label">Accent</span>
              <span className="select-wrap"><select value={accent} onChange={(event) => setAccent(event.target.value)} aria-label="Accent">
                {availableAccents.map((code) => <option value={code} key={code}>{ACCENT_LABELS[code] || code}</option>)}
              </select><Icon name="chevron" size={15} /></span>
            </label>
            <div className="control-field voice-control">
              <span className="field-label">Voice</span>
              <div className="voice-select-line"><span className="select-wrap"><select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} aria-label="Voice persona" disabled={voicesLoading || filteredVoices.length === 0}>
                <option value="">{voicesLoading ? "Loading voices…" : filteredVoices.length ? "Choose a voice" : "No voices available"}</option>
                {groupedVoices.female.length > 0 && <optgroup label="Female voices">{groupedVoices.female.map((voice) => <option value={voice.id} key={voice.id}>{voice.name} — {voice.description || "Female"}</option>)}</optgroup>}
                {groupedVoices.male.length > 0 && <optgroup label="Male voices">{groupedVoices.male.map((voice) => <option value={voice.id} key={voice.id}>{voice.name} — {voice.description || "Male"}</option>)}</optgroup>}
                {groupedVoices.neutral.length > 0 && <optgroup label="Neutral voices">{groupedVoices.neutral.map((voice) => <option value={voice.id} key={voice.id}>{voice.name} — {voice.description || "Neutral"}</option>)}</optgroup>}
              </select><Icon name="chevron" size={15} /></span><button type="button" className={`preview-button ${previewLoading ? "is-loading" : ""}`} onClick={handlePreview} disabled={!voiceId || previewLoading} aria-label="Play voice preview" title="Play a short voice sample">{previewLoading ? <span className="spinner tiny" /> : <Icon name="play" size={14} />}</button></div>
            </div>
            <label className="control-field range-field">
              <span className="field-label">Speed <strong>{speed.toFixed(1)}×</strong></span>
              <input type="range" min="0.7" max="1.3" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Speech speed" />
              <span className="range-ends"><span>Slower</span><span>Faster</span></span>
            </label>
          </div>

          {provider === "google" && voicesError && !showEngineSettings && <div className="setup-note"><Icon name="lock" size={15} /><span><strong>Basic voice service needs setup.</strong> {voicesError} Open Voice engine settings for details.</span><button type="button" onClick={() => setShowEngineSettings(true)}>Configure</button></div>}

          <div className="controls-bottom-row">
            <button type="button" className="engine-label-button" onClick={() => setShowEngineSettings((value) => !value)} aria-expanded={showEngineSettings}><span className={`provider-dot ${provider}`} />{provider === "google" ? "Basic voices" : `${provider === "openai" ? "OpenAI" : "ElevenLabs"} · Premium`}<span className="engine-caret"><Icon name="chevron" size={14} /></span></button>
            <label className="volume-control"><Icon name="audio" size={15} /><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Audio volume" /><strong>{Math.round(volume * 100)}%</strong></label>
          </div>

          {showEngineSettings && <div className="engine-settings-panel">
            <div className="engine-settings-title"><div><strong>Voice engine</strong><p>Basic voices use the app’s configured Google key. Premium providers use your own key.</p></div><span className="byok-chip"><Icon name="lock" size={12} /> BYOK</span></div>
            <label className="control-field engine-provider-field"><span className="field-label">Provider</span><span className="select-wrap"><select value={provider} onChange={(event) => { setProvider(event.target.value as Provider); setProviderKey(""); setVoicesError(""); setError(""); }} aria-label="Voice provider"><option value="google">Google Cloud · Basic</option><option value="openai">OpenAI · Premium (your key)</option><option value="elevenlabs">ElevenLabs · Premium (your key)</option></select><Icon name="chevron" size={15} /></span></label>
            {provider !== "google" && <div className="byok-input-row"><label className="control-field"><span className="field-label">{provider === "openai" ? "OpenAI API key" : "ElevenLabs API key"}</span><input type="password" autoComplete="off" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} placeholder="Paste your API key — not saved" /></label><button type="button" className="secondary-button load-voices-button" onClick={() => void loadVoices(providerKey.trim())} disabled={!providerKey.trim() || voicesLoading}>{voicesLoading ? <><span className="spinner small" /> Loading</> : "Load voices"}</button></div>}
            {provider === "google" && <p className="fine-print">Google Cloud Standard and WaveNet voices are used for the Basic tier. Server configuration is required. Google Cloud requires billing to be enabled; configure quotas and alerts before public launch.</p>}
            {provider !== "google" && <><p className="fine-print">Your key is sent to the EK Voice backend over HTTPS for provider requests and is not written to LocalStorage or the history database. Only paste a key into a trusted deployment you control.</p><div className="premium-plan-placeholder"><div><strong>Premium subscription</strong><span>Checkout is not connected yet.</span></div><button type="button" className="secondary-button compact" disabled><Icon name="lock" size={13} /> Upgrade plan · coming soon</button></div></>}
            {voicesError && <p className="inline-error"><Icon name="x" size={14} /> {voicesError}</p>}
          </div>}

          {(hardLimitExceeded || tierLimitExceeded) && <p className="limit-warning"><Icon name="lock" size={15} />{hardLimitExceeded ? "The hard limit is 5,000 characters. Shorten your text to continue." : !user ? "Guest limit: 200 characters. Sign in to generate longer text and download MP3s." : "Free account limit: 2,000 characters. Use a premium provider with your own key for up to 5,000 characters."}</p>}
          {textChanged && <p className="changed-notice"><span className="changed-dot" /> Text changed — generate again to update the audio.</p>}
          {error && <div className="message error-message" role="alert"><Icon name="x" size={16} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><Icon name="x" size={15} /></button></div>}
          {notice && !error && <div className="message success-message" role="status"><Icon name="check" size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><Icon name="x" size={15} /></button></div>}

          <button type="submit" className={`generate-button ${textChanged ? "needs-update" : ""}`} disabled={!canGenerate}>
            {loading ? <><span className="spinner" /> Generating your audio…</> : <><Icon name="audio" size={19} /> Convert to Speech <span className="button-arrow"><Icon name="arrowUpRight" size={16} /></span></>}
          </button>
          {loading && <div className="generation-state"><div className="loading-track"><span /></div><span>Preparing your voice and building the MP3. Longer text may take a little more time.</span><button type="button" className="cancel-generation-button" onClick={() => generationControllerRef.current?.abort()}><Icon name="x" size={13} /> Cancel generation</button></div>}
          <p className="privacy-note"><Icon name="lock" size={13} /> Your text is processed securely. Audio generation uses an AI voice service.</p>
        </form>

        {audioSrc && <section className="audio-card" aria-label="Generated audio player">
          <div className="audio-card-heading"><div className="audio-file-icon"><Icon name="audio" size={20} /></div><div className="audio-title-group"><span className="audio-kicker">YOUR AUDIO IS READY</span><strong>{audioName}</strong><span className="audio-details">MP3 audio · {languageLabel} · {selectedVoice?.name || voiceId}</span></div><div className={`waveform ${playing ? "active" : ""}`} aria-label={playing ? "Audio playing" : "Audio ready"}>{Array.from({ length: 19 }, (_, index) => <span key={index} style={{ "--bar": `${8 + ((index * 17) % 26)}px`, "--delay": `${(index % 7) * 0.09}s` } as CSSProperties} />)}</div></div>
          <audio ref={audioRef} src={audioSrc} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onEnded={(event) => { event.currentTarget.currentTime = 0; setPlaying(false); setCurrentTime(0); }} />
          <div className="player-row"><button type="button" className="player-play-button" onClick={() => void playPause()} aria-label={playing ? "Pause audio" : "Play audio"}><Icon name={playing ? "pause" : "play"} size={19} /></button><span className="time-label">{timeLabel(currentTime)}</span><input className="seek-slider" type="range" min="0" max={Math.max(1, duration || 1)} step="0.1" value={Math.min(currentTime, duration || 1)} onChange={(event) => seekAudio(Number(event.target.value))} aria-label="Audio progress" /><span className="time-label">{timeLabel(duration)}</span><button type="button" className="stop-button" onClick={stopAudio} aria-label="Stop audio" title="Stop"><Icon name="stop" size={15} /></button><button type="button" className={`download-button ${!user ? "download-locked" : ""}`} onClick={requestDownload} title={!user ? "Sign in to download MP3" : "Download MP3"}><Icon name={!user ? "lock" : "download"} size={16} /> <span>{!user ? "Sign in to download" : "Download MP3"}</span></button></div>
          {!user && <div className="download-hint"><Icon name="lock" size={13} /> Guest playback is enabled. <button type="button" onClick={() => { setAuthMode("signup"); setShowAuth(true); }}>Create a free account</button> to download MP3 and save history.</div>}
        </section>}

        <div className="bottom-proof-row"><div><span className="proof-icon"><Icon name="lock" size={15} /></span><span><strong>Private by design</strong><small>API keys stay server-side or in-session only</small></span></div><div><span className="proof-icon"><Icon name="audio" size={15} /></span><span><strong>Made for listening</strong><small>Natural AI voices and downloadable audio</small></span></div><div><span className="proof-icon"><Icon name="user" size={15} /></span><span><strong>Accessible by default</strong><small>Keyboard-friendly, clear controls</small></span></div></div>
      </section>

      <footer className="footer"><span>© {new Date().getFullYear()} <strong>EK Graphics</strong> · Developed by Emmanuel Nana Osei Kwarteng</span><span>EK Voice <span className="footer-dot">·</span> AI-generated speech</span></footer>
      <audio ref={previewAudioRef} className="visually-hidden-audio" onEnded={() => setPreviewLoading(false)} onError={() => setPreviewLoading(false)} />

      {showAuth && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAuth(false); }}><section className="modal-card auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" type="button" onClick={() => setShowAuth(false)} aria-label="Close sign-in dialog"><Icon name="x" size={18} /></button><div className="modal-brand-mark"><Icon name="audio" size={22} /></div><span className="eyebrow modal-eyebrow">EK VOICE ACCOUNT</span><h2 id="auth-title">{authMode === "signin" ? "Welcome back." : "Create your free account."}</h2><p>{authMode === "signin" ? "Sign in to download MP3s and access your saved conversions." : "Unlock longer text generations, downloads, and private audio history."}</p><form className="auth-form" onSubmit={signInOrUp}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} placeholder="At least 6 characters" autoComplete={authMode === "signin" ? "current-password" : "new-password"} /></label><button className="generate-button" type="submit" disabled={authLoading}>{authLoading ? <><span className="spinner" /> Please wait…</> : authMode === "signin" ? "Sign in" : "Create account"}</button></form>{authMessage && <p className="auth-message" role="status">{authMessage}</p>}<p className="auth-switch">{authMode === "signin" ? "New to EK Voice?" : "Already have an account?"} <button type="button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthMessage(""); }}>{authMode === "signin" ? "Create an account" : "Sign in"}</button></p><p className="modal-privacy">Authentication is provided by your configured Supabase project. EK Voice does not receive or store your password.</p></section></div>}

      {historyOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><section className="modal-card history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"><div className="history-modal-header"><div><span className="eyebrow modal-eyebrow">YOUR LIBRARY</span><h2 id="history-title">Conversion history</h2><p>Your recent speech files and source text.</p></div><button className="modal-close inline-close" type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"><Icon name="x" size={18} /></button></div>{historyLoading ? <div className="modal-loading"><span className="spinner" /> Loading your history…</div> : history.length === 0 ? <div className="empty-history"><span className="empty-history-icon"><Icon name="clock" size={24} /></span><strong>No saved conversions yet</strong><span>Your generated MP3s will appear here after you sign in.</span></div> : <div className="history-list">{history.map((item) => <article className="history-item" key={item.id}><div className="history-item-icon"><Icon name="audio" size={18} /></div><div className="history-item-main"><strong>{item.download_name}</strong><p>{new Date(item.created_at).toLocaleString()} · {item.character_count.toLocaleString()} characters</p><p className="history-text-preview">{item.input_text}</p></div>{item.download_url && <a className="history-download" href={item.download_url} download={item.download_name} target="_blank" rel="noreferrer" aria-label={`Download ${item.download_name}`}><Icon name="download" size={16} /></a>}</article>)}</div>}<div className="history-modal-footer"><span>Files are stored in your private account storage.</span><button className="secondary-button compact" type="button" onClick={() => void loadHistory()}><Icon name="clock" size={14} /> Refresh</button></div></section></div>}
    </main>
  );
}
