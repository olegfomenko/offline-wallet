// Browser I/O: QR rendering and decoding, webcam frames, clipboard, file downloads and reads.
import encodeQR from 'qr';
import decodeQR from 'qr/decode.js';
import { bytesOrBin } from '../core/encoding.js';

/** QR as a boolean matrix. Alphanumeric-friendly payloads (UR, BBQr, Base43) use uppercase. */
export function qrMatrix(text, { ecc = 'low', numeric = false } = {}) {
  const opts = { ecc, border: 2 };
  if (numeric) opts.encoding = 'numeric';
  return encodeQR(text, 'raw', opts);
}

export function qrSvgPath(m) {
  let d = '';
  for (let y = 0; y < m.length; y++) {
    const row = m[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w]) w++;
      d += 'M' + x + ' ' + y + 'h' + w + 'v1h-' + w + 'z';
      x += w;
    }
  }
  return d;
}

export function qrPngBlob(m, scale = 8) {
  const n = m.length;
  const c = document.createElement('canvas');
  c.width = c.height = n * scale;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) g.fillRect(x * scale, y * scale, scale, scale);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ---- clipboard ----
let clearTimer = null;
export async function copyText(text, { priv = false } = {}) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    t.value = ''; t.remove();
  }
  if (ok && priv) {
    // Browsers only allow clipboard writes while the page has focus, so if the timer fires while
    // you're in another window, clearing waits until you come back to this tab.
    clearTimeout(clearTimer);
    clearTimer = setTimeout(clearClipboard, 60000);
  }
  return ok;
}
let clearPending = false;
async function clearClipboard() {
  clearPending = true;
  try { await navigator.clipboard.writeText(''); clearPending = false; } catch (e) { /* retried on focus */ }
}
window.addEventListener('focus', () => { if (clearPending) clearClipboard(); });

export async function pasteText() {
  return navigator.clipboard.readText();
}

// ---- reading files ----
export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}
export async function fileBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

/** Binary QR payloads (e.g. Compact SeedQR) come back as "BIN:<hex>". */
export function decodeImageData(img) {
  try { return decodeQR({ width: img.width, height: img.height, data: img.data }, { textDecoder: bytesOrBin }); } catch (e) { return null; }
}

export async function decodeImageFile(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const res = decodeImageData(g.getImageData(0, 0, c.width, c.height));
  if (!res) throw new Error('No QR code found in that picture.');
  return res;
}

// ---- webcam ----
export async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser gives no webcam access here.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  return stream;
}
export function stopCamera(stream) { if (stream) for (const t of stream.getTracks()) t.stop(); }

/** Grab frames and decode; calls onText for every distinct QR string. Returns a stop function. */
export function scanLoop(video, onText) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  let stopped = false, last = '', busy = false;
  const tick = () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth) {
      busy = true;
      const s = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      c.width = Math.round(video.videoWidth * s); c.height = Math.round(video.videoHeight * s);
      g.drawImage(video, 0, 0, c.width, c.height);
      const r = decodeImageData(g.getImageData(0, 0, c.width, c.height));
      busy = false;
      if (r && r !== last) { last = r; try { onText(r); } catch (e) { /* keep scanning */ } }
    }
    setTimeout(tick, 60);
  };
  tick();
  return () => { stopped = true; };
}
