// A few Jest-style matchers on top of node:assert, so the tests read naturally.
import assert from 'node:assert/strict';

export function expect(actual) {
  const m = {
    toBe: (exp) => assert.strictEqual(actual, exp),
    toEqual: (exp) => assert.deepStrictEqual(actual, exp),
    toBeTruthy: () => assert.ok(actual),
    toContain: (x) => assert.ok(actual.includes(x), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(x)}`),
    toMatch: (re) => assert.match(actual, re),
    toBeGreaterThan: (n) => assert.ok(actual > n, `expected ${actual} > ${n}`),
    toThrow: (re) => (re ? assert.throws(actual, re) : assert.throws(actual)),
  };
  m.not = { toBe: (exp) => assert.notStrictEqual(actual, exp) };
  m.rejects = { toThrow: (re) => assert.rejects(actual, re) };
  return m;
}
