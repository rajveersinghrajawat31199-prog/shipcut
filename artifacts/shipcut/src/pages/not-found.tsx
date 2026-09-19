export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-paper text-ink px-6">
      <div className="max-w-md w-full text-center">
        <p className="font-mono text-xs uppercase tracking-[0.04em] text-graphite">Frame not found</p>
        <h1 className="mt-3 font-display text-5xl text-ink">404</h1>
        <p className="mt-4 text-sm text-graphite">
          This page does not exist. Check the URL or head back to the start.
        </p>
      </div>
    </div>
  );
}
