import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';

// Temporary for testing the real generation pipeline -- see replit.md.
const DEMO_URLS = ['replit.com', 'razorpay.com'];

const LOGO_INK_SRC = `${import.meta.env.BASE_URL}logos/shipcut-wordmark-ink.svg`;

export default function Home() {
  const [url, setUrl] = useState('');
  const [, setLocation] = useLocation();

  useEffect(() => {
    document.title = 'Shipcut';
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', 'Paste a URL. Ship a product demo video, tuned to your brand.');
  }, []);

  const goToGenerate = (raw: string) => {
    if (!raw || !raw.trim()) return;

    let targetUrl = raw.trim();
    try {
      new URL(targetUrl);
    } catch {
      // Basic validation fallback
      if (targetUrl.includes('.')) {
        targetUrl = 'https://' + targetUrl;
      }
    }

    setLocation(`/generate?url=${encodeURIComponent(targetUrl)}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    goToGenerate(url);
  };

  const handleDemoChipClick = (demoUrl: string) => {
    setUrl(demoUrl);
    goToGenerate(demoUrl);
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-paper text-ink selection:bg-tally selection:text-white">
      {/* Header */}
      <header className="w-full">
        <div className="h-[60px] px-6 md:px-10 flex items-center justify-between">
          <img src={LOGO_INK_SRC} alt="Shipcut" width={140} className="h-auto w-[110px] md:w-[140px]" />
          <span className="font-mono text-xs uppercase tracking-[0.04em] text-graphite">
            Shipcut Studio / v0.1
          </span>
        </div>
        <div className="h-px w-full bg-fog" />
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center px-6">
        <div className="w-full max-w-3xl pt-[12vh] md:pt-[20vh] text-center">
          <h1 className="font-display text-[56px] md:text-[96px] leading-[1.05] tracking-[-0.025em] text-ink">
            Paste a URL. Ship a <em className="italic">video</em>.
          </h1>
          <p className="mt-6 font-sans text-lg text-graphite">
            Five specialist agents. One demo video, tuned to your brand. Under three minutes.
          </p>

          <form onSubmit={handleSubmit} className="mt-12 text-left">
            <input
              type="text"
              placeholder="https://your-product.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full h-[68px] px-6 py-5 rounded-[3px] border border-fog bg-paper font-sans text-lg text-ink placeholder:text-graphite outline-none focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-tally"
              data-testid="input-url"
            />
            <button
              type="submit"
              className="mt-3 w-full h-[68px] rounded-[3px] bg-tally text-white font-sans font-medium text-base hover:bg-tally-deep transition-colors duration-[120ms] ease-brand"
              data-testid="button-submit"
            >
              Generate →
            </button>
            <span
              className="mt-3 block text-center font-mono text-[11px] uppercase tracking-[0.04em] text-graphite"
              data-testid="text-live-generation-label"
            >
              Live generation · ~90 seconds per video
            </span>
          </form>

          <div className="mt-12">
            <span className="font-mono text-xs uppercase tracking-[0.04em] text-graphite">
              Try a demo
            </span>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {DEMO_URLS.map((demoUrl) => (
                <button
                  key={demoUrl}
                  type="button"
                  onClick={() => handleDemoChipClick(demoUrl)}
                  className="py-2 px-3.5 rounded-[2px] border border-fog bg-paper font-mono text-[13px] text-ink hover:border-ink transition-colors duration-[120ms] ease-brand"
                  data-testid={`chip-demo-${demoUrl}`}
                >
                  {demoUrl}
                </button>
              ))}
            </div>
            <span
              className="mt-4 block text-center font-mono text-[11px] uppercase tracking-[0.04em] text-graphite"
              data-testid="text-two-tiers-label"
            >
              Two tiers · Studio (curated) · Fast (live)
            </span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full">
        <div className="h-px w-full bg-fog" />
        <div className="px-6 md:px-10 py-4 flex flex-col sm:flex-row items-center justify-between gap-1 text-center sm:text-left">
          <span className="font-mono text-xs uppercase tracking-[0.04em] text-graphite">
            Made by a studio. Delivered in three minutes.
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.04em] text-graphite">
            5 agents · adaptive length · 1080p
          </span>
        </div>
        <div className="px-6 md:px-10 pb-4 text-center">
          <span
            className="font-mono text-xs uppercase tracking-[0.04em] text-graphite"
            data-testid="text-audience-positioning"
          >
            Made for SaaS, tech, and enterprise teams that ship.
          </span>
        </div>
      </footer>
    </div>
  );
}
