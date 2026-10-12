// Core tests. Run: npm test
import { test } from 'node:test';
import { expect } from './expect.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { hex, utf8, base64 } from '../src/core/util.js';
import { descChecksum, parseDescriptor, parseExt, serializeExt, addressOf, decodeAddress, withChecksum, TYPES } from '../src/core/hd.js';
import { walletFromMnemonic, walletFromCustom, readXkey, walletFromXkey, walletFromKeys, accountKeys, account, addressAt, lastWordCandidates, isValidMnemonic, seedQREncode, seedQRDecode, customSeedText } from '../src/core/wallet.js';
import { decodeWIF, encodeWIF, parseKeyLine, decryptBIP38, pubOf, keyAddress, looksExtended, ELECTRUM_PREFIX } from '../src/core/keys.js';
import { makeEntropy, countedBits, neededBits } from '../src/core/entropy.js';
import { signMessageECDSA, verifyMessageECDSA, signMessageSchnorr, verifyMessageSchnorr } from '../src/core/message.js';
import { base43, BBQrDecoder, bbqrSplit, classify, MultiPartCollector, psbtQRFrames } from '../src/core/transport.js';
import { parsePsbt, analyzePsbt, signPsbt, psbtJSON } from '../src/core/psbt.js';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const W = walletFromMnemonic(ABANDON, '');

test('BIP39/BIP32 fingerprint and standard addresses (BIP44/49/84/86 vectors)', () => {
  expect(W.fp).toBe('73C5DA0A');
  const first = (type, net = 'main') => addressAt(account(W, type, net, 0), type, net, 0, 0).address;
  expect(first('wpkh')).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  expect(first('shwpkh')).toBe('37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
  expect(first('pkh')).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  expect(first('tr')).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  expect(first('wpkh', 'test')).toBe('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  const A = account(W, 'wpkh', 'main', 0);
  expect(addressAt(A, 'wpkh', 'main', 1, 0).address).toBe('bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
});

test('SLIP-132 account keys and descriptors', () => {
  const k = accountKeys(W, 'wpkh', 'main', 0);
  expect(k.slip).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
  const kp = accountKeys(W, 'wpkh', 'main', 0, null, true);
  expect(kp.slip).toBe('zprvAdG4iTXWBoARxkkzNpNh8r6Qag3irQB8PzEMkAFeTRXxHpbF9z4QgEvBRmfvqWvGp42t42nvgGpNgYSJA9iefm1yYNZKEm7z6qUWCroSQnE');
  const y = accountKeys(W, 'shwpkh', 'main', 0);
  expect(y.slip).toBe('ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP');
  expect(k.desc.startsWith("wpkh([73c5da0a/84h/0h/0h]xpub")).toBe(true);
  expect(k.desc).toMatch(/\/<0;1>\/\*\)#[a-z0-9]{8}$/);
  // Bitcoin Core doc example (BIP380)
  expect(descChecksum("pkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)")).toBe('ml40v0wf');
  const d = parseDescriptor(k.desc);
  expect(d.type).toBe('wpkh'); expect(d.fp).toBe('73C5DA0A'); expect(d.path).toBe("m/84'/0'/0'");
  expect(() => parseDescriptor(k.desc.slice(0, -1) + 'q')).toThrow();
});

test('extended private key wallets: zprv, plain xprv, descriptor', () => {
  const kp = accountKeys(W, 'wpkh', 'main', 0, null, true);
  const z = readXkey(kp.slip);
  expect(z.type).toBe('wpkh'); expect(z.depth).toBe(3); expect(z.fp).toBe(null);
  const wz = walletFromXkey(z);
  const A = account(wz, 'wpkh', 'main');
  expect(addressAt(A, 'wpkh', 'main', 0, 0).address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  const x = readXkey(kp.x);
  expect(x.type).toBe(null);
  const wx = walletFromXkey(x, 'pkh');
  expect(addressAt(account(wx, 'pkh', 'main'), 'pkh', 'main', 0, 0).address).toBe('1JaUQDVNRdhfNsVncGkXedaPSM5Gc54Hso');
  const dsc = readXkey(kp.desc);
  expect(dsc.fp).toBe('73C5DA0A'); expect(dsc.path).toBe("m/84'/0'/0'");
  // root xprv behaves like a seed
  const r = readXkey(W.root.privateExtendedKey);
  const wr = walletFromXkey(r);
  expect(wr.fp).toBe('73C5DA0A');
  expect(() => readXkey(accountKeys(W, 'wpkh', 'main', 0).x)).toThrow(/public/);
});

test('WIF, Electrum prefix, hex keys', () => {
  const A = account(W, 'wpkh', 'main', 0);
  const n = A.node.deriveChild(0).deriveChild(0);
  expect(encodeWIF(n.privateKey)).toBe('KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
  const k = parseKeyLine('p2wpkh:KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
  expect(k.type).toBe('wpkh');
  expect(addressOf('wpkh', pubOf(k.priv), 'main')).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  expect(parseKeyLine(hex.encode(n.privateKey)).kind).toBe('hex');
  expect(() => parseKeyLine('KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9e')).toThrow();
});

test('BIP38 decryption (spec vectors)', { timeout: 120000 }, async () => {
  const a = await decryptBIP38('6PYNKZ1EAgYgmQfmNVamxyXVWHzK5s6DGhwP4J5o44cvXdoY7sRzhtpUeo', 'TestingOneTwoThree');
  expect(encodeWIF(a.priv, 'main', a.compressed)).toBe('L44B5gGEpqEDRS9vVPz7QT35jcBG2r3CZwSwQ4fCewXAhAhqGVpP');
  const b = await decryptBIP38('6PfQu77ygVyJLZjfvMLyhLMQbYnu5uguoJJ4kMCLqWwPEdfpwANVS76gTX', 'TestingOneTwoThree');
  expect(encodeWIF(b.priv, 'main', b.compressed)).toBe('5K4caxezwjGCGfnoPTZ8tMcJBLB7Jvyjv4xxeacadhq8nLisLR2');
  await expect(decryptBIP38('6PYNKZ1EAgYgmQfmNVamxyXVWHzK5s6DGhwP4J5o44cvXdoY7sRzhtpUeo', 'wrong')).rejects.toThrow(/Wrong password/);
});

test('custom (non-BIP39) words follow Electrum normalization', () => {
  expect(customSeedText('  casa  perro\tluna ')).toBe('casa perro luna');
  const w = walletFromCustom('casa perro luna');
  const w2 = walletFromCustom('casa   perro luna');
  expect(w.fp).toBe(w2.fp);
  expect(walletFromCustom('Casa perro luna').fp).not.toBe(w.fp);
  // A valid BIP39 phrase entered as custom text gives the same wallet (same PBKDF2 input).
  expect(walletFromCustom(ABANDON.join(' ')).fp).toBe('73C5DA0A');
});

test('last word candidates', () => {
  const c12 = lastWordCandidates(ABANDON.slice(0, 11));
  expect(c12.length).toBe(128);
  expect(c12.some((c) => c.word === 'about')).toBe(true);
  for (const c of c12) expect(isValidMnemonic([...ABANDON.slice(0, 11), c.word])).toBe(true);
  const c24 = lastWordCandidates(Array(23).fill('abandon'));
  expect(c24.length).toBe(8);
  expect(c24.some((c) => c.word === 'art')).toBe(true);
});

test('SeedQR roundtrip', () => {
  const s = seedQREncode(ABANDON);
  expect(s).toBe('000000000000000000000000000000000000000000000003');
  expect(seedQRDecode(s)).toEqual(ABANDON);
});

test('entropy mixing', () => {
  const e = makeEntropy({ bytes: 32, device: true, dice: [1, 2, 3] });
  expect(e.length).toBe(32);
  const a = makeEntropy({ bytes: 16, device: false, dice: Array(50).fill(3) });
  const b = makeEntropy({ bytes: 16, device: false, dice: Array(50).fill(3) });
  expect(hex.encode(a)).toBe(hex.encode(b));
  expect(() => makeEntropy({ bytes: 16, device: false, dice: [1] })).toThrow();
  // Without device randomness the dice must carry the seed's full entropy: 128 bits for 12 words, 256 for 24.
  expect(neededBits(12)).toBe(128);
  expect(neededBits(24)).toBe(256);
  expect(makeEntropy({ bytes: 32, device: false, dice: Array(100).fill(4) }).length).toBe(32); // 258.5 bits
  expect(() => makeEntropy({ bytes: 32, device: false, dice: Array(50).fill(4) })).toThrow(/256 bits/); // 129 bits
  expect(() => makeEntropy({ bytes: 32, device: false, dice: Array(98).fill(4), coins: [] })).toThrow(/256 bits/); // 253.3 bits
  expect(makeEntropy({ bytes: 32, device: false, dice: Array(98).fill(4), coins: Array(3).fill('H') }).length).toBe(32); // 256.3 bits
  expect(Math.floor(countedBits(Array(50).fill(1), []))).toBe(129);
});

test('message signatures: ECDSA (BIP-137) and Schnorr (BIP-340/322)', () => {
  const A = account(W, 'wpkh', 'main', 0);
  const a = addressAt(A, 'wpkh', 'main', 0, 0);
  const msg = utf8.encode('Proof of ownership');
  const sig = signMessageECDSA(a.node.privateKey, msg, 'wpkh');
  expect(sig.length).toBe(65);
  expect(sig[0] >= 39 && sig[0] <= 42).toBe(true);
  expect(verifyMessageECDSA(a.address, msg, sig).ok).toBe(true);
  expect(verifyMessageECDSA(a.address, utf8.encode('other'), sig).ok).toBe(false);
  // Electrum-style header 31-34 also verifies against a segwit address
  const legacyHdr = sig.slice(); legacyHdr[0] = sig[0] - 8;
  expect(verifyMessageECDSA(a.address, msg, legacyHdr).ok).toBe(true);
  const s = signMessageSchnorr(a.node.privateKey, msg);
  expect(verifyMessageSchnorr(a.pub.subarray(1), msg, s).ok).toBe(true);
  expect(verifyMessageSchnorr(a.pub.subarray(1), utf8.encode('x'), s).ok).toBe(false);
});

test('Base43 and BBQr', () => {
  const psbt = new Uint8Array(readFileSync(join(import.meta.dirname, 'data/1in2out.psbt')));
  expect(classify(base43.encode(psbt)).format).toBe('Base43');
  const parts = bbqrSplit(new Uint8Array(readFileSync(join(import.meta.dirname, 'data/1in100out.psbt'))), 'P');
  expect(parts.length).toBeGreaterThan(1);
  const d = new BBQrDecoder();
  for (const p of parts.slice().reverse()) d.receive(p);
  expect(d.done).toBe(true);
  expect(hex.encode(d.result.bytes)).toBe(hex.encode(readFileSync(join(import.meta.dirname, 'data/1in100out.psbt'))));
  // Coinkite's real scan (Zlib-compressed, file type U)
  const lines = readFileSync(join(import.meta.dirname, 'data/real-scan.txt'), 'utf8').split('\n').filter((l) => l.trim());
  const z = new BBQrDecoder();
  for (const l of lines) z.receive(l);
  expect(z.result.fileType).toBe('U');
  const text = new TextDecoder().decode(z.result.bytes);
  expect(text).toContain('Zlib compressed');
});

test('classify detects formats', () => {
  const psbt = new Uint8Array(readFileSync(join(import.meta.dirname, 'data/1in2out.psbt')));
  expect(classify(base64.encode(psbt)).format).toBe('Base64');
  expect(classify(hex.encode(psbt)).format).toBe('Hex');
  expect(classify(psbt).format).toBe('Binary');
  expect(classify('bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.015').kind).toBe('bip21');
  expect(classify('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu').kind).toBe('address');
  const ur = psbtQRFrames(psbt, 'UR');
  const col = new MultiPartCollector();
  let r;
  for (let i = 0; i < 200 && (!r || r.status !== 'done'); i++) r = col.receive(ur.next ? ur.next() : ur.frames[0]);
  expect(r.status).toBe('done');
  expect(classify(base64.encode(psbt)).bytes.length).toBe(psbt.length);
  expect(hex.encode(new Uint8Array(r.payload.ur.cbor).slice(-10))).toBe(hex.encode(psbt.slice(-10)));
});

// ---- PSBT end to end ----
function fakePrevTx(script, amount) {
  return btc.RawTx.decode(btc.RawTx.encode({
    version: 2, segwitFlag: false,
    inputs: [{ txid: new Uint8Array(32).fill(7), index: 0, finalScriptSig: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ amount: 1000n, script: new Uint8Array([0x6a]) }, { amount, script }],
    witnesses: [], lockTime: 0,
  }));
}
function txidOf(raw) { return btc.Transaction.fromRaw(btc.RawTx.encode(raw), { allowUnknownOutputs: true }).id; }

function buildPsbt({ type = 'wpkh', full = true, sighash, fee = 2571n, extOut = 1500000n, selfOut = false, lockTime = 0, chgAcct = 0 } = {}) {
  const net = 'main';
  const A = account(W, type, net, 0);
  const inA = addressAt(A, type, net, 0, 5);
  const chg = addressAt(account(W, type, net, chgAcct), type, net, 1, 3);
  const pay = btc.p2wpkh(pubOf(new Uint8Array(32).fill(9)));
  const inAmount = 10000000n;
  const p = (() => {
    const N = btc.NETWORK;
    if (type === 'wpkh') return btc.p2wpkh(inA.pub, N);
    if (type === 'tr') return btc.p2tr(inA.pub.subarray(1), undefined, N);
    if (type === 'pkh') return btc.p2pkh(inA.pub, N);
    return btc.p2sh(btc.p2wpkh(inA.pub, N), N);
  })();
  const prev = fakePrevTx(p.script, inAmount);
  const tx = new btc.Transaction({ lockTime, allowUnknownOutputs: true });
  const path = [84, 0, 0].map((x) => x + 0x80000000);
  const purpose = { wpkh: 84, tr: 86, pkh: 44, shwpkh: 49 }[type];
  path[0] = purpose + 0x80000000;
  const inp = { txid: txidOf(prev), index: 1, sequence: 0xfffffffd, witnessUtxo: { script: p.script, amount: inAmount } };
  if (full && type !== 'tr') inp.nonWitnessUtxo = prev;
  if (type === 'pkh') delete inp.witnessUtxo;
  if (type === 'shwpkh') inp.redeemScript = p.redeemScript;
  if (type === 'tr') { inp.tapInternalKey = inA.pub.subarray(1); inp.tapBip32Derivation = [[inA.pub.subarray(1), { hashes: [], der: { fingerprint: W.root.fingerprint, path: [...path, 0, 5] } }]]; }
  else inp.bip32Derivation = [[inA.pub, { fingerprint: W.root.fingerprint, path: [...path, 0, 5] }]];
  if (sighash !== undefined) inp.sighashType = sighash;
  tx.addInput(inp);
  tx.addOutput({ script: pay.script, amount: extOut });
  const chgAmount = inAmount - extOut - fee;
  const outChg = { script: payOf(type, chg.pub).script, amount: chgAmount };
  if (type === 'tr') { outChg.tapInternalKey = chg.pub.subarray(1); outChg.tapBip32Derivation = [[chg.pub.subarray(1), { hashes: [], der: { fingerprint: W.root.fingerprint, path: [path[0], path[1], 0x80000000 + chgAcct, 1, 3] } }]]; }
  else outChg.bip32Derivation = [[chg.pub, { fingerprint: W.root.fingerprint, path: [path[0], path[1], 0x80000000 + chgAcct, 1, 3] }]];
  tx.addOutput(outChg);
  if (selfOut) {
    const r = addressAt(A, type, net, 0, 1);
    tx.addOutput({ script: payOf(type, r.pub).script, amount: 1000n, bip32Derivation: type === 'tr' ? undefined : [[r.pub, { fingerprint: W.root.fingerprint, path: [...path, 0, 1] }]] });
  }
  return tx.toPSBT();
}
function payOf(type, pub) {
  const N = btc.NETWORK;
  if (type === 'wpkh') return btc.p2wpkh(pub, N);
  if (type === 'tr') return btc.p2tr(pub.subarray(1), undefined, N);
  if (type === 'pkh') return btc.p2pkh(pub, N);
  return btc.p2sh(btc.p2wpkh(pub, N), N);
}

for (const type of ['wpkh', 'tr', 'pkh', 'shwpkh']) {
  test('PSBT analyze + sign + finalize: ' + type, () => {
    const tx = parsePsbt(buildPsbt({ type }));
    const a = analyzePsbt(tx, W, { net: 'main' });
    expect(a.blockers).toEqual([]);
    expect(a.missing).toEqual([]);
    expect(a.confirm).toEqual([]);
    expect(a.canSign).toBe(true);
    expect(a.fee).toBe(2571n);
    expect(a.outputs[1].kind).toBe('change');
    expect(a.outputs[0].kind).toBe('external');
    const r = signPsbt(tx, a, W);
    expect(r.final).toBe(true);
    expect(r.txHex.length).toBeGreaterThan(100);
    expect(typeof psbtJSON(tx, a)).toBe('string');
  });
}

test('PSBT warnings: missing prev tx, SIGHASH_NONE, high fee, self output, date locktime', () => {
  let a = analyzePsbt(parsePsbt(buildPsbt({ full: false })), W);
  expect(a.missing.length).toBe(1);
  expect(a.canSign).toBe(false);
  a = analyzePsbt(parsePsbt(buildPsbt({ sighash: 2 })), W);
  expect(a.blockers[0].title).toMatch(/SIGHASH_NONE/);
  a = analyzePsbt(parsePsbt(buildPsbt({ fee: 186000n, selfOut: true, lockTime: 1800000000 })), W);
  const ids = a.confirm.map((c) => c.id).sort();
  expect(ids).toEqual(['fee', 'lt', 'rate', 'self3']);
  expect(a.canSign).toBe(true);
});

test('PSBT from another seed is refused', () => {
  const other = walletFromMnemonic(ABANDON, 'passphrase');
  const a = analyzePsbt(parsePsbt(buildPsbt({})), other);
  expect(a.canSign).toBe(false);
  expect(a.blockers[0].body).toMatch(/73C5DA0A/);
});

test('PSBT signed by account-level zprv and by single key', () => {
  const kp = accountKeys(W, 'wpkh', 'main', 0, null, true);
  const wz = walletFromXkey(readXkey(kp.slip));
  const tx = parsePsbt(buildPsbt({}));
  const a = analyzePsbt(tx, wz);
  expect(a.canSign).toBe(true);
  expect(signPsbt(tx, a, wz).final).toBe(true);
  const A = account(W, 'wpkh', 'main', 0);
  const key = A.node.deriveChild(0).deriveChild(5);
  const wk = walletFromKeys([{ priv: key.privateKey, compressed: true, type: 'wpkh', net: 'main' }]);
  const tx2 = parsePsbt(buildPsbt({}));
  const a2 = analyzePsbt(tx2, wk);
  expect(a2.inputs[0].own).toBeTruthy();
  expect(signPsbt(tx2, a2, wk).final).toBe(true);
});

test('real Coinkite test PSBT parses', () => {
  const psbt = new Uint8Array(readFileSync(join(import.meta.dirname, 'data/1in2out.psbt')));
  const tx = parsePsbt(psbt);
  const a = analyzePsbt(tx, W);
  expect(a.outputs.length).toBe(2);
  expect(a.canSign).toBe(false);
});

test('PSBT protections found in review (audit regressions)', () => {
  // whole input to fee
  let a = analyzePsbt(parsePsbt(buildPsbt({ extOut: 0n, fee: 10000000n })), W);
  expect(a.confirm.map((c) => c.id)).toContain('feeall');
  expect(a.clean).toBe(false);
  // change into another account is not "verified change"
  a = analyzePsbt(parsePsbt(buildPsbt({ chgAcct: 7 })), W);
  expect(a.outputs[1].kind).toBe('unusual');
  expect(a.confirm.map((c) => c.id)).toContain('path2');
  // mainnet coins while Testnet is selected
  a = analyzePsbt(parsePsbt(buildPsbt({})), W, { net: 'test' });
  expect(a.canSign).toBe(false);
  expect(a.blockers.map((b) => b.title).join()).toMatch(/another network/);
  // signing refuses when blocked and never mutates the original
  const tx = parsePsbt(buildPsbt({ sighash: 2 }));
  const before = hex.encode(tx.toPSBT());
  expect(() => signPsbt(tx, analyzePsbt(tx, W), W)).toThrow();
  expect(hex.encode(tx.toPSBT())).toBe(before);
});

test('every private-key export restores to the same address (restore from a private key)', () => {
  for (const net of ['main', 'test']) {
    for (const type of ['wpkh', 'shwpkh', 'pkh', 'tr']) {
      const A = account(W, type, net, 0);
      const a0 = addressAt(A, type, net, 0, 0);
      const priv = a0.node.privateKey;
      const wif = encodeWIF(priv, net, true);
      // Single address: Private key screen formats (WIF, Electrum, hex, descriptor).
      const single = [wif, withChecksum(TYPES[type].tmpl.replace('KEY', wif)), TYPES[type].tmpl.replace('KEY', wif)];
      if (ELECTRUM_PREFIX[type]) single.push(ELECTRUM_PREFIX[type] + ':' + wif);
      for (const line of single) {
        const k = parseKeyLine(line);
        expect(keyAddress(k, k.type || type, k.net)).toBe(a0.address);
        if (line !== wif) expect(k.type).toBe(type);
      }
      const h = parseKeyLine(hex.encode(priv));
      expect(h.net).toBe(null); // network is chosen on Check private keys
      expect(keyAddress(h, type, net)).toBe(a0.address);
      // Account: xprv/tprv, SLIP-132 and descriptor.
      const P = accountKeys(W, type, net, 0, null, true);
      for (const v of [P.x, P.slip, P.desc].filter(Boolean)) {
        const info = readXkey(v);
        const t = info.type || type;
        const wx = walletFromXkey(info, t);
        const A2 = account(wx, t, info.net, 0);
        expect(addressAt(A2, t, info.net, 0, 0).address).toBe(a0.address);
        expect(A2.path).toBe(A.path);
      }
    }
  }
});

test('descriptors from other wallets (Bitcoin Core) restore', () => {
  const A = account(W, 'wpkh', 'main', 0);
  const first = addressAt(A, 'wpkh', 'main', 0, 0);
  const wif = encodeWIF(first.node.privateKey);
  // Single key with origin info, and combo() (type chosen by the user, no Taproot).
  const o = parseKeyLine(withChecksum('wpkh([73c5da0a/84h/0h/0h/0/0]' + wif + ')'));
  expect(o.type).toBe('wpkh');
  expect(keyAddress(o, 'wpkh', 'main')).toBe(first.address);
  expect(parseKeyLine(withChecksum('combo(' + wif + ')')).type).toBe(null);
  expect(parseKeyLine(withChecksum('combo(' + encodeWIF(first.node.privateKey, 'main', false) + ')')).type).toBe('pkh');
  // Master key with the account path after it.
  const root = serializeExt(W.root, 'xprv');
  for (const d of ['wpkh(' + root + '/84h/0h/0h/<0;1>/*)', 'wpkh([73c5da0a]' + root + "/84'/0'/0'/0/*)"]) {
    const info = readXkey(withChecksum(d));
    expect(info.path).toBe("m/84'/0'/0'");
    expect(info.fp).toBe('73C5DA0A');
    const wx = walletFromXkey(info, 'wpkh');
    expect(addressAt(account(wx, 'wpkh', 'main', 0), 'wpkh', 'main', 0, 0).address).toBe(first.address);
  }
  expect(() => readXkey(withChecksum('wpkh(' + root + '/84h/0h/0h/0/0)'))).toThrow(/one derived key/);
});

test('restore input errors are clear', () => {
  const wif = encodeWIF(new Uint8Array(32).fill(7));
  expect(() => parseKeyLine('wpkh(' + wif + ')#aaaaaaaa')).toThrow(/checksum/);
  expect(() => parseKeyLine(withChecksum('wpkh(' + encodeWIF(new Uint8Array(32).fill(7), 'main', false) + ')'))).toThrow(/compressed/);
  expect(() => parseKeyLine(withChecksum('wpkh(' + wif + '/0)'))).toThrow(/derivation path/);
  const root = serializeExt(W.root, 'xprv');
  expect(looksExtended(root)).toBe(true);
  expect(looksExtended(withChecksum('wpkh([73c5da0a/84h/0h/0h]' + root + '/<0;1>/*)'))).toBe(true);
  expect(looksExtended(wif)).toBe(false);
  expect(() => parseKeyLine(root)).toThrow(/Master key/);
  expect(() => readXkey(withChecksum('combo(' + root + ')'))).toThrow(/single keys/);
});
