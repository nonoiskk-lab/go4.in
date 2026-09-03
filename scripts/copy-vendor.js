// Copies the ffmpeg.wasm browser bundle from node_modules into public/vendor
// so the app can load it same-origin (no external CDN dependency at runtime).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const copies = [
  { from: '@ffmpeg/ffmpeg/dist/esm', to: 'public/vendor/ffmpeg', filter: (f) => f.endsWith('.js') },
  { from: '@ffmpeg/util/dist/esm', to: 'public/vendor/util', filter: (f) => f.endsWith('.js') },
  { from: '@ffmpeg/core/dist/esm', to: 'public/vendor/core', filter: (f) => f.endsWith('.js') || f.endsWith('.wasm') },
];

for (const { from, to, filter } of copies) {
  const srcDir = path.join(ROOT, 'node_modules', from);
  const destDir = path.join(ROOT, to);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    if (!filter(file)) continue;
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log(`copied ${from} -> ${to}`);
}
