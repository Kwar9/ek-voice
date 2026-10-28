import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech, safeFileName, type TTSProvider } from "@/lib/providers";
import { checkRateLimit, hasSharedRateLimitStore, reserveMonthlyCharacters } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function getIp(request: NextRequest) {
  // On Vercel, x-real-ip is set by the trusted platform proxy.
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !hasSharedRateLimitStore()) {
    return NextResponse.json({ error: "Secure rate limiting is not configured yet. Add Upstash Redis environment variables before enabling public speech generation." }, { status: 503 });
  }

  let body: { provider?: TTSProvider; text?: string; originalText?: string; voiceId?: string; languageCode?: string; speed?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read. Please refresh and try again." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const originalText = typeof body.originalText === "string" ? body.originalText : text;
  const provider = body.provider;
  if (!provider || !["google", "openai", "elevenlabs"].includes(provider)) return NextResponse.json({ error: "Choose a valid voice engine." }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "Enter some text before generating speech." }, { status: 400 });
  if (text.length > 5000 || originalText.length > 5000) return NextResponse.json({ error: "This text is over the 5,000-character limit. Please shorten it and try again." }, { status: 413 });
  if (typeof body.voiceId !== "string" || body.voiceId.length > 180) return NextResponse.json({ error: "Select a valid voice." }, { status: 400 });

  const ip = getIp(request);
  const supabase = await getSupabaseServerClient();
  let userId: string | null = null;
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  }

  const ipLimit = await checkRateLimit(`tts-ip:${ip}`, userId ? 12 : 4, 60);
  if (!ipLimit.allowed) return NextResponse.json({ error: "You have reached the short-term generation limit. Please wait a minute and try again." }, { status: 429 });
  if (userId) {
    const userLimit = await checkRateLimit(`tts-user:${userId}`, 12, 60);
    if (!userLimit.allowed) return NextResponse.json({ error: "Your account has reached the short-term generation limit. Please try again shortly." }, { status: 429 });
  }

  const providerKey = request.headers.get("x-provider-key") || undefined;
  const isByok = (provider === "openai" || provider === "elevenlabs") && Boolean(providerKey?.trim());
  const allowedChars = !userId ? 200 : isByok ? 5000 : 2000;
  if (originalText.length > allowedChars) {
    return NextResponse.json({ error: !userId
      ? "Guest generations are limited to 200 characters. Sign in for a larger limit, or shorten this text to try EK Voice."
      : isByok ? "This text exceeds the 5,000-character app limit." : "Free-account generations are limited to 2,000 characters. Use your own premium provider key for up to 5,000 characters." }, { status: 413 });
  }
  if ((provider === "openai" || provider === "elevenlabs") && !providerKey?.trim()) {
    return NextResponse.json({ error: `Add your ${provider === "openai" ? "OpenAI" : "ElevenLabs"} API key in Voice engine settings. Your key is used for the request and is not saved by EK Voice.` }, { status: 400 });
  }

  if (provider === "google") {
    const reserve = await reserveMonthlyCharacters(text.length);
    if (!reserve.allowed) {
      const message = reserve.reason === "shared_store_required"
        ? "The shared monthly usage cap is not configured. Add Upstash Redis before enabling Google speech generation in production."
        : "EK Voice has reached its app-level monthly character budget for Google voices. Try again next month or use your own premium provider key.";
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  try {
    const audio = await synthesizeSpeech({
      provider,
      text,
      voiceId: body.voiceId,
      languageCode: String(body.languageCode || "en-US"),
      speed: Number.isFinite(body.speed) ? Number(body.speed) : 1,
      providerKey,
    }, request.signal);

    let historySaved = false;
    if (userId && supabase) {
      try {
        const fileName = safeFileName(originalText);
        const path = `${userId}/${randomUUID()}.mp3`;
        const upload = await supabase.storage.from("generated-audio").upload(path, audio, { contentType: "audio/mpeg", upsert: false });
        if (!upload.error) {
          const insert = await supabase.from("conversion_history").insert({
            user_id: userId,
            input_text: originalText,
            provider,
            voice_id: body.voiceId,
            language_code: String(body.languageCode || "en-US"),
            speed: Number.isFinite(body.speed) ? Number(body.speed) : 1,
            character_count: originalText.length,
            audio_path: path,
            download_name: fileName,
          });
          historySaved = !insert.error;
          if (insert.error) await supabase.storage.from("generated-audio").remove([path]);
        }
      } catch {
        // Audio delivery should still succeed if optional history storage is unavailable.
      }
    }

    const filename = safeFileName(originalText);
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store, private",
        "X-Audio-Filename": filename,
        "X-History-Saved": historySaved ? "true" : "false",
        "X-Usage-Characters": String(originalText.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech generation failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
