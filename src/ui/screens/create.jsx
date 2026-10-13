// Welcome and "Create a wallet": length → randomness → write down → check → passphrase → ready.
import { h, Fragment } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { go } from '../router.js';
import { getState, setState, patch, useStore } from '../store.js';
import { FlowShell, StepRow, Seg, Switch, Spacer, OutField, ExportBtn, PrivChip, InField, I, walletLabel, useNet } from '../kit.jsx';
import { environment } from '../env.js';
import { Keyboard, useKbd } from '../Keyboard.jsx';
import { makeEntropy, countedBits, neededBits, DICE_BITS } from '../../core/entropy.js';
import { mnemonicFromEntropy, walletFromMnemonic, walletFromCustom, seedQREncode, wordlist, fingerprintWith } from '../../core/wallet.js';
import { randomInt, wipe } from '../../core/util.js';

// ---------- Welcome ----------
export function Welcome() {
  const st = useStore();
  const env = useMemo(() => environment(), []);
  const net = useNet();
  const Row = ({ k, ok, warn, v, last }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: last ? 'none' : '1px solid var(--line)', fontSize: '15px' }}>
      <span>{k}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: ok ? 'var(--accent)' : warn ? 'var(--warn)' : 'var(--danger)' }}>{ok ? <I.ICheck /> : <I.IWarn size={16} />}{v}</span>
    </div>
  );
  return (
    <FlowShell max={560} gap={28}>
      <div style={{ width: '64px', height: '64px', border: '2px solid var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.IKey size={32} /></div>
      <div class="stack" style={{ gap: '12px' }}>
        <h1>Set up this offline signer</h1>
        <p class="lead" style={{ fontSize: '16px' }}>A Bitcoin signer that runs in your browser with no network. Private keys are made and kept here. Only public keys and signatures leave, as QR codes or files.</p>
      </div>
      <div class="card">
        <div class="caps" style={{ padding: '12px 16px 4px' }}>Offline check</div>
        <Row k="Network" ok={net === 'offline'} warn={net === 'unknown'} v={{ offline: 'Offline', online: 'Online', unknown: 'Can’t tell' }[net]} />
        <Row k="Opened from" ok={env.local} v={env.origin} />
        <Row k="Extensions" ok={!env.extensions.length} v={env.extensions.length ? env.extensions.length + ' sign' + (env.extensions.length > 1 ? 's' : '') + ' found' : 'None found'} last />
      </div>
      <span class="note" style={{ marginTop: '-8px' }}>
        {net === 'unknown' ? 'This browser can’t tell whether the device is online (iPhone and iPad browsers can report a network when there is none). Turn on airplane mode and check that Wi-Fi and Bluetooth are off. ' : ''}
        {env.extensions.length ? 'Something added code or elements to this page (' + env.extensions.slice(0, 3).join(', ') + '). Use a private window with extensions off. ' : ''}
        Nothing is saved: the wallet lives only in this tab and is gone when you close it. To use another seed, open the page in a new tab. This only reads what the browser reports. It can’t prove the computer was never compromised: use a computer that never goes online, ideally booted from a clean live system, and a private window.
      </span>
      <Spacer />
      {st.wallet ? (
        <div class="btncol">
          <span class="infoline"><I.IInfo />A {walletLabel(st.wallet).toLowerCase()} is open in this tab. Open a new tab for another seed.</span>
          <button class="btn-primary" onClick={() => go('main')}>Go to wallet</button>
        </div>
      ) : (
        <div class="btncol">
          <button class="btn-primary" onClick={() => { setState({ flow: { origin: 'create', len: 24 } }); go('new'); }}>Create new wallet</button>
          <button class="btn-secondary" onClick={() => { setState({ flow: { origin: 'restore', len: 24, words: [] } }); go('restore'); }}>Restore from seed words</button>
        </div>
      )}
    </FlowShell>
  );
}

// ---------- 1 · New wallet ----------
export function NewWallet() {
  const { flow } = useStore();
  const len = flow.len || 24;
  return (
    <FlowShell max={560}>
      <StepRow back="welcome" step={1} />
      <h1>New single-sig wallet</h1>
      <p class="lead" style={{ marginTop: '-8px' }}>One seed on this device controls the wallet. Choose how many words it has.</p>
      <div class="stack" style={{ gap: '10px' }}>
        <span class="caps">Seed length</span>
        <Seg cls="h44" items={[[12, '12 words'], [24, '24 words']]} value={len} onChange={(v) => patch('flow', { len: v })} />
        <span class="note">{len === 24 ? '256 bits. The common choice for long-term storage.' : '128 bits. Also secure, and quicker to write down and check.'}</span>
      </div>
      <Spacer />
      <button class="btn-primary" onClick={() => go('randomness')}>Continue</button>
    </FlowShell>
  );
}

function finishEntropy(params) {
  const st = getState();
  const bytes = (st.flow.len || 24) === 24 ? 32 : 16;
  const ent = makeEntropy({ bytes, ...params });
  const words = mnemonicFromEntropy(ent);
  wipe(ent);
  patch('flow', { words, src: params.dice || params.coins || params.strokes ? 'user' : 'device', checkQs: null });
  go('write-seed');
}

// ---------- 2 · Your own randomness? ----------
export function Randomness() {
  const Item = ({ icon, t, s, last }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '11px 16px', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span style={{ fontSize: '15px', fontWeight: 600 }}>{t}</span><span class="small">{s}</span></div>
    </div>
  );
  return (
    <FlowShell max={600} gap={16}>
      <StepRow back="new" step={2} />
      <div class="stack" style={{ gap: '10px' }}>
        <span class="badge-opt">Optional</span>
        <h1>Add your own randomness?</h1>
        <p class="lead">The key is already safe from the browser's random generator. Anything you add can only make it harder to guess.</p>
      </div>
      <div class="card">
        <Item icon={<I.IDice />} t="Dice rolls" s="Roll a real die, click the face · 2.58 bits each" />
        <Item icon={<I.ICoin />} t="Coin flips" s="Flip a real coin, click heads or tails · 1 bit each" />
        <Item icon={<I.IDraw />} t="A drawing" s="Scribble with the mouse · mixed in, not counted" last />
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">How the key is made</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 28px minmax(0,1fr)', alignItems: 'center', gap: '6px', fontSize: '12px', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 6px', border: '1px solid var(--line2)' }}><span style={{ fontWeight: 600 }}>Your input</span><span class="muted">hashed to 32 bytes</span></div>
          <span style={{ fontSize: '20px', color: 'var(--accent)' }} aria-label="XOR">⊕</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 6px', border: '1px solid var(--line2)' }}><span style={{ fontWeight: 600 }}>Device</span><span class="muted">32 random bytes</span></div>
        </div>
        <span class="small">The key is at least as strong as the better of the two: weak input can't weaken it, good input covers for a weak generator.</span>
      </div>
      <Spacer />
      <div class="btncol">
        <button class="btn-primary" onClick={() => go('add-randomness')}>Add randomness</button>
        <button class="btn-secondary bold" onClick={() => finishEntropy({ device: true })}>Skip, create key now</button>
      </div>
    </FlowShell>
  );
}

// ---------- 3 · Add randomness ----------
export function AddRandomness() {
  const [S, set] = useState({ tab: 'dice', dice: [], coins: [], strokes: [], cur: null, adv: false, device: true });
  const up = (p) => set((s) => ({ ...s, ...p }));
  // 12 words carry 128 bits, 24 words 256: that much from dice and coins is enough on its own.
  const words = (getState().flow.len || 24) === 12 ? 12 : 24;
  const need = neededBits(words);
  const exact = countedBits(S.dice, S.coins);
  const bits = Math.floor(exact);
  const enough = bits >= need;
  const points = S.strokes.reduce((n, s) => n + s.length, 0) + (S.cur ? S.cur.length : 0);
  const anyInput = S.dice.length + S.coins.length + points > 0;
  const canCreate = S.device || enough;
  let meter, meterCol = 'var(--muted)';
  if (enough) { meter = 'Enough on its own. More is fine.'; meterCol = 'var(--accent)'; }
  else if (!S.device) { meter = 'Device randomness is off: a ' + words + '-word seed needs ' + need + ' bits. Add ' + (need - bits) + ' more (about ' + Math.ceil((need - bits) / DICE_BITS) + ' rolls).'; meterCol = 'var(--danger)'; }
  else if (anyInput) meter = 'Every bit helps. The device generator already makes the key safe.';
  else meter = need + ' bits (about ' + Math.ceil(need / DICE_BITS) + ' rolls or ' + need + ' flips) is enough on its own for ' + words + ' words.';
  const cta = !canCreate ? 'Add ' + (need - bits) + ' more bits' : !anyInput ? 'Create key with device only' : 'Create key';
  const seq = (xs, empty) => (!xs.length ? empty : (xs.length > 60 ? '… ' : '') + xs.slice(-60).join(' '));
  const padRef = useRef(null);
  const pt = (e) => {
    const r = padRef.current.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) * 350) / r.width), y: Math.round(((e.clientY - r.top) * 240) / r.height), t: performance.now() };
  };
  const path = (s) => s.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ');
  const create = () => {
    const strokes = S.strokes.concat(S.cur ? [S.cur] : []);
    finishEntropy({ device: S.device, dice: S.dice, coins: S.coins, strokes });
    set({ tab: 'dice', dice: [], coins: [], strokes: [], cur: null, adv: false, device: true });
  };
  return (
    <FlowShell max={600}>
      <StepRow back="randomness" step={3} label="Step 3 of 6 · optional" />
      <h1>Add randomness</h1>
      <div class="stack" style={{ gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span class="small">Counted from dice and coins</span>
          <span class="mono" style={{ fontSize: '18px' }}>{bits} <span class="small">/ {need} bits</span></span>
        </div>
        <div class="meter" role="progressbar" aria-label="Bits added" aria-valuemin="0" aria-valuemax={need} aria-valuenow={bits}><i style={{ width: Math.min(100, Math.round((exact / need) * 100)) + '%', background: enough ? 'var(--accent)' : 'var(--primary)' }} /></div>
        <span class="note" style={{ color: meterCol }}>{meter}</span>
        <span class="note">{[S.dice.length + ' rolls', S.coins.length + ' flips', points ? 'drawing: ' + points + ' points, not counted' : 'no drawing'].join(' · ')}</span>
      </div>
      <div class="utabs" role="tablist" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {[['dice', 'Dice' + (S.dice.length ? ' · ' + S.dice.length : '')], ['coins', 'Coins' + (S.coins.length ? ' · ' + S.coins.length : '')], ['draw', 'Drawing' + (S.strokes.length ? ' ✓' : '')]].map(([id, l]) => (
          <button key={id} role="tab" aria-selected={S.tab === id ? 'true' : 'false'} class={S.tab === id ? 'on' : ''} style={{ height: '48px', fontSize: '15px' }} onClick={() => up({ tab: id })}>{l}</button>
        ))}
      </div>
      {S.tab === 'dice' && (
        <div class="stack14">
          <span class="small">Roll a real die and click the face it shows. Don't pick numbers yourself.</span>
          <div class="dice">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} aria-label={'Die shows ' + n} onClick={() => up({ dice: S.dice.concat([n]) })}>{n}</button>)}</div>
          <div class="stack"><span class="note">Entered · {S.dice.length} rolls</span><div class="seqbox" style={{ color: S.dice.length ? 'var(--text)' : 'var(--ph)' }}>{seq(S.dice, 'No rolls yet')}</div></div>
          <div class="btnrow"><button class="btn-secondary btn-sm" onClick={() => up({ dice: S.dice.slice(0, -1) })}>Undo</button><button class="btn-secondary btn-sm" onClick={() => up({ dice: [] })}>Clear rolls</button></div>
        </div>
      )}
      {S.tab === 'coins' && (
        <div class="stack14">
          <span class="small">Flip a real coin and click the side that lands up.</span>
          <div class="coins"><button onClick={() => up({ coins: S.coins.concat(['H']) })}>Heads</button><button onClick={() => up({ coins: S.coins.concat(['T']) })}>Tails</button></div>
          <div class="stack"><span class="note">Entered · {S.coins.length} flips</span><div class="seqbox" style={{ color: S.coins.length ? 'var(--text)' : 'var(--ph)' }}>{seq(S.coins, 'No flips yet')}</div></div>
          <div class="btnrow"><button class="btn-secondary btn-sm" onClick={() => up({ coins: S.coins.slice(0, -1) })}>Undo</button><button class="btn-secondary btn-sm" onClick={() => up({ coins: [] })}>Clear flips</button></div>
        </div>
      )}
      {S.tab === 'draw' && (
        <div class="stack14">
          <span class="small">Scribble anything. The path and the timing of each point are mixed in. It isn't counted in the bits, because its randomness can't be measured.</span>
          <div class="pad" ref={padRef} aria-label="Drawing pad"
            onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* */ } up({ cur: [pt(e)] }); }}
            onPointerMove={(e) => { if (S.cur) up({ cur: S.cur.concat([pt(e)]) }); }}
            onPointerUp={() => { if (S.cur) up({ strokes: S.strokes.concat([S.cur]), cur: null }); }}
            onPointerLeave={() => { if (S.cur) up({ strokes: S.strokes.concat([S.cur]), cur: null }); }}>
            <svg viewBox="0 0 350 240" preserveAspectRatio="none"><path d={S.strokes.concat(S.cur ? [S.cur] : []).map(path).join(' ')} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" /></svg>
            {points === 0 && <div class="ph">Draw here with the mouse or a finger</div>}
          </div>
          <span class="note">Entered · {S.strokes.length} strokes · {points} points</span>
          <div class="btnrow"><button class="btn-secondary btn-sm" onClick={() => up({ strokes: S.strokes.slice(0, -1) })}>Undo stroke</button><button class="btn-secondary btn-sm" onClick={() => up({ strokes: [], cur: null })}>Clear drawing</button></div>
        </div>
      )}
      <div class="stack" style={{ gap: '10px' }}>
        <button class="linkbtn" aria-expanded={S.adv ? 'true' : 'false'} onClick={() => up({ adv: !S.adv })} style={{ gap: '8px' }}>Advanced<span>{S.adv ? '−' : '+'}</span></button>
        {S.adv && (
          <>
            <Switch on={S.device} onClick={() => up({ device: !S.device })} label="Device randomness" sub="Recommended. Mixes 32 random bytes from the browser into the key." />
            {!S.device && (
              <div class="warnline" style={{ flexDirection: 'column', gap: '6px' }}>
                <b>Your input alone makes the key</b>
                <span class="muted">Use this only if you don't trust the browser's generator. The key is the hash of your rolls and flips, so the same rolls always give the same key.</span>
                <span class="muted">Any written record of your rolls is as secret as the key itself. For a {words}-word seed you need at least {need} bits from dice and coins; the drawing still mixes in but doesn't count.</span>
              </div>
            )}
          </>
        )}
      </div>
      <div class="btncol">
        {canCreate ? <button class="btn-primary" onClick={create}>{cta}</button> : <button class="btn-primary" disabled>{cta}</button>}
        <span class="note">Nothing you enter is saved. It's discarded as soon as the key is made.</span>
      </div>
    </FlowShell>
  );
}

// ---------- seed word grid with reveal ----------
export function SeedGrid({ words, shown, onShow }) {
  return (
    <div class="blurwrap">
      <div class={'wordgrid' + (shown ? '' : ' blurred')} aria-hidden={shown ? 'false' : 'true'}>
        {words.map((w, i) => <div key={i} class="wordcell"><span class="n">{i + 1}</span><span class="w">{shown ? w : 'xxxxxx'}</span></div>)}
      </div>
      {!shown && <button class="revealbtn" onClick={onShow}><I.IEye />Click to reveal</button>}
    </div>
  );
}
export function seedExportSpec(words) {
  return {
    title: 'Seed words', priv: true, qrOnly: true, value: words.map((w, i) => i + 1 + ' ' + w).join('\n'), copyText: words.join(' '),
    qr: { text: seedQREncode(words), numeric: true }, file: 'seed-words.txt',
    extra: <span class="note">The QR is a SeedQR (SeedSigner, Krux, Jade, Coldcard Q). It encodes only the words, not a passphrase.</span>,
  };
}

// ---------- 4 · Write down ----------
export function WriteSeed() {
  const { flow } = useStore();
  const [shown, setShown] = useState(false);
  const words = flow.words;
  if (!words) { go('new'); return null; }
  const fromLast = flow.lastWord;
  return (
    <FlowShell max={760} gap={16}>
      <StepRow back={fromLast ? 'lastword' : flow.src === 'user' ? 'add-randomness' : 'randomness'} step={4} />
      <div class="stack">
        <h1>Write down your seed</h1>
        <p class="lead">On paper, in this order. Anyone with these words can spend your bitcoin. Never take a screenshot or photo.</p>
      </div>
      <div class="stack14">
        <div class="fhead"><span class="flabel">Seed words · {words.length}<PrivChip /></span><ExportBtn spec={seedExportSpec(words)} /></div>
        <SeedGrid words={words} shown={shown} onShow={() => setShown(true)} />
        {shown && <button class="linkbtn" onClick={() => setShown(false)}>Hide words</button>}
      </div>
      <button class="btn-primary" onClick={() => go('check-backup')}>I've written them down</button>
    </FlowShell>
  );
}

// ---------- 5 · Check backup ----------
function makeQuestions(words) {
  const n = words.length;
  const pos = new Set();
  while (pos.size < 3) pos.add(randomInt(n));
  return [...pos].sort((a, b) => a - b).map((p) => {
    const right = words[p];
    const opts = new Set([right]);
    // decoys: prefer words sharing the first letter, so the check isn't trivial
    const same = wordlist.filter((w) => w[0] === right[0] && w !== right && !words.includes(w));
    while (opts.size < 4) {
      const pool = opts.size < 3 && same.length > 3 ? same : wordlist;
      const w = pool[randomInt(pool.length)];
      if (!words.includes(w)) opts.add(w);
    }
    const arr = [...opts];
    for (let i = arr.length - 1; i > 0; i--) { const j = randomInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return { n: p + 1, right, opts: arr };
  });
}
export function CheckBackup() {
  const { flow } = useStore();
  const [ans, setAns] = useState({});
  const qs = useMemo(() => (flow.words ? makeQuestions(flow.words) : []), [flow.words]);
  if (!flow.words) { go('new'); return null; }
  let ok = 0, wrong = 0;
  for (const q of qs) { if (ans[q.n] === q.right) ok++; else if (ans[q.n]) wrong++; }
  const all = ok === qs.length;
  return (
    <FlowShell max={600} gap={18}>
      <StepRow back="write-seed" step={5} />
      <div class="stack">
        <h1>Check your backup</h1>
        <p class="lead">Pick the right word for each position from your paper.</p>
      </div>
      {qs.map((q) => (
        <div key={q.n} class="stack" style={{ gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 500 }}>Word #{q.n}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '8px' }}>
            {q.opts.map((w) => {
              const picked = ans[q.n] === w;
              const border = !picked ? '1px solid var(--line)' : w === q.right ? '2px solid var(--accent)' : '2px solid var(--danger)';
              return <button key={w} aria-pressed={picked ? 'true' : 'false'} style={{ height: '48px', background: 'var(--surface)', color: 'var(--text)', font: '500 15px var(--mono)', cursor: 'pointer', border }} onClick={() => setAns({ ...ans, [q.n]: w })}>{w}</button>;
            })}
          </div>
        </div>
      ))}
      <Spacer />
      {all ? <button class="btn-primary" onClick={() => go('passphrase')}>Continue</button> : <button class="btn-primary" disabled>{wrong ? 'A word is wrong. Check your paper.' : 'Select all three words'}</button>}
    </FlowShell>
  );
}

// ---------- 6 · Passphrase ----------
/**
 * Fingerprint for words + passphrase, computed shortly after typing stops (PBKDF2 takes a moment).
 * Returns null until the fingerprint for exactly the current input is ready, so a stale one is
 * never shown.
 */
export function useFingerprint(src, pass, enabled = true) {
  const [res, setRes] = useState({ k: null, fp: null });
  const k = src ? (src.custom != null ? 'c:' + src.custom : 'w:' + (src.words || []).join(' ')) + '\u0000' + pass : null;
  useEffect(() => {
    if (!enabled || !src) return undefined;
    const t = setTimeout(() => { let fp = null; try { fp = fingerprintWith(src, pass); } catch (e) { /* invalid input */ } setRes({ k, fp }); }, 120);
    return () => clearTimeout(t);
  }, [enabled, k]);
  return enabled && res.k === k ? res.fp : null;
}

export function Passphrase() {
  const { flow } = useStore();
  const [on, setOn] = useState(() => getState().flow.origin !== 'restore');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [exp, setExp] = useState('');
  const [err, setErr] = useState('');
  const kb = useKbd();
  const restore = flow.origin === 'restore';
  const src = flow.custom ? { custom: flow.custom } : flow.words ? { words: flow.words } : null;
  const waiting = on && !p1;
  const fp = useFingerprint(src, on ? p1 : '', !waiting);
  if (!src) { go('welcome'); return null; }
  const match = p1 === p2;
  // Creating asks for the passphrase twice; restoring checks it against the written fingerprint instead.
  const ready = !on || (p1.length > 0 && (restore || match));
  const back = restore ? (flow.custom ? 'custom-seed' : 'restore') : 'check-backup';
  const ex = exp.trim().toUpperCase();
  const expOk = ex.length === 8 && fp && ex === fp;
  const create = () => {
    try {
      const pass = on ? p1 : '';
      const w = flow.custom ? walletFromCustom(flow.custom, pass) : walletFromMnemonic(flow.words, pass);
      w.net = getState().settings.net;
      setState({ wallet: w, flow: { origin: flow.origin, done: true }, addr: { ...getState().addr, cpath: {} } });
      setP1(''); setP2(''); setExp('');
      go('wallet-ready');
    } catch (e) { setErr(e.message); }
  };
  return (
    <FlowShell max={600}>
      {restore ? <StepRow back={back} step={6} label="Restore · last step" /> : <StepRow back={back} step={6} />}
      <div class="stack" style={{ gap: '8px' }}>
        <h1>{restore ? 'Did this wallet use a passphrase?' : 'Add a passphrase?'}</h1>
        <p class="lead">{restore ? 'Only if one was set when the wallet was made. Enter it exactly: a different passphrase opens a different, empty wallet.' : 'Optional. It acts as a 25th word: the same seed with a different passphrase opens a different wallet.'}</p>
      </div>
      <Switch on={on} onClick={() => setOn(!on)} label={restore ? 'The wallet uses a passphrase' : 'Use a passphrase'} />
      {on && (
        <div class="stack14">
          <InField id="pp1" label="Passphrase" priv password mono={false} value={p1} onInput={setP1} placeholder="Enter passphrase"
            kb={{ what: 'the passphrase', isOpen: kb.id === 'p1', open: () => kb.open('p1') }} />
          {!restore && (
            <>
              <InField id="pp2" label="Repeat passphrase" priv password mono={false} value={p2} onInput={setP2} placeholder="Enter it again"
                kb={{ what: 'the repeated passphrase', isOpen: kb.id === 'p2', open: () => kb.open('p2') }}
                note={p2 ? (match ? 'Both entries match.' : 'The two entries don’t match.') : 'Capital letters, spaces and accents all count.'} noteCls={p2 && !match ? 'err' : ''} />
              <div class="warnline"><I.IWarn /><span>It is not part of your seed backup. If you lose it, the funds are gone. Write it down separately.</span></div>
            </>
          )}
        </div>
      )}
      <div class="fpbox">
        <div class="fprow">
          <span class="small" style={{ fontSize: '14px' }}>{on ? 'Fingerprint with this passphrase' : 'Fingerprint without a passphrase'}</span>
          <span class={'fpval' + (waiting ? ' wait' : '')}>{waiting ? '········' : fp || '········'}</span>
        </div>
        <span class="small">{waiting ? 'Enter the passphrase to see the fingerprint it gives.'
          : restore ? 'Compare it with the fingerprint you wrote down. If they differ, a word or the passphrase is wrong.'
            : 'Write it down with your backup. Typing the passphrase again later must give the same fingerprint (Settings → Check passphrase).'}</span>
        {restore && (
          <div class="fpexp">
            <label for="pp-exp" class="small">Fingerprint you wrote down (optional)</label>
            <input id="pp-exp" class="input fpin" type="text" value={exp} maxLength={8} autocomplete="off" spellcheck={false} placeholder="e.g. 73C5DA0A"
              onInput={(e) => setExp(e.currentTarget.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase())} />
            {ex.length > 0 && (
              <span role="status" class="fpverdict" style={{ color: ex.length < 8 ? 'var(--muted)' : expOk ? 'var(--accent)' : 'var(--danger)' }}>
                {ex.length < 8 ? 'Fingerprints have 8 characters.' : !fp ? 'Enter the passphrase first.' : expOk ? '✓ Matches. This is your wallet.' : '✗ Doesn’t match. Check the passphrase, then the seed words.'}
              </span>
            )}
          </div>
        )}
      </div>
      {err && <span class="note err">{err}</span>}
      <Spacer />
      {ready ? <button class="btn-primary" onClick={create}>{restore ? (on ? 'Restore with passphrase' : 'Restore without passphrase') : on ? 'Create wallet with passphrase' : 'Create wallet without passphrase'}</button>
        : <button class="btn-primary" disabled>{p1 ? 'Enter the same passphrase twice' : 'Enter a passphrase'}</button>}
      <Keyboard kb={kb} targets={on ? {
        p1: { label: 'Passphrase', layout: 'text', mask: true, value: p1, onChange: setP1, anchor: 'pp1' },
        ...(restore ? {} : { p2: { label: 'Repeat passphrase', layout: 'text', mask: true, value: p2, onChange: setP2, anchor: 'pp2' } }),
      } : {}} />
    </FlowShell>
  );
}

// ---------- Wallet created ----------
export function WalletReady() {
  const { wallet: w } = useStore();
  if (!w) { go('welcome'); return null; }
  const restored = getState().flow.origin === 'restore';
  const typeLabel = { seed: 'Single-sig · BIP39 seed', custom: 'Single-sig · custom words', xkey: 'Master private key', keys: 'Single keys' }[w.kind];
  return (
    <FlowShell max={600} gap={24}>
      <span style={{ width: '64px', height: '64px', background: 'var(--primary)', color: 'var(--on-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I.ICheck size={32} /></span>
      <div class="stack" style={{ gap: '8px' }}>
        <h1 style={{ fontSize: '30px' }}>{restored ? 'Wallet restored' : 'Wallet created'}</h1>
        <p class="lead">{w.kind === 'keys' ? 'Each key signs for its own address. Your online wallet builds the transaction, this device signs it.' : 'Share the xpub with your online watch-only wallet so it can build transactions for you to sign.'}</p>
      </div>
      {w.kind !== 'keys' && <OutField label="Fingerprint" value={w.fpKnown ? w.fp : 'Unknown'} spec={{ title: 'Fingerprint', value: w.fp, file: 'fingerprint.txt' }}
        note={w.fpKnown ? 'Note it next to your seed backup. It confirms the right seed and passphrase on restore.' : 'This key doesn’t carry its master fingerprint. Watch-only wallets may show 00000000.'} />}
      <div class="card">
        <div class="row"><span class="k">Type</span><span>{typeLabel}</span></div>
        {(w.kind === 'seed' || w.kind === 'custom') && <div class="row"><span class="k">Passphrase</span><span>{w.passphrase ? 'On' : 'Off'}</span></div>}
        {w.kind === 'seed' && <div class="row"><span class="k">Seed words</span><span>{w.words.length}</span></div>}
        {w.kind === 'keys' && <div class="row"><span class="k">Keys</span><span>{w.keys.length}</span></div>}
      </div>
      <Spacer />
      <div class="btncol">
        {w.kind !== 'keys' && <button class="btn-primary" onClick={() => go('addresses')}>Export xpub to watch-only wallet</button>}
        <button class={w.kind !== 'keys' ? 'btn-secondary' : 'btn-primary'} onClick={() => go('main')}>Go to wallet</button>
      </div>
    </FlowShell>
  );
}
