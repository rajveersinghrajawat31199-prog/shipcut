---
name: Vite mid-session dependency optimization causes a transient "Invalid hook call"
description: A package imported for the first time mid-dev-session (e.g. adding framer-motion to a page while Vite is already running) can throw a one-time "Invalid hook call" / duplicate-React error right after Vite's automatic re-optimize + reload. Read this before chasing a hooks/React-duplication bug that appeared right after adding a new import.
---

## Symptom

Right after adding a new import from a package that was not previously used anywhere in the app (so it was never in Vite's dependency pre-bundle cache), the browser console logs:

- `✨ new dependencies optimized: <package>` then `✨ optimized dependencies changed. reloading` in the Vite client log
- Immediately followed by a React error: "Invalid hook call. Hooks can only be called inside of the body of a function component..." thrown from inside the newly-added package's component (e.g. `AnimatePresence` from framer-motion), sometimes tripping an error boundary.

This looks like a duplicate-React-instance bug or a Rules-of-Hooks violation in the new code, but the component code is correct.

## Cause

Vite's dependency pre-bundling only discovers a dependency the first time it's actually imported at runtime. Discovering one mid-session forces a stop-the-world re-optimize and a forced full reload, but the in-flight module graph can still be transiently inconsistent for that one reload (stale chunk referencing the pre-reload React instance) — a one-time artifact of hot discovery, not a real duplicate install.

**Why:** Cost time to diagnose because the error message and stack trace point at "duplicate React" / "broken rules of hooks", which sends you looking at the component code and the dedupe config first — both are fine.

## How to apply

If this error appears right after adding a new import and only right after the "optimized dependencies changed. reloading" log line: restart the dev server workflow (a cold start re-optimizes and caches the new dependency cleanly before any page ever loads) and re-check. Don't waste time auditing `resolve.dedupe`, node_modules for duplicate React copies, or the new component's hook usage until a clean-restart retry has actually failed too.
