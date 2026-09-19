---
name: LLM tag-stream parsing
description: Parsing tag-delimited streamed LLM output (e.g. [AGENT_NAME]...[/AGENT_NAME] sections) into structured events.
---

When a system prompt asks Claude (claude-sonnet-5) to output several tagged
sections in one response, the model reliably emits every opening tag
(`[SECTION_NAME]`) but is not reliable about emitting the matching closing
tag (`[/SECTION_NAME]`) -- observed consistently chaining straight from one
section's prose into the next section's opening tag instead, and never
closing the final section at all.

**Why:** a streaming parser that waits only for the literal closing tag will
silently swallow every subsequent section into the current one once a close
tag is skipped (their content and tag markup all get attributed to the first
section), and will hang forever on the last section since no closing tag
ever arrives.

**How to apply:** when parsing streamed tag-delimited sections, treat EITHER
the section's own closing tag OR the next section's opening tag as a valid
boundary (whichever appears first in the buffer) -- not just the closing
tag. For the last section, don't wait for a closing tag at all: finalize it
(flush remaining buffered text, mark done) once the overall model stream
ends, not once a tag is seen. Also strip leading whitespace at the start of
each section -- the model puts a newline right after the opening tag.
See artifacts/api-server/src/lib/agent-tag-parser.ts in the Shipcut project
for a working implementation of this pattern.
