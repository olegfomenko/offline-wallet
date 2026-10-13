// The account and address the Addresses screens are looking at, resolved to keys. Plain functions,
// no hooks: screens call them during render and derive what they need on the spot. Nothing here is
// kept in the store, so no derived private key outlives the render that used it.
import { accountKeys } from '../core/wallet.js';
import { payment } from '../core/hd.js';
import { pubOf } from '../core/keys.js';

/** Everything about the current account selection. */
export function accountOf(st) {
  const w = st.wallet;
  const net = st.settings.net;
  const a = st.addr;
  const type = w.kind === 'xkey' && w.typeFixed ? w.defaultType : a.type;
  const cp = w.root ? a.cpath[type] : null;
  const K = accountKeys(w, type, net, a.acct, cp);
  return { w, net, type, cp, K, fixed: !w.root };
}

/** Resolve an address selection ({ keyIdx } or { base, branch, i, type }) to its keys. */
export function resolveSel(w, sel, net) {
  if (sel.keyIdx !== undefined) {
    const k = w.keys[sel.keyIdx];
    const pub = pubOf(k.priv, k.compressed);
    return { priv: k.priv, pub, compressed: k.compressed, address: payment(k.type, pub, net).address, type: k.type, path: null, key: k };
  }
  const node = w.root ? w.root.derive(sel.base).deriveChild(sel.branch).deriveChild(sel.i) : w.node.deriveChild(sel.branch).deriveChild(sel.i);
  return { node, priv: node.privateKey, pub: node.publicKey, compressed: true, address: payment(sel.type, node.publicKey, net).address, type: sel.type, path: sel.base + '/' + sel.branch + '/' + sel.i };
}
