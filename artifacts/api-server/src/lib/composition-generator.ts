import { anthropic } from "./anthropic-client";
import type { ScrapedSite } from "./scrape-site";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 6000;

// Verbatim per spec -- do not paraphrase.
const SYSTEM_PROMPT = `You are a HyperFrames composition author. Output ONLY a complete valid
HTML file for a 15-second product demo video. No markdown fences. No
explanation before or after. Just the HTML.

Follow this exact template — replace the three headlines and only the
three headlines. Do not add new elements, do not change the structure,
do not change the timing, do not change the colors.

<!DOCTYPE html>
<html>
<head>
  <meta charset='UTF-8'>
  <script src='https://cdn.jsdelivr.net/npm/gsap@3.12/dist/gsap.min.js'></script>
</head>
<body style='margin:0;overflow:hidden;background:#F3F0E8;width:1920px;height:1080px;font-family:Georgia,serif;color:#11110F'>
  <div id='root' data-hf-id='root' data-composition-id='main' data-start='0' data-duration='15' data-width='1920' data-height='1080'>
    <div id='scene-1' data-hf-id='s1' class='clip' data-start='0' data-duration='5' data-width='1920' data-height='1080' style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:110px;font-style:italic;text-align:center;padding:0 120px;line-height:1.05'>
      SCENE_1_HEADLINE
    </div>
    <div id='scene-2' data-hf-id='s2' class='clip' data-start='5' data-duration='5' data-width='1920' data-height='1080' style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:220px;font-weight:700;text-align:center;color:#D92E24;letter-spacing:-0.02em'>
      SCENE_2_HEADLINE
    </div>
    <div id='scene-3' data-hf-id='s3' class='clip' data-start='10' data-duration='5' data-width='1920' data-height='1080' style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;text-align:center;padding:0 120px;line-height:1.1'>
      SCENE_3_HEADLINE
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo('#scene-1', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 0.3);
    tl.to('#scene-1', { opacity: 0, duration: 0.4 }, 4.5);
    tl.fromTo('#scene-2', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(2)' }, 5.3);
    tl.to('#scene-2', { opacity: 0, duration: 0.4 }, 9.5);
    tl.fromTo('#scene-3', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 10.3);
    window.__timelines['main'] = tl;
  </script>
</body>
</html>

Rules for the three headlines:
- SCENE_1_HEADLINE: a short editorial statement about the brand's core
  promise, 4-8 words. Use double quotes if a phrase.
- SCENE_2_HEADLINE: the single most striking number or claim you found
  in the scraped data, kept punchy (a stat, a scale figure, a %, etc.)
- SCENE_3_HEADLINE: a closing brand line or CTA, 3-6 words

Do not use exclamation marks. Do not use em dashes. Do not use the banned
words (magic, wizard, effortless, seamless, supercharge, unlock,
revolutionary, game-changing).

Output the HTML now. Nothing else.`;

/**
 * Streams the second Claude call that turns scraped brand data + the five
 * agents' finalized commentary into a complete HyperFrames HTML composition.
 * Yields text tokens as they arrive; the caller accumulates them (and/or
 * reads the final message) to get the full HTML.
 */
export async function* streamComposition(
  scrapedData: ScrapedSite,
  agentOutputs: string[],
): AsyncGenerator<string, void, unknown> {
  const userMessage = JSON.stringify({ scraped: scrapedData, analysis: agentOutputs });

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  // Surfaces stream-level errors (e.g. aborted mid-flight) to the caller.
  await stream.finalMessage();
}
