// Anti-exfil signing: nonce derivation, host checks, and message signatures.
import { test } from 'node:test';
import { expect } from './expect.js';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8, hex } from '../src/core/util.js';
import * as A from '../src/core/antiexfil.js';
import { messageSignerNonce, signMessageAntiExfil, verifyMessageECDSA, verifyMessageSchnorr, messageHash, bip322Hash } from '../src/core/message.js';
import { walletFromMnemonic, account, addressAt } from '../src/core/wallet.js';
import { xonly } from '../src/core/hd.js';

const priv = sha256(utf8.encode('anti-exfil test key'));
const msg = sha256(utf8.encode('message'));
const data = utf8.encode('host-entropy-1:9f2c6a1e7b');
const c = A.hostCommitment(data);

test('anti-exfil: signer nonces are the plain signers’ nonces with the commitment as extra data', () => {
  // ECDSA: RFC 6979 with extra data c gives the same R that noble's extraEntropy = c gives.
  const R = A.ecdsaSignerNonce(priv, msg, c);
  expect(R.length).toBe(33);
  const plain = secp256k1.Signature.fromBytes(secp256k1.sign(msg, priv, { prehash: false, extraEntropy: c }));
  expect(plain.r).toBe(secp256k1.Point.fromBytes(R).toAffine().x % secp256k1.Point.Fn.ORDER);
  // Schnorr: BIP340 with aux = c.
  const Rs = A.schnorrSignerNonce(priv, msg, c);
  expect(hex.encode(Rs)).toBe(hex.encode(schnorr.sign(msg, priv, c).subarray(0, 32)));
  // Fixed before the data is known, and different for another commitment.
  expect(hex.encode(A.ecdsaSignerNonce(priv, msg, c))).toBe(hex.encode(R));
  expect(hex.encode(A.ecdsaSignerNonce(priv, msg, sha256(utf8.encode('other'))))).not.toBe(hex.encode(R));
});

test('anti-exfil: signatures use R + SHA256(R‖data)·G and pass the host checks', () => {
  const R = A.ecdsaSignerNonce(priv, msg, c);
  const s = A.ecdsaSignAntiExfil(priv, msg, c, data);
  expect(hex.encode(s.R)).toBe(hex.encode(R));
  expect(hex.encode(s.Rfinal)).toBe(hex.encode(A.finalNonce(R, data)));
  expect(A.hostVerifyECDSA(s.compact, msg, secp256k1.getPublicKey(priv, true), R, data)).toBe(true);
  expect(A.hostVerifyECDSA(s.compact, msg, secp256k1.getPublicKey(priv, true), R, utf8.encode('x'))).toBe(false);
  // Same inputs, same signature: a retry after a transport error can't be used to grind.
  expect(hex.encode(A.ecdsaSignAntiExfil(priv, msg, c, data).der)).toBe(hex.encode(s.der));

  const Rs = A.schnorrSignerNonce(priv, msg, c);
  const ss = A.schnorrSignAntiExfil(priv, msg, c, data);
  expect(A.hostVerifySchnorr(ss.sig, msg, schnorr.getPublicKey(priv), Rs, data)).toBe(true);
  expect(hex.encode(ss.sig.subarray(0, 32))).toBe(hex.encode(A.finalNonce(Rs, data)));
  // Many keys and data, to exercise both y parities and low-S.
  for (let i = 0; i < 24; i++) {
    const k = sha256(utf8.encode('k' + i)), d = utf8.encode('d' + i), cc = A.hostCommitment(d);
    const e = A.ecdsaSignAntiExfil(k, msg, cc, d);
    expect(A.hostVerifyECDSA(e.compact, msg, secp256k1.getPublicKey(k, true), A.ecdsaSignerNonce(k, msg, cc), d)).toBe(true);
    const z = A.schnorrSignAntiExfil(k, msg, cc, d);
    expect(A.hostVerifySchnorr(z.sig, msg, schnorr.getPublicKey(k), A.schnorrSignerNonce(k, msg, cc), d)).toBe(true);
  }
});

test('anti-exfil: data that doesn’t match the commitment is refused', () => {
  expect(() => A.ecdsaSignAntiExfil(priv, msg, c, utf8.encode('wrong'))).toThrow(/doesn’t match/);
  expect(() => A.schnorrSignAntiExfil(priv, msg, c, utf8.encode('wrong'))).toThrow(/doesn’t match/);
  expect(() => A.ecdsaSignerNonce(priv, msg, new Uint8Array(31))).toThrow(/32 bytes/);
  expect(A.dataMatches(data, c)).toBe(true);
});

test('anti-exfil message signatures verify as BIP-137 and BIP-340', () => {
  const W = walletFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '), '');
  const m = utf8.encode('Hello from anti-exfil');
  for (const type of ['wpkh', 'pkh', 'shwpkh']) {
    const a = addressAt(account(W, type, 'main', 0), type, 'main', 0, 0);
    const node = W.root.derive(a.path);
    const R = messageSignerNonce('ecdsa', node.privateKey, m, c);
    const r = signMessageAntiExfil('ecdsa', node.privateKey, m, type, c, data);
    expect(r.sig.length).toBe(65);
    expect(verifyMessageECDSA(a.address, m, r.sig).ok).toBe(true);
    expect(A.hostVerifyECDSA(r.sig.subarray(1), messageHash(m), node.publicKey, R, data)).toBe(true);
  }
  const node = W.root.derive("m/86'/0'/0'/0/0");
  const r = signMessageAntiExfil('schnorr', node.privateKey, m, 'tr', c, data);
  expect(verifyMessageSchnorr(xonly(node.publicKey), m, r.sig).ok).toBe(true);
  expect(A.hostVerifySchnorr(r.sig, bip322Hash(m), xonly(node.publicKey), messageSignerNonce('schnorr', node.privateKey, m, c), data)).toBe(true);
});
