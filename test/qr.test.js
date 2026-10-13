// QR round trips: what the export sheet draws must decode back to the same bytes.
import { test } from 'node:test';
import { expect } from './expect.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import encodeQR from 'qr';
import decodeQR from 'qr/decode.js';
import { psbtQRFrames, MultiPartCollector, classify, classifyPayload } from '../src/core/transport.js';
import { seedQREncode, seedQRDecode } from '../src/core/wallet.js';
import { hex } from '../src/core/util.js';

function toImage(text, opts = {}) {
  const m = encodeQR(text, 'raw', { ecc: 'low', border: 2, ...opts });
  const scale = 4, n = m.length, w = n * scale;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const v = m[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
    const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { width: w, height: w, data };
}
const scan = (text, opts) => decodeQR(toImage(text, opts));

const psbt = new Uint8Array(readFileSync(join(import.meta.dirname, 'data/sample-clean.psbt')));
const big = new Uint8Array(readFileSync(join(import.meta.dirname, 'data/1in100out.psbt')));

for (const fmt of ['Base64', 'Base43', 'BBQr', 'UR']) {
  test('PSBT QR round trip · ' + fmt, () => {
    for (const bytes of [psbt, big]) {
      const q = psbtQRFrames(bytes, fmt);
      if (fmt === 'Base64' || fmt === 'Base43') {
        if (bytes === big) continue; // single QR formats are for small PSBTs
        const r = classify(scan(q.frames[0]));
        expect(r.kind).toBe('psbt');
        expect(hex.encode(r.bytes)).toBe(hex.encode(bytes));
        continue;
      }
      const col = new MultiPartCollector();
      let res, guard = 0;
      const frames = q.frames || [];
      while ((!res || res.status !== 'done') && guard++ < 500) {
        const f = q.next ? q.next() : frames[guard % frames.length];
        res = col.receive(scan(f));
        if (res.status === 'single') res = { status: 'done', payload: null, single: f };
      }
      const r = res.payload ? classifyPayload(res.payload) : classify(scan(res.single));
      expect(r.kind).toBe('psbt');
      expect(hex.encode(r.bytes)).toBe(hex.encode(bytes));
    }
  });
}

test('SeedQR (numeric mode) round trip', () => {
  const words = 'orbit canvas lunar ripple timber absorb velvet gravity harvest mosquito pledge salmon'.split(' ');
  expect(seedQRDecode(scan(seedQREncode(words), { encoding: 'numeric' }))).toEqual(words);
});

test('Text to QR: long text as BBQr, UR and numbered parts decodes back unchanged', async () => {
  const { textQRFrames } = await import('../src/core/transport.js');
  const { cbor } = await import('../src/core/ur.js');
  const { utf8 } = await import('../src/core/util.js');
  // Spaces at part edges, Cyrillic and an emoji: all must survive every format.
  const text = 'Привет, мир! Bitcoin ₿ 😀 · '.repeat(200) + 'end  ';
  // BBQr, file type U (UTF-8 text)
  let m = textQRFrames(text, 'bbqr');
  expect(m.frames.length).toBeGreaterThan(1);
  expect(m.frames[0].slice(0, 4)).toBe('B$2U');
  let c = new MultiPartCollector(), r;
  for (const f of m.frames) r = c.receive(f);
  expect(r.status).toBe('done');
  expect(r.payload.bbqr.fileType).toBe('U');
  expect(new TextDecoder().decode(r.payload.bbqr.bytes)).toBe(text);
  // UR "bytes", fountain-coded: the original parts are enough
  m = textQRFrames(text, 'ur');
  c = new MultiPartCollector();
  for (let k = 0; k < m.seqLen; k++) r = c.receive(m.next());
  expect(r.status).toBe('done');
  expect(r.payload.ur.type).toBe('bytes');
  expect(new TextDecoder().decode(cbor.readBytes(r.payload.ur.cbor, 0).value)).toBe(text);
  // Numbered pMofN parts
  m = textQRFrames(text, 'split');
  c = new MultiPartCollector();
  for (const f of m.frames) r = c.receive(f);
  expect(r.status).toBe('done');
  expect(r.payload.text).toBe(text);
  // Every frame fits one QR even at the highest error correction
  for (const mode of ['bbqr', 'split']) for (const f of textQRFrames(text, mode).frames) encodeQR(f, 'raw', { ecc: 'high' });
  expect(utf8.encode(text).length).toBeGreaterThan(2953);
});
