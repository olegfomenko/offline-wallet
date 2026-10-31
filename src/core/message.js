// Message and raw-digest signatures.
//  - ECDSA: classic "Bitcoin Signed Message" (BIP-137 headers, Electrum/Trezor compatible), 65 bytes.
//  - Schnorr: BIP-340 over the BIP-322 tagged message hash, 64 bytes; verifier needs the x-only key.
//  - Raw: the same, but over exactly the 32 bytes given (no prefix, no hashing).
//  - Schnorr on a Taproot address signs with the address's own key: the tweaked output key (BIP86),
//    in both modes, as a key-path spend and BIP-322 need. Other address types have no tweak.
// An ECDSA signature is kept as 65 bytes (header ‖ r ‖ s); DER is only another view of it (toDER).
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { taprootTweakPrivKey } from '@scure/btc-signer/utils.js';
import { concat, sha256d, varint, utf8, taggedHash, randomBytes, equal } from './util.js';
import { addressOf, decodeAddress, xonly } from './hd.js';
import { ecdsaSignerNonce, ecdsaSignAntiExfil, schnorrSignerNonce, schnorrSignAntiExfil } from './antiexfil.js';

const PREFIX = utf8.encode('\x18Bitcoin Signed Message:\n');

export function messageHash(msgBytes) {
  return sha256d(concat(PREFIX, varint(msgBytes.length), msgBytes));
}
export function bip322Hash(msgBytes) {
  return taggedHash('BIP0322-signed-message', msgBytes);
}

// BIP-137 header base by address type (compressed keys).
const HEADER = { pkh: 31, shwpkh: 35, wpkh: 39, tr: 31 };

export function signMessageECDSA(priv, msgBytes, type) {
  return signHashECDSA(priv, messageHash(msgBytes), type);
}
function signHashECDSA(priv, h, type) {
  const rec = secp256k1.sign(h, priv, { prehash: false, lowS: true, format: 'recovered' });
  // noble 'recovered' layout: [recovery, r(32), s(32)]
  const out = new Uint8Array(65);
  out[0] = HEADER[type] + rec[0];
  out.set(rec.subarray(1), 1);
  return out;
}

/** Recover the signing key and check it against an address. Accepts any BIP-137 / Electrum header, or DER. */
export function verifyMessageECDSA(address, msgBytes, sig) {
  return verifyHashECDSA(address, messageHash(msgBytes), sig);
}

/** 65-byte ECDSA signature (header ‖ r ‖ s) → DER. */
export function toDER(sig65) {
  return secp256k1.Signature.fromBytes(sig65.subarray(1, 65), 'compact').toBytes('der');
}

/** DER, also with a trailing sighash byte as in a transaction → { r, s } or null. */
function parseDER(sig) {
  for (const b of [sig, sig.subarray(0, sig.length - 1)]) {
    try { return secp256k1.Signature.fromBytes(b, 'der'); } catch (e) { /* next */ }
  }
  return null;
}
export const isDER = (sig) => sig.length >= 8 && sig.length <= 73 && sig[0] === 0x30 && !!parseDER(sig);

/**
 * ECDSA over a 32-byte hash, checked against an address. 65 bytes: the header names the key to
 * recover. DER: no recovery id, so every candidate key is tried.
 */
function verifyHashECDSA(address, h, sig) {
  let dec;
  try { dec = decodeAddress(address); } catch (e) { return { ok: false, why: e.message }; }
  const cands = []; // [pub, compressed]
  if (sig.length === 65 && sig[0] !== 0x30) {
    const header = sig[0];
    if (header < 27 || header > 42) return { ok: false, why: 'Unknown signature header byte.' };
    try {
      const rec = new Uint8Array(65);
      rec[0] = (header - 27) & 3;
      rec.set(sig.subarray(1), 1);
      cands.push([secp256k1.Signature.fromBytes(rec, 'recovered').recoverPublicKey(h), header >= 31]);
    } catch (e) { return { ok: false, why: 'The signature is malformed.' }; }
  } else {
    const d = parseDER(sig);
    if (!d) return { ok: false, why: 'ECDSA needs 65 bytes or DER; got ' + sig.length + ' bytes.' };
    for (let rid = 0; rid < 4; rid++) {
      try { cands.push([new secp256k1.Signature(d.r, d.s, rid).recoverPublicKey(h), true]); } catch (e) { /* no key for this id */ }
    }
  }
  for (const [point, compressed] of cands) {
    const pub = point.toBytes(compressed);
    const types = compressed ? ['pkh', 'wpkh', 'shwpkh', 'tr'] : ['pkh'];
    for (const t of types) {
      try { if (addressOf(t, pub, dec.net) === address.trim()) return { ok: true, type: t, pub }; } catch (e) { /* next */ }
    }
  }
  return { ok: false, why: 'mismatch' };
}

export function signMessageSchnorr(priv, msgBytes) {
  return schnorr.sign(bip322Hash(msgBytes), priv, randomBytes(32));
}
export function verifyMessageSchnorr(xonlyPub, msgBytes, sig) {
  return verifyHashSchnorr(xonlyPub, bip322Hash(msgBytes), sig);
}
function verifyHashSchnorr(xonlyPub, h, sig) {
  if (sig.length !== 64) return { ok: false, why: 'A Schnorr signature is 64 bytes.' };
  if (xonlyPub.length !== 32) return { ok: false, why: 'The x-only public key is 32 bytes (64 hex characters).' };
  try {
    return { ok: schnorr.verify(sig, h, xonlyPub) };
  } catch (e) {
    return { ok: false, why: 'The signature or key is malformed.' };
  }
}

// ---- one entry point for the Sign or verify screen: message (raw = false) or raw 32-byte digest ----

/** The 32 bytes that get signed. Raw: the input itself, which must be 32 bytes. */
export function digestOf(alg, bytes, raw) {
  if (raw) {
    if (!bytes || bytes.length !== 32) throw new Error('A raw hash must be exactly 32 bytes.');
    return bytes;
  }
  return alg === 'ecdsa' ? messageHash(bytes) : bip322Hash(bytes);
}

/** The private key that signs: the address's own key. Schnorr on a Taproot address: the tweaked output key (BIP86). */
export function signingKey(alg, priv, type) {
  return alg === 'schnorr' && type === 'tr' ? taprootTweakPrivKey(priv) : priv;
}

/** The public key a verifier needs: 33-byte compressed for ECDSA, 32-byte x-only for Schnorr (for Taproot, the key in the address). */
export function signingPub(alg, priv, type) {
  if (alg === 'ecdsa') return secp256k1.getPublicKey(priv, true);
  const k = signingKey(alg, priv, type);
  const pub = schnorr.getPublicKey(k);
  if (k !== priv) k.fill(0);
  return pub;
}

/** Sign a message or raw digest: ECDSA → 65 bytes (header ‖ r ‖ s, low-S, RFC 6979); Schnorr → 64 bytes. */
export function signDigest(alg, priv, type, bytes, raw) {
  const h = digestOf(alg, bytes, raw);
  if (alg === 'ecdsa') return signHashECDSA(priv, h, type);
  const k = signingKey(alg, priv, type);
  try { return schnorr.sign(h, k, randomBytes(32)); } finally { if (k !== priv) k.fill(0); }
}

/** Verify a message or raw digest. ECDSA: against an address (65 bytes or DER). Schnorr: against an x-only key. */
export function verifyDigest(alg, who, bytes, sig, raw) {
  let h;
  try { h = digestOf(alg, bytes, raw); } catch (e) { return { ok: false, why: e.message }; }
  return alg === 'ecdsa' ? verifyHashECDSA(who, h, sig) : verifyHashSchnorr(who, h, sig);
}

// ---- anti-exfil (antiexfil.js): same signature formats, host-committed nonce ----

/** Step 2: the signer nonce R (ECDSA: 33 bytes; Schnorr: 32 bytes x-only). `opts.raw` signs a 32-byte digest. */
export function messageSignerNonce(alg, priv, msgBytes, commitment, { raw = false, type } = {}) {
  const h = digestOf(alg, msgBytes, raw);
  if (alg === 'ecdsa') return ecdsaSignerNonce(priv, h, commitment);
  const k = signingKey(alg, priv, type);
  try { return schnorrSignerNonce(k, h, commitment); } finally { if (k !== priv) k.fill(0); }
}

/** Step 4: the signature (65-byte BIP-137 header ‖ r ‖ s, or 64-byte BIP-340) and its nonces { sig, R, Rfinal }. */
export function signMessageAntiExfil(alg, priv, msgBytes, type, commitment, data, { raw = false } = {}) {
  const h = digestOf(alg, msgBytes, raw);
  if (alg !== 'ecdsa') {
    const k = signingKey(alg, priv, type);
    try { return schnorrSignAntiExfil(k, h, commitment, data); } finally { if (k !== priv) k.fill(0); }
  }
  const r = ecdsaSignAntiExfil(priv, h, commitment, data);
  const sig = new Uint8Array(65);
  sig[0] = HEADER[type] + r.recovery;
  sig.set(r.compact, 1);
  return { sig, R: r.R, Rfinal: r.Rfinal };
}

export { xonly, equal };
