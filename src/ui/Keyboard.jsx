// On-screen keyboard for private fields: click the keys instead of typing, so a keylogger on this
// computer records nothing. One panel at a time, fixed to the bottom of the window.
//
// A screen keeps its value in its own state and hands the panel a target:
//   { label, layout: 'text' | 'seed', value, onChange, mask?, multiline?, len? (seed), anchor }
// `anchor` is the id of the field to keep in view (for seed words, a function of the word index).
// The physical keyboard keeps working in the fields: the keys never take focus from them.
import { h } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import * as K from './kbd.js';
import { wordlist } from '../core/wallet.js';
import { getState } from './store.js';
import * as I from './icons.jsx';

// Shuffle stays on for later panels in this tab (the key order itself is new each time).
let shufflePref = false;

/** Which keyboard is open on this screen, and for seed words, which word. */
export function useKbd() {
  const [s, set] = useState({ id: null, i: 0, n: 0 });
  return {
    id: s.id, i: s.i, n: s.n,
    open: (id, i = 0) => set((p) => ({ id, i, n: p.n + 1 })),
    setI: (i) => set((p) => ({ ...p, i })),
    close: () => set((p) => ({ ...p, id: null })),
  };
}

/** The keyboard button next to a private field. */
export function KbdButton({ onClick, what, open }) {
  return (
    <button type="button" class="iconbtn priv" aria-label={'On-screen keyboard for ' + what} aria-expanded={open ? 'true' : 'false'}
      title="On-screen keyboard: click the keys, nothing goes through the computer keyboard" onClick={onClick}><I.IKeyboard /></button>
  );
}

export function Keyboard({ kb, targets }) {
  const T = kb.id ? targets[kb.id] : null;
  if (!T) return null;
  // A new key per opening: fresh mode, Show/Hide and key order every time.
  return <Panel key={kb.n} kb={kb} T={T} />;
}

const noFocus = (e) => e.preventDefault(); // pointerdown: keep the focus (and caret) where it is

function Panel({ kb, T }) {
  const seed = T.layout === 'seed';
  const len = T.len || 1;
  const [mode, setMode] = useState('abc');
  const [shuf, setShuf] = useState(shufflePref);
  const [orders, setOrders] = useState(() => K.makeOrders(T.layout, shufflePref));
  const [show, setShow] = useState(false);
  const panel = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  const i = seed ? K.seedGo(len, kb.i) : 0;
  const words = seed ? T.value || [] : null;
  const cur = seed ? String(words[i] || '') : String(T.value || '');

  const close = (refocus) => {
    kb.close();
    const el = opener.current;
    if (refocus && el && el.isConnected && typeof el.focus === 'function') el.focus();
  };

  // Escape closes the panel (the import sheet, when open on top, handles Escape itself).
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !getState().sheet) { e.preventDefault(); close(true); } };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  // Room under the page for the panel, and the field scrolled into view above it.
  const reveal = () => {
    const id = typeof T.anchor === 'function' ? T.anchor(i) : T.anchor;
    const cell = id && document.getElementById(id);
    // A text field comes into view whole, with its note; a seed word, just its cell.
    const el = cell && (seed ? cell : cell.closest('.field') || cell);
    if (!el || !panel.current) return;
    const r = el.getBoundingClientRect();
    const limit = panel.current.getBoundingClientRect().top - 12;
    if (r.bottom > limit) window.scrollBy(0, r.bottom - limit);
    else if (r.top < 68) window.scrollBy(0, r.top - 68); // clear of the sticky top bar on phones
  };
  useLayoutEffect(() => {
    const body = document.body;
    const fit = () => { if (panel.current) body.style.paddingBottom = panel.current.offsetHeight + 'px'; };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro && panel.current) ro.observe(panel.current);
    return () => { if (ro) ro.disconnect(); body.style.paddingBottom = ''; };
  }, []);
  useEffect(() => { requestAnimationFrame(reveal); }, [i]);

  // ---- actions ----
  const put = (v) => T.onChange(v);
  const typeChar = (ch) => {
    if (seed) { put(K.seedType(words, len, i, ch)); return; }
    const r = K.textType(cur, mode, ch);
    put(r.value);
    if (r.mode !== mode) setMode(r.mode);
  };
  const back = () => {
    if (seed) {
      const r = K.seedBack(words, len, i);
      if (r.i !== i) kb.setI(r.i); else put(r.words);
      return;
    }
    put(K.textBack(cur));
  };
  const toggleShuffle = () => {
    const on = !shuf;
    shufflePref = on;
    setShuf(on);
    setOrders(K.makeOrders(T.layout, on)); // a new order every time it's turned on
  };

  // ---- keys ----
  const ok = seed ? K.allowedNext(cur, wordlist) : null;
  const key = (label, aria, onPress, opt = {}) => (
    <button type="button" class={'kk' + (opt.fn ? ' fn' : '') + (opt.on ? ' on' : '') + (opt.dim ? ' dim' : '')}
      style={opt.grow ? { flexGrow: opt.grow, maxWidth: opt.max + 'px' } : undefined}
      aria-label={aria} aria-disabled={opt.dim ? 'true' : undefined} aria-pressed={opt.pressed}
      onPointerDown={noFocus} onClick={opt.dim ? undefined : onPress}>{label}</button>
  );
  const rows = K.keyRows(orders, seed ? 'abc' : mode).map((r) => r.map((ch) => (seed && !ok.has(ch)
    ? key(ch, ch + ', no BIP39 word continues with it', null, { dim: true })
    : key(ch, ch, () => typeChar(ch)))));
  const del = key('⌫', 'Delete', back, { fn: true, grow: 1.5, max: 88 });
  const last = rows[rows.length - 1];
  let bottom;
  if (seed) {
    last.push(del);
    bottom = [
      key('← Word', 'Previous word', () => kb.setI(K.seedGo(len, i - 1)), { fn: true, grow: 2, max: 140 }),
      key('Next word →', 'Next word', () => kb.setI(K.seedGo(len, i + 1)), { fn: true, grow: 4, max: 300 }),
      key('Done', 'Close keyboard', () => close(true), { fn: true, on: true, grow: 2, max: 140 }),
    ];
  } else {
    const letters = K.family(mode) !== 'sym';
    const acc = K.family(mode) === 'acc';
    const up = K.isUpper(mode);
    if (letters) last.unshift(key('⇧', 'Shift', () => setMode(K.textShift(mode)), { fn: true, on: up, pressed: up ? 'true' : 'false', grow: 1.5, max: 88 }));
    last.push(del);
    bottom = [
      key(letters ? '#+=' : 'abc', letters ? 'Symbols' : 'Letters', () => setMode(K.textToggleSymbols(mode)), { fn: true, grow: 1.5, max: 100 }),
      key(acc ? 'abc' : 'àé', acc ? 'Letters' : 'Accented letters', () => setMode(K.textToggleAccents(mode)), { fn: true, on: acc, grow: 1.5, max: 100 }),
      key('space', 'Space', () => put(cur + ' '), { fn: true, grow: 5, max: 340 }),
    ];
    if (T.multiline) bottom.push(key('↵', 'New line', () => put(K.textNewline(cur, true)), { fn: true, grow: 1.5, max: 100 }));
    bottom.push(key('Done', 'Close keyboard', () => close(true), { fn: true, on: true, grow: 1.5, max: 120 }));
  }

  const shown = K.previewText(cur, { seed, mask: T.mask, show });
  const sugg = seed ? K.suggestions(cur, wordlist, 6) : [];
  const pick = (w) => { const r = K.seedPick(words, len, i, w); put(r.words); kb.setI(r.i); };

  return (
    <div ref={panel} role="group" aria-label="On-screen keyboard" class="kbd">
      <div class="kbd-in">
        <div class="kbd-head">
          <div class="kbd-title">
            <span class="kbd-tag"><I.IKeyboard size={14} />On-screen keyboard · private</span>
            <b>{seed ? T.label + ' · word ' + (i + 1) + ' of ' + len : T.label}</b>
          </div>
          <div class="kbd-tools">
            <button type="button" class={'kbd-shuf' + (shuf ? ' on' : '')} aria-pressed={shuf ? 'true' : 'false'} onPointerDown={noFocus} onClick={toggleShuffle}
              title="Mixes the key positions, so where you click says nothing about what you type">{shuf ? 'Shuffled' : 'Shuffle keys'}</button>
            <button type="button" class="kbd-x" aria-label="Close keyboard" onPointerDown={noFocus} onClick={() => close(true)}><I.IClose size={20} sw={1.8} /></button>
          </div>
        </div>
        <div class="kbd-prev">
          <span aria-live="polite" class={'v' + (shown ? '' : ' ph')}>{shown || (seed ? 'Type the first letters' : 'Nothing typed yet')}</span>
          {!seed && <span class="c">{K.charCount(cur)}</span>}
          {!seed && T.mask && <button type="button" class="sh" aria-pressed={show ? 'true' : 'false'} onPointerDown={noFocus} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>}
        </div>
        {seed && (
          <div class="kbd-sugg">
            {sugg.map((w) => <button key={w} type="button" class={w === cur ? 'exact' : ''} onPointerDown={noFocus} onClick={() => pick(w)}>{w}</button>)}
            {!sugg.length && <span class="hint">{cur ? 'No BIP39 word starts with “' + cur + '”.' : 'Words appear here as you type. Letters that can’t start a BIP39 word are dimmed.'}</span>}
          </div>
        )}
        <div class="kbd-rows">
          {rows.map((r, k) => <div key={k} class="kbd-row">{r}</div>)}
          <div class="kbd-row">{bottom}</div>
        </div>
      </div>
    </div>
  );
}
