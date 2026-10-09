// Networks, address types, BIP32 extended keys (with SLIP-132 prefixes) and output descriptors.
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';
import { concat, hash160, readU32be, u32be, fpHex } from './util.js';

export const base58check = createBase58check(sha256);

export const NETS = {
  main: { id: 'main', name: 'Mainnet', btc: btc.NETWORK, coin: 0, test: false },
  test: { id: 'test', name: 'Testnet', btc: btc.TEST_NETWORK, coin: 1, test: true },
  signet: { id: 'signet', name: 'Signet', btc: btc.TEST_NETWORK, coin: 1, test: true },
  regtest: { id: 'regtest', name: 'Regtest', btc: { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef }, coin: 1, test: true },
};

export const TYPES = {
  wpkh: { id: 'wpkh', label: 'Native SegWit', script: 'P2WPKH', purpose: 84, tmpl: 'wpkh(KEY)', short: 'SegWit', electrum: 'p2wpkh' },
  tr: { id: 'tr', label: 'Taproot', script: 'P2TR', purpose: 86, tmpl: 'tr(KEY)', short: 'Taproot', electrum: null },
  shwpkh: { id: 'shwpkh', label: 'Nested SegWit', script: 'P2SH-P2WPKH', purpose: 49, tmpl: 'sh(wpkh(KEY))', short: 'Nested', electrum: 'p2wpkh-p2sh' },
  pkh: { id: 'pkh', label: 'Legacy', script: 'P2PKH', purpose: 44, tmpl: 'pkh(KEY)', short: 'Legacy', electrum: 'p2pkh' },
};
export const TYPE_ORDER = ['wpkh', 'tr', 'shwpkh', 'pkh'];

// Extended key version bytes. SLIP-132 adds y/z (and u/v on test networks) to tell the address type.
export const VERSIONS = {
  xpub: { v: 0x0488b21e, priv: false, net: 'main', type: null },
  xprv: { v: 0x0488ade4, priv: true, net: 'main', type: null },
  ypub: { v: 0x049d7cb2, priv: false, net: 'main', type: 'shwpkh' },
  yprv: { v: 0x049d7878, priv: true, net: 'main', type: 'shwpkh' },
  zpub: { v: 0x04b24746, priv: false, net: 'main', type: 'wpkh' },
  zprv: { v: 0x04b2430c, priv: true, net: 'main', type: 'wpkh' },
  tpub: { v: 0x043587cf, priv: false, net: 'test', type: null },
  tprv: { v: 0x04358394, priv: true, net: 'test', type: null },
  upub: { v: 0x044a5262, priv: false, net: 'test', type: 'shwpkh' },
  uprv: { v: 0x044a4e28, priv: true, net: 'test', type: 'shwpkh' },
  vpub: { v: 0x045f1cf6, priv: false, net: 'test', type: 'wpkh' },
  vprv: { v: 0x045f18bc, priv: true, net: 'test', type: 'wpkh' },
};
const BY_VERSION = Object.fromEntries(Object.entries(VERSIONS).map(([name, x]) => [x.v, { name, ...x }]));

export function versionName(kind /* 'x'|'slip' */, type, net, priv) {
  const test = NETS[net].test;
  if (kind === 'slip') {
    if (type === 'wpkh') return test ? (priv ? 'vprv' : 'vpub') : priv ? 'zprv' : 'zpub';
    if (type === 'shwpkh') return test ? (priv ? 'uprv' : 'upub') : priv ? 'yprv' : 'ypub';
    return null;
  }
  return test ? (priv ? 'tprv' : 'tpub') : priv ? 'xprv' : 'xpub';
}

/** Serialize an HDKey node with any version name (xpub, zprv, tpub…). */
export function serializeExt(node, name) {
  const info = VERSIONS[name];
  if (!info) throw new Error('Unknown key version ' + name);
  const key = info.priv ? concat(new Uint8Array([0]), node.privateKey) : node.publicKey;
  if (!key) throw new Error('Key has no private part');
  const raw = concat(u32be(info.v), new Uint8Array([node.depth]), u32be(node.parentFingerprint), u32be(node.index), node.chainCode, key);
  return base58check.encode(raw);
}

/** Parse any extended key string. Returns { node, name, priv, net, type, depth, parentFp, index }. */
export function parseExt(str) {
  const s = String(str).trim();
  let raw;
  try { raw = base58check.decode(s); } catch (e) { throw new Error('Not a valid extended key: the checksum or characters are wrong.'); }
  if (raw.length !== 78) throw new Error('Not an extended key: wrong length.');
  const ver = readU32be(raw, 0);
  const info = BY_VERSION[ver];
  if (!info) throw new Error('Unknown extended key prefix.');
  // Re-encode with the plain BIP32 version so @scure/bip32 accepts it.
  const plain = info.net === 'main' ? (info.priv ? VERSIONS.xprv.v : VERSIONS.xpub.v) : info.priv ? VERSIONS.tprv.v : VERSIONS.tpub.v;
  const versions = info.net === 'main' ? { private: VERSIONS.xprv.v, public: VERSIONS.xpub.v } : { private: VERSIONS.tprv.v, public: VERSIONS.tpub.v };
  const node = HDKey.fromExtendedKey(base58check.encode(concat(u32be(plain), raw.subarray(4))), versions);
  return { node, name: info.name, priv: info.priv, net: info.net, type: info.type, depth: raw[4], parentFp: readU32be(raw, 5), index: readU32be(raw, 9) };
}

// ---- derivation paths ----
export function parsePath(path) {
  const s = String(path).trim().replace(/[hH]/g, "'");
  if (!/^m(\/\d+'?)*$/.test(s)) throw new Error("Use m/ then numbers, with ' or h for hardened steps");
  const parts = s.split('/').slice(1).map((p) => {
    const hard = p.endsWith("'");
    const n = parseInt(p, 10);
    if (n >= HARDENED_OFFSET) throw new Error('Each level must be below 2147483648');
    return hard ? n + HARDENED_OFFSET : n;
  });
  return parts;
}
export function formatPath(indexes, hardMark = "'") {
  return 'm' + indexes.map((i) => '/' + (i >= HARDENED_OFFSET ? (i - HARDENED_OFFSET) + hardMark : i)).join('');
}
export function normPath(path) { return formatPath(parsePath(path)); }
export function stdAccountPath(type, net, acct = 0) {
  return `m/${TYPES[type].purpose}'/${NETS[net].coin}'/${acct}'`;
}
export function deriveIndexes(node, idx) {
  let n = node;
  for (const i of idx) n = n.deriveChild(i);
  return n;
}

// ---- addresses ----
export const xonly = (pub) => (pub.length === 33 ? pub.subarray(1) : pub);

export function payment(type, pub, net) {
  const N = NETS[net].btc;
  if (type === 'wpkh') return btc.p2wpkh(pub, N);
  if (type === 'shwpkh') return btc.p2sh(btc.p2wpkh(pub, N), N);
  if (type === 'pkh') return btc.p2pkh(pub, N);
  if (type === 'tr') return btc.p2tr(xonly(pub), undefined, N);
  throw new Error('Unknown address type ' + type);
}
export const addressOf = (type, pub, net) => payment(type, pub, net).address;

/** Decode an address string into { type, hash|program, script, net } or throw. */
export function decodeAddress(addr, net) {
  const a = String(addr).trim();
  const nets = net ? [net] : ['main', 'test', 'regtest'];
  let lastErr;
  for (const n of nets) {
    try {
      const out = btc.Address(NETS[n].btc).decode(a);
      const script = btc.OutScript.encode(out);
      const type = { wpkh: 'wpkh', tr: 'tr', sh: 'sh', pkh: 'pkh', wsh: 'wsh' }[out.type] || out.type;
      return { type, hash: out.hash || out.pubkey, script, net: n };
    } catch (e) { lastErr = e; }
  }
  throw new Error('Not a valid Bitcoin address' + (net ? ' for ' + NETS[net].name : '') + '.');
}

export function scriptToAddress(script, net) {
  try {
    const out = btc.OutScript.decode(script);
    return btc.Address(NETS[net].btc).encode(out);
  } catch (e) { return null; }
}

export function scriptKind(script) {
  try {
    const t = btc.OutScript.decode(script).type;
    return { wpkh: 'P2WPKH', tr: 'P2TR', sh: 'P2SH', pkh: 'P2PKH', wsh: 'P2WSH', pk: 'P2PK', ms: 'Bare multisig', unknown: 'Unknown' }[t] || t.toUpperCase();
  } catch (e) {
    if (script[0] === 0x6a) return 'OP_RETURN';
    return 'Unknown';
  }
}

// ---- BIP380 descriptor checksum ----
const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(c, val) {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ val;
  if (c0 & 1n) c ^= 0xf5dee51989n;
  if (c0 & 2n) c ^= 0xa9fdca3312n;
  if (c0 & 4n) c ^= 0x1bab10e32dn;
  if (c0 & 8n) c ^= 0x3706b1677an;
  if (c0 & 16n) c ^= 0x644d626ffdn;
  return c;
}
export function descChecksum(desc) {
  let c = 1n, cls = 0n, clscount = 0;
  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos === -1) throw new Error('Invalid character in descriptor');
    c = polymod(c, BigInt(pos & 31));
    cls = cls * 3n + BigInt(pos >> 5);
    if (++clscount === 3) { c = polymod(c, cls); cls = 0n; clscount = 0; }
  }
  if (clscount > 0) c = polymod(c, cls);
  for (let j = 0; j < 8; j++) c = polymod(c, 0n);
  c ^= 1n;
  let out = '';
  for (let j = 0; j < 8; j++) out += CHECKSUM_CHARSET[Number((c >> (5n * BigInt(7 - j))) & 31n)];
  return out;
}
export const withChecksum = (d) => d + '#' + descChecksum(d);

/** Account descriptor with key origin, multipath receive/change. */
export function accountDescriptor(type, keyStr, fp, path) {
  const origin = fp ? '[' + fp.toLowerCase() + path.slice(1).replace(/'/g, 'h') + ']' : '';
  const inner = origin + keyStr + '/<0;1>/*';
  const body = TYPES[type].tmpl.replace('KEY', inner);
  return withChecksum(body);
}

/** Parse a single-key descriptor like wpkh([fp/84h/0h/0h]xprv…/<0;1>/*)#checksum. */
export function parseDescriptor(text) {
  const s = String(text).trim();
  const m = /^(.*?)(?:#([qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}))?$/.exec(s);
  const body = m[1];
  if (m[2] && descChecksum(body) !== m[2]) throw new Error('The descriptor checksum does not match. Check for typos.');
  const forms = [
    [/^wpkh\((.*)\)$/, 'wpkh'], [/^sh\(wpkh\((.*)\)\)$/, 'shwpkh'], [/^pkh\((.*)\)$/, 'pkh'], [/^tr\(([^,()]*)\)$/, 'tr'],
  ];
  for (const [re, type] of forms) {
    const x = re.exec(body);
    if (!x) continue;
    const km = /^(?:\[([0-9a-fA-F]{8})((?:\/\d+['hH]?)*)\])?([1-9A-HJ-NP-Za-km-z]+)((?:\/(?:\d+['hH]?|<\d+;\d+>|\*))*)$/.exec(x[1]);
    if (!km) throw new Error('Could not read the key inside the descriptor.');
    if (!['', '/<0;1>/*', '/0/*', '/1/*'].includes((km[4] || '').replace(/[hH]/g, "'"))) throw new Error('Only account descriptors ending in /<0;1>/* (or /0/*, /1/*) are supported.');
    return { type, fp: km[1] ? km[1].toUpperCase() : null, path: km[1] ? 'm' + (km[2] || '').replace(/[hH]/g, "'") : null, key: km[3], suffix: km[4] || '', checksum: m[2] || null };
  }
  throw new Error('Only single-key descriptors are supported: wpkh(), sh(wpkh()), pkh(), tr().');
}

export { HDKey, HARDENED_OFFSET, fpHex, hash160 };
