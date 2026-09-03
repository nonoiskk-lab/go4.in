(() => {
  const fileInput = document.getElementById('fileInput');
  const uploadError = document.getElementById('uploadError');

  const stepUpload = document.getElementById('step-upload');
  const stepSelect = document.getElementById('step-select');
  const stepProgress = document.getElementById('step-progress');
  const stepDone = document.getElementById('step-done');

  const previewImg = document.getElementById('previewImg');
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

  let job = null; // { id, width, height }
  let boxes = []; // in natural video pixel coordinates {x,y,w,h}
  let drawing = null; // in-progress box, in canvas display coordinates

  function showStep(step) {
    for (const el of [stepUpload, stepSelect, stepProgress, stepDone]) {
      el.classList.toggle('hidden', el !== step);
    }
  }

  function scale() {
    return {
      sx: job.width / overlay.clientWidth,
      sy: job.height / overlay.clientHeight,
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

  fileInput.addEventListener('change', async () => {
    uploadError.textContent = '';
    const file = fileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('video', file);

    try {
      fileInput.disabled = true;
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      job = { id: data.id, width: data.width, height: data.height, duration: data.duration };
      boxes = [];
      previewImg.src = `/api/preview/${job.id}?t=${Date.now()}`;
      previewImg.onload = () => {
        syncCanvasSize();
        showStep(stepSelect);
      };
    } catch (e) {
      uploadError.textContent = e.message;
    } finally {
      fileInput.disabled = false;
    }
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

  let start = null;

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

  processBtn.addEventListener('click', async () => {
    processError.textContent = '';
    if (boxes.length === 0) {
      processError.textContent = 'Draw at least one box over the watermark first.';
      return;
    }
    const mode = document.querySelector('input[name="mode"]:checked').value;

    try {
      processBtn.disabled = true;
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, regions: boxes, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start processing');

      showStep(stepProgress);
      pollStatus();
    } catch (e) {
      processError.textContent = e.message;
    } finally {
      processBtn.disabled = false;
    }
  });

  async function pollStatus() {
    try {
      const res = await fetch(`/api/status/${job.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status check failed');

      progressFill.style.width = `${data.progress}%`;
      progressLabel.textContent = `${data.progress}%`;

      if (data.status === 'done') {
        resultVideo.src = `/api/download/${job.id}`;
        downloadLink.href = `/api/download/${job.id}`;
        showStep(stepDone);
        return;
      }
      if (data.status === 'error') {
        showStep(stepSelect);
        processError.textContent = data.error || 'Processing failed';
        return;
      }
      setTimeout(pollStatus, 1000);
    } catch (e) {
      showStep(stepSelect);
      processError.textContent = e.message;
    }
  }

  restartBtn.addEventListener('click', () => {
    job = null;
    boxes = [];
    fileInput.value = '';
    resultVideo.src = '';
    showStep(stepUpload);
  });
})();
