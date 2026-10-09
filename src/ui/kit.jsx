// Shared building blocks: page shells, navigation, segmented controls and the value-field pattern
// (every output has an export button, every input an import button; private values start hidden).
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { go, current } from './router.js';
import { getState, setState, resetAll } from './store.js';
import * as I from './icons.jsx';
import { netStatus, onNetChange } from './net.js';

/** Network status as the browser reports it: 'offline', 'online' or 'unknown' (iPhone and iPad). */
export function useNet() {
  const [net, setNet] = useState(netStatus);
  useEffect(() => { setNet(netStatus()); return onNetChange(setNet); }, []);
  return net;
}

export const NET_ONLINE_TIP = 'The browser reports a network connection. Disconnect this device before using real keys.';
export const NET_UNKNOWN_TIP = 'iPhone and iPad browsers can report a network even when there is none, so the network can’t be checked here. Turn on airplane mode and check that Wi-Fi and Bluetooth are off.';

function NetBadge() {
  const net = useNet();
  if (net === 'online') return <span class="netbadge online" title={NET_ONLINE_TIP}><I.INet />Network detected</span>;
  if (net === 'unknown') return <span class="netbadge unknown" title={NET_UNKNOWN_TIP}><I.IWarn size={16} />Can’t check network</span>;
  return <span class="netbadge"><I.INoNet />Offline · no network</span>;
}

export function Brand({ sub }) {
  return (
    <span class="brand">
      <span class="logo"><I.IKey size={16} /></span>
      <span><b>Offline Signer</b>{sub && <small>{sub}</small>}</span>
    </span>
  );
}

/** Pages before a wallet exists: header with brand and offline badge, centered column. */
export function FlowShell({ max = 600, gap = 20, children }) {
  return (
    <div class="page">
      <header class="flowhead"><Brand /><NetBadge /></header>
      <main class="flowmain">
        <div class="wrap" style={{ maxWidth: max + 'px', gap: gap + 'px' }}>{children}</div>
      </main>
    </div>
  );
}

const NAV = [
  ['main', 'Home', I.IHome, ['main']],
  ['source', 'Sign transaction', I.IScan, ['source', 'load', 'notpsbt', 'review', 'signed-export', 'psbt-details']],
  ['addresses', 'Addresses', I.IList, ['addresses', 'address-help', 'edit-path', 'address', 'private-key', 'sign-verify']],
  ['signed', 'Signed', I.ISigned, ['signed']],
  ['keys', 'Keys', I.IKey, ['keys']],
  ['check-address', 'Check an address', I.ISearch, ['check-address']],
  ['seed', 'Seed', I.ILock, ['seed']],
  ['settings', 'Settings', I.IGear, ['settings', 'wordlist', 'lastword']],
];

export function walletLabel(w) {
  if (!w) return '';
  return { seed: 'Single-sig wallet', custom: 'Single-sig wallet', xkey: 'Master-key wallet', keys: 'Single-key wallet' }[w.kind];
}

const NARROW = '(max-width: 760px)';

/** Pages of an open wallet: side menu on wide screens. On narrow ones a top bar with a menu button
 *  opens the same menu as a drawer from the left, over a dark backdrop. */
export function NavShell({ max = 1040, gap = 24, children }) {
  const st = getState();
  const w = st.wallet;
  const route = current();
  const net = useNet();
  const [open, setOpen] = useState(false);
  const menuBtn = useRef(null);
  const closeBtn = useRef(null);
  const close = (refocus) => { setOpen(false); if (refocus && menuBtn.current) menuBtn.current.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    // While the drawer is open: Escape closes it, the page behind doesn't scroll, and widening the
    // window past the breakpoint (where the menu is a normal sidebar again) closes it.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    const mq = window.matchMedia(NARROW);
    const onMq = () => { if (!mq.matches) setOpen(false); };
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    if (closeBtn.current) closeBtn.current.focus();
    return () => { root.style.overflow = prev; document.removeEventListener('keydown', onKey); mq.removeEventListener('change', onMq); };
  }, [open]);

  return (
    <div class="page nav">
      <header class="mbar">
        <button ref={menuBtn} class="mbar-btn" aria-label="Menu" aria-controls="ow-nav" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}><I.IMenu /></button>
        <b>Offline Signer</b>
        {net === 'online' ? <span class="mbar-net online" title={NET_ONLINE_TIP}><I.INet />Network</span>
          : net === 'unknown' ? <span class="mbar-net unknown" title={NET_UNKNOWN_TIP}><I.IWarn size={16} />Can’t tell</span>
          : <span class="mbar-net" title="Offline · no network"><I.INoNet />Offline</span>}
      </header>
      {open && <button class="navscrim" aria-label="Close menu" tabindex={-1} onClick={() => close(false)} />}
      <nav id="ow-nav" aria-label="Wallet" class="side" data-open={open ? 'true' : 'false'}>
        <div class="sidehead">
          <Brand sub="Bitcoin · single-sig" />
          <button ref={closeBtn} class="navclose" aria-label="Close menu" onClick={() => close(true)}><I.IClose size={22} sw={1.8} /></button>
        </div>
        {w && <div class="walletchip"><span>{walletLabel(w)}</span><b>{w.kind === 'keys' ? w.keys.length + ' key' + (w.keys.length > 1 ? 's' : '') : w.fp}</b></div>}
        <div class="navlist">
          {NAV.map(([id, label, Icon, group]) => (
            <a href={'#/' + id} class={group.includes(route) ? 'on' : ''} aria-current={group.includes(route) ? 'page' : undefined} onClick={() => setOpen(false)}>
              <span class="ic"><Icon /></span>{label}
            </a>
          ))}
        </div>
        <div class="sidefoot">
          {net === 'online' ? <span class="offl online" title={NET_ONLINE_TIP}><I.INet />Network detected</span>
            : net === 'unknown' ? <span class="offl unknown" title={NET_UNKNOWN_TIP}><I.IWarn size={16} />Can’t check network</span>
            : <span class="offl"><I.INoNet />Offline · no network</span>}
          <button class="btn-secondary bold btn-sm" title="Nothing is saved. The wallet is forgotten when you close this tab." onClick={() => { setOpen(false); resetAll(); go('welcome'); }}>Close wallet</button>
        </div>
      </nav>
      <main class="navmain">
        <div class="wrap" style={{ maxWidth: max + 'px', gap: gap + 'px' }}>{children}</div>
      </main>
    </div>
  );
}

export function Back({ to, label = 'Back', onClick }) {
  return <button class="backbtn" aria-label={label} onClick={() => (onClick ? onClick() : go(to))}><I.IBack /></button>;
}
export function TitleRow({ back, title, sub, right, h28 = true, onBack }) {
  return (
    <div class="backrow">
      {(back || onBack) && <Back to={back} onClick={onBack} />}
      {sub ? <div class="titlecol"><h1 class={h28 ? 'h28' : ''}>{title}</h1><span class="sub">{sub}</span></div> : <h1 class={h28 ? 'h28' : ''} style={{ flexGrow: 1 }}>{title}</h1>}
      {right}
    </div>
  );
}
export function StepRow({ back, onBack, step, of = 6, label }) {
  return (
    <>
      <div class="backrow between">
        <Back to={back} onClick={onBack} />
        <span class="small" style={{ fontSize: '14px' }}>{label || 'Step ' + step + ' of ' + of}</span>
      </div>
      <div class="steps">{Array.from({ length: of }, (_, i) => <span class={i < step ? 'on' : ''} />)}</div>
    </>
  );
}

export function Seg({ items, value, onChange, cls = '', cols }) {
  return (
    <div class={'seg ' + cls} role="group" style={{ gridTemplateColumns: 'repeat(' + (cols || items.length) + ', minmax(0, 1fr))' }}>
      {items.map(([id, label]) => <button type="button" aria-pressed={value === id ? 'true' : 'false'} class={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>)}
    </div>
  );
}
export function Chips({ items, value, onChange, label }) {
  return (
    <div class="chips" role="group" aria-label={label}>
      {items.map(([id, l]) => <button type="button" aria-pressed={value === id ? 'true' : 'false'} class={value === id ? 'on' : ''} onClick={() => onChange(id)}>{l}</button>)}
    </div>
  );
}
export function UTabs({ items, value, onChange, label }) {
  return (
    <div class="utabs" role="tablist" aria-label={label} style={{ gridTemplateColumns: 'repeat(' + items.length + ', minmax(0, 1fr))' }}>
      {items.map(([id, l]) => <button role="tab" aria-selected={value === id ? 'true' : 'false'} class={value === id ? 'on' : ''} onClick={() => onChange(id)}>{l}</button>)}
    </div>
  );
}

export const PrivChip = () => <span class="privchip"><I.ILockSm />Private</span>;

export function openExport(spec) { setState({ sheet: { mode: 'export', ...spec } }); }
export function openImport(spec) { setState({ sheet: { mode: 'import', ...spec } }); }

const lcFirst = (t) => { const s = String(t); return s.length > 1 && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1]) ? s : s.charAt(0).toLowerCase() + s.slice(1); };
export function ExportBtn({ spec, label, small }) {
  const t = label || 'Export ' + lcFirst(spec.title);
  return <button class={'iconbtn' + (spec.priv ? ' priv' : '') + (small ? ' sm' : '')} aria-label={t} title={t} onClick={() => openExport(spec)}><I.IExport size={small ? 16 : 18} /></button>;
}
export function ImportBtn({ spec }) {
  const t = 'Enter ' + lcFirst(spec.title) + ': type, paste, scan or load';
  return <button class={'iconbtn' + (spec.priv ? ' priv' : '')} aria-label={t} title={t} onClick={() => openImport(spec)}><I.IImport /></button>;
}

/** Output field: label, value box, export button. Private values show "Hidden". */
export function OutField({ label, value, spec, note, noteCls = '', priv, children, extra }) {
  const s = spec || { title: label, value, priv };
  return (
    <div class="field">
      <div class="fhead"><span class="flabel">{label}{priv && <PrivChip />}{extra}</span><span /></div>
      <div class="fbody">
        {priv ? <div class="valbox hiddenv"><span>••••••••••••</span><small>Hidden</small></div> : <div class="valbox">{children || value}</div>}
        <ExportBtn spec={{ ...s, priv: !!priv }} />
      </div>
      {note && <span class={'note ' + noteCls}>{note}</span>}
    </div>
  );
}

/** Input field with an import button. */
export function InField({ label, priv, value, onInput, placeholder, note, noteCls = '', textarea, password, bad, spec, mono = true, rows, id, right }) {
  const cls = (textarea ? 'textarea' : 'input') + (bad ? ' bad' : '') + (mono ? '' : ' sans');
  const common = { id, value, placeholder, spellcheck: false, autocapitalize: 'none', autocomplete: 'off', 'aria-label': label, onInput: (e) => onInput(e.currentTarget.value) };
  return (
    <div class="field">
      <div class="fhead"><span class="flabel">{label}{priv && <PrivChip />}</span><span>{right}</span></div>
      <div class="fbody">
        {textarea ? <textarea class={cls} rows={rows} {...common} /> : <input class={cls} type={password ? 'password' : 'text'} {...common} />}
        <ImportBtn spec={{ title: label, priv, ...spec, onValue: spec && spec.onValue ? spec.onValue : (v) => onInput(typeof v === 'string' ? v : new TextDecoder().decode(v)), focusId: id }} />
      </div>
      {note && <span class={'note ' + noteCls}>{note}</span>}
    </div>
  );
}

/** Private input that stays masked; content arrives through the import sheet. */
export function HiddenInField({ label, has, count, onValue, note, multi, onType }) {
  return (
    <div class="field">
      <div class="fhead"><span class="flabel">{label}<PrivChip /></span><span /></div>
      <div class="fbody">
        <div class="valbox hiddenv" role="textbox" aria-label={label + ', hidden'}><span style={{ color: has ? 'var(--dim)' : 'var(--line2)' }}>{has ? '••••••••••••' : '············'}</span><small>{has ? 'Hidden · ' + count : 'Nothing entered'}</small></div>
        <ImportBtn spec={{ title: label, priv: true, onValue, multi, onType }} />
      </div>
      {note && <span class="note">{note}</span>}
    </div>
  );
}

export function Switch({ on, onClick, label, sub }) {
  return (
    <button class="switchrow" role="switch" aria-checked={on ? 'true' : 'false'} onClick={onClick}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span>{label}</span>{sub && <span class="small">{sub}</span>}</span>
      <span class={'switch' + (on ? ' on' : '')}><i /></span>
    </button>
  );
}

export function Card({ children, style }) { return <div class="card" style={style}>{children}</div>; }
export function KV({ k, v, sub, mono, right }) {
  return (
    <div class="rowb">
      <div class="kv"><span>{k}</span><span class={mono ? 'mono' : ''}>{v}</span>{right}</div>
      {sub && <span class="sub">{sub}</span>}
    </div>
  );
}
export function Section({ title, right, children }) {
  return (
    <div class="stack">
      <div class="secthead"><span class="caps s12">{title}</span>{right && <span class="note">{right}</span>}</div>
      {children}
    </div>
  );
}
export function Spacer() { return <div class="grow" />; }

/** Colored address prefix as in the design. */
export function Addr({ a, chunks }) {
  if (!a) return null;
  if (chunks) {
    const parts = [];
    for (let k = 0; k < a.length; k += 4) parts.push(a.slice(k, k + 4));
    return <div class="chunks" aria-label={a}>{parts.map((p, i) => <span style={{ color: i === 0 ? 'var(--accent)' : i % 2 ? 'var(--text)' : 'var(--muted)' }}>{p}</span>)}</div>;
  }
  const m = /^(bc1[qp]|tb1[qp]|bcrt1[qp])(.*)$/.exec(a);
  return m ? <span><span style={{ color: 'var(--accent)' }}>{m[1]}</span>{m[2]}</span> : <span>{a}</span>;
}

export const shortAddr = (a, n = 8, m = 6) => (a && a.length > n + m + 1 ? a.slice(0, n) + '…' + a.slice(-m) : a);
export const fmtTime = (t) => {
  const d = new Date(t);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

// ---- amounts ----
export function fmtAmt(sats, unit, withUnit = true) {
  if (sats === null || sats === undefined) return '?';
  const n = typeof sats === 'bigint' ? sats : BigInt(sats);
  const neg = n < 0n; const a = neg ? -n : n;
  let s, u;
  const dec = (v, d) => { const p = 10n ** BigInt(d); const i = v / p, f = v % p; return i.toLocaleString('en-US') + '.' + f.toString().padStart(d, '0'); };
  if (unit === 'sats') { s = a.toLocaleString('en-US'); u = 'sats'; }
  else if (unit === 'bits') { s = dec(a, 2); u = 'bits'; }
  else if (unit === 'mbtc') { s = dec(a, 5); u = 'mBTC'; }
  else { s = (a / 100000000n).toString() + '.' + (a % 100000000n).toString().padStart(8, '0'); u = 'BTC'; }
  return (neg ? '−' : '') + s + (withUnit ? ' ' + u : '');
}
export const unitName = (unit) => ({ btc: 'BTC', mbtc: 'mBTC', bits: 'bits', sats: 'sats' }[unit]);

export { I };
