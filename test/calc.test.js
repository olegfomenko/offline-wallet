// Settings tools: SHA-256 / SHA-512 and the secp256k1 calculator.
import { test } from 'node:test';
import { expect } from './expect.js';
import { hex, utf8 } from '../src/core/util.js';
import { digest, parseNum, formatNum, modN, N, G, parsePoint, encodePoint, ecOp, decodeBytes, encodeBytes, yOdd } from '../src/core/calc.js';

test('SHA-256 and SHA-512 (FIPS 180 vectors)', () => {
  expect(hex.encode(digest('sha256', utf8.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(hex.encode(digest('sha256', new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(hex.encode(digest('sha512', utf8.encode('abc')))).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  expect(encodeBytes(decodeBytes('YWJj', 'b64'), 'hex')).toBe('616263');
  expect(decodeBytes('zz', 'hex')).toBe(null);
});

test('scalars: decimal, hex, Base64, negative and mod n', () => {
  expect(parseNum('3', 'dec')).toBe(3n);
  expect(parseNum('-1', 'dec')).toBe(-1n);
  expect(parseNum('0x0a', 'hex')).toBe(10n);
  expect(parseNum('-ff', 'hex')).toBe(-255n);
  expect(parseNum('AQA=', 'b64')).toBe(256n);
  expect(parseNum('-AQA=', 'b64')).toBe(null);
  expect(parseNum('1.5', 'dec')).toBe(null);
  expect(formatNum(255n, 'hex')).toBe('ff');
  expect(formatNum(-255n, 'hex')).toBe('-ff');
  expect(formatNum(256n, 'b64')).toBe('AQA=');
  expect(formatNum(-1n, 'b64')).toBe(formatNum(N - 1n, 'b64'));
  expect(modN(-1n)).toBe(N - 1n);
  expect(modN(N + 2n)).toBe(2n);
});

const G2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const G3 = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
const pt = (h) => parsePoint(hex.decode(h)).pt;

test('secp256k1: k × P, P + Q, 2P, encodings and infinity', () => {
  expect(hex.encode(encodePoint(ecOp('mul', { k: 3n, P: G }), 'comp'))).toBe(G3);
  expect(hex.encode(encodePoint(ecOp('dbl', { P: G }), 'comp'))).toBe(G2);
  expect(hex.encode(encodePoint(ecOp('add', { P: G, Q: pt(G2) }), 'comp'))).toBe(G3);
  // −1 × G is G with the other y.
  const negG = ecOp('mul', { k: -1n, P: G });
  expect(hex.encode(encodePoint(negG, 'xonly'))).toBe(hex.encode(encodePoint(G, 'xonly')));
  expect(yOdd(negG)).toBe(!yOdd(G));
  expect(ecOp('add', { P: G, Q: negG })).toBe(null);
  expect(ecOp('mul', { k: N, P: G })).toBe(null);
  // Uncompressed and x-only inputs parse to the same point.
  const un = encodePoint(G, 'uncomp');
  expect(un.length).toBe(65);
  expect(parsePoint(un).kind).toBe('uncompressed, 65 bytes');
  expect(parsePoint(encodePoint(G, 'xonly')).pt.equals(G)).toBe(true); // G has even y
  expect(parsePoint(hex.decode('02' + 'ff'.repeat(32))).err).toBe('Not on the curve.');
  expect(parsePoint(new Uint8Array(20)).err).toMatch(/got 20/);
  const bad = un.slice(); bad[64] ^= 1;
  expect(parsePoint(bad).err).toBe('Not on the curve.');
});
