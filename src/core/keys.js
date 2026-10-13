// Single private keys: WIF, Electrum "type:WIF", single-key descriptors, raw hex and BIP38 (password-protected).
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { ecb } from '@noble/ciphers/aes.js';
import { base58check, NETS, addressOf, parseDescriptor } from './hd.js';
import { concat, equal, sha256d, hex, isHex, utf8 } from './util.js';

const N = secp256k1.Point.CURVE().n;
const bytesToBig = bytesToNumberBE;
const bigToBytes = (n) => numberToBytesBE(n, 32);

export function validPriv(priv) {
  if (priv.length !== 32) return false;
  const d = bytesToBig(priv);
  return d > 0n && d < N;
}

export function pubOf(priv, compressed = true) {
  return secp256k1.getPublicKey(priv, compressed);
}

export function encodeWIF(priv, net = 'main', compressed = true) {
  const ver = NETS[net].btc.wif;
  return base58check.encode(concat(new Uint8Array([ver]), priv, compressed ? new Uint8Array([1]) : new Uint8Array()));
}

export function decodeWIF(s) {
  const raw = base58check.decode(s);
  const ver = raw[0];
  let net;
  if (ver === 0x80) net = 'main'; else if (ver === 0xef) net = 'test'; else throw new Error('Not a WIF key: unknown prefix.');
  let compressed;
  if (raw.length === 34 && raw[33] === 1) compressed = true;
  else if (raw.length === 33) compressed = false;
  else throw new Error('Not a WIF key: wrong length.');
  const priv = raw.slice(1, 33);
  if (!validPriv(priv)) throw new Error('Private key out of range.');
  return { priv, compressed, net };
}

const ELECTRUM = { p2pkh: 'pkh', 'p2wpkh-p2sh': 'shwpkh', p2wpkh: 'wpkh', p2tr: 'tr' };
export const ELECTRUM_PREFIX = { pkh: 'p2pkh', shwpkh: 'p2wpkh-p2sh', wpkh: 'p2wpkh' };

/** True if the text looks like an extended key or a descriptor holding one (for the Master key tab). */
export function looksExtended(s) {
  return /(^|[(\]])[xyzuvt]prv[1-9A-HJ-NP-Za-km-z]{100,}/.test(String(s).trim());
}

/**
 * Read one key line. Returns { kind: 'wif'|'electrum'|'descriptor'|'hex'|'bip38', priv?, compressed, net, type?, encrypted? }
 * `type` is set when the line says it (Electrum prefix or descriptor); otherwise the user picks it.
 */
export function parseKeyLine(line) {
  const s = String(line).trim();
  if (!s) return null;
  const m = /^(p2pkh|p2wpkh-p2sh|p2wpkh|p2tr):(.+)$/.exec(s);
  if (m) {
    const k = decodeWIF(m[2].trim());
    if (!k.compressed && m[1] !== 'p2pkh') throw new Error('SegWit and Taproot need a compressed key.');
    return { kind: 'electrum', ...k, type: ELECTRUM[m[1]], source: s };
  }
  if (/^(wpkh|sh|pkh|tr|combo)\(/.test(s)) {
    if (looksExtended(s)) throw new Error('This descriptor holds an extended key. Use Master key.');
    const d = parseDescriptor(s);
    if (d.deriv || d.suffix) throw new Error('A single key can’t have a derivation path after it.');
    let k;
    try { k = decodeWIF(d.key); } catch (e) { throw new Error('The key inside the descriptor isn’t a WIF private key.'); }
    if (!k.compressed && d.type && d.type !== 'pkh') throw new Error('SegWit and Taproot need a compressed key.');
    // combo() of an uncompressed key is only Legacy.
    const type = d.type || (k.compressed ? null : 'pkh');
    return { kind: 'descriptor', ...k, type, source: s, originFp: d.fp, originPath: d.path };
  }
  if (/^6P[1-9A-HJ-NP-Za-km-z]{56}$/.test(s)) return { kind: 'bip38', encrypted: s, source: s };
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    const priv = hex.decode(s);
    if (!validPriv(priv)) throw new Error('Private key out of range.');
    return { kind: 'hex', priv, compressed: true, net: null, source: s };
  }
  if (/^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s)) return { kind: 'wif', ...decodeWIF(s), source: s };
  if (looksExtended(s)) throw new Error('This is an extended key. Use Master key.');
  throw new Error('Not a private key this app reads (WIF, type:WIF, a descriptor, 64 hex, or 6P… BIP38).');
}

// ---- BIP38 ----
function aesDecryptBlock(key, block) { return ecb(key, { disablePadding: true }).decrypt(block); }
const xor = (a, b) => a.map((x, i) => x ^ b[i]);

/** Decrypt a BIP38 key (both non-EC-multiplied and EC-multiplied modes). Slow on purpose (scrypt). */
export async function decryptBIP38(encrypted, password, onProgress) {
  const raw = base58check.decode(encrypted);
  if (raw.length !== 39) throw new Error('Not a BIP38 key: wrong length.');
  const pass = utf8.encode(String(password).normalize('NFC'));
  const flag = raw[2];
  const compressed = (flag & 0x20) !== 0;
  const addrHash = raw.slice(3, 7);
  const checkAddr = (priv) => {
    const pub = pubOf(priv, compressed);
    const addr = addressOf('pkh', pub, 'main');
    return equal(sha256d(utf8.encode(addr)).slice(0, 4), addrHash);
  };
  const tick = (p) => onProgress && onProgress(p);
  if (raw[0] === 0x01 && raw[1] === 0x42) {
    const dk = await scryptAsync(pass, addrHash, { N: 16384, r: 8, p: 8, dkLen: 64, onProgress: (p) => tick(p * 0.95) });
    const half1 = dk.slice(0, 32), half2 = dk.slice(32);
    const d1 = aesDecryptBlock(half2, raw.slice(7, 23));
    const d2 = aesDecryptBlock(half2, raw.slice(23, 39));
    const priv = xor(concat(d1, d2), half1);
    if (!validPriv(priv) || !checkAddr(priv)) throw new Error('Wrong password.');
    tick(1);
    return { priv, compressed };
  }
  if (raw[0] === 0x01 && raw[1] === 0x43) {
    const ownerEntropy = raw.slice(7, 15);
    const lotSeq = (flag & 0x04) !== 0;
    const ownerSalt = lotSeq ? ownerEntropy.slice(0, 4) : ownerEntropy;
    let passFactor = await scryptAsync(pass, ownerSalt, { N: 16384, r: 8, p: 8, dkLen: 32, onProgress: (p) => tick(p * 0.9) });
    if (lotSeq) passFactor = sha256d(concat(passFactor, ownerEntropy));
    const passPoint = secp256k1.getPublicKey(passFactor, true);
    const dk = await scryptAsync(passPoint, concat(addrHash, ownerEntropy), { N: 1024, r: 1, p: 1, dkLen: 64 });
    const half1 = dk.slice(0, 32), half2 = dk.slice(32);
    const encPart1Half = raw.slice(15, 23);
    const encPart2 = raw.slice(23, 39);
    const dec2 = xor(aesDecryptBlock(half2, encPart2), half1.slice(16, 32));
    const encPart1 = concat(encPart1Half, dec2.slice(0, 8));
    const dec1 = xor(aesDecryptBlock(half2, encPart1), half1.slice(0, 16));
    const seedb = concat(dec1, dec2.slice(8, 16));
    const factorB = sha256d(seedb);
    const d = (bytesToBig(passFactor) * bytesToBig(factorB)) % N;
    const priv = bigToBytes(d);
    if (!validPriv(priv) || !checkAddr(priv)) throw new Error('Wrong password.');
    tick(1);
    return { priv, compressed };
  }
  throw new Error('Unknown BIP38 mode.');
}

export function keyAddress(k, type, net) {
  const pub = pubOf(k.priv, k.compressed);
  return addressOf(type, pub, net);
}

export { isHex };
