// PSBT Inspector: review without private keys (watch-only key or none), each input's hash out,
// a signature made elsewhere (the Addresses app's Raw hash signing) back in, partial export.
import { test } from 'node:test';
import { expect } from './expect.js';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hex } from '../src/core/util.js';
import { accountKeys, addressAt, account } from '../src/core/wallet.js';
import { parsePsbt, analyzePsbt, signPsbt, prepareSignInputs, checkInputSignature, applyInputSignatures, watchWallet, inferNet } from '../src/core/psbt.js';
import { signDigest, toDER } from '../src/core/message.js';
import { buildPsbt, W } from './psbt-fixture.js';

const TYPES = ['wpkh', 'tr', 'pkh', 'shwpkh'];

/** What the Addresses app returns for an item: Sign or verify → Raw hash, on the input's own key. */
function rawSign(item) {
  const priv = W.root.derive(item.path).privateKey;
  const sig = signDigest(item.alg, priv, item.type, item.hash, true);
  return item.alg === 'ecdsa' ? toDER(sig) : sig;
}

for (const type of TYPES) {
  test('Inspector without a watch-only key: review, sign each input elsewhere, finalize · ' + type, () => {
    const tx = parsePsbt(buildPsbt({ type }));
    const a = analyzePsbt(tx, null, { net: inferNet(tx) });
    expect(a.mode).toBe('none');
    expect(a.canSign).toBe(true);
    expect(a.inputs[0].own.unverified).toBe(true);
    expect(a.outputs[1].kind).toBe('change');
    expect(a.outputs[1].unverified).toBe(true);
    expect(a.notes[0].mark).toBe('!');
    expect(a.checks[0].text).toMatch(/Ownership not checked/);
    const prep = prepareSignInputs(tx, a);
    expect(prep.items.length).toBe(1);
    const it = prep.items[0];
    expect(it.alg).toBe(type === 'tr' ? 'schnorr' : 'ecdsa');
    expect(it.path).toBe({ wpkh: "m/84'/0'/0'/0/5", tr: "m/86'/0'/0'/0/5", pkh: "m/44'/0'/0'/0/5", shwpkh: "m/49'/0'/0'/0/5" }[type]);
    const sig = rawSign(it);
    const c = checkInputSignature(it, sig);
    expect(c.ok).toBe(true);
    if (type !== 'tr') expect(c.added).toBe(true);
    const r = applyInputSignatures(prep, [c.field]);
    expect(r.final).toBe(true);
    expect(r.txHex.length).toBeGreaterThan(100);
    // The hash is exactly what the Full app signs: its own signature over the same input verifies too.
    const plain = parsePsbt(signPsbt(tx, analyzePsbt(tx, W, { net: 'main' }), W).psbt).getInput(0);
    if (type === 'tr') expect(checkInputSignature(it, plain.tapKeySig).ok).toBe(true);
    else expect(checkInputSignature(it, plain.partialSig[0][1]).ok).toBe(true);
  });
}

test('Inspector with a watch-only key proves inputs and change; a wrong key blocks', () => {
  for (const type of TYPES) {
    const K = accountKeys(W, type, 'main', 0);
    for (const key of [K.x, K.slip, K.desc].filter(Boolean)) {
      const ww = watchWallet(key);
      const tx = parsePsbt(buildPsbt({ type }));
      const a = analyzePsbt(tx, ww, { net: ww.net });
      expect(a.mode).toBe('watch');
      expect(a.canSign).toBe(true);
      expect(!!a.inputs[0].own.unverified).toBe(false);
      expect(a.outputs[1].kind).toBe('change');
      expect(a.checks[0].text).toMatch(/watch-only wallet/);
      expect(a.notes[0].mark).toBe('✓');
    }
  }
  // Another account's key: nothing matches.
  const other = watchWallet(accountKeys(W, 'wpkh', 'main', 1).x);
  const a = analyzePsbt(parsePsbt(buildPsbt({ type: 'wpkh' })), other, { net: 'main' });
  expect(a.canSign).toBe(false);
  expect(a.blockers[0].title).toMatch(/watch-only wallet/);
});

test('Inspector refuses private and master keys as watch-only keys', () => {
  expect(() => watchWallet(accountKeys(W, 'wpkh', 'main', 0, undefined, true).x)).toThrow(/private key/);
  expect(() => watchWallet(W.root.publicExtendedKey)).toThrow(/master public key/);
  expect(() => watchWallet('hello')).toThrow(/Not an xpub/);
});

test('Signatures are checked: wrong key, wrong sighash byte, junk', () => {
  const tx = parsePsbt(buildPsbt({ type: 'wpkh' }));
  const prep = prepareSignInputs(tx, analyzePsbt(tx, null, { net: 'main' }));
  const it = prep.items[0];
  const der = rawSign(it);
  expect(checkInputSignature(it, new Uint8Array([...der, 1])).ok).toBe(true);
  expect(checkInputSignature(it, new Uint8Array([...der, 2])).kind).toBe('byte');
  expect(checkInputSignature(it, new Uint8Array(10)).kind).toBe('format');
  // Same key, another hash.
  const wrong = toDER(signDigest('ecdsa', W.root.derive(it.path).privateKey, 'wpkh', new Uint8Array(32).fill(3), true));
  expect(checkInputSignature(it, wrong).kind).toBe('bad');
  // Right hash, another key.
  const other = toDER(signDigest('ecdsa', W.root.derive("m/84'/0'/0'/0/6").privateKey, 'wpkh', it.hash, true));
  expect(checkInputSignature(it, other).kind).toBe('bad');
  // High-S is refused.
  const d = secp256k1.Signature.fromBytes(der, 'der');
  const high = new secp256k1.Signature(d.r, secp256k1.Point.Fn.ORDER - d.s).toBytes('der');
  expect(checkInputSignature(it, high).ok).toBe(false);
});

test('Partial signing: export after one of two inputs, then continue from that PSBT', () => {
  const tx = parsePsbt(buildPsbt({ type: 'wpkh' }));
  const two = parsePsbt(buildPsbt({ type: 'tr' }));
  tx.addInput(two.getInput(0));
  tx.updateOutput(0, { amount: 1500000n + 10000000n - 2571n });
  const a = analyzePsbt(tx, null, { net: 'main' });
  const prep = prepareSignInputs(tx, a);
  expect(prep.items.length).toBe(2);
  const c0 = checkInputSignature(prep.items[0], rawSign(prep.items[0]));
  const r1 = applyInputSignatures(prep, [c0.field, null]);
  expect(r1.final).toBe(false);
  expect(r1.signedCount).toBe(1);
  // Load the partial PSBT again: the first input shows as already signed.
  const tx2 = parsePsbt(r1.psbt);
  const prep2 = prepareSignInputs(tx2, analyzePsbt(tx2, null, { net: 'main' }));
  expect(prep2.items[0].pre).toBe(true);
  expect(prep2.items[1].pre).toBe(false);
  const c1 = checkInputSignature(prep2.items[1], rawSign(prep2.items[1]));
  const r2 = applyInputSignatures(prep2, [null, c1.field]);
  expect(r2.final).toBe(true);
  expect(r2.signedCount).toBe(2);
});

test('The network comes from the PSBT key paths', () => {
  expect(inferNet(parsePsbt(buildPsbt({ type: 'wpkh' })))).toBe('main');
  const t = new btc.Transaction();
  expect(inferNet(t)).toBe('main');
  const testNode = W.root.derive("m/84'/1'/0'/0/0");
  const t2 = new btc.Transaction({ allowUnknownOutputs: true });
  t2.addOutput({ script: btc.p2wpkh(testNode.publicKey, btc.TEST_NETWORK).script, amount: 1000n, bip32Derivation: [[testNode.publicKey, { fingerprint: W.root.fingerprint, path: [84, 1, 0, 0, 0].map((x, i) => (i < 3 ? x + 0x80000000 : x)) }]] });
  expect(inferNet(t2)).toBe('test');
  expect(hex.encode(new Uint8Array([1]))).toBe('01');
  expect(addressAt(account(W, 'wpkh', 'main', 0), 'wpkh', 'main', 0, 0).address.startsWith('bc1q')).toBe(true);
});
