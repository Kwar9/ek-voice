# EK Voice — EK Graphics TTS

A mobile-first, full-screen text-to-speech application built with Next.js App Router, React, TypeScript, CSS design tokens, and server-side API routes. It does **not** use `window.speechSynthesis` or browser-native speech voices.

## Included

- Clean light/dark SaaS interface with responsive mobile controls.
- Google Cloud TTS Basic voice catalogue (Standard and WaveNet classes), dynamically loaded from the API.
- Optional OpenAI and ElevenLabs premium engines through Bring Your Own Key (BYOK).
- Fixed-sample voice previews, no auto-play, custom HTML5 audio controls, pause/resume/stop/seek/volume, and MP3 download naming.
- Sentence/word-boundary chunking for provider request-size limits; chunk audio bytes are combined into one playable MP3 response.
- Character counting, 5,000-character hard limit, 200-character guest limit, 2,000-character signed-in Basic limit, and up to 5,000 characters with a premium provider key.
- URL-to-article extraction with HTML cleanup, response-size limits, timeouts, public-host validation and redirect blocking to reduce SSRF risk.
- Client-side pronunciation replacement rules and supported Google SSML pause insertion.
- Guest draft autosave in `localStorage` (debounced); authenticated history in Supabase Postgres and a private Storage bucket.
- Per-IP/user rate limits and app-level monthly character cap using Upstash Redis.
- No payment gateway is included. The premium tier is a BYOK starter rather than a paid subscription system.

## Requirements

- Node.js 20.9 or newer (Node 22 recommended).
- A Google Cloud project with the Cloud Text-to-Speech API enabled and an API key restricted to that API.
- Upstash Redis REST credentials before a public production launch.
- Supabase project for accounts and saved history (optional during local testing, required for sign-in/history).
- OpenAI and/or ElevenLabs API key only if you want to test those BYOK options.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set `GOOGLE_TTS_API_KEY` to a key that has access to Cloud Text-to-Speech.
3. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The app fails closed for generation and URL extraction in production if the shared limiter is not configured. Local development uses an in-memory fallback only.
4. For accounts/history, configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then follow the Supabase setup below.
5. Run:

   ```bash
   npm install
   npm run dev
   ```

6. Open `http://localhost:3000`.

## Google Cloud TTS setup

1. Create/select a Google Cloud project and enable **Cloud Text-to-Speech API**.
2. Create an API key, restrict it to Cloud Text-to-Speech, and store it as `GOOGLE_TTS_API_KEY` in server-side environment variables. Never use a `NEXT_PUBLIC_` prefix for provider secrets.
3. The app filters the default Basic voice catalogue to Standard and WaveNet voice classes. Set `GOOGLE_MONTHLY_CHARACTER_CAP` to a conservative value (default `250000`). The same Google key is used for voice listing and speech requests.
4. Configure Google Cloud budget alerts, quota monitoring, and billing safeguards in the Google Cloud Console. A free allowance is not the same as a guaranteed zero bill: Google states that billing must be enabled and charges may apply after the free character allowance. Review the current pricing before launch: https://cloud.google.com/text-to-speech/pricing
5. Current Google TTS input content is limited to 5,000 bytes per request. EK Voice chunks the input below that size based on sentence/word boundaries. Review current quotas: https://docs.cloud.google.com/text-to-speech/quotas

## Upstash Redis setup

Create a Redis database in Upstash and copy the REST URL and token into environment variables. Redis stores per-minute request counters and an atomic monthly Google character counter. The production routes intentionally return a configuration error if the shared store is missing, because process-local limits are not reliable across serverless instances.

## Supabase Auth and history setup

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Create a **private** Storage bucket named `generated-audio` in Supabase Storage. Do not mark it public.
4. In Supabase Auth settings, configure allowed site URL and redirect URLs for local development and your deployed domain.
5. Redeploy. Authenticated audio is uploaded to the private bucket; only the path and conversion metadata are stored in Postgres. History API responses create time-limited signed URLs.

## Premium BYOK engines

The OpenAI and ElevenLabs keys are sent from the client to your own backend using the `x-provider-key` request header over HTTPS. They are not saved in local storage or written into conversion history. The server forwards the key to the chosen provider and does not intentionally log it. Do not paste a provider key into a deployment you do not trust. Configure strict hosting log policies and HTTPS before production.

The OpenAI integration currently uses the `/v1/audio/speech` workflow and defaults to `gpt-4o-mini-tts`. OpenAI's current docs say the `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` Speech API models are scheduled to shut down on **January 6, 2027**; review the current OpenAI migration guidance before that date if you enable this option: https://developers.openai.com/api/docs/guides/text-to-speech

## Deployment (Vercel or Netlify)

- Push this folder to a private or public Git repository you control.
- Import it as a Next.js project in Vercel or a compatible Next.js host.
- Add the environment variables in the host dashboard, never in committed files.
- Ensure the provider route duration budget is appropriate for sequential audio chunks. `app/api/tts/route.ts` declares `maxDuration = 60`; platform plan/runtime limits still apply.
- Configure Upstash before enabling public generation. Configure Supabase only if you need accounts and online history.
- Use the generated free deployment subdomain initially. Set `metadataBase` and a canonical domain later when a custom domain is chosen.
- Verify usage caps, rate limits, URL extraction, auth callbacks, and download behavior on the deployed domain before sharing it publicly.

## Website builder / embed component note

This project includes backend routes, secure credentials, URL extraction, rate limiting, authentication and private storage. **It cannot safely run as a single pasted HTML/JavaScript embed by itself.** Host this project as a standalone Next.js app first. You may embed/link the deployed app from a website builder. Never paste API keys into an HTML embed or browser JavaScript.

## Known scope / production checklist

- The UI and API route scaffold is complete, but this environment has not been given your real provider, Redis, or Supabase credentials. External generation, authentication, and online history will work only after those are configured.
- Browser drafts save locally only for guest users and do not include the BYOK key.
- The app uses a strict per-request guest and free-account cap but does not yet include subscription billing, a payment gateway, email transaction workflows, or a monetization ledger.
- Language auto-detection maps the five selected language families (English, French, Spanish, German and Mandarin Chinese). Regional languages such as Twi, Ewe and Ga need a voice/model that explicitly supports them.
- Standard/WaveNet provider outputs are returned as one concatenated MP3 stream after chunk synthesis; test long multi-chunk audio on your target browsers and provider voice set. If frame-perfect gapless stitching becomes a requirement, add an audio remux/transcode stage in a host that supports FFmpeg or a PCM-to-MP3 encoder.
- Google, OpenAI and ElevenLabs voice catalogues, prices, quotas and deprecation schedules change. Re-check vendor docs before launch.

## Branding

Header application name: **EK Voice** (by EK Graphics)

Footer copyright: **Developed by Emmanuel Nana Osei Kwarteng**
