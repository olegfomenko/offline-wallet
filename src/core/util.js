// Small byte helpers shared by the core modules. Nothing here touches the DOM.
import { hex as HEX, base64 as B64, utf8 as UTF8 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

export const hex = {
  encode: (b) => HEX.encode(b),
  decode: (s) => HEX.decode(String(s).trim().toLowerCase()),
};
export const base64 = {
  encode: (b) => B64.encode(b),
  decode: (s) => B64.decode(String(s).replace(/\s+/g, '')),
};
export const utf8 = { encode: (s) => UTF8.decode(s), decode: (b) => UTF8.encode(b) };

export const isHex = (s) => /^([0-9a-fA-F]{2})*$/.test(s);

export function concat(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

export function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export const sha256d = (b) => sha256(sha256(b));
export const hash160 = (b) => ripemd160(sha256(b));

export function taggedHash(tag, ...msgs) {
  const t = sha256(utf8.encode(tag));
  return sha256(concat(t, t, ...msgs));
}

/** Cryptographically secure random bytes from the browser (or Node webcrypto in tests). */
export function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Uniform random integer in [0, n) without modulo bias. */
export function randomInt(n) {
  if (n <= 0 || n > 2 ** 32) throw new Error('randomInt range');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Best-effort zeroing of secret buffers. JS can't guarantee no copies remain, but it helps. */
export function wipe(...bufs) {
  for (const b of bufs) if (b && typeof b.fill === 'function') try { b.fill(0); } catch (e) { /* frozen */ }
}

export const u32be = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
export const readU32be = (b, o = 0) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export function fpHex(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bitcoin CompactSize (varint) encoding. */
export function varint(n) {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 255, n >> 8]);
  return new Uint8Array([0xfe, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
}
