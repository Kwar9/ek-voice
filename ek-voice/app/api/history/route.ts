import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "History requires Supabase configuration." }, { status: 503 });
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ error: "Sign in to view your saved history." }, { status: 401 });

  const { data, error } = await supabase
    .from("conversion_history")
    .select("id,input_text,provider,voice_id,language_code,speed,character_count,audio_path,download_name,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: "Could not load history. Check the Supabase database setup." }, { status: 502 });

  const entries = await Promise.all((data ?? []).map(async (row) => {
    const signed = row.audio_path
      ? await supabase.storage.from("generated-audio").createSignedUrl(row.audio_path, 60 * 60, { download: row.download_name })
      : { data: null, error: null };
    return { ...row, download_url: signed.data?.signedUrl ?? null };
  }));
  return NextResponse.json({ history: entries }, { headers: { "Cache-Control": "no-store" } });
}
