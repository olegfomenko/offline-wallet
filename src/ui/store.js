// App state lives only in this JavaScript heap: no localStorage, no IndexedDB, no cookies.
// Closing the tab forgets everything; closeWallet() also wipes key material we can reach.
import { useEffect, useReducer } from 'preact/hooks';
import { closeWallet } from '../core/wallet.js';

const initial = () => ({
  wallet: null,
  // net: the Addresses screen's network. signNet: the network PSBTs are reviewed for (Sign a
  // transaction); null until picked, then it follows the wallet's own network.
  settings: { unit: 'btc', net: 'main', signNet: null, feeLimit: 5, depth: 1000 },
  flow: {},          // create / restore flow scratch (seed words in progress etc.)
  addr: { type: 'wpkh', acct: 0, cpath: {}, kmode: 'pub', branch: 0, idx: 0, fmt: 'slip' },
  addrSel: null,     // address opened on the detail screen
  keyScope: 'addr',  // private key screen: 'addr' | 'acct'
  tx: {},            // loaded PSBT, its analysis and signing result
  log: [],           // signed PSBTs and messages (this tab only)
  logPrefs: { keep: true, retOn: false, d: 30, h: 0 },
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
  let changed = false;
  let log = state.log;
  if (lc) { const n = log.filter((x) => x.time >= lc); if (n.length !== log.length) { log = n; changed = true; } }
  if (changed) setState({ log });
}
setInterval(pruneLogs, 60e3);

export function addLog(entry) {
  if (!state.logPrefs.keep) return;
  setState({ log: [{ ...entry, id: Math.random().toString(36).slice(2), time: Date.now() }, ...state.log] });
}

/** The network PSBTs are reviewed and signed for. */
export function signNetOf(st) {
  return st.settings.signNet || (st.wallet && st.wallet.net === 'test' ? 'test' : 'main');
}
