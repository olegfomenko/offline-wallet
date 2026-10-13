// The in-memory wallet. Four kinds: BIP39 seed, custom (non-BIP39) words, extended private key, single keys.
// Nothing is ever persisted; closeWallet() wipes what JavaScript lets us wipe.
import { mnemonicToSeedSync, validateMnemonic, entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import {
  HDKey, NETS, TYPES, parseExt, parseDescriptor, stdAccountPath, parsePath, normPath, deriveIndexes,
  addressOf, serializeExt, versionName, accountDescriptor, fpHex, HARDENED_OFFSET,
} from './hd.js';
import { pubOf } from './keys.js';
import { utf8, wipe, equal } from './util.js';

export { wordlist };
export const WORDSET = new Set(wordlist);

export function normalizeWords(text) {
  return String(text).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function isValidMnemonic(words) {
  return validateMnemonic(words.join(' '), wordlist);
}

function fromSeedBytes(seed) {
  const root = HDKey.fromMasterSeed(seed);
  wipe(seed);
  return root;
}

export function walletFromMnemonic(words, passphrase = '') {
  const mnemonic = words.join(' ');
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('The words fail the BIP39 checksum. Check each word and its position.');
  const root = fromSeedBytes(mnemonicToSeedSync(mnemonic, passphrase));
  return { kind: 'seed', words: words.slice(), passphrase, root, fp: fpHex(root.fingerprint).toUpperCase(), fpKnown: true, net: 'main' };
}

/** Electrum-compatible "BIP39 seed" from any text: NFKD, whitespace collapsed, no checksum. */
// Python's str.split() whitespace (what Electrum uses), not JavaScript's \s.
const PY_WS = /[ \t\n\r\x0b\x0c\x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
export function customSeedText(text) {
  return String(text).split(PY_WS).filter(Boolean).join(' ').normalize('NFKD');
}
export function walletFromCustom(text, passphrase = '') {
  const exact = customSeedText(text);
  if (!exact) throw new Error('Enter at least one word.');
  const salt = utf8.encode('mnemonic' + String(passphrase).normalize('NFKD'));
  const seed = pbkdf2(sha512, utf8.encode(exact), salt, { c: 2048, dkLen: 64 });
  const root = fromSeedBytes(seed);
  return { kind: 'custom', text: exact, passphrase, root, fp: fpHex(root.fingerprint).toUpperCase(), fpKnown: true, net: 'main' };
}

/**
 * Read a master/account private key: xprv/yprv/zprv/tprv/uprv/vprv or a private descriptor.
 * Returns facts for the check screen plus a wallet object.
 */
export function readXkey(input) {
  const s = String(input).trim();
  let desc = null, keyStr = s;
  if (/^(wpkh|sh|pkh|tr|combo)\(/.test(s)) { desc = parseDescriptor(s); keyStr = desc.key; }
  let ext = parseExt(keyStr);
  if (!ext.priv) throw new Error('This is a public key (watch-only). Enter the private key to sign.');
  if (desc && desc.type === null) throw new Error('combo() is read only for single keys, not extended keys.');
  const type = desc ? desc.type : ext.type;
  if (desc && desc.path) {
    const depth = parsePath(desc.path).length;
    if (depth !== ext.depth) throw new Error('The descriptor path depth does not match the key depth.');
  }
  let fp = desc && desc.fp ? desc.fp : ext.depth === 0 ? fpHex(ext.node.fingerprint).toUpperCase() : null;
  let path = desc && desc.path ? normPath(desc.path) : ext.depth === 0 ? 'm' : null;
  if (desc && desc.deriv) {
    // A path after the key, e.g. Bitcoin Core's wpkh(xprv/84h/0h/0h/<0;1>/*): the account is that child.
    if (!desc.suffix) throw new Error('This descriptor is for one derived key, not an account. It needs to end in /<0;1>/* (or /0/*, /1/*).');
    let node = ext.node;
    for (const i of parsePath('m' + desc.deriv)) node = node.deriveChild(i);
    ext = { ...ext, node, depth: node.depth, parentFp: node.parentFingerprint, index: node.index };
    path = path ? normPath(path + desc.deriv) : null;
    if (!path) fp = null;
  }
  const format = desc ? 'Private descriptor' : ext.type ? ext.name + ' · SLIP-132' : ext.name + ' · plain BIP32';
  return {
    raw: s, ext, desc, type, format,
    depth: ext.depth,
    level: ext.depth === 0 ? 'depth 0 · master key' : ext.depth === 3 ? 'depth 3 · account key' : 'depth ' + ext.depth,
    parentFp: fpHex(ext.parentFp).toUpperCase(),
    fp, path,
    net: ext.net,
  };
}

export function walletFromXkey(info, chosenType) {
  const type = info.type || chosenType || 'wpkh';
  const net = info.net === 'test' ? 'test' : 'main';
  if (info.depth === 0) {
    return { kind: 'xkey', root: info.ext.node, xinfo: info, fp: fpHex(info.ext.node.fingerprint).toUpperCase(), fpKnown: true, net, defaultType: type };
  }
  const path = info.path || (info.depth === 3 ? stdAccountPath(type, net, 0) : null);
  return {
    kind: 'xkey', node: info.ext.node, xinfo: info, fp: info.fp || '00000000', fpKnown: !!info.fp,
    acctPath: path, pathKnown: !!info.path, net, defaultType: type, typeFixed: !!info.type,
  };
}

/** keys: [{priv, compressed, type}] */
export function walletFromKeys(keys) {
  return { kind: 'keys', keys, fp: null, fpKnown: false, net: keys[0] && keys[0].net === 'test' ? 'test' : 'main' };
}

/**
 * Master fingerprint that seed words (or custom words) give with a passphrase, without keeping the
 * wallet: the key is wiped right away. Used to check a passphrase against a written fingerprint.
 * `src`: { words } for BIP39 words, { custom } for custom words.
 */
export function fingerprintWith(src, passphrase = '') {
  const w = src.custom != null ? walletFromCustom(src.custom, passphrase) : walletFromMnemonic(src.words, passphrase);
  const fp = w.fp;
  try { w.root.wipePrivateData(); } catch (e) { /* best effort */ }
  return fp;
}

export function isHD(w) { return w && w.kind !== 'keys'; }
export function hasRoot(w) { return !!(w && w.root); }

/**
 * Account node for an address type. For seed-like wallets any path works; for an account-level xprv
 * the key itself is the account (path is fixed).
 */
export function account(w, type, net, acct = 0, customPath) {
  if (w.root) {
    const path = customPath ? normPath(customPath) : stdAccountPath(type, net, acct);
    return { node: w.root.derive(path), path, fp: w.fp, fpKnown: true, pathKnown: true, fixed: false };
  }
  if (w.node) {
    const path = w.pathKnown ? w.acctPath : w.xinfo.depth === 3 ? stdAccountPath(type, net, 0) : 'm/…';
    return { node: w.node, path, fp: w.fp, fpKnown: w.fpKnown, pathKnown: w.pathKnown, fixed: true };
  }
  return null;
}

export function accountKeys(w, type, net, acct, customPath, priv = false) {
  const A = account(w, type, net, acct, customPath);
  const xName = versionName('x', type, net, priv);
  const sName = versionName('slip', type, net, priv);
  const x = serializeExt(A.node, xName);
  return {
    ...A, xName, sName, x,
    slip: sName ? serializeExt(A.node, sName) : null,
    desc: accountDescriptor(type, x, A.fpKnown ? A.fp : null, A.path),
  };
}

export function addressAt(A, type, net, branch, index) {
  const child = A.node.deriveChild(branch).deriveChild(index);
  return { address: addressOf(type, child.publicKey, net), pub: child.publicKey, node: child, path: A.path + '/' + branch + '/' + index };
}

export function seedSummary(w) {
  if (w.kind === 'seed') return { label: 'Seed words', words: w.words };
  return null;
}

export function closeWallet(w) {
  if (!w) return;
  try {
    if (w.root) w.root.wipePrivateData();
    if (w.node) w.node.wipePrivateData();
    if (w.keys) for (const k of w.keys) wipe(k.priv);
  } catch (e) { /* best effort */ }
}

// ---- BIP39 tools ----
export function wordIndex(w) { return wordlist.indexOf(w); }

/** All valid final words for 11 or 23 chosen words. */
export function lastWordCandidates(words) {
  const n = words.length + 1;
  const ENT = (n * 11 * 32) / 33; // 128 or 256
  const freeBits = 11 - (n * 11 - ENT); // bits of the last word that are entropy: 7 or 3
  let bits = '';
  for (const w of words) {
    const i = wordIndex(w);
    if (i < 0) throw new Error('“' + w + '” is not on the BIP39 list.');
    bits += i.toString(2).padStart(11, '0');
  }
  const out = [];
  for (let v = 0; v < 1 << freeBits; v++) {
    const fb = v.toString(2).padStart(freeBits, '0');
    const entBits = bits + fb;
    const ent = new Uint8Array(ENT / 8);
    for (let i = 0; i < ent.length; i++) ent[i] = parseInt(entBits.slice(i * 8, i * 8 + 8), 2);
    const m = entropyToMnemonic(ent, wordlist).split(' ');
    out.push({ word: m[m.length - 1], bits: fb });
    wipe(ent);
  }
  return out;
}

export function mnemonicFromEntropy(ent) { return entropyToMnemonic(ent, wordlist).split(' '); }
export function entropyFromWords(words) { return mnemonicToEntropy(words.join(' '), wordlist); }

/** SeedQR (SeedSigner): standard = 4-digit word indexes; compact = raw entropy bytes. */
export function seedQREncode(words) { return words.map((w) => String(wordIndex(w)).padStart(4, '0')).join(''); }
export function seedQRDecode(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s) && (s.length === 48 || s.length === 96)) {
    const words = [];
    for (let i = 0; i < s.length; i += 4) {
      const n = parseInt(s.slice(i, i + 4), 10);
      if (n > 2047) return null;
      words.push(wordlist[n]);
    }
    return words;
  }
  return null;
}
export function compactSeedQRDecode(bytes) {
  if (bytes.length !== 16 && bytes.length !== 32) return null;
  return mnemonicFromEntropy(bytes);
}

export { NETS, TYPES, deriveIndexes, pubOf, equal, HARDENED_OFFSET };
