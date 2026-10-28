import { NextRequest, NextResponse } from "next/server";
import { synthesizePreview, type TTSProvider } from "@/lib/providers";
import { checkRateLimit, hasSharedRateLimitStore, reserveMonthlyCharacters } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 40;

function getIp(request: NextRequest) {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !hasSharedRateLimitStore()) {
    return NextResponse.json({ error: "Secure rate limiting is not configured yet. Add Upstash Redis environment variables before enabling public speech generation." }, { status: 503 });
  }
  const ip = getIp(request);
  const rate = await checkRateLimit(`preview-ip:${ip}`, 10, 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many voice previews. Please wait a moment and try again." }, { status: 429 });
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const userRate = await checkRateLimit(`preview-user:${data.user.id}`, 20, 60);
      if (!userRate.allowed) return NextResponse.json({ error: "Your account has reached the voice-preview limit. Please try again shortly." }, { status: 429 });
    }
  }

  try {
    const body = await request.json() as { provider?: TTSProvider; voiceId?: string; languageCode?: string; speed?: number };
    const provider = body.provider;
    if (!provider || !["google", "openai", "elevenlabs"].includes(provider)) return NextResponse.json({ error: "Choose a valid voice engine." }, { status: 400 });
    const providerKey = request.headers.get("x-provider-key") || undefined;
    if (provider === "google") {
      const budget = await reserveMonthlyCharacters(100);
      if (!budget.allowed) return NextResponse.json({ error: budget.reason === "shared_store_required" ? "Configure Upstash Redis before enabling Google TTS in production." : "The app-level Google TTS monthly character budget has been reached." }, { status: 429 });
    }
    const audio = await synthesizePreview({
      provider,
      voiceId: String(body.voiceId || ""),
      languageCode: String(body.languageCode || "en-US"),
      speed: Number.isFinite(body.speed) ? Number(body.speed) : 1,
      providerKey,
    });
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "Content-Length": String(audio.byteLength) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice preview failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
