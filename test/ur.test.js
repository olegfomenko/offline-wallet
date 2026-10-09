// UR / fountain-code tests using the vectors of the Blockchain Commons reference implementation
// (github.com/BlockchainCommons/bc-ur, test/test.cpp).
import { test } from 'node:test';
import { expect } from './expect.js';
import { crc32, bytewords, Xoshiro, chooseDegree, chooseFragments, shuffled, nominalFragmentLength, FountainEncoder, FountainDecoder, partToCbor, encodeUR, URDecoder, cbor } from '../src/core/ur.js';
import { hex, utf8 } from '../src/core/util.js';

const makeMessage = (len, seed = 'Wolf') => new Xoshiro(utf8.encode(seed)).nextData(len);
const makeMessageUR = (len, seed = 'Wolf') => cbor.bytes(makeMessage(len, seed));

test('crc32', () => {
  expect(crc32(utf8.encode('Hello, world!')).toString(16)).toBe('ebe6c6e6');
  expect(crc32(utf8.encode('Wolf')).toString(16)).toBe('598c84dc');
});

test('bytewords', () => {
  const input = new Uint8Array([0, 1, 2, 128, 255]);
  expect(bytewords.encode(input, 'standard')).toBe('able acid also lava zoom jade need echo taxi');
  expect(bytewords.encode(input, 'uri')).toBe('able-acid-also-lava-zoom-jade-need-echo-taxi');
  expect(bytewords.encode(input)).toBe('aeadaolazmjendeoti');
  expect(Array.from(bytewords.decode('aeadaolazmjendeoti'))).toEqual([0, 1, 2, 128, 255]);
  expect(() => bytewords.decode('aeadaolazojendeowf')).toThrow();
});

test('xoshiro256** (rng_1, rng_3)', () => {
  const rng = new Xoshiro(utf8.encode('Wolf'));
  const nums = Array.from({ length: 100 }, () => Number(rng.next() % 100n));
  expect(nums.slice(0, 20)).toEqual([42, 81, 85, 8, 82, 84, 76, 73, 70, 88, 2, 74, 40, 48, 77, 54, 88, 7, 5, 88]);
  const r3 = new Xoshiro(utf8.encode('Wolf'));
  expect(Array.from({ length: 20 }, () => r3.nextInt(1, 10))).toEqual([6, 5, 8, 4, 10, 5, 7, 10, 4, 9, 10, 9, 7, 7, 1, 1, 2, 9, 9, 2]);
});

test('rng_2 seeded from crc32', () => {
  const c = crc32(utf8.encode('Wolf'));
  const rng = new Xoshiro(new Uint8Array([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]));
  expect(Array.from({ length: 10 }, () => Number(rng.next() % 100n))).toEqual([88, 44, 94, 74, 0, 99, 7, 77, 68, 35]);
});

test('shuffle', () => {
  const rng = new Xoshiro(utf8.encode('Wolf'));
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(shuffled(v, rng)).toEqual([6, 4, 9, 3, 10, 5, 7, 8, 1, 2]);
  expect(shuffled(v, rng)).toEqual([10, 8, 6, 5, 1, 2, 3, 9, 7, 4]);
});

test('fragment length, degrees and fragments', () => {
  expect(nominalFragmentLength(12345, 1005, 1955)).toBe(1764);
  expect(nominalFragmentLength(12345, 1005, 30000)).toBe(12345);
  const msg = makeMessage(1024);
  const fl = nominalFragmentLength(msg.length, 10, 100);
  const count = Math.ceil(msg.length / fl);
  const degrees = [];
  for (let nonce = 1; nonce <= 20; nonce++) degrees.push(chooseDegree(count, new Xoshiro(utf8.encode('Wolf-' + nonce))));
  expect(degrees).toEqual([11, 3, 6, 5, 2, 1, 2, 11, 1, 3, 9, 10, 10, 4, 2, 1, 1, 2, 1, 1]);
  const checksum = crc32(msg);
  const idx = [];
  for (let s = 1; s <= 30; s++) idx.push(chooseFragments(s, count, checksum));
  expect(idx[12]).toEqual([2, 5, 6, 8, 9, 10]);
  expect(idx[16]).toEqual([0, 2, 4, 5, 8, 10]);
  expect(idx[25]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(idx[29]).toEqual([7]);
});

test('fountain encoder parts and CBOR', () => {
  const enc = new FountainEncoder(makeMessage(256), 30);
  const parts = Array.from({ length: 20 }, () => enc.nextPart());
  expect(parts[0].checksum).toBe(23570951);
  expect(hex.encode(parts[0].data)).toBe('916ec65cf77cadf55cd7f9cda1a1030026ddd42e905b77adc36e4f2d3c');
  expect(hex.encode(parts[9].data)).toBe('330f0f33a05eead4f331df229871bee733b50de71afd2e5a79f196de09');
  expect(hex.encode(parts[19].data)).toBe('e055c2433562184fa71b4be94f262e200f01c6f74c284b0dc6fae6673f');
  expect(hex.encode(partToCbor(parts[0]))).toBe('8501091901001a0167aa07581d916ec65cf77cadf55cd7f9cda1a1030026ddd42e905b77adc36e4f2d3c');
  expect(hex.encode(partToCbor(parts[14]))).toBe('850f091901001a0167aa07581d73f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5');
});

test('single-part UR and UR encoder strings', () => {
  const single = encodeUR('bytes', makeMessageUR(50));
  expect(single.next()).toBe('ur:bytes/hdeymejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtgwdpfnsboxgwlbaawzuefywkdplrsrjynbvygabwjldapfcsdwkbrkch');
  const e = encodeUR('bytes', makeMessageUR(256), 30);
  const parts = Array.from({ length: 20 }, () => e.next());
  expect(parts[0]).toBe('ur:bytes/1-9/lpadascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtdkgslpgh');
  expect(parts[9]).toBe('ur:bytes/10-9/lpbkascfadaxcywenbpljkhdcahkadaemejtswhhylkepmykhhtsytsnoyoyaxaedsuttydmmhhpktpmsrjtwdkiplzs');
  expect(parts[19]).toBe('ur:bytes/20-9/lpbbascfadaxcywenbpljkhdcayapmrleeleaxpasfrtrdkncffwjyjzgyetdmlewtkpktgllepfrltataztksmhkbot');
});

test('fountain decoder recovers a 32767-byte message from mixed parts', () => {
  const msg = makeMessage(32767);
  const enc = new FountainEncoder(msg, 1000, 100);
  const dec = new FountainDecoder();
  let n = 0;
  while (!dec.complete && n < 1000) { dec.receive(enc.nextPart()); n++; }
  expect(dec.result && hex.encode(dec.result) === hex.encode(msg)).toBe(true);
});

test('multipart UR decoder, parts out of order and with losses', () => {
  const ur = makeMessageUR(4000);
  const e = encodeUR('bytes', ur, 200);
  const all = Array.from({ length: 80 }, () => e.next());
  const d = new URDecoder();
  // drop every third, feed in reverse
  for (const p of all.filter((_, i) => i % 3 !== 0).reverse()) { d.receive(p); if (d.done) break; }
  expect(d.done).toBe(true);
  expect(hex.encode(d.result.cbor)).toBe(hex.encode(ur));
});
