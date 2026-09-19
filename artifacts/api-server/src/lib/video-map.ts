import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_BY_HOSTNAME: Readonly<Record<string, string>> = {
  "stripe.com": "/videos/stripe.mp4",
  "notion.so": "/videos/notion.mp4",
  "linear.app": "/videos/linear.mp4",
  "vercel.com": "/videos/vercel.mp4",
  "replit.com": "/videos/replit.com.mp4",
  "razorpay.com": "/videos/razorpay.com.mp4",
};

const DEFAULT_VIDEO = "/videos/generic.mp4";

// Falls back to this placeholder whenever the intended per-brand file
// hasn't been dropped into artifacts/shipcut/public/videos/ yet (see the
// README in that folder).
const PLACEHOLDER_VIDEO = "/demo.mp4";

// This module is always run bundled as artifacts/api-server/dist/index.mjs
// (see build.mjs), so shipcut's public dir is two levels up and over.
const SHIPCUT_PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../shipcut/public",
);

export interface VideoResolution {
  hostname: string;
  /** Where this hostname will point once real per-brand videos exist. */
  intendedPath: string;
  /** Where it points today: `intendedPath` if that file exists on disk, otherwise the placeholder. */
  videoUrl: string;
}

export function resolveVideoUrl(rawUrl: string): VideoResolution {
  let hostname = "";
  try {
    hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    hostname = "";
  }

  const intendedPath = VIDEO_BY_HOSTNAME[hostname] ?? DEFAULT_VIDEO;
  const existsOnDisk = existsSync(path.join(SHIPCUT_PUBLIC_DIR, intendedPath));
  const videoUrl = existsOnDisk ? intendedPath : PLACEHOLDER_VIDEO;

  return { hostname, intendedPath, videoUrl };
}
