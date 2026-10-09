// App state lives only in this JavaScript heap: no localStorage, no IndexedDB, no cookies.
// Closing the tab forgets everything; closeWallet() also wipes key material we can reach.
import { useEffect, useReducer } from 'preact/hooks';
import { closeWallet } from '../core/wallet.js';

const initial = () => ({
  wallet: null,
  settings: { unit: 'btc', net: 'main', feeLimit: 5, depth: 1000 },
  flow: {},          // create / restore flow scratch (seed words in progress etc.)
  addr: { type: 'wpkh', acct: 0, cpath: {}, kmode: 'pub', branch: 0, idx: 0, fmt: 'slip' },
  addrSel: null,     // address opened on the detail screen
  keyScope: 'addr',  // private key screen: 'addr' | 'acct'
  tx: {},            // loaded PSBT, its analysis and signing result
  log: [],           // signed PSBTs and messages (this tab only)
  logPrefs: { keep: true, retOn: false, d: 30, h: 0 },
  seen: { ours: new Map(), theirs: new Map() },
  seenPrefs: { keep: true, retOn: false, d: 30, h: 0 },
  sheet: null,
  toast: null,
});

let state = initial();
const subs = new Set();
export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const f of subs) f();
}
export function patch(key, p) {
  setState({ [key]: { ...state[key], ...p } });
}
export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { subs.add(force); return () => subs.delete(force); }, []);
  return state;
}

export function resetAll() {
  closeWallet(state.wallet);
  if (state.tx && state.tx.tx) state.tx = {};
  state = initial();
  for (const f of subs) f();
}

let toastTimer;
export function toast(msg) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3500);
}

// ---- retention for the in-tab logs ----
export function pruneLogs() {
  const now = Date.now();
  const cut = (prefs) => (prefs.retOn && (prefs.d || prefs.h) ? now - (prefs.d * 24 + prefs.h) * 3600e3 : null);
  const lc = cut(state.logPrefs);
  const sc = cut(state.seenPrefs);
  let changed = false;
  let log = state.log;
  if (lc) { const n = log.filter((x) => x.time >= lc); if (n.length !== log.length) { log = n; changed = true; } }
  const seen = { ours: new Map(state.seen.ours), theirs: new Map(state.seen.theirs) };
  if (sc) for (const m of [seen.ours, seen.theirs]) for (const [k, v] of m) if (v.last < sc) { m.delete(k); changed = true; }
  if (changed) setState({ log, seen });
}
setInterval(pruneLogs, 60e3);

export function addLog(entry) {
  if (!state.logPrefs.keep) return;
  setState({ log: [{ ...entry, id: Math.random().toString(36).slice(2), time: Date.now() }, ...state.log] });
}
export function noteSeen(ours, theirs) {
  if (!state.seenPrefs.keep) return;
  const seen = { ours: new Map(state.seen.ours), theirs: new Map(state.seen.theirs) };
  const now = Date.now();
  for (const o of ours) seen.ours.set(o.addr, { ...o, last: now });
  for (const t of theirs) if (!seen.ours.has(t.addr)) seen.theirs.set(t.addr, { ...t, last: now });
  setState({ seen });
}
