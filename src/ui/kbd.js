// On-screen keyboard: layouts and editing rules, with no DOM, so node --test can check them.
// The panel (Keyboard.jsx) keeps the mode, shuffle and Show/Hide state; the typed value stays in the
// screen's own state and goes through these functions.

/** Seed words: letters only. */
export const SEED_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** Text: three families of key sets. Upper case is the same set in capitals. */
export const TEXT_ROWS = {
  abc: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  sym: ['1234567890', '-/:;()$&@"', '[]{}#%^*+=', "_\\|~<>.,?!'"],
  acc: ['1234567890', 'áàâäãåæçéè', 'êëíìîïñóòô', 'öõøœúùûüý'],
};

/** abc / ABC → 'abc', acc / ACC → 'acc', sym → 'sym'. */
export const family = (mode) => String(mode || 'abc').toLowerCase();
export const isUpper = (mode) => mode === 'ABC' || mode === 'ACC';

const split = (rows) => rows.map((r) => Array.from(r));

/** Uniform integer in [0, n) from the browser's CSPRNG (rejection sampling, no modulo bias). */
export function cryptoRandomInt(n) {
  if (!(n > 0) || n > 0x100000000) throw new Error('bad range');
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Fisher–Yates over all keys, then poured back into rows of the same lengths. */
export function shuffleRows(rows, randInt = cryptoRandomInt) {
  const all = [].concat(...rows);
  for (let i = all.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = all[i]; all[i] = all[j]; all[j] = t;
  }
  let p = 0;
  return rows.map((r) => r.map(() => all[p++]));
}

/**
 * Key order for every key set of a layout. Shuffled ones get a fresh order each call; lower and
 * upper case share one order so ⇧ doesn't move the keys.
 */
export function makeOrders(layout, shuffled, randInt = cryptoRandomInt) {
  const sets = layout === 'seed' ? { abc: SEED_ROWS } : TEXT_ROWS;
  const out = {};
  for (const k of Object.keys(sets)) out[k] = shuffled ? shuffleRows(split(sets[k]), randInt) : split(sets[k]);
  return out;
}

/** The character keys to draw for a mode. */
export function keyRows(orders, mode) {
  const rows = orders[family(mode)] || orders.abc;
  return isUpper(mode) ? rows.map((r) => r.map((c) => c.toUpperCase())) : rows;
}

// ---------- text layout ----------

/** Type one character. Shift is one-shot: after a capital, the keys go back to lower case. */
export function textType(value, mode, ch) {
  return { value: value + ch, mode: isUpper(mode) ? family(mode) : mode };
}
/** ⇧ on the letter sets; does nothing on symbols. */
export function textShift(mode) {
  if (family(mode) === 'sym') return mode;
  return isUpper(mode) ? family(mode) : family(mode).toUpperCase();
}
/** #+= ↔ abc. */
export function textToggleSymbols(mode) { return family(mode) === 'sym' ? 'abc' : 'sym'; }
/** àé ↔ abc. */
export function textToggleAccents(mode) { return family(mode) === 'acc' ? 'abc' : 'acc'; }
/** Delete one character (a whole code point, so an emoji pasted earlier isn't split). */
export function textBack(value) { const a = Array.from(value); a.pop(); return a.join(''); }
export function textNewline(value, multiline) { return multiline ? value + '\n' : value; }

// ---------- seed layout ----------

const pad = (words, len) => { const w = (words || []).slice(0, len); while (w.length < len) w.push(''); return w; };
const clamp = (i, len) => Math.max(0, Math.min(len - 1, i));

/** Where the keyboard starts: the first empty word, or the last one when all are filled. */
export function firstEmpty(words, len) {
  const w = pad(words, len);
  const i = w.findIndex((x) => !String(x).trim());
  return i < 0 ? len - 1 : i;
}
/** Letters that can come next: some BIP39 word continues with them. */
export function allowedNext(prefix, wordlist) {
  const p = String(prefix || '');
  const out = new Set();
  for (const w of wordlist) if (w.length > p.length && w.startsWith(p)) out.add(w[p.length]);
  return out;
}
/** Up to `max` BIP39 words starting with the prefix (none for an empty prefix). */
export function suggestions(prefix, wordlist, max = 6) {
  const p = String(prefix || '');
  if (!p) return [];
  const out = [];
  for (const w of wordlist) { if (w.startsWith(p)) { out.push(w); if (out.length === max) break; } }
  return out;
}
export function seedType(words, len, i, ch) {
  const w = pad(words, len);
  w[i] = (w[i] || '') + ch;
  return w;
}
/** Delete a letter; on an empty word, go back to the previous word instead. */
export function seedBack(words, len, i) {
  const w = pad(words, len);
  if (!w[i] && i > 0) return { words: w, i: i - 1 };
  w[i] = Array.from(w[i] || '').slice(0, -1).join('');
  return { words: w, i };
}
/** Pick a suggestion: fill the word and move to the next one. */
export function seedPick(words, len, i, word) {
  const w = pad(words, len);
  w[i] = word;
  return { words: w, i: clamp(i + 1, len) };
}
export function seedGo(len, i) { return clamp(i, len); }

// ---------- preview ----------

/** What the preview shows: dots for a hidden value (line breaks kept), ␣ for spaces when shown. */
export function previewText(value, { seed, mask, show }) {
  const v = String(value || '');
  if (seed) return v;
  if (mask && !show) return v.replace(/[^\n]/gu, '•');
  return v.replace(/ /g, '␣');
}
export function charCount(value) {
  const n = Array.from(String(value || '')).length;
  return n + (n === 1 ? ' character' : ' characters');
}
