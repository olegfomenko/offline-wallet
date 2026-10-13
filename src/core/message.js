// Message signatures.
//  - ECDSA: classic "Bitcoin Signed Message" (BIP-137 headers, Electrum/Trezor compatible), 65 bytes.
//  - Schnorr: BIP-340 over the BIP-322 tagged message hash, 64 bytes; verifier needs the x-only key.
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
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
  const h = messageHash(msgBytes);
  const rec = secp256k1.sign(h, priv, { prehash: false, lowS: true, format: 'recovered' });
  // noble 'recovered' layout: [recovery, r(32), s(32)]
  const out = new Uint8Array(65);
  out[0] = HEADER[type] + rec[0];
  out.set(rec.subarray(1), 1);
  return out;
}

/** Recover the signing key and check it against an address. Accepts any BIP-137 / Electrum header. */
export function verifyMessageECDSA(address, msgBytes, sig) {
  if (sig.length !== 65) return { ok: false, why: 'An ECDSA message signature is 65 bytes.' };
  const header = sig[0];
  if (header < 27 || header > 42) return { ok: false, why: 'Unknown signature header byte.' };
  const recid = (header - 27) & 3;
  const compressed = header >= 31;
  const h = messageHash(msgBytes);
  let pub;
  try {
    const rec = new Uint8Array(65);
    rec[0] = recid;
    rec.set(sig.subarray(1), 1);
    const point = secp256k1.Signature.fromBytes(rec, 'recovered').recoverPublicKey(h);
    pub = point.toBytes(compressed);
  } catch (e) {
    return { ok: false, why: 'The signature is malformed.' };
  }
  let dec;
  try { dec = decodeAddress(address); } catch (e) { return { ok: false, why: e.message }; }
  const types = compressed ? ['pkh', 'wpkh', 'shwpkh', 'tr'] : ['pkh'];
  for (const t of types) {
    try { if (addressOf(t, pub, dec.net) === address.trim()) return { ok: true, type: t, pub }; } catch (e) { /* next */ }
  }
  return { ok: false, why: 'mismatch', pub };
}

export function signMessageSchnorr(priv, msgBytes) {
  return schnorr.sign(bip322Hash(msgBytes), priv, randomBytes(32));
}
export function verifyMessageSchnorr(xonlyPub, msgBytes, sig) {
  if (sig.length !== 64) return { ok: false, why: 'A Schnorr signature is 64 bytes.' };
  if (xonlyPub.length !== 32) return { ok: false, why: 'The x-only public key is 32 bytes (64 hex characters).' };
  try {
    return { ok: schnorr.verify(sig, bip322Hash(msgBytes), xonlyPub) };
  } catch (e) {
    return { ok: false, why: 'The signature or key is malformed.' };
  }
}

// ---- anti-exfil message signing (antiexfil.js): same signature formats, host-committed nonce ----

/** Step 2: the signer nonce R for this message (ECDSA: 33 bytes; Schnorr: 32 bytes x-only). */
export function messageSignerNonce(alg, priv, msgBytes, commitment) {
  return alg === 'ecdsa' ? ecdsaSignerNonce(priv, messageHash(msgBytes), commitment) : schnorrSignerNonce(priv, bip322Hash(msgBytes), commitment);
}

/** Step 4: the signature (65-byte BIP-137 or 64-byte BIP-340) and its nonces { sig, R, Rfinal }. */
export function signMessageAntiExfil(alg, priv, msgBytes, type, commitment, data) {
  if (alg !== 'ecdsa') return schnorrSignAntiExfil(priv, bip322Hash(msgBytes), commitment, data);
  const r = ecdsaSignAntiExfil(priv, messageHash(msgBytes), commitment, data);
  const sig = new Uint8Array(65);
  sig[0] = HEADER[type] + r.recovery;
  sig.set(r.compact, 1);
  return { sig, R: r.R, Rfinal: r.Rfinal };
}

export { xonly, equal };
