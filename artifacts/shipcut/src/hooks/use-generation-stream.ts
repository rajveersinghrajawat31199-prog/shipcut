import { useState, useEffect, useRef } from 'react';

export type AgentName = 
  | "Brand Analyst" 
  | "Creative Director" 
  | "Storyboard Artist" 
  | "Motion Designer" 
  | "Critic";

export interface AgentState {
  name: AgentName;
  statusText: string;
  state: 'idle' | 'thinking' | 'done';
  timestamp?: string;
}

const INITIAL_AGENTS: AgentState[] = [
  { name: "Brand Analyst", statusText: "Standing by.", state: 'idle' },
  { name: "Creative Director", statusText: "Standing by.", state: 'idle' },
  { name: "Storyboard Artist", statusText: "Standing by.", state: 'idle' },
  { name: "Motion Designer", statusText: "Standing by.", state: 'idle' },
  { name: "Critic", statusText: "Standing by.", state: 'idle' }
];

function nowStamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export type RenderPhaseState = 'idle' | 'thinking' | 'done';

export function useGenerationStream(url: string | null) {
  const [agents, setAgents] = useState<AgentState[]>(INITIAL_AGENTS);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [curated, setCurated] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositionState, setCompositionState] = useState<RenderPhaseState>('idle');
  const [compositionText, setCompositionText] = useState('');
  const [renderState, setRenderState] = useState<RenderPhaseState>('idle');
  const [renderStage, setRenderStage] = useState('Standing by.');
  const [renderPct, setRenderPct] = useState(0);
  
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!url || fetchedRef.current) return;
    fetchedRef.current = true;

    const controller = new AbortController();

    const fetchStream = async () => {
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No readable stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          
          // Keep the last partial frame in the buffer
          buffer = frames.pop() || "";

          for (const frame of frames) {
            if (!frame.startsWith('data: ')) continue;
            
            const jsonStr = frame.replace(/^data:\s*/, '');
            if (!jsonStr.trim()) continue;

            const { event, data } = JSON.parse(jsonStr) as { event: string; data: any };

            switch (event) {
              case 'scrape_done': {
                // Scraped brand data isn't shown in this UI yet.
                break;
              }

              case 'agent_start': {
                const timestampStr = nowStamp();
                setAgents(prev => prev.map(a =>
                  a.name === data.agent
                    ? { ...a, state: 'thinking', statusText: '', timestamp: timestampStr }
                    : a
                ));
                break;
              }

              case 'agent_token': {
                setAgents(prev => prev.map(a =>
                  a.name === data.agent
                    ? { ...a, statusText: a.statusText + data.token }
                    : a
                ));
                break;
              }

              case 'agent_done': {
                setAgents(prev => prev.map(a =>
                  a.name === data.agent ? { ...a, state: 'done' } : a
                ));
                break;
              }

              case 'composition_start': {
                setCompositionState('thinking');
                setCompositionText('');
                break;
              }

              case 'composition_token': {
                if (typeof data?.token === 'string') {
                  setCompositionText(prev => prev + data.token);
                }
                break;
              }

              case 'composition_done': {
                setCompositionState('done');
                if (typeof data?.html === 'string') {
                  // Authoritative final text -- guards against any drift from
                  // accumulating composition_token deltas one by one.
                  setCompositionText(data.html);
                }
                break;
              }

              case 'render_start': {
                setRenderState('thinking');
                setRenderStage('Preparing render.');
                setRenderPct(0);
                break;
              }

              case 'render_progress': {
                if (typeof data?.stage === 'string') {
                  setRenderStage(data.stage);
                }
                if (typeof data?.pct === 'number') {
                  setRenderPct(data.pct);
                }
                break;
              }

              case 'render_done': {
                setRenderState('done');
                setRenderStage('Render complete.');
                setRenderPct(100);
                break;
              }

              case 'done': {
                setVideoUrl(data.videoUrl);
                setFresh(data.fresh === true);
                setCurated(data.curated === true);
                setFallback(data.fallback === true);
                setRenderState('done');
                // Defensive: ensure every card reads as done once the video is ready.
                setAgents(prev => prev.map(a => a.state === 'done' ? a : { ...a, state: 'done' }));
                setCompositionState(prev => prev === 'done' ? prev : 'done');
                break;
              }

              case 'error': {
                setError(typeof data?.message === 'string' ? data.message : 'Generation failed. Try again.');
                break;
              }

              default:
                break;
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setError('Something interrupted the generation. Try again.');
      }
    };

    fetchStream();

    return () => {
      controller.abort();
    };
  }, [url]);

  return {
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
  };
}
