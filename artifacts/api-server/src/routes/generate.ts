import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { anthropic } from "../lib/anthropic-client";
import { scrapeSite } from "../lib/scrape-site";
import { AgentTagStreamParser, type AgentDisplayName } from "../lib/agent-tag-parser";
import { resolveVideoUrl } from "../lib/video-map";
import { streamComposition } from "../lib/composition-generator";
import { renderComposition } from "../lib/hyperframes-render";

const router: IRouter = Router();

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4000;

// Verbatim per spec -- do not paraphrase.
const SYSTEM_PROMPT = `You are the orchestration engine for Shipcut, an AI video studio. A user has given you a website URL. Five specialist agents will collaborate to design a 30-second product demo video for that brand.

Output your response as five tagged sections, in order. Each section is written IN CHARACTER as that agent, in first person, present tense. Keep each section to 8-12 sentences with specific references to the scraped data. Be substantive — reference real observations from the scraped data.

[BRAND_ANALYST]
Analyze the brand: what does this product do, who is the customer, what is the visible personality (color/type/voice), what one word captures the brand.
[/BRAND_ANALYST]

[CREATIVE_DIRECTOR]
Propose the video's central angle in one sentence. Then name the emotional arc (setup → tension → payoff) and the single strongest proof point to show.
[/CREATIVE_DIRECTOR]

[STORYBOARD_ARTIST]
Outline exactly 5 scenes (5-7 seconds each). For each: scene number, visual description in one sentence, on-screen text if any.
[/STORYBOARD_ARTIST]

[MOTION_DESIGNER]
Describe the motion character: pacing (energetic / measured / cinematic), 2-3 signature moves (e.g., type-on, data count-up, UI reveal), and the palette + type stack you'd use.
[/MOTION_DESIGNER]

[CRITIC]
Review the concept for brand-safety and clarity. Name one specific improvement. End with either "APPROVED FOR PRODUCTION" or "REVISION NEEDED".
[/CRITIC]

Rules:
- No sparkle emojis, no marketing fluff.
- Reference the scraped brand data specifically.
- Speak as a professional studio, not a chatbot.
- Do not use exclamation marks. End sentences with periods.
- Do not use em dashes. Use periods or commas instead.
- Do not use these words: magic, wizard, effortless, seamless, supercharge, unlock, revolutionary, game-changing.`;

// Fixed emission order for the five agents -- matches agent-tag-parser.ts's
// internal sequence and use-generation-stream.ts's INITIAL_AGENTS.
const AGENT_ORDER: readonly AgentDisplayName[] = [
  "Brand Analyst",
  "Creative Director",
  "Storyboard Artist",
  "Motion Designer",
  "Critic",
];

function normalizeUrl(raw: string): string | null {
  try {
    return new URL(raw).toString();
  } catch {
    // allow bare domains like "stripe.com"
  }
  try {
    return new URL(`https://${raw}`).toString();
  } catch {
    return null;
  }
}

router.post("/generate", (req, res): void => {
  const body = req.body as { url?: unknown } | undefined;
  const rawUrl = body?.url;

  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const url = normalizeUrl(rawUrl.trim());
  if (!url) {
    res.status(400).json({ error: "url is not a valid URL" });
    return;
  }

  req.log.info({ url }, "Starting real generation pipeline");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let closed = false;
  let activeStream: ReturnType<typeof anthropic.messages.stream> | null = null;

  // NOTE: listen on `res` ("close" = connection actually torn down), not
  // `req` -- see replit.md Gotchas.
  res.on("close", () => {
    closed = true;
    activeStream?.abort();
  });

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
  };

  void (async () => {
    try {
      const scraped = await scrapeSite(url);
      send("scrape_done", scraped);
      if (closed) return;

      const parser = new AgentTagStreamParser();
      const userMessage = `Brand URL: ${url}\n\nScraped data:\n${JSON.stringify(scraped)}`;

      // Accumulated per-agent text, built up from the same agent_token
      // events sent to the client -- feeds the composition call below.
      const agentTexts: Record<AgentDisplayName, string> = {
        "Brand Analyst": "",
        "Creative Director": "",
        "Storyboard Artist": "",
        "Motion Designer": "",
        Critic: "",
      };
      const dispatch = (evt: { event: string; data: unknown }): void => {
        send(evt.event, evt.data);
        if (evt.event === "agent_token") {
          const { agent, token } = evt.data as { agent: AgentDisplayName; token: string };
          agentTexts[agent] += token;
        }
      };

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      activeStream = stream;

      stream.on("error", (err) => {
        req.log.error({ err }, "Anthropic stream error");
      });

      stream.on("text", (delta) => {
        for (const evt of parser.push(delta)) {
          dispatch(evt);
        }
      });

      await stream.finalMessage();

      if (!parser.allDone) {
        req.log.warn(
          { url },
          "Model output did not close all agent sections; finalizing remaining agents",
        );
        for (const evt of parser.finalize()) {
          dispatch(evt);
        }
      }

      if (closed) return;

      // Composition authoring: a second Claude call turns the scraped brand
      // data and the five agents' commentary into one real HyperFrames HTML
      // composition (see lib/composition-generator.ts).
      const requestId = randomUUID();
      const agentOutputs = AGENT_ORDER.map((name) => agentTexts[name]);

      send("composition_start", { agent: "Composition Author" });
      let compositionHtml = "";
      for await (const token of streamComposition(scraped, agentOutputs)) {
        if (closed) return;
        compositionHtml += token;
        send("composition_token", { agent: "Composition Author", token });
      }
      if (closed) return;
      send("composition_done", { agent: "Composition Author", html: compositionHtml });

      // Two-tier serving: if a curated Studio Tier video already exists for
      // this hostname, skip the real HyperFrames render entirely and serve
      // that file instead -- the 5-agent analysis and composition above are
      // still real Claude output either way.
      const videoResolution = resolveVideoUrl(url);
      const hasCuratedVideo = videoResolution.videoUrl !== "/demo.mp4";

      if (hasCuratedVideo) {
        req.log.info(
          { hostname: videoResolution.hostname, videoUrl: videoResolution.videoUrl },
          "Serving curated Studio Tier video; skipping HyperFrames render",
        );
        send("render_start", { agent: "Render" });
        send("render_progress", {
          agent: "Render",
          stage: "Serving curated Studio Tier output",
          pct: 100,
        });
        send("render_done", { agent: "Render" });
        send("done", {
          videoUrl: videoResolution.videoUrl,
          fresh: false,
          curated: true,
          fallback: false,
        });
        return;
      }

      // Render: spawn HyperFrames on the composition HTML and stream its
      // real progress. A failure or timeout here falls back to the cached
      // video-map result instead of failing the whole request -- the agent
      // analysis and composition the user just watched are still real.
      send("render_start", { agent: "Render" });
      try {
        for await (const progress of renderComposition(compositionHtml, requestId)) {
          if (closed) return;
          send("render_progress", { agent: "Render", stage: progress.stage, pct: progress.pct });
        }
        if (closed) return;

        const videoUrl = `/renders/${requestId}.mp4`;
        req.log.info({ requestId, videoUrl }, "HyperFrames render complete");
        send("render_done", { agent: "Render" });
        send("done", { videoUrl, fresh: true, curated: false, fallback: false });
      } catch (err) {
        req.log.error({ err, requestId }, "HyperFrames render failed; falling back to cached video");
        if (closed) return;

        const { hostname, intendedPath, videoUrl } = resolveVideoUrl(url);
        req.log.info({ hostname, intendedPath, videoUrl }, "Resolved fallback video");
        send("render_done", { agent: "Render" });
        send("done", { videoUrl, fresh: false, curated: false, fallback: true });
      }
    } catch (err) {
      req.log.error({ err }, "Generation pipeline failed");
      send("error", { message: "Generation failed. Please try again." });
    } finally {
      if (!closed) res.end();
    }
  })();
});

export default router;
