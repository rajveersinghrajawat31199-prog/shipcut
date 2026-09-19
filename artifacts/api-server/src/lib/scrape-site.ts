import * as cheerio from "cheerio";

export interface ScrapedSite {
  title: string;
  metaDescription: string;
  h1s: string[];
  ogImage: string;
}

const FETCH_TIMEOUT_MS = 5000;

function fallback(url: string): ScrapedSite {
  return { title: url, metaDescription: "", h1s: [], ogImage: "" };
}

/**
 * Fetches `url` and pulls basic brand signal out of the HTML: title, meta
 * description, the first few h1s, and the og:image. Any failure (timeout,
 * network error, non-2xx status) falls back to a minimal object built from
 * the URL alone so the pipeline can keep going instead of failing outright.
 */
export async function scrapeSite(url: string): Promise<ScrapedSite> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ShipcutBot/1.0; +https://shipcut.app)",
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $("title").first().text().trim();
    const metaDescription =
      $('meta[name="description"]').attr("content")?.trim() ?? "";
    const h1s = $("h1")
      .slice(0, 3)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((text) => text.length > 0);
    const ogImage = $('meta[property="og:image"]').attr("content")?.trim() ?? "";

    return { title, metaDescription, h1s, ogImage };
  } catch {
    return fallback(url);
  } finally {
    clearTimeout(timer);
  }
}
