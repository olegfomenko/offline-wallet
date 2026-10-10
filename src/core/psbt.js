// PSBT review and signing. Every claim shown to the user is checked here: input ownership by
// re-deriving the key, amounts against the full previous transaction, change by re-deriving the
// output script from its path. Anything that can't be proven is reported, not assumed.
import * as btc from '@scure/btc-signer';
import { hex, equal, utf8, sha256d } from './util.js';
import { HARDENED_OFFSET, payment, scriptToAddress, scriptKind, formatPath, fpHex, NETS, xonly } from './hd.js';
import { pubOf } from './keys.js';

const TX_OPTS = {
  unknown: 'ignore', proprietary: 'ignore', allowUnknownOutputs: true, allowUnknownInputs: true,
  lowR: true, allowLegacyWitnessUtxo: true, disableScriptCheck: false,
};
export const SIGHASH_NAMES = { 0: 'DEFAULT', 1: 'ALL', 2: 'NONE', 3: 'SINGLE', 0x81: 'ALL|ANYONECANPAY', 0x82: 'NONE|ANYONECANPAY', 0x83: 'SINGLE|ANYONECANPAY' };
const UNUSUAL_INDEX = 1000;
const MAX_PATH = 12;          // derivation paths from a PSBT longer than this are ignored
const HIGH_FEE_RATE = 500;    // sat/vB above which the fee rate must be confirmed
const STD_PURPOSE = { 44: 'pkh', 49: 'shwpkh', 84: 'wpkh', 86: 'tr' };

export function parsePsbt(bytes) {
  return btc.Transaction.fromPSBT(bytes, TX_OPTS);
}

function typeOfScript(script) {
  if (script.length && script[0] === 0x6a) return 'opreturn';
  try {
    const t = btc.OutScript.decode(script).type;
    if (t === 'wpkh' || t === 'pkh' || t === 'tr') return t;
    if (t === 'sh') return 'sh';
    return t;
  } catch (e) { return script[0] === 0x6a ? 'opreturn' : 'unknown'; }
}

/** Find the private node for a BIP32 derivation row, or null. Pubkey equality is checked by the caller. */
function nodeFor(w, fingerprint, path) {
  if (path.length > MAX_PATH) return null;
  if (w.root) {
    if ((fingerprint >>> 0) !== (w.root.fingerprint >>> 0)) return null;
    let n = w.root;
    for (const i of path) n = n.deriveChild(i);
    return n;
  }
  if (w.node) {
    if (path.length < 2) return null;
    const tail = path.slice(-2);
    if (tail.some((i) => i >= HARDENED_OFFSET)) return null;
    return w.node.deriveChild(tail[0]).deriveChild(tail[1]);
  }
  return null;
}

/** Which of our keys controls `script`? Returns { priv, pub, type, path, branch, index } or null. */
function matchOwn(w, script, derivs, tapDerivs, net) {
  const st = typeOfScript(script);
  if (w.kind === 'keys') {
    for (const k of w.keys) {
      const pub = pubOf(k.priv, k.compressed);
      for (const t of k.compressed ? ['wpkh', 'shwpkh', 'pkh', 'tr'] : ['pkh']) {
        if (equal(payment(t, pub, net).script, script)) return { priv: k.priv, pub, type: t, path: null, label: k.label, compressed: k.compressed };
      }
    }
    return null;
  }
  const rows = [];
  for (const [pub, d] of derivs || []) rows.push({ pub, fp: d.fingerprint, path: d.path, tap: false });
  for (const [pub, d] of tapDerivs || []) if (!d.hashes || d.hashes.length === 0) rows.push({ pub, fp: d.der.fingerprint, path: d.der.path, tap: true });
  let mismatch = null;
  for (const r of rows) {
    let node;
    try { node = nodeFor(w, r.fp, r.path); } catch (e) { node = null; }
    if (!node || !node.privateKey) continue;
    const pub = node.publicKey;
    if (r.tap ? !equal(pub.subarray(1), r.pub) : !equal(pub, r.pub)) continue;
    const types = r.tap ? ['tr'] : st === 'sh' ? ['shwpkh'] : st === 'pkh' ? ['pkh'] : ['wpkh'];
    for (const t of types) {
      if (equal(payment(t, pub, net).script, script)) {
        const p = r.path;
        return {
          node, pub, type: t, path: formatPath(p), fp: fpHex(r.fp).toUpperCase(), pathArr: p.slice(), fpNum: r.fp >>> 0, compressed: true,
          branch: p.length >= 2 ? p[p.length - 2] : null, index: p.length >= 1 ? p[p.length - 1] : null,
        };
      }
    }
    mismatch = mismatch || { mismatch: true, path: formatPath(r.path) };
  }
  return mismatch;
}

const prefixKey = (own) => own.fpNum + '|' + own.pathArr.slice(0, -2).join('/');
/** For standard purposes, the coin type must match the selected network. */
function coinMismatch(own, net) {
  const p = own.pathArr;
  if (!p || p.length < 2 || p[0] < HARDENED_OFFSET || !STD_PURPOSE[p[0] - HARDENED_OFFSET]) return false;
  return p[1] !== HARDENED_OFFSET + NETS[net].coin;
}

/** Fingerprints the PSBT says it wants, for a helpful message when nothing matches. */
function wantedFingerprints(tx) {
  const set = new Set();
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    for (const [, d] of inp.bip32Derivation || []) set.add(fpHex(d.fingerprint).toUpperCase());
    for (const [, d] of inp.tapBip32Derivation || []) set.add(fpHex(d.der.fingerprint).toUpperCase());
  }
  return [...set];
}

function txidOfRaw(rawTxObj) {
  const t = btc.Transaction.fromRaw(btc.RawTx.encode(rawTxObj), { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true, allowUnknownVersion: true });
  return t.id;
}

function relTimelock(seq, version) {
  if (version < 2 || seq & 0x80000000) return null;
  const v = seq & 0xffff;
  if (seq & 0x00400000) return { kind: 'time', seconds: v * 512 };
  return { kind: 'blocks', blocks: v };
}

function opReturnData(script) {
  try {
    const dec = btc.Script.decode(script);
    const pushes = dec.slice(1).filter((x) => x instanceof Uint8Array);
    if (!pushes.length) return { hex: '', text: null };
    const data = pushes.length === 1 ? pushes[0] : new Uint8Array(pushes.reduce((a, b) => a.concat(Array.from(b)), []));
    let text = null;
    try { const s = new TextDecoder('utf-8', { fatal: true }).decode(data); if (/^[\x20-\x7e -￿]*$/.test(s)) text = s; } catch (e) { /* binary */ }
    return { hex: hex.encode(data), text };
  } catch (e) { return { hex: hex.encode(script.subarray(1)), text: null }; }
}

// Approximate witness/scriptSig size once signed, for the fee rate.
const SIGNED_SIZE = {
  wpkh: { ss: 0, wit: 108 }, shwpkh: { ss: 23, wit: 108 }, pkh: { ss: 107, wit: 0 }, tr: { ss: 0, wit: 66 },
};
function estimateVsize(tx, inputs) {
  let base = 4 + 4; // version + locktime
  let wit = 0;
  let anyWit = false;
  base += varSize(tx.inputsLength) + varSize(tx.outputsLength);
  inputs.forEach((inp) => {
    const s = SIGNED_SIZE[inp.scriptType] || SIGNED_SIZE.wpkh;
    base += 32 + 4 + 4 + varSize(s.ss) + s.ss;
    if (s.wit) { wit += s.wit; anyWit = true; } else wit += 1;
  });
  for (let j = 0; j < tx.outputsLength; j++) {
    const o = tx.getOutput(j);
    base += 8 + varSize(o.script.length) + o.script.length;
  }
  const weight = base * 4 + (anyWit ? wit + 2 : 0);
  return Math.ceil(weight / 4);
}
const TYPE_NAMES = { wpkh: 'Native SegWit', shwpkh: 'Nested SegWit', pkh: 'Legacy', tr: 'Taproot' };
const varSize = (n) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

export function locktimeInfo(lt) {
  if (!lt) return { kind: 'none', value: 0 };
  if (lt < 500000000) return { kind: 'block', value: lt };
  return { kind: 'time', value: lt, date: new Date(lt * 1000) };
}

/**
 * Analyze a PSBT for this wallet. Returns everything the review screen shows plus `issues`:
 *   blockers (can't sign), missing (data needed), confirm (must tick), info (good to know), notes (before you sign).
 */
export function analyzePsbt(tx, w, { net = 'main', feeLimitPct = 5 } = {}) {
  const version = tx.version;
  const inputs = [];
  const blockers = [], missing = [], confirm = [], info = [], notes = [];
  let inSum = 0n, inKnown = true;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const n = i + 1;
    const txid = hex.encode(inp.txid);
    const outpoint = txid + ':' + inp.index;
    let prevScript = null, amount = null, amountProven = false;
    if (inp.nonWitnessUtxo) {
      let ok = false;
      try { ok = txidOfRaw(inp.nonWitnessUtxo) === txid; } catch (e) { ok = false; }
      const out = inp.nonWitnessUtxo.outputs[inp.index];
      if (!ok || !out) blockers.push({ title: 'Input ' + n + ': previous transaction doesn’t match', body: 'The full previous transaction included for this input has a different ID than the coin being spent. The PSBT is inconsistent or was tampered with. Don’t sign it.' });
      else {
        prevScript = out.script; amount = out.amount; amountProven = true;
        if (inp.witnessUtxo && (inp.witnessUtxo.amount !== out.amount || !equal(inp.witnessUtxo.script, out.script))) {
          blockers.push({ title: 'Input ' + n + ': amounts disagree', body: 'The input amount in the PSBT differs from the previous transaction. This is how fee attacks look. Don’t sign it.' });
        }
      }
    } else if (inp.witnessUtxo) {
      prevScript = inp.witnessUtxo.script; amount = inp.witnessUtxo.amount;
    }
    const scriptType = prevScript ? typeOfScript(prevScript) : null;
    let own = null;
    if (prevScript) own = matchOwn(w, prevScript, inp.bip32Derivation, inp.tapBip32Derivation, net);
    const isTr = scriptType === 'tr';
    if (prevScript && !amountProven && isTr) amountProven = true; // BIP341 signs all input amounts
    const sighash = inp.sighashType;
    const seq = inp.sequence ?? 0xffffffff;
    const rel = relTimelock(seq, version);
    const finalized = !!(inp.finalScriptSig || inp.finalScriptWitness);
    const signedAlready = !!((inp.partialSig && inp.partialSig.length) || inp.tapKeySig);
    const rec = {
      n, txid, vout: inp.index, outpoint, amount, amountProven, scriptType: own && own.type ? own.type : scriptType === 'sh' ? 'shwpkh' : scriptType,
      scriptName: prevScript ? scriptKind(prevScript) : '—', address: prevScript ? scriptToAddress(prevScript, net) : null,
      own: own && !own.mismatch ? own : null, sighash, sighashName: sighash === undefined ? 'ALL' : SIGHASH_NAMES[sighash] || '0x' + sighash.toString(16),
      sequence: seq, rel, finalized, signedAlready,
      pubkey: own && own.pub ? hex.encode(own.pub) : null,
      derivs: (inp.bip32Derivation || []).map(([pub, d]) => ({ pubkey: hex.encode(pub), fp: fpHex(d.fingerprint), path: formatPath(d.path) }))
        .concat((inp.tapBip32Derivation || []).map(([pub, d]) => ({ pubkey: hex.encode(pub), fp: fpHex(d.der.fingerprint), path: formatPath(d.der.path), tap: true }))),
      unknownCount: (inp.unknown || []).length,
    };
    inputs.push(rec);
    if (amount === null) inKnown = false; else inSum += amount;
    if (!prevScript) missing.push({ title: 'Input ' + n + ' comes without any previous output data', body: 'Neither the previous transaction nor its output is included, so the amount and owner can’t be checked. Export again with full input data.' });
    else if (rec.own && !amountProven) {
      missing.push({ title: 'Input ' + n + ' comes without its previous transaction', body: (scriptType === 'pkh' ? 'It’s a legacy input' : 'It’s a SegWit v0 input') + ', so without that data the input amount, and with it the fee, can’t be proven. Export again with full input data. (Taproot inputs don’t need it.)' });
    }
    if (rec.own && coinMismatch(rec.own, net)) blockers.push({ title: 'Input ' + n + ' is on another network', body: 'Its path ' + rec.own.path + ' uses coin type ' + (rec.own.pathArr[1] - HARDENED_OFFSET) + '′, but ' + NETS[net].name + ' is selected. Signing would spend coins on the other network. Switch the network on the Addresses screen if that’s what you mean.' });
    if (rec.own && rec.own.compressed === false) blockers.push({ title: 'Input ' + n + ' uses an uncompressed key', body: 'This signer can’t sign with uncompressed (old-style) keys. Sweep that key with a wallet that supports them.' });
    if (!rec.own && prevScript && !amountProven && !finalized) info.push({ title: 'Input ' + n + '’s amount isn’t proven', body: 'It isn’t from this wallet and comes without its previous transaction, so the fee shown depends on what the other party claims.' });
    if (own && own.mismatch) blockers.push({ title: 'Input ' + n + ': key doesn’t match its address', body: 'Its path ' + own.path + ' derives a key from this seed, but not the one for the coin being spent. Don’t sign.' });
    if (rec.own && sighash !== undefined && sighash !== 0 && sighash !== 1) {
      blockers.push({ title: 'Input ' + n + ' asks for SIGHASH_' + rec.sighashName, body: 'That signature would let others change the transaction after you sign' + (sighash & 0x80 ? ', adding or removing inputs' : '') + (sighash & 3 && (sighash & 3) !== 1 ? ' and where the money goes' : '') + '. Ask your online wallet for a normal transaction and scan it again. Special signing types are an expert option, off by default.' });
    }
    if (rel) info.push({ title: 'Input ' + n + ' has a relative timelock', body: rel.kind === 'blocks' ? rel.blocks + ' blocks (about ' + humanBlocks(rel.blocks) + ') after its coin was confirmed.' : humanSecs(rel.seconds) + ' after its coin was confirmed.' });
    if (!rec.own && prevScript && !finalized) info.push({ title: 'Input ' + n + ' isn’t from this wallet', body: 'This device won’t sign it. Someone else has to, before the transaction can be sent.' });
  }
  const seenOutpoints = new Set();
  for (const x of inputs) {
    if (seenOutpoints.has(x.outpoint)) blockers.push({ title: 'Input ' + x.n + ' spends the same coin twice', body: 'Outpoint ' + x.outpoint + ' appears more than once. The transaction can’t be valid and its amounts are wrong.' });
    seenOutpoints.add(x.outpoint);
  }
  const ownInputs = inputs.filter((x) => x.own);
  // Accounts the inputs come from: change must go back to one of them, with the same script type.
  const inputAccounts = new Map();
  for (const x of ownInputs) if (x.own.pathArr) {
    const k = prefixKey(x.own);
    if (!inputAccounts.has(k)) inputAccounts.set(k, new Set());
    inputAccounts.get(k).add(x.own.type);
  }
  if (!ownInputs.length) {
    const fps = wantedFingerprints(tx);
    blockers.push({
      title: 'No input belongs to this wallet',
      body: fps.length && w.fp && !fps.includes(w.fp)
        ? 'The transaction expects key fingerprint ' + fps.join(', ') + ', but this wallet is ' + w.fp + '. Check the seed, the passphrase, and which wallet made it.'
        : 'Nothing here can be signed with this wallet. Check the seed, the passphrase, the address type and which wallet made it.',
    });
  }

  // outputs
  const outputs = [];
  let outSum = 0n, sentExt = 0n, toSelf = 0n;
  for (let j = 0; j < tx.outputsLength; j++) {
    const o = tx.getOutput(j);
    const n = j + 1;
    const amount = o.amount;
    outSum += amount;
    const st = typeOfScript(o.script);
    const rec = { n, amount, script: hex.encode(o.script), address: scriptToAddress(o.script, net), scriptName: st === 'opreturn' ? 'OP_RETURN' : scriptKind(o.script), kind: 'external', own: null, data: null,
      derivs: (o.bip32Derivation || []).map(([pub, d]) => ({ pubkey: hex.encode(pub), fp: fpHex(d.fingerprint), path: formatPath(d.path) }))
        .concat((o.tapBip32Derivation || []).map(([pub, d]) => ({ pubkey: hex.encode(pub), fp: fpHex(d.der.fingerprint), path: formatPath(d.der.path), tap: true }))) };
    if (st === 'opreturn') { rec.kind = 'data'; rec.data = opReturnData(o.script); }
    else {
      const own = matchOwn(w, o.script, o.bip32Derivation, o.tapBip32Derivation, net);
      if (own && own.mismatch) {
        confirm.push({ id: 'claim' + n, title: 'Output ' + n + ' claims to be yours but isn’t', body: 'It carries path ' + own.path + ' from this wallet, but that path makes a different address. Treat it as a payment to someone else.' });
      } else if (own) {
        rec.own = own;
        const acct = own.pathArr ? inputAccounts.get(prefixKey(own)) : null;
        if (w.kind === 'keys') rec.kind = 'change';
        else if (acct && acct.has(own.type) && (own.branch === 0 || own.branch === 1) && !coinMismatch(own, net)) rec.kind = own.branch === 1 ? 'change' : 'mine';
        else {
          rec.kind = 'unusual';
          confirm.push({ id: 'path' + n, title: 'Output ' + n + ' goes to this wallet at an unusual path', body: 'Path ' + own.path + ' (' + TYPE_NAMES[own.type] + ') is not a receive or change address of the account your inputs come from' + (coinMismatch(own, net) ? ', and its coin type doesn’t match ' + NETS[net].name : '') + '. The coins stay yours, but your online wallet probably won’t show them. Sign only if you expect this.' });
        }
        if (rec.kind === 'mine') confirm.push({ id: 'self' + n, title: 'Output ' + n + ' pays your own receive address #' + own.index, body: 'In this wallet but not change. Fine if you meant to.' });
        if (own.index !== null && own.index > UNUSUAL_INDEX) confirm.push({ id: 'idx' + n, title: (rec.kind === 'change' ? 'Change' : 'Output ' + n) + ' at index ' + own.index.toLocaleString('en-US'), body: 'Verified from its path. Your online wallet may not show it until its gap limit reaches that far.' });
      }
    }
    if (rec.kind === 'external') sentExt += amount;
    if (rec.kind === 'mine') toSelf += amount;
    outputs.push(rec);
  }

  const fee = inKnown ? inSum - outSum : null;
  if (fee !== null && fee < 0n) blockers.push({ title: 'Outputs are larger than inputs', body: 'This transaction can’t be valid.' });
  const vsize = estimateVsize(tx, inputs);
  const feeRate = fee !== null ? Number(fee) / vsize : null;
  const sentBase = sentExt > 0n ? sentExt : toSelf > 0n ? toSelf : outSum;
  const feePct = fee !== null && sentBase > 0n ? (Number(fee) / Number(sentBase)) * 100 : null;
  if (fee !== null && fee > 0n && outSum === 0n) confirm.push({ id: 'feeall', title: 'Everything goes to the fee', body: 'No output carries any value: all ' + Number(fee).toLocaleString('en-US') + ' sats of the inputs go to the miner. This is almost never what you want.' });
  if (feeRate !== null && feeRate > HIGH_FEE_RATE) confirm.push({ id: 'rate', title: 'Fee rate is ' + fmtRate(feeRate) + ' sat/vB', body: 'That is very high. This device can’t see the network: check current fees in your online wallet.' });
  if (feePct !== null && feePct > feeLimitPct) confirm.push({ id: 'fee', title: 'Fee is ' + fmtPct(feePct) + ' of the amount sent', body: 'Above your ' + feeLimitPct + '% limit. This device can’t know network fees: check ' + fmtRate(feeRate) + ' sat/vB in your online wallet.' });

  const lt = locktimeInfo(tx.lockTime);
  if (lt.kind === 'time') confirm.push({ id: 'lt', title: 'Locktime is a date: ' + fmtDate(lt.date), body: 'Can’t be mined before then. This device has no trusted clock: check it in your online wallet.' });
  if (lt.kind === 'block') notes.push({ mark: '!', text: 'Locktime is block ' + lt.value.toLocaleString('en-US') + '. Check in your online wallet that it isn’t far in the future.' });
  const rbf = inputs.some((x) => x.sequence < 0xfffffffe);
  const unknownGlobal = (tx.global.unknown || []).length + inputs.reduce((a, x) => a + x.unknownCount, 0) + (tx.global.proprietary || []).length;
  if (unknownGlobal) info.push({ title: unknownGlobal + ' unknown PSBT field' + (unknownGlobal > 1 ? 's' : ''), body: 'Kept unchanged and shown in JSON.' });
  if (ownInputs.length && ownInputs.every((x) => x.signedAlready)) info.push({ title: 'Already signed', body: 'Every input of this wallet already has a signature. Signing again gives the same transaction.' });

  const changeOk = outputs.filter((o) => o.kind === 'change').length;
  const checks = [];
  if (ownInputs.length === inputs.length) checks.push({ ok: inKnown && inputs.every((x) => x.amountProven), text: (inputs.length > 1 ? 'All ' + inputs.length + ' inputs belong' : 'The input belongs') + ' to this wallet' + (inputs.every((x) => x.amountProven) ? ', amounts confirmed' + (inputs.some((x) => x.scriptType !== 'tr') ? ' from the full previous transactions.' : ' by Taproot signing.') : '.') });
  else checks.push({ ok: false, text: ownInputs.length + ' of ' + inputs.length + ' inputs belong to this wallet.' });
  if (changeOk) checks.push({ ok: true, text: 'Change goes back to this wallet at a path it derives itself.' });
  else checks.push({ ok: true, text: 'No change output: everything goes to the outputs shown.' });
  if (inputs.every((x) => !x.own || x.sighash === undefined || x.sighash <= 1)) checks.push({ ok: true, text: 'Every input signs with SIGHASH_ALL.' });
  if (lt.kind === 'block') checks.push({ ok: false, text: 'Locktime is block ' + lt.value.toLocaleString('en-US') + '. This device is offline and doesn’t know the current block, so check in your online wallet that it is not far in the future.' });
  if (unknownGlobal) checks.push({ ok: false, text: unknownGlobal + ' unknown PSBT field' + (unknownGlobal > 1 ? 's' : '') + '. Kept unchanged, shown in JSON.' });

  const summaryOk = blockers.length + missing.length + confirm.length === 0;
  if (summaryOk) notes.push({ mark: '✓', text: (changeOk ? 'Change verified from its path, i' : 'I') + 'nputs and amounts checked, normal signing.', details: true });

  return {
    txid: tx.id, version, lockTime: tx.lockTime, lt, rbf, psbtVersion: tx.global.version || 0, net,
    inputs, outputs, inSum: inKnown ? inSum : null, outSum, fee, vsize, feeRate, feePct, sentExt, toSelf,
    blockers, missing, confirm, info, notes, checks, clean: summaryOk, unknownCount: unknownGlobal,
    canSign: blockers.length === 0 && missing.length === 0,
  };
}

/**
 * Sign every input of this wallet on a copy of the PSBT; nothing is changed unless all succeed.
 * Returns { psbt, final, txHex, txid, signedCount }.
 */
export function signPsbt(tx, analysis, w) {
  if (!analysis.canSign) throw new Error('This transaction has blockers or missing data.');
  const t = btc.Transaction.fromPSBT(tx.toPSBT(), TX_OPTS);
  let signed = 0;
  const allowed = [btc.SigHash.DEFAULT, btc.SigHash.ALL];
  for (const inp of analysis.inputs) {
    if (!inp.own || inp.finalized) continue;
    const idx = inp.n - 1;
    const cur = t.getInput(idx);
    // Fill in what we know and the PSBT left out, so signing doesn't fail on it.
    if (inp.own.type === 'shwpkh' && !cur.redeemScript) t.updateInput(idx, { redeemScript: payment('shwpkh', inp.own.pub, analysis.net).redeemScript });
    if (inp.own.type === 'tr' && !cur.tapInternalKey) t.updateInput(idx, { tapInternalKey: xonly(inp.own.pub) });
    const priv = inp.own.node ? inp.own.node.privateKey : inp.own.priv;
    if (!priv) throw new Error('Input ' + inp.n + ': no private key.');
    if (!t.signIdx(priv, idx, allowed)) throw new Error('Input ' + inp.n + ' could not be signed.');
    signed++;
  }
  if (!signed && !analysis.inputs.some((x) => x.own && x.signedAlready)) throw new Error('No input could be signed.');
  const psbt = t.toPSBT();
  let final = false, txHex = null, txid = analysis.txid;
  try {
    const t2 = btc.Transaction.fromPSBT(psbt, TX_OPTS);
    t2.finalize();
    txHex = hex.encode(t2.extract());
    txid = t2.id;
    final = true;
  } catch (e) { /* someone else still has to sign */ }
  return { psbt, final, txHex, txid, signedCount: signed };
}

/** JSON view of the PSBT in the spirit of Bitcoin Core's decodepsbt. */
export function psbtJSON(tx, a) {
  const btcAmt = (s) => (s === null || s === undefined ? null : Number(s) / 1e8);
  const obj = {
    tx: {
      txid: a.txid, version: a.version, locktime: a.lockTime,
      vin: a.inputs.map((x) => ({ txid: x.txid, vout: x.vout, sequence: x.sequence })),
      vout: a.outputs.map((o) => ({ value: btcAmt(o.amount), scriptPubKey: { hex: o.script, address: o.address || undefined, type: o.scriptName } })),
    },
    psbt_version: a.psbtVersion,
    inputs: a.inputs.map((x) => ({
      amount: btcAmt(x.amount), amount_proven: x.amountProven, script_type: x.scriptName, address: x.address || undefined,
      sighash: x.sighashName, bip32_derivs: x.derivs.map((d) => ({ pubkey: d.pubkey, master_fingerprint: d.fp, path: d.path, taproot: d.tap || undefined })),
      signed: x.signedAlready || undefined, final: x.finalized || undefined,
    })),
    outputs: a.outputs.map((o) => ({ belongs_to: o.kind, bip32_derivs: o.derivs.length ? o.derivs.map((d) => ({ pubkey: d.pubkey, master_fingerprint: d.fp, path: d.path })) : undefined, op_return: o.data || undefined })),
    unknown_fields: a.unknownCount,
    fee: btcAmt(a.fee),
  };
  return JSON.stringify(obj, null, 2);
}

// ---- formatting helpers used by analysis text ----
export function fmtPct(p) { return p >= 10 ? p.toFixed(1) + '%' : p >= 1 ? p.toFixed(2).replace(/0$/, '') + '%' : p.toFixed(2) + '%'; }
export function fmtRate(r) { return r === null ? '?' : r >= 100 ? Math.round(r).toLocaleString('en-US') : r.toFixed(1); }
export function fmtDate(d) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UTC';
}
function humanBlocks(b) { const h = b * 10 / 60; return h < 48 ? Math.round(h) + ' hours' : Math.round(h / 24) + ' days'; }
function humanSecs(s) { const h = s / 3600; return h < 48 ? Math.round(h) + ' hours' : Math.round(h / 24) + ' days'; }

export { xonly, NETS, utf8, sha256d };
