const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, Job>} */
const jobs = new Map();

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function ffprobe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,r_frame_rate',
        '-of', 'json',
        filePath,
      ],
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const data = JSON.parse(stdout);
          const stream = data.streams && data.streams[0];
          if (!stream) return reject(new Error('No video stream found'));
          resolve({
            width: stream.width,
            height: stream.height,
            duration: parseFloat(stream.duration) || null,
          });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const id = newId();
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Only video files are allowed'));
    }
    cb(null, true);
  },
});

// 1. Upload a video, get back its id, resolution and a preview frame.
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video uploaded' });

    const uploadPath = req.file.path;
    const id = path.parse(req.file.filename).name;

    try {
      const info = await ffprobe(uploadPath);
      const previewPath = path.join(UPLOAD_DIR, `${id}.jpg`);
      await runFfmpeg([
        '-y', '-ss', String(Math.min(1, (info.duration || 2) / 2)),
        '-i', uploadPath,
        '-frames:v', '1',
        '-q:v', '3',
        previewPath,
      ]);

      jobs.set(id, {
        id,
        uploadPath,
        previewPath,
        width: info.width,
        height: info.height,
        duration: info.duration,
        status: 'uploaded',
        createdAt: Date.now(),
      });
      scheduleCleanup(id);

      res.json({ id, width: info.width, height: info.height, duration: info.duration });
    } catch (e) {
      fs.unlink(uploadPath, () => {});
      res.status(400).json({ error: 'Could not read that video: ' + e.message });
    }
  });
});

app.get('/api/preview/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.sendFile(job.previewPath);
});

// 2. Kick off processing: remove watermark region(s) from the full video.
app.post('/api/process', (req, res) => {
  const { id, regions, mode } = req.body || {};
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: 'Unknown job id (upload again)' });
  if (!Array.isArray(regions) || regions.length === 0) {
    return res.status(400).json({ error: 'At least one region is required' });
  }
  for (const r of regions) {
    if (
      [r.x, r.y, r.w, r.h].some((n) => !Number.isFinite(n) || n < 0) ||
      r.w < 4 || r.h < 4 ||
      r.x + r.w > job.width || r.y + r.h > job.height
    ) {
      return res.status(400).json({ error: 'Region is out of bounds' });
    }
  }
  if (job.status === 'processing') {
    return res.status(409).json({ error: 'This job is already processing' });
  }

  const outPath = path.join(OUTPUT_DIR, `${id}-out.mp4`);
  const filter = buildFilter(regions, mode === 'blur' ? 'blur' : 'delogo');

  job.status = 'processing';
  job.progress = 0;
  job.outputPath = outPath;

  const args = [
    '-y', '-i', job.uploadPath,
    '-filter_complex', filter.graph,
    '-map', filter.outLabel,
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'copy',
    '-progress', 'pipe:1', '-nostats',
    outPath,
  ];

  const proc = spawn('ffmpeg', args);
  job.proc = proc;

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/out_time_ms=(\d+)/g);
    if (m && job.duration) {
      const last = m[m.length - 1];
      const ms = parseInt(last.split('=')[1], 10);
      job.progress = Math.min(99, Math.round((ms / 1e6 / job.duration) * 100));
    }
    if (buf.length > 20000) buf = buf.slice(-2000);
  });

  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-4000);
  });

  proc.on('close', (code) => {
    job.proc = null;
    if (code === 0) {
      job.status = 'done';
      job.progress = 100;
    } else {
      job.status = 'error';
      job.error = 'ffmpeg failed: ' + stderr.split('\n').slice(-5).join(' ');
    }
  });

  res.json({ id, status: 'processing' });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown job id' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    error: job.error || null,
  });
});

app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).end();
  res.download(job.outputPath, `watermark-removed-${req.params.id}.mp4`);
});

function buildFilter(regions, mode) {
  if (mode === 'blur') {
    let last = '0:v';
    const parts = [];
    regions.forEach((r, i) => {
      const bg = `bg${i}`;
      const fg = `fg${i}`;
      const blurred = `bl${i}`;
      const merged = i === regions.length - 1 ? 'vout' : `m${i}`;
      parts.push(`[${last}]split=2[${bg}][${fg}]`);
      parts.push(`[${fg}]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=18:6[${blurred}]`);
      parts.push(`[${bg}][${blurred}]overlay=${r.x}:${r.y}[${merged}]`);
      last = merged;
    });
    return { graph: parts.join(';'), outLabel: '[vout]' };
  }

  // delogo: reconstructs the patch from surrounding pixels, better for static logos
  const chain = regions
    .map((r) => `delogo=x=${r.x}:y=${r.y}:w=${r.w}:h=${r.h}:show=0`)
    .join(',');
  return { graph: `[0:v]${chain}[vout]`, outLabel: '[vout]' };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function scheduleCleanup(id) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (!job) return;
    for (const p of [job.uploadPath, job.previewPath, job.outputPath]) {
      if (p) fs.unlink(p, () => {});
    }
    jobs.delete(id);
  }, JOB_TTL_MS);
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Watermark remover running on http://localhost:${PORT}`);
});
