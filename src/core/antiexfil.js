// Anti-exfil signing (Blockstream's protocol, also called sign-to-contract with a host commitment).
// It stops a faulty or malicious signer from leaking the private key through its nonces.
//
//   1. The host picks random data and gives the signer only c = SHA256(data).
//   2. The signer derives its nonce k from (key, message, c) and reveals R = k·G before it has seen
//      the data. R is fixed: the same key, message and commitment always give the same R.
//   3. The host reveals the data; the signer checks SHA256(data) == c.
//   4. The signer signs with k' = k + e, e = SHA256(R ‖ data) mod n, so the final nonce is
//      R' = R + e·G. The host checks that the signature's nonce is R' (ECDSA: r == x(R') mod n;
//      Schnorr: the first 32 bytes of the signature are x(R')).
//
// R is serialized as 33-byte compressed for ECDSA, and as the 32-byte x-only point (even y, as in
// BIP340) for Schnorr. The ECDSA nonce is RFC 6979 with c as the extra data; the Schnorr nonce is
// BIP340 with c as the aux data. So the same nonce comes out as when the plain signer gets c as
// its extra randomness, which the tests check.
//
// Every signature is verified against the message and public key, and its nonce against R',
// before it is returned.
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { createHmacDrbg, bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal, taggedHash, randomBytes } from './util.js';

const Point = secp256k1.Point;
const Fn = Point.Fn;
const N = Fn.ORDER;
const G = Point.BASE;
const even = (y) => (y & 1n) === 0n;
const mod = (a) => Fn.create(a);
const toBytes32 = (n) => numberToBytesBE(n, 32);

/** SHA-256 of the host data: the commitment the host gives first. */
export function hostCommitment(data) {
  return sha256(data);
}

/** Does the revealed data match the commitment? */
export function dataMatches(data, commitment) {
  return !!(data && commitment && commitment.length === 32 && equal(sha256(data), commitment));
}

/** Tweak e = SHA256(R ‖ data) mod n. */
function tweakOf(Rbytes, data) {
  return mod(bytesToNumberBE(sha256(concat(Rbytes, data))));
}

// ---- ECDSA ----

const drbg = () => createHmacDrbg(32, 32, (k, m) => hmac(sha256, k, m));

/** RFC 6979 nonce with the commitment as extra data (RFC 6979 §3.6), as noble's extraEntropy. */
function ecdsaNonce(priv, msg32, commitment) {
  const d = bytesToNumberBE(priv);
  if (!Fn.isValidNot0(d)) throw new Error('Invalid private key.');
  const h = mod(bytesToNumberBE(msg32));
  const seed = concat(toBytes32(d), toBytes32(h), commitment);
  return drbg()(seed, (kb) => {
    const k = bytesToNumberBE(kb);
    return Fn.isValidNot0(k) ? k : undefined;
  });
}

function checkCommitment(c) {
  if (!(c instanceof Uint8Array) || c.length !== 32) throw new Error('The host commitment must be 32 bytes.');
}

/** Step 2 for ECDSA: the signer's nonce point R, 33 bytes compressed. */
export function ecdsaSignerNonce(priv, msg32, commitment) {
  checkCommitment(commitment);
  const k = ecdsaNonce(priv, msg32, commitment);
  return G.multiply(k).toBytes(true);
}

/**
 * Step 4 for ECDSA. Returns { r, s, recovery, R, Rfinal, der, compact } with low-S applied.
 * `recovery` is the BIP-137 recovery id (0..3) for the final signature.
 */
export function ecdsaSignAntiExfil(priv, msg32, commitment, data) {
  checkCommitment(commitment);
  if (!dataMatches(data, commitment)) throw new Error('The host data doesn’t match the commitment.');
  const d = bytesToNumberBE(priv);
  const k = ecdsaNonce(priv, msg32, commitment);
  const Rp = G.multiply(k);
  const R = Rp.toBytes(true);
  const e = tweakOf(R, data);
  const k2 = mod(k + e);
  if (k2 === 0n) throw new Error('Nonce is zero. Retry with the same data.');
  const Q = G.multiply(k2).toAffine();
  const r = mod(Q.x);
  if (r === 0n) throw new Error('r is zero. Retry with the same data.');
  const m = mod(bytesToNumberBE(msg32));
  // Blinded inversion (as noble does): s = (b·k')⁻¹ · (b·m + b·d·r).
  const b = mod(bytesToNumberBE(randomBytes(48))) || 1n;
  let s = mod(Fn.inv(mod(b * k2)) * mod(b * m + mod(b * d) * r));
  if (s === 0n) throw new Error('s is zero. Retry with the same data.');
  let recovery = (even(Q.y) ? 0 : 1) | (Q.x >= N ? 2 : 0);
  if (s > N >> 1n) { s = N - s; recovery ^= 1; }
  const sig = new secp256k1.Signature(r, s, recovery);
  const pub = G.multiply(d).toBytes(true);
  if (!secp256k1.verify(sig.toBytes('compact'), msg32, pub, { prehash: false, lowS: true })) throw new Error('The signature didn’t verify. Retry with the same data.');
  const Rfinal = Point.fromAffine(Q).toBytes(true);
  if (!equal(Rfinal, Rp.add(G.multiply(e)).toBytes(true))) throw new Error('Final nonce mismatch.');
  return { r, s, recovery, R, Rfinal, der: sig.toBytes('der'), compact: sig.toBytes('compact') };
}

// ---- Schnorr (BIP340) ----

/** BIP340 key and nonce with aux = commitment. k is normalized so R has even y. */
function schnorrPrep(priv, msg32, commitment) {
  const d0 = bytesToNumberBE(priv);
  if (!Fn.isValidNot0(d0)) throw new Error('Invalid private key.');
  const P = G.multiply(d0);
  const d = even(P.toAffine().y) ? d0 : N - d0;
  const px = toBytes32(P.toAffine().x);
  const t = toBytes32(d ^ bytesToNumberBE(taggedHash('BIP0340/aux', commitment)));
  const k0 = mod(bytesToNumberBE(taggedHash('BIP0340/nonce', t, px, msg32)));
  if (k0 === 0n) throw new Error('Nonce is zero.');
  const R0 = G.multiply(k0).toAffine();
  const k = even(R0.y) ? k0 : N - k0;
  return { d, px, k, Rx: toBytes32(R0.x) };
}

/** Step 2 for Schnorr: the signer's nonce point R as 32-byte x-only (even y). */
export function schnorrSignerNonce(priv, msg32, commitment) {
  checkCommitment(commitment);
  return schnorrPrep(priv, msg32, commitment).Rx;
}

/** Step 4 for Schnorr. Returns { sig (64 bytes), R, Rfinal (x-only) }. */
export function schnorrSignAntiExfil(priv, msg32, commitment, data) {
  checkCommitment(commitment);
  if (!dataMatches(data, commitment)) throw new Error('The host data doesn’t match the commitment.');
  const { d, px, k, Rx } = schnorrPrep(priv, msg32, commitment);
  const e = tweakOf(Rx, data);
  let k2 = mod(k + e);
  if (k2 === 0n) throw new Error('Nonce is zero. Retry with the same data.');
  const Q = G.multiply(k2).toAffine();
  if (!even(Q.y)) k2 = N - k2;
  const rx = toBytes32(Q.x);
  const c = mod(bytesToNumberBE(taggedHash('BIP0340/challenge', rx, px, msg32)));
  const s = mod(k2 + c * d);
  const sig = concat(rx, toBytes32(s));
  if (!schnorr.verify(sig, msg32, px)) throw new Error('The signature didn’t verify. Retry with the same data.');
  const expect = Point.fromAffine(liftEven(Rx)).add(G.multiply(e)).toAffine();
  if (expect.x !== Q.x) throw new Error('Final nonce mismatch.');
  return { sig, R: Rx, Rfinal: rx };
}

function liftEven(xBytes) {
  return Point.fromBytes(concat(Uint8Array.of(2), xBytes)).toAffine();
}

// ---- host side (used by the tests, and to show the final nonce before signing) ----

/** Final nonce R' = R + SHA256(R ‖ data)·G, serialized like R (33 bytes for ECDSA, 32 x-only for Schnorr). */
export function finalNonce(R, data) {
  const e = tweakOf(R, data);
  const P = R.length === 32 ? Point.fromAffine(liftEven(R)) : Point.fromBytes(R);
  const F = P.add(G.multiply(e));
  return R.length === 32 ? toBytes32(F.toAffine().x) : F.toBytes(true);
}

/** Host check for ECDSA: valid signature and r == x(R') mod n. `sig` is compact (64 bytes). */
export function hostVerifyECDSA(sig64, msg32, pub, R, data) {
  if (!secp256k1.verify(sig64, msg32, pub, { prehash: false, lowS: false })) return false;
  const F = Point.fromBytes(finalNonce(R, data)).toAffine();
  return mod(F.x) === bytesToNumberBE(sig64.subarray(0, 32));
}

/** Host check for Schnorr: valid signature and its R is x(R'). */
export function hostVerifySchnorr(sig, msg32, xonlyPub, R, data) {
  if (!schnorr.verify(sig, msg32, xonlyPub)) return false;
  return equal(sig.subarray(0, 32), finalNonce(R, data));
}


