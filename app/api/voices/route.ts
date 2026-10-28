import { NextRequest, NextResponse } from "next/server";
import { listVoices, type TTSProvider } from "@/lib/providers";
import { checkRateLimit, hasSharedRateLimitStore } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const validProviders = new Set<TTSProvider>(["google", "openai", "elevenlabs"]);

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !hasSharedRateLimitStore()) {
    return NextResponse.json({ error: "Secure rate limiting is not configured yet. Add Upstash Redis before enabling public provider requests." }, { status: 503 });
  }
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimit = await checkRateLimit(`voices-ip:${ip}`, 30, 60);
  if (!ipLimit.allowed) return NextResponse.json({ error: "Too many voice-catalogue requests. Please wait a moment." }, { status: 429 });
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const userLimit = await checkRateLimit(`voices-user:${data.user.id}`, 60, 60);
      if (!userLimit.allowed) return NextResponse.json({ error: "Your account has made too many voice-catalogue requests." }, { status: 429 });
    }
  }
  const provider = (request.nextUrl.searchParams.get("provider") || "google") as TTSProvider;
  if (!validProviders.has(provider)) return NextResponse.json({ error: "Unsupported voice provider." }, { status: 400 });

  const providerKey = request.headers.get("x-provider-key") || undefined;
  try {
    const voices = await listVoices(provider, providerKey);
    return NextResponse.json({ voices }, { headers: { "Cache-Control": provider === "google" ? "public, s-maxage=3600, stale-while-revalidate=300" : "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load voices.";
    return NextResponse.json({ error: message, voices: [] }, { status: message.includes("not configured") || message.includes("Add your") ? 503 : 502 });
  }
}
