// Settings → Tools: SHA-256 / SHA-512 and a secp256k1 point calculator. Pure functions, no DOM.
// All curve math is noble's (@noble/curves); this file only parses and formats.
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { concat } from './util.js';
import { decodeBytes, encodeBytes } from './encoding.js';

export { decodeBytes, encodeBytes };

export function digest(alg, bytes) {
  return alg === 'sha512' ? sha512(bytes) : sha256(bytes);
}

const Point = secp256k1.Point;
export const N = Point.Fn.ORDER;
export const G = Point.BASE;

const minLen = (n) => Math.max(1, Math.ceil(n.toString(16).length / 2));

/**
 * A number typed as decimal, hex (optional 0x) or Base64 (big-endian, no sign). Decimal and hex may
 * be negative. Returns a BigInt or null.
 */
export function parseNum(s, enc) {
  const v = String(s || '').trim().replace(/\s+/g, '');
  if (!v) return null;
  const neg = v[0] === '-' || v[0] === '−';
  const a = neg ? v.slice(1) : v;
  if (enc === 'dec') return /^\d+$/.test(a) ? (neg ? -BigInt(a) : BigInt(a)) : null;
  if (enc === 'hex') { const h = a.replace(/^0x/i, ''); return /^[0-9a-fA-F]+$/.test(h) ? (neg ? -1n : 1n) * BigInt('0x' + h) : null; }
  if (neg) return null;
  const b = decodeBytes(v, 'b64');
  return b && b.length ? bytesToNumberBE(b) : null;
}
/** Format a number like parseNum reads it. Base64 can't carry a sign, so negatives become n − |k|. */
export function formatNum(n, enc) {
  if (n < 0n) return enc === 'b64' ? formatNum(((n % N) + N) % N, enc) : '-' + formatNum(-n, enc);
  if (enc === 'dec') return n.toString(10);
  return encodeBytes(numberToBytesBE(n, minLen(n)), enc);
}
export const modN = (k) => ((k % N) + N) % N;

/** Bytes → { pt, kind } or { err }. Accepts 33-byte compressed, 65-byte uncompressed, 32-byte x-only (even y). */
export function parsePoint(b) {
  if (!b) return { err: 'Not valid encoding.' };
  try {
    if (b.length === 33 && (b[0] === 2 || b[0] === 3)) return { pt: Point.fromBytes(b), kind: 'compressed, 33 bytes' };
    if (b.length === 65 && b[0] === 4) return { pt: Point.fromBytes(b), kind: 'uncompressed, 65 bytes' };
    if (b.length === 32) return { pt: Point.fromBytes(concat(Uint8Array.of(2), b)), kind: 'x-only, 32 bytes · even y' };
  } catch (e) {
    return { err: b.length === 32 ? 'No point has this x.' : 'Not on the curve.' };
  }
  return { err: 'Expected 33 bytes (02/03…), 65 bytes (04…) or 32 bytes (x-only); got ' + b.length + '.' };
}

/** Point → bytes: 'comp' (33), 'uncomp' (65) or 'xonly' (32). */
export function encodePoint(pt, fmt) {
  if (fmt === 'uncomp') return pt.toBytes(false);
  const c = pt.toBytes(true);
  return fmt === 'xonly' ? c.subarray(1) : c;
}
export const yOdd = (pt) => (pt.toAffine().y & 1n) === 1n;

/** k × P, P + Q or 2P. Returns a point, or null for the point at infinity. */
export function ecOp(op, { k, P, Q }) {
  let R;
  if (op === 'mul') {
    const kk = modN(k);
    if (kk === 0n) return null;
    R = P.multiply(kk);
  } else if (op === 'add') R = P.add(Q);
  else R = P.double();
  return R.equals(Point.ZERO) ? null : R;
}
