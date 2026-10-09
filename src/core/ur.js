// Uniform Resources (BCR-2020-005) with fountain codes, as used by Sparrow, BlueWallet, Nunchuk,
// Keystone and Jade for animated QR. Ported from the Blockchain Commons C++ reference (bc-ur);
// test/ur.test.js checks it against that reference's vectors.
import { sha256 } from '@noble/hashes/sha2.js';
import { concat } from './util.js';

// ---- CRC32 (IEEE) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

// ---- Bytewords ----
const BW = 'ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybragbrewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdatadaysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexiteyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegeargemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholyhopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugsjumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliarlimplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmissmonknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeckplaypluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofrubyruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxitenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovialvibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawnyellyogayurtzapszerozestzinczonezoom';
const MINIMAL = new Map();
const FULL = new Map();
for (let i = 0; i < 256; i++) {
  const w = BW.slice(i * 4, i * 4 + 4);
  MINIMAL.set(w[0] + w[3], i);
  FULL.set(w, i);
}
export const bytewords = {
  encode(bytes, style = 'minimal') {
    const all = concat(bytes, u32(crc32(bytes)));
    const words = Array.from(all, (b) => BW.slice(b * 4, b * 4 + 4));
    if (style === 'minimal') return words.map((w) => w[0] + w[3]).join('');
    return words.join(style === 'uri' ? '-' : ' ');
  },
  decode(s, style = 'minimal') {
    const str = s.toLowerCase();
    let vals;
    if (style === 'minimal') {
      if (str.length % 2) throw new Error('Invalid Bytewords.');
      vals = [];
      for (let i = 0; i < str.length; i += 2) {
        const v = MINIMAL.get(str.slice(i, i + 2));
        if (v === undefined) throw new Error('Invalid Bytewords.');
        vals.push(v);
      }
    } else {
      vals = str.split(style === 'uri' ? '-' : ' ').map((w) => {
        const v = FULL.get(w);
        if (v === undefined) throw new Error('Invalid Bytewords.');
        return v;
      });
    }
    if (vals.length < 5) throw new Error('Invalid Bytewords.');
    const buf = new Uint8Array(vals);
    const body = buf.slice(0, -4);
    const chk = buf.slice(-4);
    const c = u32(crc32(body));
    if (c[0] !== chk[0] || c[1] !== chk[1] || c[2] !== chk[2] || c[3] !== chk[3]) throw new Error('Invalid Bytewords.');
    return body;
  },
};

// ---- Minimal CBOR (unsigned ints, byte strings, arrays, tags) ----
function cborHead(major, n) {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 255];
  if (n < 0x100000000) return [(major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  throw new Error('CBOR int too large');
}
export const cbor = {
  uint: (n) => new Uint8Array(cborHead(0, n)),
  bytes: (b) => concat(new Uint8Array(cborHead(2, b.length)), b),
  array: (items) => concat(new Uint8Array(cborHead(4, items.length)), ...items),
  /** Read one head; returns { major, value, next } */
  head(b, o) {
    const ib = b[o];
    if (ib === undefined) throw new Error('CBOR: truncated');
    const major = ib >> 5, ai = ib & 31;
    if (ai < 24) return { major, value: ai, next: o + 1 };
    const len = { 24: 1, 25: 2, 26: 4, 27: 8 }[ai];
    if (!len) throw new Error('CBOR: unsupported');
    if (o + 1 + len > b.length) throw new Error('CBOR: truncated');
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + b[o + 1 + i];
    return { major, value: v, next: o + 1 + len };
  },
  readBytes(b, o) {
    const h = cbor.head(b, o);
    if (h.major !== 2) throw new Error('CBOR: expected bytes');
    if (h.next + h.value > b.length) throw new Error('CBOR: truncated');
    return { value: b.slice(h.next, h.next + h.value), next: h.next + h.value };
  },
  readUint(b, o) {
    const h = cbor.head(b, o);
    if (h.major !== 0) throw new Error('CBOR: expected uint');
    return h;
  },
};

// ---- Xoshiro256** ----
const M64 = (1n << 64n) - 1n;
const rotl = (x, k) => ((x << BigInt(k)) | (x >> BigInt(64 - k))) & M64;
export class Xoshiro {
  constructor(seedBytes) {
    const d = sha256(seedBytes);
    this.s = [0, 1, 2, 3].map((i) => {
      let v = 0n;
      for (let n = 0; n < 8; n++) v = (v << 8n) | BigInt(d[i * 8 + n]);
      return v;
    });
  }
  next() {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & M64, 7) * 9n) & M64;
    const t = (s[1] << 17n) & M64;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45);
    return result;
  }
  nextDouble() { return Number(this.next()) / 18446744073709551616; }
  nextInt(low, high) { return Math.floor(this.nextDouble() * (high - low + 1)) + low; }
  nextData(n) { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = this.nextInt(0, 255); return out; }
}

// ---- Fountain code helpers ----
class RandomSampler {
  constructor(probs) {
    const sum = probs.reduce((a, b) => a + b, 0);
    const n = probs.length;
    const P = probs.map((p) => (p * n) / sum);
    const S = [], L = [];
    for (let i = n - 1; i >= 0; i--) (P[i] < 1 ? S : L).push(i);
    const pr = new Array(n).fill(0), al = new Array(n).fill(0);
    while (S.length && L.length) {
      const a = S.pop(), g = L.pop();
      pr[a] = P[a]; al[a] = g;
      P[g] += P[a] - 1;
      (P[g] < 1 ? S : L).push(g);
    }
    while (L.length) pr[L.pop()] = 1;
    while (S.length) pr[S.pop()] = 1;
    this.probs = pr; this.aliases = al;
  }
  next(rng) {
    const r1 = rng(), r2 = rng();
    const i = Math.floor(this.probs.length * r1);
    return r2 < this.probs[i] ? i : this.aliases[i];
  }
}
const samplerCache = new Map();
export const MAX_SEQ_LEN = 10000; // ~2.5 MB at 250-byte fragments; bounds the O(n²) shuffle
export function chooseDegree(seqLen, rng) {
  let s = samplerCache.get(seqLen);
  if (!s) {
    if (samplerCache.size > 8) samplerCache.clear();
    s = new RandomSampler(Array.from({ length: seqLen }, (_, i) => 1 / (i + 1)));
    samplerCache.set(seqLen, s);
  }
  return s.next(() => rng.nextDouble()) + 1;
}
export function shuffled(items, rng) {
  const rem = items.slice(), out = [];
  while (rem.length) { const i = rng.nextInt(0, rem.length - 1); out.push(rem[i]); rem.splice(i, 1); }
  return out;
}
export function chooseFragments(seqNum, seqLen, checksum) {
  if (seqNum <= seqLen) return [seqNum - 1];
  const rng = new Xoshiro(concat(u32(seqNum), u32(checksum)));
  const degree = chooseDegree(seqLen, rng);
  const idx = Array.from({ length: seqLen }, (_, i) => i);
  return shuffled(idx, rng).slice(0, degree).sort((a, b) => a - b);
}
export function nominalFragmentLength(messageLen, minLen, maxLen) {
  const maxCount = Math.floor(messageLen / minLen);
  let len;
  for (let c = 1; c <= Math.max(1, maxCount); c++) {
    len = Math.ceil(messageLen / c);
    if (len <= maxLen) break;
  }
  return len;
}

export class FountainEncoder {
  constructor(message, maxFragmentLen = 200, firstSeqNum = 0, minFragmentLen = 10) {
    this.messageLen = message.length;
    this.checksum = crc32(message);
    this.fragmentLen = nominalFragmentLength(message.length, minFragmentLen, maxFragmentLen);
    this.fragments = [];
    for (let o = 0; o < message.length; o += this.fragmentLen) {
      const f = new Uint8Array(this.fragmentLen);
      f.set(message.subarray(o, o + this.fragmentLen));
      this.fragments.push(f);
    }
    this.seqNum = firstSeqNum >>> 0;
  }
  get seqLen() { return this.fragments.length; }
  nextPart() {
    this.seqNum = (this.seqNum + 1) >>> 0;
    const idx = chooseFragments(this.seqNum, this.seqLen, this.checksum);
    const data = new Uint8Array(this.fragmentLen);
    for (const i of idx) for (let k = 0; k < data.length; k++) data[k] ^= this.fragments[i][k];
    return { seqNum: this.seqNum, seqLen: this.seqLen, messageLen: this.messageLen, checksum: this.checksum, data };
  }
}
export function partToCbor(p) {
  return cbor.array([cbor.uint(p.seqNum), cbor.uint(p.seqLen), cbor.uint(p.messageLen), cbor.uint(p.checksum), cbor.bytes(p.data)]);
}
export function partFromCbor(b) {
  const h = cbor.head(b, 0);
  if (h.major !== 4 || h.value !== 5) throw new Error('UR: bad part');
  let o = h.next;
  const r = [];
  for (let i = 0; i < 4; i++) { const x = cbor.readUint(b, o); r.push(x.value); o = x.next; }
  const d = cbor.readBytes(b, o);
  return { seqNum: r[0], seqLen: r[1], messageLen: r[2], checksum: r[3], data: d.value };
}

const keyOf = (idx) => idx.join(',');
const xorInto = (a, b) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };

export class FountainDecoder {
  constructor() {
    this.expected = null; this.received = new Set(); this.simple = new Map(); this.mixed = new Map();
    this.queue = []; this.result = null; this.error = null; this.processed = 0;
  }
  get complete() { return !!(this.result || this.error); }
  progress() {
    if (this.result) return 1;
    if (!this.expected) return 0;
    return Math.min(0.99, this.received.size / this.expected.seqLen);
  }
  receive(p) {
    if (this.complete) return false;
    // Reject parts that can't come from a real encoder (and would make chooseFragments slow or wrong).
    if (!(p.seqNum >= 1 && p.seqLen >= 1 && p.seqLen <= MAX_SEQ_LEN && p.data.length > 0)) return false;
    if (p.messageLen > p.seqLen * p.data.length || p.messageLen <= (p.seqLen - 1) * p.data.length) return false;
    if (!this.expected) this.expected = { seqLen: p.seqLen, messageLen: p.messageLen, checksum: p.checksum, fragLen: p.data.length };
    else {
      const e = this.expected;
      if (e.seqLen !== p.seqLen || e.messageLen !== p.messageLen || e.checksum !== p.checksum || e.fragLen !== p.data.length) return false;
    }
    this.queue.push({ idx: chooseFragments(p.seqNum, p.seqLen, p.checksum), data: p.data.slice() });
    while (!this.complete && this.queue.length) {
      const part = this.queue.shift();
      if (part.idx.length === 1) this.processSimple(part); else this.processMixed(part);
    }
    this.processed++;
    return true;
  }
  reduce(a, b) {
    // if b ⊂ a strictly
    if (b.idx.length >= a.idx.length) return a;
    const set = new Set(a.idx);
    if (!b.idx.every((i) => set.has(i))) return a;
    const data = a.data.slice();
    xorInto(data, b.data);
    return { idx: a.idx.filter((i) => !b.idx.includes(i)), data };
  }
  reduceMixedBy(p) {
    const next = new Map();
    for (const m of this.mixed.values()) {
      const r = this.reduce(m, p);
      if (r.idx.length === 1) this.queue.push(r); else next.set(keyOf(r.idx), r);
    }
    this.mixed = next;
  }
  processSimple(p) {
    const i = p.idx[0];
    if (this.received.has(i)) return;
    this.simple.set(i, p);
    this.received.add(i);
    if (this.received.size === this.expected.seqLen) {
      const frags = [];
      for (let k = 0; k < this.expected.seqLen; k++) frags.push(this.simple.get(k).data);
      const msg = concat(...frags).slice(0, this.expected.messageLen);
      if (crc32(msg) === this.expected.checksum) this.result = msg; else this.error = new Error('UR: checksum mismatch');
    } else this.reduceMixedBy(p);
  }
  processMixed(p) {
    if (this.mixed.has(keyOf(p.idx))) return;
    let r = p;
    for (const s of this.simple.values()) r = this.reduce(r, s);
    for (const m of this.mixed.values()) r = this.reduce(r, m);
    if (r.idx.length === 1) this.queue.push(r);
    else { this.reduceMixedBy(r); this.mixed.set(keyOf(r.idx), r); }
  }
}

// ---- UR strings ----
export function encodeUR(type, cborBytes, maxFragmentLen = 250, firstSeqNum = 0) {
  const enc = new FountainEncoder(cborBytes, maxFragmentLen, firstSeqNum);
  if (enc.seqLen === 1) return { single: true, next: () => 'ur:' + type + '/' + bytewords.encode(cborBytes), seqLen: 1 };
  return {
    single: false, seqLen: enc.seqLen,
    next: () => {
      const p = enc.nextPart();
      return 'ur:' + type + '/' + p.seqNum + '-' + p.seqLen + '/' + bytewords.encode(partToCbor(p));
    },
  };
}

export class URDecoder {
  constructor() { this.type = null; this.fountain = new FountainDecoder(); this.result = null; }
  /** Feed one string; returns true if it was a valid UR part. */
  receive(s) {
    const lower = String(s).trim().toLowerCase();
    if (!lower.startsWith('ur:')) return false;
    const comps = lower.slice(3).split('/');
    if (comps.length < 2) return false;
    const type = comps[0];
    if (!/^[a-z0-9-]+$/.test(type)) return false;
    if (this.type && this.type !== type) return false;
    this.type = type;
    try {
      if (comps.length === 2) { this.result = { type, cbor: bytewords.decode(comps[1]) }; return true; }
      if (comps.length !== 3) return false;
      const m = /^(\d+)-(\d+)$/.exec(comps[1]);
      if (!m) return false;
      const part = partFromCbor(bytewords.decode(comps[2]));
      if (part.seqNum !== +m[1] || part.seqLen !== +m[2]) return false;
      if (!this.fountain.receive(part)) return false;
      if (this.fountain.result) this.result = { type, cbor: this.fountain.result };
      if (this.fountain.error) throw this.fountain.error;
      return true;
    } catch (e) {
      if (e && /checksum/.test(e.message)) throw e;
      return false;
    }
  }
  get done() { return !!this.result; }
  progress() { return this.result ? 1 : this.fountain.progress(); }
  counts() { const e = this.fountain.expected; return { got: this.fountain.received.size, total: e ? e.seqLen : 0 }; }
}

/** crypto-psbt / psbt payload is a CBOR byte string wrapping the PSBT. */
export function psbtFromURcbor(cborBytes) {
  return cbor.readBytes(cborBytes, 0).value;
}
export function psbtToURparts(psbt, maxFragmentLen = 250) {
  return encodeUR('crypto-psbt', cbor.bytes(psbt), maxFragmentLen);
}
