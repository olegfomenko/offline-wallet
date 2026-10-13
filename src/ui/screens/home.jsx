// Wallet home, seed, settings and the seed tools (word list, last word, check an address).
import { h, Fragment } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { go } from '../router.js';
import { setState, patch, useStore } from '../store.js';
import { NavShell, TitleRow, Seg, OutField, ExportBtn, PrivChip, InField, I, walletLabel, fmtAmt } from '../kit.jsx';
import { SeedGrid, seedExportSpec } from './create.jsx';
import { SeedCells, seedStats, wordsFromInput } from './restore.jsx';
import { Keyboard, KbdButton, useKbd } from '../Keyboard.jsx';
import { firstEmpty } from '../kbd.js';
import { wordlist, lastWordCandidates } from '../../core/wallet.js';
import { encodeWIF } from '../../core/keys.js';
import { NETS, TYPES } from '../../core/hd.js';
import { findAddress } from '../../core/search.js';
import { APP_VERSION } from '../version.js';

export function Main() {
  const st = useStore();
  const w = st.wallet;
  const psbts = st.log.filter((x) => x.kind === 'psbt').length, msgs = st.log.length - psbts;
  const seedLabel = { seed: 'Seed words', custom: 'Custom words', xkey: 'Master key', keys: 'Private keys' }[w.kind];
  return (
    <NavShell>
      <div class="stack">
        <div class="caps">Wallet</div>
        <h1 style={{ fontWeight: 600 }}>{walletLabel(w)}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '20px' }}>
          {w.kind === 'keys'
            ? <span class="mono muted" style={{ fontSize: '14px' }}>{w.keys.length} key{w.keys.length > 1 ? 's' : ''} · no fingerprint</span>
            : <><span class="mono muted" style={{ fontSize: '14px' }}>Fingerprint {w.fpKnown ? w.fp : 'unknown'}</span><ExportBtn small spec={{ title: 'Fingerprint', value: w.fp, file: 'fingerprint.txt' }} /></>}
        </div>
      </div>
      <a class="homecta" href="#/source">
        <I.IScan size={32} />
        <div><b>Sign transaction</b><span>Scan, paste or load a PSBT</span></div>
      </a>
      <div class="tiles">
        <a class="tile" href="#/addresses"><I.IList size={26} /><div><b>Addresses</b><span>{w.kind === 'keys' ? 'One per key' : 'xpub, descriptor'}</span></div></a>
        <a class="tile" href="#/seed"><I.ILock size={26} /><div><b>Seed</b><span>{seedLabel}</span></div></a>
      </div>
      <div class="card">
        <a class="cardlink" href="#/signed"><span class="muted">Signed</span><span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{psbts} PSBT{psbts === 1 ? '' : 's'} · {msgs} message{msgs === 1 ? '' : 's'}<I.IChev /></span></a>
      </div>
    </NavShell>
  );
}

/** The passphrase under the seed words: hidden until Show, spaces as ␣, exportable. */
function PassphraseRow({ pass }) {
  const [show, setShow] = useState(false);
  if (!pass) return <span class="small">No passphrase. These words alone open this wallet.</span>;
  const n = Array.from(pass).length;
  return (
    <div class="field">
      <div class="fhead"><span class="flabel">Passphrase<PrivChip /></span>{show && <span class="note">{n} character{n === 1 ? '' : 's'}</span>}</div>
      <div class="fbody">
        <div class={'valbox' + (show ? ' ppshown' : ' hiddenv')} aria-live="polite">
          {show ? pass.replace(/ /g, '␣') : <><span>••••••••••••</span><small>Hidden</small></>}
        </div>
        <button type="button" class="btn-privsm" aria-pressed={show ? 'true' : 'false'} onClick={() => setShow(!show)}><I.IEye size={16} />{show ? 'Hide' : 'Show'}</button>
        <ExportBtn spec={{ title: 'Passphrase', value: pass, priv: true, file: 'passphrase.txt' }} />
      </div>
      <span class="note">Not part of the words above: without it they open a different, empty wallet. Spaces show as ␣. Keep its written copy apart from the seed backup.</span>
    </div>
  );
}

export function Seed() {
  const { wallet: w } = useStore();
  const [shown, setShown] = useState(false);
  return (
    <NavShell max={860} gap={20}>
      <h1>Seed</h1>
      <div class="warnline"><I.IWarn /><span>Never type or scan these into a computer or phone that goes online, unless you are moving to a new wallet.</span></div>
      {w.kind === 'seed' && (
        <div class="stack14">
          <div class="fhead"><span class="flabel">Seed words · {w.words.length}<PrivChip /></span><ExportBtn spec={seedExportSpec(w.words)} /></div>
          <SeedGrid words={w.words} shown={shown} onShow={() => setShown(true)} />
          {shown && <button class="linkbtn" onClick={() => setShown(false)}>Hide words</button>}
          <PassphraseRow pass={w.passphrase} />
          <div class="stack" style={{ gap: '4px' }}>
            <span class="caps s12">Works with</span>
            <span style={{ fontSize: '14px' }}>Any BIP39 wallet: Sparrow, BlueWallet, Nunchuk, Electrum</span>
            <span class="note">In Electrum choose the BIP39 seed option, it is not the default. The QR in export is a SeedQR for SeedSigner, Krux, Jade and Coldcard Q.</span>
          </div>
        </div>
      )}
      {w.kind === 'custom' && (
        <div class="stack14">
          <OutField label="Custom words · exact text" priv spec={{ title: 'Custom seed words', value: w.text, file: 'custom-seed-words.txt' }}
            note="Restore them with the same capital letters and accents." />
          <PassphraseRow pass={w.passphrase} />
        </div>
      )}
      {w.kind === 'xkey' && (
        <>
          <OutField label={'Master private key · ' + w.xinfo.format} priv spec={{ title: 'Master private key', value: w.xinfo.raw, file: 'master-key.txt' }}
            note="This key is the wallet's only backup. There are no seed words." />
          {!w.fpKnown && <span class="note">Fingerprint and full path are unknown for this key. Watch-only wallets may show 00000000.</span>}
        </>
      )}
      {w.kind === 'keys' && w.keys.map((k, i) => (
        <OutField key={i} label={(k.label || 'Key ' + (i + 1)) + ' · WIF · ' + TYPES[k.type].label} priv spec={{ title: (k.label || 'Key ' + (i + 1)) + ' · WIF', value: encodeWIF(k.priv, k.net === 'test' ? 'test' : 'main', k.compressed), file: 'key-' + (i + 1) + '-wif.txt' }} />
      ))}
    </NavShell>
  );
}

export function Settings() {
  const { settings, wallet: w } = useStore();
  const hasPassphraseCheck = w && (w.kind === 'seed' || w.kind === 'custom');
  const un = settings.unit;
  const set = (p) => patch('settings', p);
  const Link = ({ to, t, s }) => (
    <a class="cardlink" href={'#/' + to} style={{ padding: '12px 16px' }}><span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span style={{ fontSize: '15px' }}>{t}</span><span class="note">{s}</span></span><I.IChev /></a>
  );
  return (
    <NavShell max={720} gap={20}>
      <h1>Settings</h1>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Amount unit</span>
        <Seg items={[['btc', 'BTC'], ['mbtc', 'mBTC'], ['bits', 'bits'], ['sats', 'sats']]} value={un} onChange={(v) => set({ unit: v })} />
        <span class="note">{fmtAmt(1500000n, un)} · same amount, shown everywhere amounts appear</span>
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Fee warning</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div class="stepper" style={{ width: '160px' }}>
            <button aria-label="Lower limit" onClick={() => set({ feeLimit: Math.max(1, settings.feeLimit - 1) })}>−</button>
            <span>{settings.feeLimit}%</span>
            <button aria-label="Raise limit" onClick={() => set({ feeLimit: Math.min(50, settings.feeLimit + 1) })}>+</button>
          </div>
          <span class="note">Fees above this share of the amount sent must be confirmed before signing.</span>
        </div>
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Wallet</span>
        <div class="card"><Link to="check-address" t="Check an address" s="Is it in this wallet?" /></div>
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Seed tools</span>
        <div class="card">
          <Link to="wordlist" t="BIP39 word list" s="All 2048 words, decimal and binary" />
          <Link to="lastword" t="Find the last word" s="Checksum for 11 or 23 words you chose" />
          {hasPassphraseCheck && <Link to="check-passphrase" t="Check passphrase" s="Does a written passphrase open this wallet?" />}
        </div>
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Tools</span>
        <div class="card">
          <Link to="text-qr" t="Text to QR" s="Show any text as a QR code" />
          <Link to="hash" t="SHA-256 · SHA-512" s="Hash text, hex or Base64" />
          <Link to="secp256k1" t="secp256k1 calculator" s="k × P, P + Q, 2P · any point format" />
        </div>
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">About</span>
        <div class="card">
          <div class="row"><span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span>App version</span><span class="note">Single HTML file · no network, no storage</span></span><span class="mono">{APP_VERSION}</span></div>
        </div>
      </div>
    </NavShell>
  );
}

export function WordList() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(1);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = wordlist.map((w, i) => ({ w, i }));
    if (!s) return all;
    if (/^\d+$/.test(s)) { const n = parseInt(s, 10) - from; return all.filter((r) => r.i === n || String(r.i + from).startsWith(s)); }
    if (/^[01\s]{5,}$/.test(s)) { const b = s.replace(/\s/g, ''); return all.filter((r) => r.i.toString(2).padStart(11, '0').startsWith(b)); }
    return all.filter((r) => r.w.startsWith(s));
  }, [q, from]);
  const shown = rows.slice(0, 300);
  return (
    <NavShell max={720} gap={16}>
      <TitleRow back="settings" title="BIP39 word list" />
      <div class="field">
        <label for="q" class="flabel">Find by word, number or binary</label>
        <input id="q" class="input sans" type="search" spellcheck={false} autocapitalize="none" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="ab · 1024 · 10000000000" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span class="note">Numbering</span>
        {[[1, 'From 1'], [0, 'From 0']].map(([v, l]) => <button key={v} style={{ height: '32px', padding: '0 10px', background: 'transparent', font: '500 12px var(--sans)', cursor: 'pointer', border: from === v ? '1px solid #fff' : '1px solid var(--line)', color: from === v ? '#fff' : 'var(--muted)' }} aria-pressed={from === v ? 'true' : 'false'} onClick={() => setFrom(v)}>{l}</button>)}
      </div>
      <div class="card">
        <div class="wl-row" style={{ fontFamily: 'var(--sans)', fontSize: '12px', color: 'var(--muted)' }}><span>Dec</span><span>Word</span><span>Binary (11 bit)</span></div>
        {shown.map((r) => <div key={r.i} class="wl-row"><span class="muted">{r.i + from}</span><span><b>{r.w.slice(0, 4)}</b><span class="tail">{r.w.slice(4)}</span></span><span class="muted">{r.i.toString(2).padStart(11, '0').replace(/(\d{3})(\d{4})(\d{4})/, '$1 $2 $3')}</span></div>)}
        {rows.length > shown.length && <div class="wl-row note">{rows.length - shown.length} more · refine the search</div>}
        {!rows.length && <div class="wl-row note">No word matches.</div>}
      </div>
      <div class="stack">
        <span class="note">The first 4 letters (bold) are enough: no two words share them.</span>
        <span class="note">Words you pick yourself are not random. Use dice or coins to choose the numbers, and let the device find the last word.</span>
      </div>
    </NavShell>
  );
}

export function LastWord() {
  const st = useStore();
  const [len, setLen] = useState(24);
  const [words, setWords] = useState([]);
  const [pick, setPick] = useState(0);
  const kb = useKbd();
  const n = len - 1;
  const setW = (w) => { setWords(w); setPick(0); };
  const openKb = () => kb.open('seed', firstEmpty(words, n));
  const G = seedStats(words, n);
  const cands = useMemo(() => (G.complete ? lastWordCandidates(words.slice(0, n).map((x) => x.trim().toLowerCase())) : []), [G.complete, words.join(' '), n]);
  const chosen = cands[pick] ? cands[pick].word : '';
  const note = G.bad ? G.bad + (G.bad === 1 ? ' word is' : ' words are') + ' not on the BIP39 list.' : G.complete ? 'All ' + n + ' words entered. Pick the last word below.' : G.filled + ' of ' + n + ' words. Each word is checked against the BIP39 list as you type.';
  const use = () => {
    const full = words.slice(0, n).map((x) => x.trim().toLowerCase()).concat([chosen]);
    setState({ flow: { origin: 'create', len, words: full, lastWord: true } });
    setWords([]);
    go('write-seed');
  };
  return (
    <NavShell max={860} gap={16}>
      <TitleRow back="settings" title="Find the last word" />
      <Seg items={[[12, '12 words'], [24, '24 words']]} value={len} onChange={(v) => { setLen(v); setPick(0); setWords(words.slice(0, v - 1)); }} />
      <div class="field" style={{ gap: '8px' }}>
        <div class="fhead">
          <span class="flabel">Your first {n} words<PrivChip /></span>
          <span class="fbtns">
            <KbdButton what="seed words" open={kb.id === 'seed'} onClick={openKb} />
            <button class="iconbtn priv" aria-label="Enter seed words: type, paste, scan or load" title="Enter seed words: type, paste, scan or load" onClick={() => setState({ sheet: { mode: 'import', title: 'Seed words', priv: true, focusId: 'lw0', kb: openKb, onValue: (v) => { const w = wordsFromInput(v); if (w.length !== 11 && w.length !== 23) return { error: 'Read ' + w.length + ' words. Expected 11 or 23.' }; setLen(w.length + 1); setWords(w); setPick(0); } } })}><I.IImport /></button>
          </span>
        </div>
        <SeedCells words={words} len={n} onChange={setW} prefix="lw" active={kb.id === 'seed' ? kb.i : -1} onPick={(i) => { if (kb.id === 'seed') kb.setI(i); }} />
        <span class={'note' + (G.bad ? ' err' : '')}>{note}</span>
      </div>
      {G.complete && (
        <div class="stack" style={{ gap: '8px' }}>
          <div class="secthead"><span class="caps s12">Valid last words</span><span class="note">{cands.length} options</span></div>
          <div class="cand">{cands.map((c, i) => <button key={c.word} aria-pressed={pick === i ? 'true' : 'false'} class={pick === i ? 'on' : ''} onClick={() => setPick(i)}><small>{c.bits}</small><span>{c.word}</span></button>)}</div>
          <span class="note">{len === 12 ? 'With 12 words the last word carries 7 bits you choose and 4 checksum bits, so 128 words fit. Flip a coin 7 times to pick one: heads = 1, tails = 0.' : 'With 24 words the last word carries 3 bits you choose and 8 checksum bits, so 8 words fit. Flip a coin 3 times: heads = 1, tails = 0.'}</span>
        </div>
      )}
      {G.complete ? (
        <div class="btncol">
          <button class="btn-primary" onClick={use}>Use “{chosen}” and verify backup</button>
          {st.wallet && <span class="note">This starts a new wallet. When you finish, it replaces the one open in this tab.</span>}
        </div>
      ) : <button class="btn-primary" disabled>{G.bad ? 'Fix the marked words' : 'Enter ' + n + ' words first'}</button>}
      <Keyboard kb={kb} targets={{ seed: { label: 'Your first ' + n + ' words', layout: 'seed', len: n, value: words, onChange: setW, anchor: (i) => 'lw' + i } }} />
    </NavShell>
  );
}

export function CheckAddress() {
  const st = useStore();
  const w = st.wallet;
  const net = st.settings.net;
  const [addr, setAddr] = useState('');
  const [depth, setDepth] = useState(st.settings.depth || 1000);
  const [res, setRes] = useState(null);
  const [prog, setProg] = useState(null);
  const run = useRef(0);
  useEffect(() => {
    const a = addr.trim();
    setRes(null);
    if (!a) { setProg(null); return; }
    const id = ++run.current;
    setProg(0);
    const t = setTimeout(async () => {
      try {
        const r = await findAddress(w, a, { net, depth, cpath: st.addr.cpath, onProgress: (p) => id === run.current && setProg(p), isCancelled: () => id !== run.current });
        if (id !== run.current) return;
        setProg(null);
        setRes(r ? { kind: r.encoded === r.type && (w.kind === 'keys' || r.type === st.addr.type) ? 'mine' : 'type', r } : { kind: 'other' });
      } catch (e) { if (id === run.current) { setProg(null); setRes({ kind: 'error', msg: e.message }); } }
    }, 250);
    return () => clearTimeout(t);
  }, [addr, depth, net]);
  const N = depth.toLocaleString('en-US');
  const desc = (r) => (r.path ? (r.branch ? 'Change' : 'Receive') + ' #' + r.index + ' · ' + r.path : r.label);
  const X = res && {
    mine: { t: 'Yes, this address is in your wallet', c: 'var(--text)', b: '#FFFFFF', body: res.r && desc(res.r) + (res.r.path ? '. Found within the first ' + N + ' receive and change addresses.' : '.') },
    type: { t: 'Your key, different address type', c: 'var(--accent)', b: 'var(--accent)', body: res.r && (res.r.encoded !== res.r.type
      ? 'The key at ' + desc(res.r) + ' (' + TYPES[res.r.type].label + ' path) encoded as ' + TYPES[res.r.encoded].label + '. The online wallet uses a script type that doesn’t match its path. Funds are safe, but choose the same type on both.'
      : TYPES[res.r.type].label + ' · ' + desc(res.r) + '. Your Addresses screen shows ' + TYPES[st.addr.type].label + '. Funds are safe, but choose the same type on both.') },
    other: { t: 'Not found among checked addresses', c: 'var(--danger)', b: 'var(--danger)', body: w.kind === 'keys' ? 'None of this wallet’s keys makes this address.' : 'Checked accounts 0–2, the first ' + N + ' receive and ' + N + ' change addresses, all 4 types. It may be further out, but if your online wallet offers it as a new address, it likely imported a different key: don’t receive on it yet.' },
    error: { t: 'Can’t check this', c: 'var(--danger)', b: 'var(--danger)', body: res.msg },
  }[res.kind];
  return (
    <NavShell max={720} gap={18}>
      <TitleRow back="settings" title="Check an address" />
      <InField id="chk" label="Address" value={addr} onInput={setAddr} placeholder={net === 'main' ? 'bc1q…' : 'tb1q…'} spec={{ title: 'Address to check', onValue: (v) => { const s = typeof v === 'string' ? v : new TextDecoder().decode(v); setAddr(s.replace(/^bitcoin:/i, '').split('?')[0].trim()); } }} />
      {w.kind !== 'keys' && (
        <div class="stack" style={{ gap: '8px' }}>
          <span class="caps s12">Wallet search depth</span>
          <Seg items={[[100, '100'], [1000, '1,000'], [10000, '10,000']]} value={depth} onChange={(v) => { setDepth(v); patch('settings', { depth: v }); }} />
          <span class="note">An address is searched in accounts 0–2, all 4 address types, the first {N} receive and {N} change addresses{w.kind === 'xkey' && w.node ? ' of this account key' : ''}.{depth === 10000 ? ' Slower: a search can take a while.' : ''}</span>
        </div>
      )}
      {prog !== null && <div class="stack"><span class="note"><span class="spin" /> Searching… {Math.round(prog * 100)}%</span><div class="progressbar"><i style={{ width: Math.round(prog * 100) + '%' }} /></div></div>}
      {X && <div class="resultbox" style={{ borderColor: X.b }}><b style={{ color: X.c }}>{X.t}</b><span class="small">{X.body}</span></div>}
      <span class="note">Network: {NETS[net].name}. Change it on the <a href="#/addresses">Addresses</a> screen.</span>
    </NavShell>
  );
}
