# Shipcut

Shipcut turns a pasted website URL into an AI-generated product demo video: paste a link, watch a 5-agent analysis pipeline work through it live, then a composition author streams a HyperFrames composition. From there, two tiers can serve the final video: a curated Studio Tier file for hostnames with a pre-made video on disk (skips rendering entirely), or a live Fast Tier HyperFrames render for everything else (see Product below).

## Run & Operate

- `pnpm --filter @workspace/shipcut run dev` — run the Shipcut frontend (Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- No database. Claude access goes through Replit's Anthropic AI integration (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, auto-provisioned) — no personal `ANTHROPIC_API_KEY` needed, usage is billed to Replit credits.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (`artifacts/shipcut`), wouter routing, Tailwind
- API: Express 5 (`artifacts/api-server`)
- No database — this app has no persisted data model

## Where things live

- `artifacts/shipcut/src/pages/home.tsx` — landing page (URL input)
- `artifacts/shipcut/src/pages/generate.tsx` — live agent panel + video reveal
- `artifacts/shipcut/src/hooks/use-generation-stream.ts` — POST+fetch SSE client, consumes `{event,data}` envelopes (see Architecture decisions)
- `artifacts/shipcut/public/demo.mp4` — placeholder output video (ffmpeg-generated slate, ~5s) — served only as the fallback when a real render fails or times out (see Product below)
- `artifacts/shipcut/public/renders/` — destination for freshly-rendered per-request videos (`<requestId>.mp4`), written by `hyperframes-render.ts` and auto-deleted ~10 minutes later
- `artifacts/shipcut/public/videos/` — curated Studio Tier videos, one per hostname (e.g. `replit.com.mp4`, `razorpay.com.mp4`); when a hostname's file exists here, `generate.ts` serves it directly and skips the real render (see Product and `video-map.ts` below)
- `artifacts/api-server/src/routes/generate.ts` — real SSE pipeline (`POST /api/generate`): scrape → stream Claude (5-agent analysis) → parse agent tags → stream Claude again (composition authoring) → two-tier video resolution: serve a curated Studio Tier file if one exists on disk for the hostname (skip rendering), otherwise run the real HyperFrames render (falling back to the cached placeholder only if that render itself fails)
- `artifacts/api-server/src/lib/scrape-site.ts` — fetches a URL (5s timeout) and pulls title/metaDescription/h1s/ogImage via cheerio, with a fallback object on any failure
- `artifacts/api-server/src/lib/anthropic-client.ts` — configured Anthropic SDK client (Replit AI integration env vars)
- `artifacts/api-server/src/lib/agent-tag-parser.ts` — incremental parser turning Claude's tagged output into agent_start/agent_token/agent_done events (see Gotchas)
- `artifacts/api-server/src/lib/composition-generator.ts` — second Claude call that turns the scraped data + five agents' commentary into one real HyperFrames HTML composition (streamed token-by-token, same as the agent analysis call)
- `artifacts/api-server/src/lib/hyperframes-render.ts` — spawns the real `hyperframes` CLI on that composition HTML, streams real `[block-chars] pct% label` progress lines, copies the finished MP4 into `public/renders/`, and schedules its cleanup (see Gotchas for the required env vars and timeout)
- `artifacts/api-server/src/lib/video-map.ts` — hostname → video mapping, consulted twice per request: first right after composition to decide the curated-vs-fresh tier, then again as the fallback resolver if a real render fails (see Product)
- `artifacts/shipcut/public/logos/` — Shipcut wordmark SVGs: `shipcut-wordmark-ink.svg` (dark, for light backgrounds) and `shipcut-wordmark-paper.svg` (light, for dark backgrounds). Always rendered as an actual image, never retyped as text.
- `artifacts/shipcut/src/index.css` — brand design tokens (colors, fonts, easing) as CSS custom properties on `:root`, mapped into Tailwind v4's `@theme inline` block (see Architecture decisions — this project has no `tailwind.config.ts`)

## Architecture decisions

- Originally specified as a Next.js App Router app; this workspace only supports react-vite + a shared Express api-server as artifact types, so the same pages/design/behavior were rebuilt on that stack instead.
- `POST /api/generate` is a hand-written Express route, not part of the OpenAPI spec / Orval codegen pipeline — the generated React Query hooks model request/response JSON, not a streaming response. The frontend calls it directly with `fetch` at the absolute path `/api/generate` (not prefixed by the frontend's own base path, since api-server is a separate service fixed at `/api`).
- The endpoint runs a real pipeline per request: (1) scrape the URL with cheerio, emit `scrape_done`; (2) stream a single Claude (`claude-sonnet-5`) call with a 5-section tagged system prompt; (3) incrementally parse the tag stream into `agent_start`/`agent_token`/`agent_done` events per agent; (4) stream a second Claude call (`composition-generator.ts`) that turns the scraped data + all five agents' text into one HyperFrames HTML composition, emitting `composition_start`/`composition_token`/`composition_done`; (5) two-tier serving decision via `resolveVideoUrl()`: if a curated file exists on disk for this hostname, emit `render_start`/one `render_progress` at 100%/`render_done` and `done` with that file's URL and `{fresh:false, curated:true, fallback:false}` — no render is spawned; otherwise spawn the real `hyperframes` CLI (`hyperframes-render.ts`), emitting real `render_start`/`render_progress`/`render_done` as it reports progress, then `done` with the fresh render's URL and `{fresh:true, curated:false, fallback:false}`; if only that render step fails or times out, fall back to the hostname → video mapping and emit `done` with `{fresh:false, curated:false, fallback:true}` instead of failing the request (the real agent analysis and composition the user watched are unaffected either way). Every `done` event carries all three booleans explicitly. Every SSE frame is `{event, data}`.
- Only the render step (step 5) is wrapped in a try/catch that falls back instead of failing — a scrape failure, a Claude error, or a composition failure still fails the whole request via the outer catch and emits a generic `error` event. In practice this rarely triggers the fallback: `scrape-site.ts` already returns a fallback scraped object internally on fetch failure (5s timeout, bad domain, etc.) rather than throwing, so even a nonexistent hostname flows through Claude analysis and composition normally and typically still renders successfully — the fallback path is really "the render step itself broke" (missing env var, hyperframes crash, 90s timeout), not "the input URL was bad."
- Claude access uses Replit's Anthropic AI integration (`lib/anthropic-client.ts`), not a user-supplied key — provisioned via `setupReplitAIIntegrations`, billed to Replit credits. This was a deliberate substitution for the originally-specified "add ANTHROPIC_API_KEY to Replit secrets", per the platform rule to check for an integration before requesting any API key.
- This app has no database and no conversation persistence (one-shot generation per request), so only the Anthropic SDK client wrapper was adopted from the AI integration's setup flow — the integration's conversations/messages DB schema and OpenAPI codegen entries were deliberately skipped as unneeded for this product.
- This project's Tailwind is v4 with CSS-native config (no `tailwind.config.ts` file). New brand colors/fonts are added as CSS custom properties in `index.css`'s `:root` and mapped into the `@theme inline` block there, which is this stack's equivalent of adding color/font names to a `tailwind.config` file.

## Product

- `/` — paste a URL, hit Generate. Below the form, temporary "Try demo URL" chips (replit.com, razorpay.com) fill the input and submit for quick testing — remove before real launch.
- `/generate?url=...` — watch a 7-step pipeline light up one card at a time with live streamed text (blinking cursor while active, checkmark when done): the 5 agent cards, then a Composition Author card (streams the raw HTML it's writing, offers a "Download .html" button once done), then a Render card (real stage text + a filling progress bar), then the finished video.
- The full pipeline is real end to end: real scrape, real 5-agent Claude analysis, and a real second Claude call authoring a HyperFrames HTML composition happen for every request regardless of tier. What differs is the final video: hostnames with a curated file on disk (`replit.com`, `razorpay.com`) get that Studio Tier file served directly with no render spawned (`curated: true`); every other hostname gets a real HyperFrames render producing a fresh MP4 per request (`fresh: true`; still a fixed 15s runtime under the composition template's `data-duration='15'`, verified via `ffprobe`, though the UI copy no longer advertises a specific duration); only if that render step itself fails or times out does the response fall back to the cached `demo.mp4` placeholder (`fallback: true`). The generate page shows a matching tier disclosure line (Curated · Studio tier / Live · Fast tier · Generated from scratch / Using cached fallback) above the video.

## User preferences

- Brand identity (applied in a UI-only rebrand pass; do not adjust without checking with the user): a "print shop / film studio" identity, not the earlier "Linear x Vercel" look.
  - Colors (CSS vars in `index.css`, mapped to same-named Tailwind classes): `paper` #F3F0E8 (page bg, not white), `paper-deep` #E9E5DA, `fog` #D8D3C6 (hairline borders/dividers), `ink` #11110F (text), `graphite` #5B5A55 (muted text/labels), `tally` #D92E24 (primary accent — CTA, focus ring, active/in-progress state), `tally-deep` #A8231C (hover), `verdigris` #2E7D5B (done/ready state), `safelight` #B7791F, `slate-signal` #4C6A8A, `projection-room` #0C0C0B (dark surface, e.g. video letterbox background).
  - Fonts, loaded via a Google Fonts CDN `@import` in `index.css`: Instrument Serif (display headlines only, 48px+, e.g. the hero's italic "video"), Geist (body/UI), Geist Mono (status labels, timestamps, uppercase mono labels).
  - Motion: only `cubic-bezier(0.2, 0, 0, 1)` easing (Tailwind `ease-brand` utility); 120ms for hover/color changes, 240ms for state changes (e.g. the generate page's animated "playhead" bar, built with Framer Motion tracking each card's measured position rather than per-card CSS keyframes, to avoid fill-mode flicker). No scale transforms, no shadows, no bounce/spring.
  - Voice: no exclamation marks, no em dashes, none of {magic, wizard, effortless, seamless, supercharge, unlock, revolutionary, game-changing} in static UI copy. This governs hardcoded strings only — the agent cards stream live Claude-generated commentary from the pipeline's system prompt, which can still contain em dashes or other phrasing since it's model output, not app copy.
  - Logos: `artifacts/shipcut/public/logos/` (see Where things live). Prose always says "Shipcut", never "ShipCut"/"SHIPCUT" (uppercase mono labels are a styling exception, e.g. "SHIPCUT STUDIO / v0.1").

## Gotchas

- In the SSE route, connection-close detection must use `res.on("close", ...)`, not `req.on("close", ...)`. For a small JSON POST body, Node fires `req`'s "close" as soon as the request body finishes being read — almost immediately — which cancels the streaming interval right after it starts. `res`'s "close" correctly waits for the underlying connection to actually end. On real disconnect, also call `activeStream.abort()` on the in-flight Anthropic stream so a dropped client doesn't keep burning tokens.
- The API server's `dev` script is `build && start`, not a watcher — restart the `artifacts/api-server: API Server` workflow after editing its routes.
- Claude reliably emits each section's opening tag (e.g. `[BRAND_ANALYST]`) but not its closing tag — it chains straight into the next section's opening tag instead, and never closes the last section at all. `agent-tag-parser.ts` treats the next open tag (or, for the last agent, the end of the overall stream) as an implicit close; a parser that waits only for the literal `[/TAG]` will misattribute every later agent's text to whichever agent's close tag got skipped.
- The frontend shows one generic on-brand error message for any failure (scrape failure, mid-stream drop, server error) because the SSE `error` event and the fetch `catch` block carry a string but no failure-kind field. Distinguishing "that site couldn't be reached" from "the stream stopped" in the UI would need a new field on the SSE contract, not just a copy change.
- `hyperframes-render.ts` requires `HYPERFRAMES_BROWSER_PATH`, `PUPPETEER_EXECUTABLE_PATH`, and `HYPERFRAMES_FFMPEG_PATH` (all set to resolved Nix store binary paths) or it throws immediately — NixOS has no `/usr/lib`-style paths for the CLI's own browser/ffmpeg auto-detection to find. It also needs a hard external timeout (90s) with a detached, process-group `SIGKILL`: malformed input has been observed to hang the render past the CLI's own internal timeouts, and killing just the parent PID leaves its browser/ffmpeg children running.
- The `hyperframes` CLI's real progress output is `[block-chars] pct% label` lines on stdout/stderr (e.g. a bar of `█`/`░` characters, a percentage, then a stage label) — not the "Capturing frame N/TOTAL (X workers)" format that might be guessed from the package name; `hyperframes-render.ts`'s `PROGRESS_LINE` regex is matched against a real captured render, not assumed.
- If a testing/Playwright subagent reports a `<video>` failing to load or play (`NotSupportedError`, `readyState: 0`, `duration: NaN`), don't assume the served file is broken before checking server-side: `ffmpeg -i file -f null -` (decode check) and `curl` with/without a `Range` header against the real served URL, byte-compared to the file on disk. That browser's Chromium may simply lack an H.264 decoder — confirmed at least once by an unrelated, previously-shipped mp4 failing identically in the same test session.
- The `done` event's `fresh`/`curated`/`fallback` booleans are a mutually-exclusive discriminated triple, always sent all three explicitly (including the `false`s) — treat them that way on the frontend (one `if` per flag) rather than reintroducing a derived `!fresh` binary, which would conflate the curated and fallback cases.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
