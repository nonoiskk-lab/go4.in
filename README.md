# Video Watermark Remover

A watermark/logo remover that runs **entirely in the browser** — Android,
Windows, iOS, Mac. Choose a video, drag a box over the watermark, download the
cleaned-up result. No server, no upload, no install: the video never leaves the
device.

Use this only on videos you own or have the rights/permission to edit —
removing watermarks from footage you don't have rights to can violate copyright
or a platform's terms of service.

## What it does

FFmpeg is compiled to WebAssembly ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm))
and runs in a Web Worker in the page:

1. **Choose** — drop a video on the page or click to pick one. A preview frame
   is drawn to a `<canvas>` using the browser's own video decoder.
2. **Mark** — drag one or more boxes over the watermark on that frame.
3. **Remove** — the whole video is processed on-device with either:
   - `delogo` — reconstructs the boxed area from surrounding pixels (best for
     static logos/watermarks), or
   - a blur over the boxed area (better for busy/animated marks).
4. **Download** — preview and save the result.

It is also an installable PWA: `manifest.json` plus a service worker that
caches the app shell and the ~30MB ffmpeg-core bundle, so repeat visits are
instant and it works offline after the first load. Chrome/Edge show an
"Install app" button on both Android and Windows.

## Project layout

```
public/            the entire deployable app (static)
  index.html       app shell; loads app.js via dynamic import() so a failed
                   load surfaces a visible error instead of a dead page
  app.js           UI, box selection, and the ffmpeg.wasm pipeline
  style.css
  manifest.json    PWA manifest
  sw.js            service worker (cache-first for /vendor, network-first shell)
  icon.svg         single scalable icon: favicon, touch icon, manifest, brand
  vendor/          ffmpeg.wasm bundle — generated at build time, not committed
scripts/
  copy-vendor.js   copies the ffmpeg.wasm bundle from node_modules into public/vendor
  dev-server.js    zero-dependency static server for local testing
```

## Run locally

```bash
npm install
npm start          # builds public/vendor, serves on http://localhost:5173
```

## Deploy

It's a static site. Build, then serve `public/`:

```bash
npm install && npm run build   # populates public/vendor
# then deploy the public/ directory to any static host
```

On Vercel the settings are:

| Setting          | Value             |
| ---------------- | ----------------- |
| Framework preset | Other / None      |
| Install command  | `npm install`     |
| Build command    | `npm run build`   |
| Output directory | `public`          |

### If the deployed URL asks for a login or shows nothing

New Vercel projects often have **Deployment Protection** (Vercel
Authentication) enabled, which makes the URL return an auth wall to everyone
except the account owner. Turn it off under
**Project → Settings → Deployment Protection → Vercel Authentication → Disable**
to make the app publicly reachable.

## Notes / limitations

- First load downloads the ~30MB ffmpeg-core WebAssembly bundle; the service
  worker caches it afterwards.
- Best for videos under ~200MB — everything runs in browser memory, so very
  large files can be slow or run out of memory on phones.
- Best on watermarks that stay in one position for the whole clip. A watermark
  that moves or appears only part of the time would need the selection UI
  extended to vary by time range — not implemented.
- The preview frame relies on the browser being able to decode the input
  (H.264/VP9/AV1 are fine in Chrome; HEVC often is not). Processing itself is
  done by ffmpeg.wasm and is not limited by the browser's codec support.
- Output video is re-encoded with `libx264`; audio is copied through untouched.
