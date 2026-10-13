// Builds single-input PSBTs for the public test seed "abandon … about" (fingerprint 73C5DA0A), for
// the tests and for `npm run fixtures`. NEVER send real funds to this seed: it is public.
import * as btc from '@scure/btc-signer';
import { walletFromMnemonic, account, addressAt } from '../src/core/wallet.js';
import { pubOf } from '../src/core/keys.js';

export const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
export const W = walletFromMnemonic(ABANDON, '');

function fakePrevTx(script, amount) {
  return btc.RawTx.decode(btc.RawTx.encode({
    version: 2, segwitFlag: false,
    inputs: [{ txid: new Uint8Array(32).fill(7), index: 0, finalScriptSig: new Uint8Array(), sequence: 0xffffffff }],
    outputs: [{ amount: 1000n, script: new Uint8Array([0x6a]) }, { amount, script }],
    witnesses: [], lockTime: 0,
  }));
}
function txidOf(raw) { return btc.Transaction.fromRaw(btc.RawTx.encode(raw), { allowUnknownOutputs: true }).id; }

export function payOf(type, pub) {
  const N = btc.NETWORK;
  if (type === 'wpkh') return btc.p2wpkh(pub, N);
  if (type === 'tr') return btc.p2tr(pub.subarray(1), undefined, N);
  if (type === 'pkh') return btc.p2pkh(pub, N);
  return btc.p2sh(btc.p2wpkh(pub, N), N);
}

/**
 * One input (receive #5 of account 0), one external output, one change output (change #3 of
 * `chgAcct`), and optionally a payment to our own receive #1.
 */
export function buildPsbt({ type = 'wpkh', full = true, sighash, fee = 2571n, extOut = 1500000n, selfOut = false, lockTime = 0, chgAcct = 0 } = {}) {
  const net = 'main';
  const A = account(W, type, net, 0);
  const inA = addressAt(A, type, net, 0, 5);
  const chg = addressAt(account(W, type, net, chgAcct), type, net, 1, 3);
  const pay = btc.p2wpkh(pubOf(new Uint8Array(32).fill(9)));
  const inAmount = 10000000n;
  const p = payOf(type, inA.pub);
  const prev = fakePrevTx(p.script, inAmount);
  const tx = new btc.Transaction({ lockTime, allowUnknownOutputs: true });
  const purpose = { wpkh: 84, tr: 86, pkh: 44, shwpkh: 49 }[type];
  const path = [purpose, 0, 0].map((x) => x + 0x80000000);
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
  const chgPath = [path[0], path[1], 0x80000000 + chgAcct, 1, 3];
  const outChg = { script: payOf(type, chg.pub).script, amount: chgAmount };
  if (type === 'tr') { outChg.tapInternalKey = chg.pub.subarray(1); outChg.tapBip32Derivation = [[chg.pub.subarray(1), { hashes: [], der: { fingerprint: W.root.fingerprint, path: chgPath } }]]; }
  else outChg.bip32Derivation = [[chg.pub, { fingerprint: W.root.fingerprint, path: chgPath }]];
  tx.addOutput(outChg);
  if (selfOut) {
    const r = addressAt(A, type, net, 0, 1);
    tx.addOutput({ script: payOf(type, r.pub).script, amount: 1000n, bip32Derivation: type === 'tr' ? undefined : [[r.pub, { fingerprint: W.root.fingerprint, path: [...path, 0, 1] }]] });
  }
  return tx.toPSBT();
}
