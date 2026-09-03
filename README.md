# Video Watermark Remover

A watermark/logo remover that runs **entirely in the browser** — Android,
Windows, iOS, Mac, any device with a modern browser. Upload a video, draw a
box over the watermark on a preview frame, and download the cleaned-up
result. There is no server component: nothing is installed, nothing is
uploaded anywhere — the video never leaves your device.

Use this only on videos you own or have the rights/permission to edit —
removing watermarks from footage you don't have rights to can violate
copyright or a platform's terms of service.

## How it works

FFmpeg is compiled to WebAssembly ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm))
and runs inside a Web Worker in your browser tab:

1. **Choose a video** — a preview frame is drawn to a `<canvas>` client-side
   (via the browser's native `<video>` decoder), no processing yet.
2. **Mark the watermark** — drag one or more boxes over it on the preview.
3. **Remove** — the whole video is processed on-device with either:
   - `delogo` — reconstructs the boxed area from surrounding pixels (best
     for static logos/watermarks), or
   - a blur filter over the boxed area (fallback for busy/animated
     watermarks where reconstruction looks worse than a blur).
4. **Download** — preview and download the result once it's done.

## Project layout

- `public/` — the static site (`index.html`, `app.js`, `style.css`). This is
  the entire deployable app.
- `public/vendor/` — the ffmpeg.wasm browser bundle, generated at build time
  (not committed to git — see below).
- `scripts/copy-vendor.js` — copies the ffmpeg.wasm bundle from
  `node_modules` into `public/vendor` so the app can load it same-origin
  (no external CDN dependency at runtime, works offline after first load).
- `scripts/dev-server.js` — a tiny zero-dependency static file server for
  local testing.

## Run it locally

```bash
npm install
npm start
```

Then open http://localhost:5173.

## Deploy it (so it just works from any browser, any device)

This is a static site — deploy `public/` (after running `npm run build` to
populate `public/vendor/`) to any static host: Vercel, Netlify, GitHub
Pages, Cloudflare Pages, etc. Once deployed, opening the URL on Android,
Windows, or any other device's browser just works — no install, no backend
to keep running.

## Notes / limitations

- First load fetches the ~30MB ffmpeg-core WebAssembly bundle; after that
  the browser caches it.
- Best for videos under ~200MB — everything happens in the browser's memory,
  so very large files can be slow or run out of memory, especially on phones.
- Works best on watermarks that stay in a fixed position for the whole clip.
  A watermark that moves or only appears part of the time would need the
  region selection UI extended to vary by time range — not implemented here.
- Output video is re-encoded with `libx264`; audio is copied without
  re-encoding.
