# Demo videos

Drop demo videos here.

`artifacts/api-server/src/lib/video-map.ts` maps a brand's hostname to a
video file in this folder:

- `stripe.mp4` — stripe.com
- `notion.mp4` — notion.so
- `linear.mp4` — linear.app
- `vercel.mp4` — vercel.com
- `generic.mp4` — default, any other hostname

Until real per-brand renders are dropped here, every request serves the
placeholder at `artifacts/shipcut/public/demo.mp4` regardless of hostname --
the mapping logic above is already correct and ready to switch over.
