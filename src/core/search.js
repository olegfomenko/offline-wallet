// "Is this address mine?" Searches accounts 0–2, all four standard types, receive and change,
// interleaved by index so common cases are found first. Runs in small slices to keep the UI alive.
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { decodeAddress, TYPES, TYPE_ORDER, stdAccountPath, NETS, normPath } from './hd.js';
import { hash160, concat, equal } from './util.js';
import { pubOf } from './keys.js';

const P2SH_PREFIX = new Uint8Array([0x00, 0x14]);

function matcher(target) {
  // returns (pub) => encoding type that matched, or null
  if (target.type === 'wpkh') return (pub) => (equal(hash160(pub), target.hash) ? 'wpkh' : null);
  if (target.type === 'pkh') return (pub) => (equal(hash160(pub), target.hash) ? 'pkh' : null);
  if (target.type === 'sh') return (pub) => (equal(hash160(concat(P2SH_PREFIX, hash160(pub))), target.hash) ? 'shwpkh' : null);
  if (target.type === 'tr') return (pub) => (equal(btc.utils.taprootTweakPubkey(pub.subarray(1), new Uint8Array())[0], target.hash) ? 'tr' : null);
  return null;
}

/**
 * @returns {Promise<null | { type, encoded, path, branch, index, acct, custom }>}
 *   type = the address type whose path held the key; encoded = the address type of `addr`.
 */
export async function findAddress(w, addr, { net, depth = 1000, cpath = {}, onProgress, isCancelled } = {}) {
  const target = decodeAddress(addr, net);
  const match = matcher(target);
  if (!match) throw new Error('Only single-key addresses (1…, 3…, bc1q…, bc1p…) can be checked.');
  if (w.kind === 'keys') {
    for (const k of w.keys) {
      const enc = match(pubOf(k.priv, k.compressed));
      if (enc) return { type: k.type, encoded: enc, path: null, label: k.label };
    }
    return null;
  }
  // the account-level branches to scan
  const combos = [];
  const pubNode = (n) => HDKey.fromExtendedKey(n.publicExtendedKey, n.versions);
  if (w.root) {
    for (const [t, p] of Object.entries(cpath)) combos.push({ type: t, base: normPath(p), acct: null, custom: true });
    for (let acct = 0; acct < 3; acct++) for (const t of TYPE_ORDER) combos.push({ type: t, base: stdAccountPath(t, net, acct), acct });
    for (const c of combos) c.node = pubNode(w.root.derive(c.base));
  } else {
    const types = w.typeFixed ? [w.defaultType] : TYPE_ORDER;
    for (const t of types) combos.push({ type: t, base: w.pathKnown ? w.acctPath : stdAccountPath(t, net, 0), acct: 0, node: pubNode(w.node), fixed: true });
  }
  const branches = [];
  for (const c of combos) for (const b of [0, 1]) branches.push({ ...c, branch: b, bnode: c.node.deriveChild(b) });
  const total = depth * branches.length;
  let done = 0, last = Date.now();
  for (let i = 0; i < depth; i++) {
    for (const br of branches) {
      const pub = br.bnode.deriveChild(i).publicKey;
      const enc = match(pub);
      done++;
      if (enc) return { type: br.type, encoded: enc, path: br.base + '/' + br.branch + '/' + i, branch: br.branch, index: i, acct: br.acct, custom: !!br.custom };
    }
    if (Date.now() - last > 40) {
      if (onProgress) onProgress(done / total);
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled && isCancelled()) return null;
      last = Date.now();
    }
  }
  return null;
}

export { TYPES, NETS };
