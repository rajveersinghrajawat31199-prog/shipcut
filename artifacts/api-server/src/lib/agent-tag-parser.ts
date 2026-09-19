export type AgentDisplayName =
  | "Brand Analyst"
  | "Creative Director"
  | "Storyboard Artist"
  | "Motion Designer"
  | "Critic";

export type AgentStreamEvent =
  | { event: "agent_start"; data: { agent: AgentDisplayName } }
  | { event: "agent_token"; data: { agent: AgentDisplayName; token: string } }
  | { event: "agent_done"; data: { agent: AgentDisplayName } };

const AGENT_SEQUENCE: ReadonlyArray<{ tag: string; displayName: AgentDisplayName }> = [
  { tag: "BRAND_ANALYST", displayName: "Brand Analyst" },
  { tag: "CREATIVE_DIRECTOR", displayName: "Creative Director" },
  { tag: "STORYBOARD_ARTIST", displayName: "Storyboard Artist" },
  { tag: "MOTION_DESIGNER", displayName: "Motion Designer" },
  { tag: "CRITIC", displayName: "Critic" },
];

/** Longest suffix of `text` that is also a prefix of `needle` (and shorter
 * than `needle` itself) -- i.e. how much of `text`'s tail could still grow
 * into `needle` once more characters arrive. Used to avoid emitting a tag
 * fragment as content when it was simply split across two stream chunks. */
function longestPartialSuffixMatch(text: string, needle: string): number {
  const max = Math.min(text.length, needle.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(needle.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Incrementally parses Claude's raw text stream for the
 * `[AGENT_TAG]...[/AGENT_TAG]` sections described in the system prompt,
 * turning them into agent_start / agent_token / agent_done events as the
 * tags are recognized -- tolerant of tags landing anywhere across chunk
 * boundaries, since streamed deltas don't align with tag text.
 */
export class AgentTagStreamParser {
  private buffer = "";
  private agentIndex = 0;
  private waitingForOpenTag = true;
  // The model always opens a section with "\n" right after the tag; skip
  // that leading whitespace so cards don't start with a blank line.
  private atSectionStart = false;
  private readonly started = new Set<AgentDisplayName>();
  private readonly done = new Set<AgentDisplayName>();

  private emitToken(agent: AgentDisplayName, raw: string, events: AgentStreamEvent[]): void {
    let text = raw;
    if (this.atSectionStart) {
      text = text.replace(/^\s+/, "");
      if (text.length === 0) return;
      this.atSectionStart = false;
    }
    events.push({ event: "agent_token", data: { agent, token: text } });
  }

  push(delta: string): AgentStreamEvent[] {
    this.buffer += delta;
    const events: AgentStreamEvent[] = [];

    for (;;) {
      const current = AGENT_SEQUENCE[this.agentIndex];
      if (!current) break;

      if (this.waitingForOpenTag) {
        const openTag = `[${current.tag}]`;
        const idx = this.buffer.indexOf(openTag);
        if (idx === -1) {
          const keep = longestPartialSuffixMatch(this.buffer, openTag);
          this.buffer = keep > 0 ? this.buffer.slice(-keep) : "";
          break;
        }
        this.buffer = this.buffer.slice(idx + openTag.length);
        this.started.add(current.displayName);
        events.push({ event: "agent_start", data: { agent: current.displayName } });
        this.waitingForOpenTag = false;
        this.atSectionStart = true;
        continue;
      }

      // In practice the model doesn't always bother emitting the closing
      // tag before starting the next section -- it just chains straight
      // into `[NEXT_TAG]`. Treat either the proper close tag or the next
      // agent's open tag (whichever comes first) as the section boundary,
      // so a skipped close tag doesn't swallow every agent after it.
      const closeTag = `[/${current.tag}]`;
      const next = AGENT_SEQUENCE[this.agentIndex + 1];
      const nextOpenTag = next ? `[${next.tag}]` : null;

      const closeIdx = this.buffer.indexOf(closeTag);
      const nextOpenIdx = nextOpenTag ? this.buffer.indexOf(nextOpenTag) : -1;

      const boundary =
        closeIdx === -1 && nextOpenIdx === -1
          ? null
          : closeIdx === -1
            ? { idx: nextOpenIdx, len: nextOpenTag!.length, viaNextOpen: true }
            : nextOpenIdx === -1
              ? { idx: closeIdx, len: closeTag.length, viaNextOpen: false }
              : closeIdx <= nextOpenIdx
                ? { idx: closeIdx, len: closeTag.length, viaNextOpen: false }
                : { idx: nextOpenIdx, len: nextOpenTag!.length, viaNextOpen: true };

      if (!boundary) {
        const unsafeTail = Math.max(
          longestPartialSuffixMatch(this.buffer, closeTag),
          nextOpenTag ? longestPartialSuffixMatch(this.buffer, nextOpenTag) : 0,
        );
        const safeLen = this.buffer.length - unsafeTail;
        if (safeLen > 0) {
          const token = this.buffer.slice(0, safeLen);
          this.buffer = this.buffer.slice(safeLen);
          this.emitToken(current.displayName, token, events);
        }
        break;
      }

      if (boundary.idx > 0) {
        this.emitToken(current.displayName, this.buffer.slice(0, boundary.idx), events);
      }
      this.buffer = this.buffer.slice(boundary.idx + boundary.len);
      this.done.add(current.displayName);
      events.push({ event: "agent_done", data: { agent: current.displayName } });
      this.agentIndex += 1;

      if (boundary.viaNextOpen && next) {
        this.started.add(next.displayName);
        events.push({ event: "agent_start", data: { agent: next.displayName } });
        this.waitingForOpenTag = false;
        this.atSectionStart = true;
      } else {
        this.waitingForOpenTag = true;
      }
    }

    return events;
  }

  get allDone(): boolean {
    return this.done.size === AGENT_SEQUENCE.length;
  }

  /**
   * Force-completes any agent the model never properly closed (e.g. output
   * got cut off by max_tokens or deviated from the tag format). Call once
   * after the stream ends so the UI never hangs on a card that never
   * received its agent_done.
   */
  finalize(): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    for (let i = 0; i < AGENT_SEQUENCE.length; i++) {
      const { displayName } = AGENT_SEQUENCE[i];
      if (this.done.has(displayName)) continue;

      if (!this.started.has(displayName)) {
        events.push({ event: "agent_start", data: { agent: displayName } });
        this.started.add(displayName);
      } else if (i === this.agentIndex && this.buffer.length > 0) {
        // Flush text that was being withheld in case it grew into a tag --
        // the stream is over, so it's definitely real content now.
        this.emitToken(displayName, this.buffer, events);
        this.buffer = "";
      }

      events.push({ event: "agent_done", data: { agent: displayName } });
      this.done.add(displayName);
    }
    return events;
  }
}
