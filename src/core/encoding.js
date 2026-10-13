// Text ↔ bytes in the three encodings the screens offer: 'text' (UTF-8), 'hex' and 'b64' (Base64).
// Shared by the message signer, anti-exfil, the hash and curve calculators and the import sheet.
import { hex, base64, utf8, isHex } from './util.js';

/** Hex or Base64 text (whitespace ignored) → bytes, or null when it doesn't parse. */
export function decodeBytes(s, enc) {
  const t = String(s || '').replace(/\s+/g, '');
  if (enc === 'hex') return isHex(t) ? hex.decode(t) : null;
  try { return base64.decode(t); } catch (e) { return null; }
}
export const encodeBytes = (b, enc) => (enc === 'hex' ? hex.encode(b) : base64.encode(b));

/** Bytes as UTF-8 text, or null when they aren't valid UTF-8. */
export function utf8Strict(b) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return null; }
}
/** Bytes as text, or "BIN:<hex>" for binary data (QR scans and files that aren't text). */
export function bytesOrBin(b) {
  const t = utf8Strict(b);
  return t === null ? 'BIN:' + hex.encode(b) : t;
}

/** Text in a format → bytes, or null when it doesn't parse. 'text' is UTF-8 and always parses. */
export function textToBytes(s, fmt) {
  if (fmt === 'text') return utf8.encode(String(s ?? ''));
  return decodeBytes(s, fmt);
}
/** Bytes → text in a format. Null when fmt is 'text' and the bytes aren't valid UTF-8. */
export function bytesToText(b, fmt) {
  if (fmt === 'text') return utf8Strict(b);
  return encodeBytes(b, fmt);
}
