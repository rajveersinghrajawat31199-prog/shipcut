import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RENDER_TIMEOUT_MS = 90_000;
const CLEANUP_DELAY_MS = 10 * 60 * 1000;
const TMP_ROOT = "/tmp/renders";

// This module is always run bundled as artifacts/api-server/dist/index.mjs
// (see build.mjs), so shipcut's public dir is two levels up and over --
// same convention as video-map.ts's SHIPCUT_PUBLIC_DIR.
const SHIPCUT_PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../shipcut/public",
);

const REQUIRED_ENV_VARS = [
  "HYPERFRAMES_BROWSER_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
  "HYPERFRAMES_FFMPEG_PATH",
] as const;

export interface RenderProgress {
  stage: string;
  pct: number;
}

// Matches the CLI's real progress-bar lines, e.g.
// "  ███████████████████░░░░░░  76%  Streaming frame 424/450"
// (Not the "Capturing frame N/TOTAL (X workers)" format that was assumed
// pre-integration -- the actual hyperframes CLI output was captured via a
// real render and this pattern was verified against it directly. See
// replit.md.)
const PROGRESS_LINE = /^[█░]+\s+(\d+)%\s+(.+?)\s*$/;

async function resolveHyperframesBin(): Promise<string> {
  // Resolve via the package's own package.json rather than a hardcoded
  // relative path, so it keeps working regardless of exactly how deep the
  // bundled dist output or pnpm's node_modules nesting is.
  const pkgJsonUrl = import.meta.resolve("hyperframes/package.json");
  const pkgDir = path.dirname(fileURLToPath(pkgJsonUrl));
  return path.join(pkgDir, "bin", "hyperframes.mjs");
}

function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Cannot render: missing required env var(s) ${missing.join(", ")}. ` +
        "HyperFrames needs an explicit browser + ffmpeg path on this NixOS environment " +
        "(auto-detection does not find Nix store paths).",
    );
  }
}

function scheduleCleanup(paths: string[]): void {
  setTimeout(() => {
    for (const p of paths) {
      void rm(p, { recursive: true, force: true }).catch(() => {
        // Best-effort -- a failed cleanup just leaves a stale temp/public
        // file behind, which is not worth crashing or logging loudly for.
      });
    }
  }, CLEANUP_DELAY_MS).unref();
}

/**
 * Renders a HyperFrames HTML composition to MP4 and yields progress as the
 * child process reports it. On success, the finished video is copied to
 * `artifacts/shipcut/public/renders/<id>.mp4` (served at `/renders/<id>.mp4`)
 * and both the temp render directory and that public copy are cleaned up
 * after 10 minutes. Throws on non-zero exit or if 90 seconds pass without
 * the process finishing (the child is killed either way).
 */
export async function* renderComposition(
  html: string,
  id: string,
): AsyncGenerator<RenderProgress, void, unknown> {
  assertRequiredEnv();

  const renderDir = path.join(TMP_ROOT, id);
  const outputFileName = `${id}.mp4`;
  const outputPath = path.join(renderDir, outputFileName);

  await mkdir(renderDir, { recursive: true });
  await writeFile(path.join(renderDir, "index.html"), html, "utf8");
  await writeFile(
    path.join(renderDir, "meta.json"),
    JSON.stringify({ id: "main", name: `shipcut-${id}` }),
    "utf8",
  );

  const hyperframesBin = await resolveHyperframesBin();

  // Queue of progress events, drained by the generator loop below. The
  // child's stdout/stderr callbacks push into it; `resolveNext`/pending
  // let the generator `await` new items without polling.
  const queue: RenderProgress[] = [];
  let pending: (() => void) | null = null;
  const push = (item: RenderProgress): void => {
    queue.push(item);
    if (pending) {
      const p = pending;
      pending = null;
      p();
    }
  };
  const waitForNext = (): Promise<void> =>
    new Promise((resolve) => {
      pending = resolve;
    });

  let stdoutTail = "";
  let stderrTail = "";
  const appendTail = (current: string, chunk: string): string =>
    (current + chunk).slice(-4000);

  const handleStream = (streamBuffer: { text: string }) => (chunk: Buffer) => {
    streamBuffer.text += chunk.toString("utf8");
    const lines = streamBuffer.text.split("\n");
    streamBuffer.text = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = PROGRESS_LINE.exec(line);
      if (match) {
        push({ stage: match[2], pct: Number(match[1]) });
      }
    }
  };

  const child = spawn(process.execPath, [hyperframesBin, "render", "--output", outputFileName], {
    cwd: renderDir,
    env: process.env,
    detached: true,
  });

  const stdoutBuffer = { text: "" };
  const stderrBuffer = { text: "" };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutTail = appendTail(stdoutTail, chunk.toString("utf8"));
    handleStream(stdoutBuffer)(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = appendTail(stderrTail, chunk.toString("utf8"));
    handleStream(stderrBuffer)(chunk);
  });

  let timedOut = false;
  let settled = false;
  let exitError: Error | null = null;

  const timer = setTimeout(() => {
    timedOut = true;
    // The child is spawned detached (its own process group leader) so a
    // hung render's browser/ffmpeg grandchildren -- which do not die just
    // because their parent does -- are killed too. See replit.md: renders
    // have been observed to hang past hyperframes' own internal timeouts
    // on malformed input, so an external hard timeout is load-bearing, not
    // a formality.
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, RENDER_TIMEOUT_MS);

  const exited = new Promise<void>((resolve) => {
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        exitError = new Error(`HyperFrames render timed out after ${RENDER_TIMEOUT_MS}ms`);
      } else if (code !== 0) {
        exitError = new Error(
          `HyperFrames render exited with code ${code}. stderr: ${stderrTail.slice(-1000)}`,
        );
      }
      if (pending) {
        const p = pending;
        pending = null;
        p();
      }
      resolve();
    });
    child.on("error", (err) => {
      settled = true;
      clearTimeout(timer);
      exitError = err;
      if (pending) {
        const p = pending;
        pending = null;
        p();
      }
      resolve();
    });
  });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (settled) break;
      await Promise.race([waitForNext(), exited]);
    }

    if (exitError) throw exitError;

    if (!existsSync(outputPath)) {
      throw new Error(
        `HyperFrames reported success but no output file was found at ${outputPath}. ` +
          `stdout: ${stdoutTail.slice(-500)}`,
      );
    }

    const publicRendersDir = path.join(SHIPCUT_PUBLIC_DIR, "renders");
    await mkdir(publicRendersDir, { recursive: true });
    const publicPath = path.join(publicRendersDir, outputFileName);
    await copyFile(outputPath, publicPath);

    scheduleCleanup([renderDir, publicPath]);
  } catch (err) {
    scheduleCleanup([renderDir]);
    throw err;
  }
}
