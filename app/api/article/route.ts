import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import { checkRateLimit, hasSharedRateLimitStore } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 15;

function isPublicAddress(address: string) {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

async function validatePublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid article URL, including https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS article links are supported.");
  if (url.username || url.password) throw new Error("URLs containing usernames or passwords are not supported.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard HTTP/HTTPS ports are supported for article extraction.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") {
    throw new Error("That address is not available for article extraction.");
  }
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new Error("Private or local network addresses are not allowed.");
  } else {
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("The website address could not be resolved. Check the link and try again.");
    }
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new Error("This website does not resolve to a publicly accessible address.");
    }
  }
  url.hash = "";
  return url;
}

async function readLimited(response: Response, maxBytes: number) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("That webpage is too large to extract. Try a simpler article page.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("That webpage is too large to extract. Try a simpler article page.");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && !hasSharedRateLimitStore()) {
    return NextResponse.json({ error: "Secure rate limiting is not configured yet. Add Upstash Redis before enabling public URL extraction." }, { status: 503 });
  }
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rate = await checkRateLimit(`article:${ip}`, 8, 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many article requests. Please try again in a minute." }, { status: 429 });

  try {
    const body = await request.json() as { url?: string };
    if (typeof body.url !== "string" || body.url.length > 2048) return NextResponse.json({ error: "Paste a valid article URL (up to 2,048 characters)." }, { status: 400 });
    const url = await validatePublicUrl(body.url);
    const timeoutMs = Math.min(15000, Math.max(3000, Number(process.env.ARTICLE_FETCH_TIMEOUT_MS || 10000)));
    const response = await fetch(url, {
      headers: {
        "User-Agent": "EKVoiceArticleReader/1.0",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (response.status >= 300 && response.status < 400) return NextResponse.json({ error: "This link redirects to another page. Paste the final destination URL instead." }, { status: 400 });
    if (!response.ok) return NextResponse.json({ error: `The webpage could not be read (HTTP ${response.status}).` }, { status: 502 });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return NextResponse.json({ error: "That link does not appear to be an HTML article. Try the article webpage rather than a PDF or media file." }, { status: 415 });
    }
    const bytes = await readLimited(response, 2 * 1024 * 1024);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const $ = load(html);
    const title = ($("title").first().text() || $("h1").first().text() || url.hostname).trim().slice(0, 180);
    $("script, style, noscript, svg, nav, footer, header, aside, form, button, iframe, [aria-hidden='true'], [role='navigation'], [role='banner']").remove();
    const candidates = [$("article").text(), $("main").text(), $("[role='main']").text(), $("body").text()]
      .map((candidate) => candidate.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    let extracted = candidates[0] || "";
    extracted = extracted.replace(/https?:\/\/\S+/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (extracted.length < 100) return NextResponse.json({ error: "We could not find enough readable article text on this page. Copy the article text into EK Voice instead." }, { status: 422 });
    const truncated = extracted.length > 5000;
    extracted = extracted.slice(0, 5000);
    return NextResponse.json({ title, text: extracted, truncated, source: url.origin + url.pathname });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Article extraction failed. Try pasting the text directly.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
