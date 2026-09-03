import { FFmpeg } from './vendor/ffmpeg/index.js';
import { fetchFile } from './vendor/util/index.js';

window.addEventListener('error', (e) => {
  console.error('[watermark-remover] uncaught error', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[watermark-remover] unhandled rejection', e.reason);
});

const fileInput = document.getElementById('fileInput');
const uploadError = document.getElementById('uploadError');
const engineStatus = document.getElementById('engineStatus');

const stepUpload = document.getElementById('step-upload');
const stepSelect = document.getElementById('step-select');
const stepProgress = document.getElementById('step-progress');
const stepDone = document.getElementById('step-done');

const frameCanvas = document.getElementById('frameCanvas');
const frameCtx = frameCanvas.getContext('2d');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const processBtn = document.getElementById('processBtn');
const processError = document.getElementById('processError');

const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');

const resultVideo = document.getElementById('resultVideo');
const downloadLink = document.getElementById('downloadLink');
const restartBtn = document.getElementById('restartBtn');

let video = null; // { width, height, duration, file }
let boxes = []; // in natural video pixel coordinates {x,y,w,h}
let drawing = null;
let start = null;

let ffmpeg = null;
let ffmpegReady = null;

function getFfmpeg() {
  if (ffmpegReady) return ffmpegReady;
  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => console.debug('[ffmpeg]', message));
  engineStatus.textContent = 'Loading the video engine (first time only, ~30MB)…';
  ffmpegReady = ffmpeg
    .load({
      coreURL: new URL('./vendor/core/ffmpeg-core.js', document.baseURI).href,
      wasmURL: new URL('./vendor/core/ffmpeg-core.wasm', document.baseURI).href,
    })
    .then(() => {
      engineStatus.textContent = 'Video engine ready.';
    })
    .catch((e) => {
      engineStatus.textContent = '';
      uploadError.textContent = 'Could not load the video engine: ' + e.message;
      ffmpegReady = null;
      throw e;
    });
  return ffmpegReady;
}

// Start loading the engine as soon as the page opens, so it's ready by the
// time the user has picked a file and drawn their boxes.
getFfmpeg().catch(() => {});

function showStep(step) {
  for (const el of [stepUpload, stepSelect, stepProgress, stepDone]) {
    el.classList.toggle('hidden', el !== step);
  }
}

function scale() {
  return {
    sx: video.width / overlay.clientWidth,
    sy: video.height / overlay.clientHeight,
  };
}

function redraw() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#5b6bff';
  ctx.fillStyle = 'rgba(91,107,255,0.2)';

  const { sx, sy } = scale();
  for (const b of boxes) {
    const x = b.x / sx, y = b.y / sy, w = b.w / sx, h = b.h / sy;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  if (drawing) {
    ctx.strokeRect(drawing.x, drawing.y, drawing.w, drawing.h);
  }
}

function syncCanvasSize() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
  redraw();
}

fileInput.addEventListener('change', () => {
  uploadError.textContent = '';
  const file = fileInput.files[0];
  if (!file) return;

  uploadError.textContent = `Reading "${file.name}"…`;

  let settled = false;
  const objectUrl = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.muted = true;
  probe.playsInline = true;

  const fail = (msg) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    console.error('[watermark-remover]', msg, file.type, file.size);
    uploadError.textContent = msg;
    URL.revokeObjectURL(objectUrl);
    fileInput.value = '';
  };

  const timeoutId = setTimeout(() => {
    fail(
      "This video didn't load in 15s. Your browser may not support this file's " +
      `codec/container (type: "${file.type || 'unknown'}"). Try converting it to MP4 (H.264) first.`
    );
  }, 15000);

  probe.onerror = () => {
    const code = probe.error && probe.error.code;
    fail(
      `Could not read that video file (browser error code ${code || 'unknown'}). ` +
      "It may be an unsupported format/codec — try MP4 (H.264) or WebM."
    );
  };

  probe.onloadedmetadata = () => {
    const w = probe.videoWidth, h = probe.videoHeight;
    if (!w || !h) {
      fail("Could not read that video's resolution.");
      return;
    }
    probe.currentTime = Math.min(1, (probe.duration || 2) / 2) || 0;
  };

  probe.onseeked = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);

    frameCanvas.width = probe.videoWidth;
    frameCanvas.height = probe.videoHeight;
    frameCtx.drawImage(probe, 0, 0);

    video = {
      width: probe.videoWidth,
      height: probe.videoHeight,
      duration: probe.duration,
      file,
    };
    boxes = [];
    URL.revokeObjectURL(objectUrl);
    uploadError.textContent = '';
    syncCanvasSize();
    showStep(stepSelect);
  };

  probe.src = objectUrl;
});

window.addEventListener('resize', () => {
  if (!stepSelect.classList.contains('hidden')) syncCanvasSize();
});

function pointerPos(e) {
  const rect = overlay.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: Math.min(Math.max(clientX - rect.left, 0), overlay.clientWidth),
    y: Math.min(Math.max(clientY - rect.top, 0), overlay.clientHeight),
  };
}

function onDown(e) {
  start = pointerPos(e);
  drawing = { x: start.x, y: start.y, w: 0, h: 0 };
}

function onMove(e) {
  if (!start) return;
  const p = pointerPos(e);
  drawing = {
    x: Math.min(start.x, p.x),
    y: Math.min(start.y, p.y),
    w: Math.abs(p.x - start.x),
    h: Math.abs(p.y - start.y),
  };
  redraw();
}

function onUp() {
  if (drawing && drawing.w > 4 && drawing.h > 4) {
    const { sx, sy } = scale();
    boxes.push({
      x: Math.round(drawing.x * sx),
      y: Math.round(drawing.y * sy),
      w: Math.round(drawing.w * sx),
      h: Math.round(drawing.h * sy),
    });
  }
  drawing = null;
  start = null;
  redraw();
}

overlay.addEventListener('mousedown', onDown);
overlay.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
overlay.addEventListener('touchstart', onDown, { passive: true });
overlay.addEventListener('touchmove', onMove, { passive: true });
overlay.addEventListener('touchend', onUp);

undoBtn.addEventListener('click', () => {
  boxes.pop();
  redraw();
});

clearBtn.addEventListener('click', () => {
  boxes = [];
  redraw();
});

function buildFilter(regions, mode) {
  if (mode === 'blur') {
    let last = '0:v';
    const parts = [];
    regions.forEach((r, i) => {
      const bg = `bg${i}`, fg = `fg${i}`, blurred = `bl${i}`;
      const merged = i === regions.length - 1 ? 'vout' : `m${i}`;
      parts.push(`[${last}]split=2[${bg}][${fg}]`);
      parts.push(`[${fg}]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=18:6[${blurred}]`);
      parts.push(`[${bg}][${blurred}]overlay=${r.x}:${r.y}[${merged}]`);
      last = merged;
    });
    return { graph: parts.join(';'), outLabel: '[vout]' };
  }

  const chain = regions
    .map((r) => `delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:show=0`)
    .join(',');
  return { graph: `[0:v]${chain}[vout]`, outLabel: '[vout]' };
}

processBtn.addEventListener('click', async () => {
  processError.textContent = '';
  if (boxes.length === 0) {
    processError.textContent = 'Draw at least one box over the watermark first.';
    return;
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;

  try {
    processBtn.disabled = true;
    showStep(stepProgress);
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Loading video engine…';

    const engine = await getFfmpeg();
    void engine;

    const ext = (video.file.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0];
    const inputName = `input${ext}`;
    const outputName = 'output.mp4';

    const onProgress = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${pct}%`;
    };
    ffmpeg.on('progress', onProgress);

    progressLabel.textContent = 'Reading file…';
    await ffmpeg.writeFile(inputName, await fetchFile(video.file));

    const filter = buildFilter(boxes, mode);
    progressLabel.textContent = 'Processing…';
    await ffmpeg.exec([
      '-i', inputName,
      '-filter_complex', filter.graph,
      '-map', filter.outLabel,
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'copy',
      outputName,
    ]);

    ffmpeg.off('progress', onProgress);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    resultVideo.src = url;
    downloadLink.href = url;

    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    showStep(stepDone);
  } catch (e) {
    showStep(stepSelect);
    processError.textContent = 'Processing failed: ' + (e.message || e);
  } finally {
    processBtn.disabled = false;
  }
});

restartBtn.addEventListener('click', () => {
  if (resultVideo.src) URL.revokeObjectURL(resultVideo.src);
  video = null;
  boxes = [];
  fileInput.value = '';
  resultVideo.removeAttribute('src');
  showStep(stepUpload);
});
