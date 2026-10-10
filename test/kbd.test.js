// On-screen keyboard logic (src/ui/kbd.js). Pure functions, no DOM. Run: npm test
import { test } from 'node:test';
import { expect } from './expect.js';
import { wordlist } from '../src/core/wallet.js';
import * as K from '../src/ui/kbd.js';

/** Type a string key by key the way the panel does, with shift pressed before capitals. */
function typeText(chars) {
  let value = '', mode = 'abc';
  for (const ch of chars) {
    if (ch !== ch.toLowerCase()) mode = K.textShift(mode);
    ({ value, mode } = K.textType(value, mode, ch));
  }
  return { value, mode };
}

test('text layout: typing, one-shot shift, backspace and newline', () => {
  let r = K.textType('', 'abc', 'a');
  expect(r).toEqual({ value: 'a', mode: 'abc' });
  // Shift capitalises one key, then the keys are lower case again.
  let mode = K.textShift('abc');
  expect(mode).toBe('ABC');
  expect(K.keyRows(K.makeOrders('text', false), mode)[1].join('')).toBe('QWERTYUIOP');
  r = K.textType('a', mode, 'B');
  expect(r).toEqual({ value: 'aB', mode: 'abc' });
  // Pressing shift twice turns it off again.
  expect(K.textShift(K.textShift('abc'))).toBe('abc');
  expect(typeText('Blue Fox 7')).toEqual({ value: 'Blue Fox 7', mode: 'abc' });
  // Backspace removes one character (a whole code point).
  expect(K.textBack('ab')).toBe('a');
  expect(K.textBack('')).toBe('');
  expect(K.textBack('a😀')).toBe('a');
  // New line only for multi-line targets.
  expect(K.textNewline('K1', true)).toBe('K1\n');
  expect(K.textNewline('K1', false)).toBe('K1');
});

test('text layout: mode switches', () => {
  const o = K.makeOrders('text', false);
  expect(K.textToggleSymbols('abc')).toBe('sym');
  expect(K.textToggleSymbols('sym')).toBe('abc');
  expect(K.textToggleSymbols('ABC')).toBe('sym');
  expect(K.keyRows(o, 'sym')[1].join('')).toBe('-/:;()$&@"');
  expect(K.textShift('sym')).toBe('sym'); // no shift on symbols
  expect(K.textToggleAccents('abc')).toBe('acc');
  expect(K.textToggleAccents('acc')).toBe('abc');
  expect(K.keyRows(o, 'acc')[1].join('')).toBe('áàâäãåæçéè');
  // Shifted accents, one-shot like letters.
  const up = K.textShift('acc');
  expect(up).toBe('ACC');
  expect(K.keyRows(o, up)[1].join('')).toBe('ÁÀÂÄÃÅÆÇÉÈ');
  expect(K.textType('', up, 'É')).toEqual({ value: 'É', mode: 'acc' });
  // Digits stay digits in every letter mode.
  expect(K.keyRows(o, 'ABC')[0].join('')).toBe('1234567890');
});

test('preview masks hidden values and keeps line breaks', () => {
  expect(K.previewText('ab c', { mask: true, show: false })).toBe('••••');
  expect(K.previewText('K1\nL2', { mask: true, show: false })).toBe('••\n••');
  expect(K.previewText('ab c', { mask: true, show: true })).toBe('ab␣c');
  expect(K.previewText('abandon', { seed: true })).toBe('abandon');
  expect(K.charCount('a')).toBe('1 character');
  expect(K.charCount('ab')).toBe('2 characters');
});

test('seed layout: allowed next letters', () => {
  // Any letter but x starts a BIP39 word.
  const first = K.allowedNext('', wordlist);
  expect(first.size).toBe(25);
  expect(first.has('x')).toBe(false);
  // gra → grab, grace, grain, grant, grape, grass, gravity
  expect([...K.allowedNext('gra', wordlist)].sort().join('')).toBe('bcinpsv');
  // zoo is a whole word that nothing continues.
  expect(K.allowedNext('zoo', wordlist).size).toBe(0);
});

test('seed layout: suggestions, picking and navigation', () => {
  expect(K.suggestions('', wordlist)).toEqual([]);
  const s = K.suggestions('a', wordlist);
  expect(s.length).toBe(6);
  expect(s[0]).toBe('abandon');
  expect(K.suggestions('gra', wordlist, 6).length).toBe(6);
  expect(K.suggestions('zoo', wordlist)).toEqual(['zoo']);
  // Typing builds the current word.
  let w = K.seedType([], 12, 0, 'z');
  w = K.seedType(w, 12, 0, 'o');
  expect(w[0]).toBe('zo');
  expect(w.length).toBe(12);
  // Picking a suggestion fills the word and moves on.
  let r = K.seedPick(w, 12, 0, 'zoo');
  expect(r.words[0]).toBe('zoo');
  expect(r.i).toBe(1);
  // …but never past the last word.
  expect(K.seedPick(w, 12, 11, 'zoo').i).toBe(11);
  // Backspace deletes a letter; on an empty word it goes back to the previous word.
  r = K.seedBack(['zoo', ''], 12, 1);
  expect(r.i).toBe(0);
  expect(r.words[0]).toBe('zoo');
  r = K.seedBack(r.words, 12, 0);
  expect(r).toEqual({ words: ['zo', '', '', '', '', '', '', '', '', '', '', ''], i: 0 });
  expect(K.seedBack([''], 12, 0).i).toBe(0);
  // Previous/next word stay within the seed.
  expect(K.seedGo(12, -1)).toBe(0);
  expect(K.seedGo(12, 12)).toBe(11);
  expect(K.seedGo(12, 5)).toBe(5);
});

test('seed layout: opening starts at the first empty word', () => {
  expect(K.firstEmpty([], 12)).toBe(0);
  expect(K.firstEmpty(['abandon', 'ability', '', 'able'], 12)).toBe(2);
  expect(K.firstEmpty(['abandon', '  ', 'able'], 12)).toBe(1);
  expect(K.firstEmpty(new Array(12).fill('zoo'), 12)).toBe(11);
});

/** A deterministic stand-in for the CSPRNG: a small LCG, for tests only. */
function testRng(seed) {
  let x = seed >>> 0;
  return (n) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; };
}

test('shuffle: a permutation with the same row lengths, function keys untouched', () => {
  for (const layout of ['text', 'seed']) {
    const plain = K.makeOrders(layout, false);
    for (let seed = 1; seed <= 20; seed++) {
      const shuf = K.makeOrders(layout, true, testRng(seed));
      for (const fam of Object.keys(plain)) {
        expect(shuf[fam].map((r) => r.length)).toEqual(plain[fam].map((r) => r.length));
        expect([].concat(...shuf[fam]).sort()).toEqual([].concat(...plain[fam]).sort());
      }
    }
  }
  // The order actually changes, and a different RNG gives a different order.
  const a = K.makeOrders('seed', true, testRng(1)).abc.flat().join('');
  const b = K.makeOrders('seed', true, testRng(2)).abc.flat().join('');
  expect(a === SEEDKEYS).toBe(false);
  expect(a === b).toBe(false);
  // Upper case uses the same order as lower case, so shift doesn't move keys.
  const o = K.makeOrders('text', true, testRng(3));
  expect(K.keyRows(o, 'ABC').flat().join('')).toBe(K.keyRows(o, 'abc').flat().join('').toUpperCase());
  // shuffleRows draws from the injected RNG only, with the right range each time.
  const seen = [];
  K.shuffleRows([['a', 'b', 'c'], ['d']], (n) => { seen.push(n); return 0; });
  expect(seen).toEqual([4, 3, 2]);
});
const SEEDKEYS = K.SEED_ROWS.join('');

test('cryptoRandomInt: in range, from crypto.getRandomValues', () => {
  const real = crypto.getRandomValues.bind(crypto);
  let calls = 0;
  crypto.getRandomValues = (a) => { calls++; return real(a); };
  try {
    for (let i = 0; i < 200; i++) {
      const v = K.cryptoRandomInt(7);
      expect(v >= 0 && v < 7 && Number.isInteger(v)).toBe(true);
    }
    expect(calls >= 200).toBe(true);
  } finally { crypto.getRandomValues = real; }
  const r = K.makeOrders('text', true); // default RNG works
  expect(r.abc.flat().length).toBe(36);
});
