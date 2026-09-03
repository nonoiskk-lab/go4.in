# Video Watermark Remover

A small self-hosted web app: upload a video, draw a box over a watermark/logo
on the preview frame, and download the video with that area removed
(reconstructed from surrounding pixels) or blurred out.

Use this only on videos you own or have the rights/permission to edit —
removing watermarks from footage you don't have rights to can violate
copyright or a platform's terms of service.

## Requirements

- Node.js 18+
- `ffmpeg` and `ffprobe` on the `PATH` (e.g. `apt install ffmpeg` / `brew install ffmpeg`)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

## How it works

1. **Upload** — the video is saved server-side and a preview frame is
   extracted with `ffprobe`/`ffmpeg`.
2. **Select** — you drag one or more boxes over the watermark on the preview
   image; box coordinates are scaled to the video's native resolution.
3. **Process** — the server runs `ffmpeg` over the whole video with either:
   - `delogo` — reconstructs the boxed area from the surrounding pixels
     (best for static logos/watermarks), or
   - a blur filter over the boxed area (fallback for busy/animated
     watermarks where reconstruction looks worse than a blur).
4. **Download** — once ffmpeg finishes, the result is available for preview
   and download. Uploaded and processed files are deleted automatically an
   hour after upload.

## Notes / limitations

- Works best on watermarks that stay in a fixed position for the whole clip.
  For a watermark that moves or only appears part of the time, you'd need to
  extend the region selection UI to vary by time range — not implemented here.
- Video is re-encoded with `libx264`; audio is copied without re-encoding.
- There's no auth or persistence — this is meant to run as a single-user
  local/self-hosted tool, not a public multi-tenant service as-is.
