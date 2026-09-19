---
name: Headless Chrome tools on NixOS
description: Why puppeteer-based CLIs that auto-download their own Chrome build fail in Replit/NixOS, and how to fix it.
---

Tools built on puppeteer-core that manage their own browser download (e.g. `hyperframes` by heygen-com, and likely similar video-rendering/screenshot CLIs) fetch a generic prebuilt Linux Chrome/chrome-headless-shell binary built for a standard FHS (Ubuntu/Debian) filesystem layout. On NixOS/Replit that binary fails to launch with "missing shared libraries" (libnss3, libnspr4, libatk-1.0, libdbus-1, the libX* family, libgbm, libxkbcommon, libasound, libatspi, etc.) because there's no `/usr/lib` with those names — everything lives in the Nix store instead.

**Why:** NixOS binaries are built with library paths baked into RPATH at build time; generic downloaded binaries expect libraries to be discoverable via standard system paths that don't exist on NixOS.

**How to apply:**
1. Install `chromium` via `installSystemDependencies` (Nix's build is properly linked and runs standalone, e.g. `chromium --headless --version` works with no missing-library errors).
2. Do NOT assume the tool respects the standard `PUPPETEER_EXECUTABLE_PATH` env var — many tools with their own browser-management layer (own download cache, own CLI subcommands to manage it) call puppeteer-core's `launch()` with an explicit `executablePath`, which silently overrides/ignores that env var. Setting it has no effect and the tool will still try to download its own broken copy.
3. Grep the installed package's source/dist for the real override (e.g. `grep -rn "executablePath\|BROWSER_PATH\|CHROME_PATH" node_modules/<pkg>/dist/`). `hyperframes` specifically reads `HYPERFRAMES_BROWSER_PATH` or `PRODUCER_HEADLESS_SHELL_PATH` — not `PUPPETEER_EXECUTABLE_PATH` — via a `findFromEnv()` step in its browser-resolution chain (checked before its own cache/download logic). Its CLI `--help` and `doctor`/`browser` subcommands never mention this; it only surfaces by reading source.
4. Point that env var at the Nix chromium **wrapper** script path (e.g. `/nix/store/.../chromium-<version>/bin/chromium`), not the `-unwrapped` derivation's inner binary — the wrapper sets up sandboxing/library env correctly via its own RUNPATH/LD_LIBRARY_PATH.
5. This can disable tool-specific optimizations tied to its own bundled `chrome-headless-shell` build (e.g. hyperframes' BeginFrame-based fast capture falls back to slower screenshot-capture mode) — rendering still works, just not at that tool's fully-tuned performance path.
