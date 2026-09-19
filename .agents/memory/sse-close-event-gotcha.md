---
name: SSE / streaming response - req vs res "close" event
description: Node/Express gotcha where listening on req.on("close") to detect client disconnect during a long-lived streaming response fires almost immediately, killing the stream after one write.
---

When implementing a long-lived streaming HTTP response (SSE, chunked progress updates, manual long-polling) in Express/Node, detect client disconnect with `res.on("close", ...)`, never `req.on("close", ...)`.

**Why:** For a request with a small body (e.g. a JSON POST), Node considers the *request* "closed" as soon as its body has been fully read — almost immediately, well before the response finishes. If stream teardown (e.g. `clearInterval` on a timer driving the response) is wired to `req`'s close event, it fires within milliseconds of the handler starting, silently killing the stream after only the first emitted chunk. The symptom is confusing: headers arrive fine, the first write reaches the client, and then nothing else ever arrives even though the underlying connection stays open until the client's own timeout — it looks like a network/buffering/proxy problem, not application code.

**How to apply:** Any handler that keeps writing to `res` after the handler function itself returns (setInterval-driven SSE, long-polling, manual chunked streaming) should listen on `res.on("close", ...)` for teardown/cleanup. Confirm the fix by checking that the interval/producer actually fires repeatedly (e.g. via server-side log lines with a tick counter) rather than only inspecting client-observed output, since client-side symptoms (one chunk then silence) look identical to several unrelated causes.
