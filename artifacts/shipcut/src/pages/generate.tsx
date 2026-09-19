import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { useGenerationStream, type AgentState } from '@/hooks/use-generation-stream';

const LOGO_INK_SRC = `${import.meta.env.BASE_URL}logos/shipcut-wordmark-ink.svg`;
const BRAND_EASE = [0.2, 0, 0, 1] as const;

const STATUS_LABEL: Record<AgentState['state'], string> = {
  idle: 'Standby',
  thinking: 'In progress',
  done: 'Done',
};

const STATUS_COLOR: Record<AgentState['state'], string> = {
  idle: 'text-graphite',
  thinking: 'text-tally',
  done: 'text-verdigris',
};

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function hostnameOf(rawUrl: string | null): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return rawUrl;
  }
}

export default function Generate() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const urlParam = searchParams.get('url');
  const hostname = hostnameOf(urlParam);

  useEffect(() => {
    if (!urlParam) {
      setLocation('/');
    }
  }, [urlParam, setLocation]);

  const {
    agents,
    videoUrl,
    fresh,
    curated,
    fallback,
    error,
    compositionState,
    compositionText,
    renderState,
    renderStage,
    renderPct,
  } = useGenerationStream(urlParam);

  // Ticking elapsed-time counter. Stops once the run finishes or fails.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (videoUrl || error) return;
    const interval = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [videoUrl, error]);

  useEffect(() => {
    const label = videoUrl ? 'Ready' : 'Generating';
    document.title = hostname ? `${label} \u00b7 ${hostname} | Shipcut` : 'Shipcut';
  }, [videoUrl, hostname]);

  // The playhead: one bar, measured against the currently-active card and
  // animated to its new position -- never a per-card CSS keyframe, so there's
  // no fill-mode flicker when the active agent changes. Spans all 7 steps:
  // the 5 agent cards plus Composition Author and Render.
  const stepStates = [...agents.map((a) => a.state), compositionState, renderState];
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const activeIndex = stepStates.findIndex((s) => s === 'thinking');
  const [playhead, setPlayhead] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (activeIndex === -1) {
      setPlayhead(null);
      return;
    }
    const el = cardRefs.current[activeIndex];
    if (el) {
      setPlayhead({ top: el.offsetTop, height: el.offsetHeight });
    }
  }, [activeIndex, agents, compositionState, renderState]);

  if (!urlParam) return null;

  // Right-panel "contact sheet" only covers the 5 agent frames -- unchanged.
  const frameCount = agents.length;
  const frameTotal = String(frameCount).padStart(2, '0');

  // Left-panel cards now number 01/07 .. 07/07 (5 agents + Composition + Render).
  const TOTAL_STEPS = agents.length + 2;
  const stepTotal = String(TOTAL_STEPS).padStart(2, '0');
  const compositionStepLabel = String(agents.length + 1).padStart(2, '0');
  const renderStepLabel = String(agents.length + 2).padStart(2, '0');

  const downloadComposition = (): void => {
    const blob = new Blob([compositionText], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `shipcut-${hostname || 'composition'}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className="min-h-screen w-full bg-paper text-ink">
      {/* Header */}
      <header className="w-full">
        <div className="h-[60px] px-6 md:px-10 grid grid-cols-3 items-center">
          <img src={LOGO_INK_SRC} alt="Shipcut" width={100} className="h-auto w-[100px] justify-self-start" />
          <div className="justify-self-center flex items-center gap-3">
            <span
              className={`font-mono text-xs uppercase tracking-[0.04em] ${videoUrl ? 'text-verdigris' : 'text-graphite'}`}
              data-testid="text-generation-status"
            >
              {videoUrl ? 'Ready' : 'Generating'} · {hostname}
            </span>
            {!videoUrl && (
              <span
                className="font-mono text-[11px] uppercase tracking-[0.04em] text-graphite"
                data-testid="text-demo-mode-label"
              >
                Live · Generating from scratch
              </span>
            )}
          </div>
          <span className="justify-self-end font-mono text-xs text-ink tabular-nums" data-testid="text-elapsed">
            {formatElapsed(elapsedSec)}
          </span>
        </div>
        <div className="h-px w-full bg-fog" />
      </header>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 px-6 md:px-10 pt-12 pb-16 max-w-6xl mx-auto">
        {/* Left: agent panel */}
        <div className="lg:col-span-7">
          <div className="relative">
            <AnimatePresence>
              {playhead && (
                <motion.div
                  className="absolute left-0 w-[3px] bg-tally"
                  initial={false}
                  animate={{ top: playhead.top, height: playhead.height, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.24, ease: BRAND_EASE }}
                />
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-8">
              {agents.map((agent, i) => (
                <div
                  key={agent.name}
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  data-testid={`agent-card-${i}`}
                  className="border-t border-fog p-6"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-graphite">
                    {String(i + 1).padStart(2, '0')} / {stepTotal}
                  </span>
                  <h3 className="mt-1 font-sans font-medium text-[22px] text-ink">{agent.name}</h3>
                  <span
                    className={`mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] ${STATUS_COLOR[agent.state]}`}
                    data-testid={`status-${agent.name}`}
                  >
                    {STATUS_LABEL[agent.state]}
                  </span>
                  <p className="mt-3 font-sans text-[15px] leading-[1.55] text-ink whitespace-pre-wrap">
                    {agent.statusText}
                    {agent.state === 'thinking' && (
                      <span
                        className="inline-block w-[2px] h-[18px] align-text-bottom bg-tally ml-0.5 animate-blink-cursor"
                        data-testid={`cursor-${agent.name}`}
                      />
                    )}
                  </p>
                </div>
              ))}

              <div
                ref={(el) => {
                  cardRefs.current[agents.length] = el;
                }}
                className="border-t border-fog p-6"
                data-testid="composition-card"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-graphite">
                  {compositionStepLabel} / {stepTotal}
                </span>
                <h3 className="mt-1 font-sans font-medium text-[22px] text-ink">Composition Author</h3>
                <span
                  className={`mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] ${STATUS_COLOR[compositionState]}`}
                  data-testid="status-composition"
                >
                  {STATUS_LABEL[compositionState]}
                </span>
                <div
                  className="mt-3 max-h-[260px] overflow-y-auto rounded-[2px] border border-fog bg-paper-deep p-3"
                  data-testid="text-composition"
                >
                  <p className="font-mono text-[11px] leading-[1.5] text-ink whitespace-pre-wrap break-all">
                    {compositionText}
                    {compositionState === 'thinking' && (
                      <span
                        className="inline-block w-[2px] h-[12px] align-text-bottom bg-tally ml-0.5 animate-blink-cursor"
                        data-testid="cursor-composition"
                      />
                    )}
                  </p>
                </div>
                {compositionState === 'done' && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={downloadComposition}
                      className="font-mono text-[11px] uppercase tracking-[0.04em] text-tally border border-fog rounded-[2px] py-[6px] px-3 hover:border-ink transition-colors duration-[120ms] ease-brand"
                      data-testid="button-download-composition"
                    >
                      Download .html
                    </button>
                  </div>
                )}
              </div>

              <div
                ref={(el) => {
                  cardRefs.current[agents.length + 1] = el;
                }}
                className="border-t border-fog p-6"
                data-testid="render-card"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-graphite">
                  {renderStepLabel} / {stepTotal}
                </span>
                <h3 className="mt-1 font-sans font-medium text-[22px] text-ink">Render</h3>
                <span
                  className={`mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] ${STATUS_COLOR[renderState]}`}
                  data-testid="status-render"
                >
                  {STATUS_LABEL[renderState]}
                </span>
                <p className="mt-3 font-mono text-[14px] leading-[1.55] text-ink" data-testid="text-render-stage">
                  {renderStage}
                  {renderState === 'thinking' && (
                    <span
                      className="inline-block w-[2px] h-[14px] align-text-bottom bg-tally ml-1 animate-blink-cursor"
                      data-testid="cursor-render"
                    />
                  )}
                </p>
                <div className="mt-4 h-[2px] w-full bg-fog overflow-hidden rounded-full">
                  <motion.div
                    className="h-full bg-tally"
                    initial={false}
                    animate={{ width: `${renderPct}%` }}
                    transition={{ duration: 0.24, ease: BRAND_EASE }}
                    data-testid="render-progress-bar"
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-8 p-4 rounded-[3px] border border-tally-deep text-tally-deep font-mono text-sm" data-testid="text-error">
              {error}
            </div>
          )}
        </div>

        {/* Right: contact sheet + video */}
        <div className="lg:col-span-5">
          <div className="sticky top-24">
            <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-graphite">
              Frames 01–{frameTotal}
            </span>
            <div className="mt-3 flex flex-col gap-2">
              {agents.map((agent, i) => (
                <div
                  key={agent.name}
                  className="relative h-[100px] rounded-[2px] border border-fog bg-paper-deep"
                  data-testid={`frame-tile-${i}`}
                >
                  <span className="absolute top-2 left-2.5 font-mono text-sm text-ink">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {agent.state === 'done' && (
                    <svg
                      width="36"
                      height="36"
                      viewBox="0 0 36 36"
                      className="absolute top-1 right-1 -rotate-6"
                      aria-hidden="true"
                    >
                      <circle
                        cx="18"
                        cy="18"
                        r="14"
                        fill="none"
                        stroke="var(--tally)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="83 5"
                      />
                    </svg>
                  )}
                </div>
              ))}
            </div>

            {videoUrl && (
              <div className="mt-8">
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-verdigris">
                  Ready · 1080p
                </span>
                {curated && (
                  <span
                    className="mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] text-verdigris"
                    data-testid="text-tier-disclosure"
                  >
                    Curated · Studio tier
                  </span>
                )}
                {fresh && (
                  <span
                    className="mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] text-tally"
                    data-testid="text-tier-disclosure"
                  >
                    Live · Fast tier · Generated from scratch
                  </span>
                )}
                {fallback && (
                  <span
                    className="mt-1 block font-mono text-[11px] uppercase tracking-[0.04em] text-graphite"
                    data-testid="text-tier-disclosure"
                  >
                    Using cached fallback
                  </span>
                )}
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  muted
                  className="mt-3 w-full aspect-video rounded-[3px] border border-fog bg-projection-room"
                  data-testid="video-player"
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLocation('/')}
                    className="font-mono text-xs uppercase tracking-[0.04em] text-graphite hover:text-ink transition-colors duration-[120ms] ease-brand"
                    data-testid="button-create-another"
                  >
                    Create another →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
