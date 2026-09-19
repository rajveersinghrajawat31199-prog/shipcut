---
name: Playwright testing browser cannot decode H.264/MP4
description: The testing-skill subagent's headless Chromium has no H.264 decoder, so any video playback check it runs (canPlayType, readyState, play()) fails even for known-good files. Don't mistake that for an app bug.
---

Confirmed directly: `document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"')` (and `avc1.4d0028`, `avc1.42E01E`) all returned `""` in the testing subagent's browser. A pre-existing, previously-shipped MP4 unrelated to the feature under test failed to load identically (`readyState: 0`, `duration: NaN`, `play()` never resolving/rejecting) — same symptom as the newly-added video, proving the browser itself, not either file, is the cause.

**Why:** that Chromium build has no proprietary H.264 decoder available (same family of issue as headless-chrome-nixos.md's missing-shared-libs problem, but a codec-licensing gap rather than a linking gap — open-source Chromium builds commonly ship without it).

**How to apply:** When a testing subagent reports a `<video>` failing to load/play (`NotSupportedError`, `readyState: 0`, `duration: NaN`), do not treat that alone as proof the served file or app code is broken. First check server-side, independent of any browser:
1. `ffmpeg -v error -i file.mp4 -f null -` — exit code 0 with no errors means the bitstream itself decodes cleanly.
2. `curl -D - -o /dev/null URL` and again with `-H "Range: bytes=0-"` against the actual served URL (through the real dev-domain/proxy, not just localhost) — confirm `Content-Length` matches the file's on-disk size, `206`/`Content-Range`/`Accept-Ranges` work, and a full download `cmp`s identical to the on-disk file.
3. If both check out, ask the tester to run the `canPlayType` check above and a control test against any older/known-shipped mp4 in the same app. If the control also fails, the failure is the test browser's codec support, not the app — report it as an environment limitation and suggest the user confirm playback in their own regular browser instead of iterating on the app code.
