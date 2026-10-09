// How transactions travel between this signer and online wallets: text encodings, single and
// animated QR formats, and detection of whatever was scanned, pasted or loaded.
import { base32 } from '@scure/base';
import { Inflate } from 'fflate';
import { URDecoder, psbtFromURcbor, psbtToURparts } from './ur.js';
import { hex, base64, isHex, utf8, concat } from './util.js';
import { decodeAddress } from './hd.js';

export const PSBT_MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);
export const isPsbtBytes = (b) => b && b.length > 5 && PSBT_MAGIC.every((x, i) => b[i] === x);

// Electrum's Base43 (used for its single static QR).
const B43_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
// Base-X with leading-zero handling exactly like Electrum's base_encode/base_decode.
function baseX(ALPHA) {
  const B = BigInt(ALPHA.length);
  return {
    encode(bytes) {
      let n = 0n;
      for (const b of bytes) n = (n << 8n) | BigInt(b);
      let s = '';
      while (n > 0n) { s = ALPHA[Number(n % B)] + s; n /= B; }
      let z = 0;
      while (z < bytes.length && bytes[z] === 0) z++;
      return ALPHA[0].repeat(z) + s;
    },
    decode(str) {
      let n = 0n;
      for (const ch of str) {
        const v = ALPHA.indexOf(ch);
        if (v < 0) throw new Error('Invalid character');
        n = n * B + BigInt(v);
      }
      const out = [];
      while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
      let z = 0;
      while (z < str.length && str[z] === ALPHA[0]) z++;
      return new Uint8Array([...new Array(z).fill(0), ...out]);
    },
  };
}
export const base43 = baseX(B43_ALPHABET);

// ---- BBQr (Coinkite) ----
const B36 = (n) => n.toString(36).toUpperCase().padStart(2, '0');
export function bbqrSplit(bytes, fileType = 'P', { maxChars = 1000 } = {}) {
  // Base32 without padding ("2"); every part except the last carries a multiple of 5 bytes.
  const header = 6 + 2;
  const perBytes = Math.max(5, Math.floor(((maxChars - header) / 8)) * 5);
  const count = Math.ceil(bytes.length / perBytes);
  if (count > 1295) throw new Error('Too large for BBQr');
  const parts = [];
  for (let i = 0; i < count; i++) {
    const chunk = bytes.subarray(i * perBytes, (i + 1) * perBytes);
    parts.push('B$2' + fileType + B36(count) + B36(i) + base32.encode(chunk).replace(/=+$/, ''));
  }
  return parts;
}

export class BBQrDecoder {
  constructor() { this.parts = new Map(); this.meta = null; this.result = null; }
  receive(s) {
    const t = String(s).trim();
    const m = /^B\$([H2Z])([A-Z])([0-9A-Z]{2})([0-9A-Z]{2})([0-9A-Z]*)$/.exec(t);
    if (!m) return false;
    const [, enc, ft, totS, idxS, body] = m;
    const total = parseInt(totS, 36), idx = parseInt(idxS, 36);
    if (!total || idx >= total) return false;
    if (enc === 'H' ? body.length % 2 : /[^A-Z2-7]/.test(body)) return false;
    if (this.meta && (this.meta.enc !== enc || this.meta.ft !== ft || this.meta.total !== total)) return false;
    this.meta = { enc, ft, total };
    if (!this.parts.has(idx)) this.parts.set(idx, body);
    if (this.parts.size === total) {
      try { this.finish(); } catch (e) { this.parts.clear(); this.meta = null; throw new Error('BBQr: the parts don’t decode (' + e.message + ').'); }
    }
    return true;
  }
  finish() {
    const { enc, ft, total } = this.meta;
    const chunks = [];
    for (let i = 0; i < total; i++) {
      const b = this.parts.get(i);
      if (enc === 'H') chunks.push(hex.decode(b));
      else chunks.push(base32.decode(b + '='.repeat((8 - (b.length % 8)) % 8)));
    }
    let data = concat(...chunks);
    if (enc === 'Z') data = inflateLimited(data, 8 * 1024 * 1024);
    this.result = { fileType: ft, bytes: data };
  }
  get done() { return !!this.result; }
  progress() { return this.meta ? this.parts.size / this.meta.total : 0; }
  counts() { return { got: this.parts.size, total: this.meta ? this.meta.total : 0 }; }
}

/** Raw-inflate with an output cap, so a tiny "zip bomb" can't exhaust memory. */
function inflateLimited(data, limit) {
  const chunks = [];
  let total = 0;
  const inf = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new Error('decompressed data too large');
    chunks.push(chunk);
  });
  inf.push(data, true);
  return concat(...chunks);
}

// ---- pMofN (Specter) ----
export class PMofNDecoder {
  constructor() { this.parts = new Map(); this.total = 0; this.result = null; }
  receive(s) {
    const m = /^p(\d+)of(\d+)\s+(\S+)$/.exec(String(s).trim());
    if (!m) return false;
    const i = +m[1], n = +m[2];
    if (!n || i < 1 || i > n || (this.total && this.total !== n)) return false;
    this.total = n;
    this.parts.set(i, m[3]);
    if (this.parts.size === n) {
      const joined = Array.from({ length: n }, (_, k) => this.parts.get(k + 1)).join('');
      this.result = { text: joined };
    }
    return true;
  }
  get done() { return !!this.result; }
  progress() { return this.total ? this.parts.size / this.total : 0; }
  counts() { return { got: this.parts.size, total: this.total }; }
}
export function pmofnSplit(text, size = 600) {
  const n = Math.ceil(text.length / size);
  if (n <= 1) return [text];
  return Array.from({ length: n }, (_, i) => 'p' + (i + 1) + 'of' + n + ' ' + text.slice(i * size, (i + 1) * size));
}

/**
 * Accumulates scanned QR frames (or pasted lines) of any animated format.
 * receive(text) → { status: 'partial'|'done'|'ignored'|'single', ... }
 */
export class MultiPartCollector {
  constructor() { this.dec = null; this.kind = null; }
  receive(text) {
    const t = String(text).trim();
    let kind = null;
    if (/^ur:/i.test(t) && /^ur:[^/]+\/\d+-\d+\//i.test(t)) kind = 'UR';
    else if (/^B\$/.test(t)) kind = 'BBQr';
    else if (/^p\d+of\d+\s/.test(t)) kind = 'pMofN';
    if (!kind) return { status: 'single' };
    if (this.kind && this.kind !== kind) return { status: 'ignored' };
    if (!this.dec) { this.kind = kind; this.dec = kind === 'UR' ? new URDecoder() : kind === 'BBQr' ? new BBQrDecoder() : new PMofNDecoder(); }
    const ok = this.dec.receive(t);
    if (!ok) return { status: 'ignored' };
    if (this.dec.done) return { status: 'done', kind, payload: this.payload() };
    return { status: 'partial', kind, ...this.dec.counts(), progress: this.dec.progress() };
  }
  payload() {
    if (this.kind === 'UR') return { kind: 'UR', ur: this.dec.result };
    if (this.kind === 'BBQr') return { kind: 'BBQr', bbqr: this.dec.result };
    return { kind: 'pMofN', text: this.dec.result.text };
  }
}

/** Collect all lines of a pasted/loaded text that look like animated parts. */
export function collectLines(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const c = new MultiPartCollector();
  let last = null;
  for (const l of lines) {
    const r = c.receive(l);
    if (r.status === 'single') return null;
    last = r;
  }
  return last;
}

/**
 * Classify what was read. `input` is a string or bytes (from a file).
 * Returns one of:
 *  { kind: 'psbt', bytes, format }      format: Base64 | Hex | Base43 | Binary | UR | BBQr | pMofN
 *  { kind: 'partial', format, got, total }
 *  { kind: 'bip21', raw, address, amount, label, message }
 *  { kind: 'address', raw, address }
 *  { kind: 'rawtx', raw }
 *  { kind: 'xpub', raw }
 *  { kind: 'unknown', raw, why }
 */
export function classify(input) {
  if (input instanceof Uint8Array) {
    if (isPsbtBytes(input)) return { kind: 'psbt', bytes: input, format: 'Binary' };
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch (e) { return { kind: 'unknown', raw: '(' + input.length + ' bytes of binary data)', why: 'binary' }; }
    return classify(text);
  }
  const raw = String(input);
  const t = raw.trim();
  if (!t) return { kind: 'empty', raw };
  const multi = collectLines(t);
  if (multi) {
    if (multi.status === 'done') return fromPayload(multi.payload, raw);
    if (multi.status === 'partial') return { kind: 'partial', raw, format: multi.kind, got: multi.got, total: multi.total };
  }
  const one = new MultiPartCollector().receive(t);
  if (one.status === 'done') return fromPayload(one.payload, raw);
  if (one.status === 'partial') return { kind: 'partial', raw, format: one.kind, got: one.got, total: one.total };
  if (/^ur:(crypto-psbt|psbt)\//i.test(t)) {
    const d = new URDecoder();
    if (d.receive(t) && d.done) return fromPayload({ kind: 'UR', ur: d.result }, raw);
  }
  const compact = t.replace(/\s+/g, '');
  if (/^cHNidP/.test(compact)) {
    try { const b = base64.decode(compact); if (isPsbtBytes(b)) return { kind: 'psbt', bytes: b, format: 'Base64' }; } catch (e) { /* fallthrough */ }
  }
  if (/^70736274ff/i.test(compact) && isHex(compact)) return { kind: 'psbt', bytes: hex.decode(compact), format: 'Hex' };
  if (/^[0-9A-Z$*+\-./:]+$/.test(compact) && compact.length > 20 && compact.length < 20000) {
    try { const b = base43.decode(compact); if (isPsbtBytes(b)) return { kind: 'psbt', bytes: b, format: 'Base43' }; } catch (e) { /* not base43 */ }
  }
  if (/^bitcoin:/i.test(t)) return parseBip21(t);
  if (/^0[12]000000/.test(compact) && isHex(compact) && compact.length > 100) return { kind: 'rawtx', raw: t };
  if (/^[xyztuv]pub[1-9A-HJ-NP-Za-km-z]{100,}$/.test(compact)) return { kind: 'xpub', raw: t };
  try { decodeAddress(t); return { kind: 'address', raw: t, address: t }; } catch (e) { /* no */ }
  return { kind: 'unknown', raw: t, why: 'unrecognized' };
}

/** Classify a completed multi-part payload from the scanner. */
export function classifyPayload(p) { return fromPayload(p, ''); }

function fromPayload(p, raw) {
  if (p.kind === 'UR') {
    if (p.ur.type === 'crypto-psbt' || p.ur.type === 'psbt') {
      const b = psbtFromURcbor(p.ur.cbor);
      if (isPsbtBytes(b)) return { kind: 'psbt', bytes: b, format: 'UR' };
    }
    return { kind: 'unknown', raw, why: 'UR type ' + p.ur.type + ' is not a transaction' };
  }
  if (p.kind === 'BBQr') {
    if (p.bbqr.fileType === 'P' && isPsbtBytes(p.bbqr.bytes)) return { kind: 'psbt', bytes: p.bbqr.bytes, format: 'BBQr' };
    if (p.bbqr.fileType === 'T') return { kind: 'rawtx', raw: hex.encode(p.bbqr.bytes) };
    if (p.bbqr.fileType === 'U' || p.bbqr.fileType === 'J') return classify(utf8.decode(p.bbqr.bytes));
    return { kind: 'unknown', raw, why: 'BBQr file type ' + p.bbqr.fileType };
  }
  const r = classify(p.text);
  if (r.kind === 'psbt') r.format = 'pMofN';
  return r;
}

export function parseBip21(t) {
  const m = /^bitcoin:([^?]*)(?:\?(.*))?$/i.exec(t.trim());
  let address = m ? m[1] : '';
  try { address = decodeURIComponent(address); } catch (e) { /* keep raw */ }
  const res = { kind: 'bip21', raw: t, address, amount: null, label: null, message: null };
  if (m && m[2]) {
    for (const kv of m[2].split('&')) {
      const [k, v = ''] = kv.split('=');
      let val;
      try { val = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { val = v; }
      if (k === 'amount') res.amount = val;
      else if (k === 'label') res.label = val;
      else if (k === 'message') res.message = val;
    }
  }
  return res;
}

// ---- Output encodings for a PSBT ----
export const QR_FORMATS = ['UR', 'BBQr', 'Base64', 'Base43'];
export function psbtQRFrames(bytes, format) {
  if (format === 'Base64') return { frames: [base64.encode(bytes)], animated: false };
  if (format === 'Base43') return { frames: [base43.encode(bytes)], animated: false, alnum: true };
  if (format === 'BBQr') {
    const parts = bbqrSplit(bytes, 'P');
    return { frames: parts, animated: parts.length > 1, alnum: true };
  }
  const enc = psbtToURparts(bytes, 250);
  if (enc.single) return { frames: [enc.next().toUpperCase()], animated: false, alnum: true };
  // Fountain codes: show every original part once, then keep emitting mixed parts.
  return { next: () => enc.next().toUpperCase(), seqLen: enc.seqLen, animated: true, alnum: true };
}
