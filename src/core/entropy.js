// Seed entropy: optional user randomness (dice, coins, drawing) hashed to 32 bytes, XORed with
// 32 bytes from the browser CSPRNG. The result is at least as unpredictable as the better source.
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, randomBytes, utf8, u32be, wipe } from './util.js';

export const DICE_BITS = Math.log2(6);

/** Bits credited for dice and coins. Drawing is mixed in but never counted. */
export function countedBits(dice, coins) {
  return dice.length * DICE_BITS + coins.length;
}

/**
 * Serialize user input with a domain tag and length prefixes so different inputs can't collide.
 * strokes: [[{x,y,t}, ...], ...]
 */
export function hashUserInput({ dice = [], coins = [], strokes = [] }) {
  const parts = [utf8.encode('offline-signer/user-entropy/v1')];
  parts.push(u32be(dice.length), new Uint8Array(dice.map((d) => d)));
  parts.push(u32be(coins.length), new Uint8Array(coins.map((c) => (c === 'H' ? 1 : 0))));
  parts.push(u32be(strokes.length));
  for (const s of strokes) {
    parts.push(u32be(s.length));
    for (const p of s) parts.push(u32be(p.x & 0xffff), u32be(p.y & 0xffff), u32be(Math.floor(p.t) >>> 0), u32be(Math.floor((p.t % 1) * 1e6)));
  }
  const buf = concat(...parts);
  const h = sha256(buf);
  wipe(buf);
  return h;
}

/** Bits of dice and coins a seed needs on its own: 128 for 12 words, 256 for 24 (the seed's entropy). */
export function neededBits(words) { return words === 12 ? 128 : 256; }

/**
 * Make seed entropy of `bytes` (16 for 12 words, 32 for 24). With device randomness on, user input is
 * optional; with it off, the dice and coins must carry as many bits as the seed: 128 or 256.
 */
export function makeEntropy({ bytes, device = true, dice = [], coins = [], strokes = [] }) {
  if (bytes !== 16 && bytes !== 32) throw new Error('Seed entropy is 16 or 32 bytes.');
  const any = dice.length + coins.length + strokes.reduce((n, s) => n + s.length, 0) > 0;
  const need = bytes * 8;
  if (!device && countedBits(dice, coins) < need) throw new Error('Need at least ' + need + ' bits from dice and coins.');
  const user = any ? hashUserInput({ dice, coins, strokes }) : new Uint8Array(32);
  const dev = device ? randomBytes(32) : new Uint8Array(32);
  const mixed = user.map((b, i) => b ^ dev[i]);
  const out = mixed.slice(0, bytes);
  wipe(user, dev, mixed);
  return out;
}
