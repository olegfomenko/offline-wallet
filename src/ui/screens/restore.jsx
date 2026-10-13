// Restore: BIP39 words, custom words, master private key, single private keys.
import { h, Fragment } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { go } from '../router.js';
import { getState, setState, patch, useStore } from '../store.js';
import { FlowShell, TitleRow, Seg, Spacer, OutField, ExportBtn, PrivChip, InField, HiddenInField, ImportBtn, I } from '../kit.jsx';
import { Keyboard, KbdButton, useKbd } from '../Keyboard.jsx';
import { firstEmpty } from '../kbd.js';
import { WORDSET, normalizeWords, isValidMnemonic, walletFromCustom, readXkey, walletFromXkey, walletFromKeys, account, addressAt, seedQRDecode, compactSeedQRDecode, customSeedText } from '../../core/wallet.js';
import { parseKeyLine, looksExtended, decryptBIP38, keyAddress, ELECTRUM_PREFIX } from '../../core/keys.js';
import { TYPES } from '../../core/hd.js';
import { hex } from '../../core/util.js';

/** Turn whatever the import sheet produced into seed words. */
export function wordsFromInput(v) {
  const s = typeof v === 'string' ? v : new TextDecoder().decode(v);
  if (s.startsWith('BIN:')) {
    const w = compactSeedQRDecode(hex.decode(s.slice(4)));
    if (w) return w;
    throw new Error('That QR holds binary data, not seed words.');
  }
  const q = seedQRDecode(s);
  if (q) return q;
  // "1 orbit\n2 canvas…" or plain words
  return normalizeWords(s.replace(/(^|\s)\d+[.):]?(?=\s)/g, ' '));
}

/** `active`: the word the on-screen keyboard is on (−1 when closed); `onPick(i)` moves it there. */
export function SeedCells({ words, len, onChange, prefix = 'sw', active = -1, onPick }) {
  const cells = [];
  for (let i = 0; i < len; i++) {
    const w = (words[i] || '').trim().toLowerCase();
    const bad = w !== '' && !WORDSET.has(w);
    cells.push(
      <label for={prefix + i} class={'wordcell' + (bad ? ' bad' : w ? ' filled' : '') + (i === active ? ' kbon' : '')} onClick={onPick ? () => onPick(i) : undefined}>
        <span class="n">{i + 1}</span>
        <input id={prefix + i} type="text" value={words[i] || ''} autocomplete="off" autocapitalize="none" spellcheck={false} aria-label={'Word ' + (i + 1)}
          onInput={(e) => {
            const val = e.currentTarget.value;
            const parts = val.trim().split(/\s+/);
            const nw = words.slice(); while (nw.length < len) nw.push('');
            if (parts.length > 1) { parts.slice(0, len - i).forEach((p, k) => { nw[i + k] = p.toLowerCase(); }); }
            else nw[i] = val.trim().toLowerCase();
            onChange(nw);
          }} />
      </label>,
    );
  }
  return <div class="wordgrid" style={{ flex: '1 1 auto', minWidth: 0 }}>{cells}</div>;
}
export function seedStats(words, len) {
  let filled = 0, bad = 0;
  for (let i = 0; i < len; i++) { const w = (words[i] || '').trim(); if (w) { filled++; if (!WORDSET.has(w)) bad++; } }
  return { filled, bad, complete: filled === len && bad === 0 };
}

export function RestoreSeed() {
  const { flow } = useStore();
  const len = flow.len || 24;
  const words = flow.words || [];
  const [err, setErr] = useState('');
  const G = seedStats(words, len);
  const setWords = (w) => { setErr(''); patch('flow', { words: w }); };
  const kb = useKbd();
  const openKb = () => kb.open('seed', firstEmpty(words, len));
  const note = err || (G.bad ? G.bad + (G.bad === 1 ? ' word is' : ' words are') + ' not on the BIP39 list.' : G.complete ? 'All ' + len + ' words entered. The checksum is verified before restoring.' : G.filled + ' of ' + len + ' words. Each word is checked against the BIP39 list as you type.');
  const restore = () => {
    const w = words.slice(0, len).map((x) => x.trim().toLowerCase());
    if (!isValidMnemonic(w)) { setErr('The words fail the BIP39 checksum: one is wrong or out of order. Check each against your paper.'); return; }
    patch('flow', { origin: 'restore', words: w, custom: null });
    go('passphrase');
  };
  return (
    <FlowShell max={820} gap={14}>
      <TitleRow back="welcome" title="Restore from seed" />
      <Seg items={[[12, '12 words'], [24, '24 words']]} value={len} onChange={(v) => patch('flow', { len: v, words: words.slice(0, v) })} />
      <div class="stack14">
        <div class="field" style={{ gap: '8px' }}>
          <div class="fhead">
            <span class="flabel">Seed words<PrivChip /></span>
            <span class="fbtns">
              <KbdButton what="seed words" open={kb.id === 'seed'} onClick={openKb} />
              <ImportBtn spec={{ title: 'Seed words', priv: true, focusId: 'sw0', kb: openKb, onValue: (v) => {
                const w = wordsFromInput(v);
                if (w.length !== 12 && w.length !== 24) return { error: 'Read ' + w.length + ' words. Expected 12 or 24.' };
                patch('flow', { len: w.length, words: w });
              } }} />
            </span>
          </div>
          <SeedCells words={words} len={len} onChange={setWords} active={kb.id === 'seed' ? kb.i : -1} onPick={(i) => { if (kb.id === 'seed') kb.setI(i); }} />
          <span class={'note' + (err || G.bad ? ' err' : '')}>{note}</span>
        </div>
        <button class="linkbtn big" onClick={() => go('custom-seed')}>Words not from the BIP39 list?</button>
        <button class="linkbtn big" style={{ marginTop: '-10px' }} onClick={() => go('restore-key')}>Restore from a private key instead</button>
      </div>
      {G.complete ? <button class="btn-primary" onClick={restore}>Restore wallet</button> : <button class="btn-primary" disabled>{G.bad ? 'Fix the marked words' : 'Enter all ' + len + ' words'}</button>}
      <Keyboard kb={kb} targets={{ seed: { label: 'Seed words', layout: 'seed', len, value: words, onChange: setWords, anchor: (i) => 'sw' + i } }} />
    </FlowShell>
  );
}

// ---------- custom words ----------
export function CustomSeed() {
  const { flow } = useStore();
  const [step, setStep] = useState(1);
  const [text, setText] = useState(flow.customDraft || '');
  const [ack, setAck] = useState(false);
  const kb = useKbd();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const notIn = words.filter((w) => !WORDSET.has(w.toLowerCase())).length;
  const exact = customSeedText(text);
  const preview = useMemo(() => {
    if (step !== 2 || !exact) return null;
    const w = walletFromCustom(exact, '');
    const A = account(w, 'wpkh', 'main', 0);
    const first = addressAt(A, 'wpkh', 'main', 0, 0).address;
    const fp = w.fp; w.root.wipePrivateData();
    return { fp, first };
  }, [step, exact]);
  return (
    <FlowShell max={640} gap={18}>
      <div class="backrow between">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button class="backbtn" aria-label="Back" onClick={() => (step === 2 ? (setStep(1), setAck(false)) : go('restore'))}><I.IBack /></button>
          <h1 class="h28">Custom seed words</h1>
        </div>
        <span class="small">Step {step} of 2</span>
      </div>
      {step === 1 && (
        <div class="stack14">
          <div class="warnline" style={{ flexDirection: 'column', gap: '8px' }}>
            <b style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><I.IWarn />At your own risk</b>
            <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <li>Nothing is checked. One typo silently opens a different, empty wallet.</li>
              <li>Words people pick themselves are easy to guess. Never use this to create a new wallet.</li>
              <li>Use it only to restore a wallet that was made this way. Electrum works the same way when its BIP39 option is on.</li>
            </ul>
            <div class="stack" style={{ gap: '4px' }}>
              <span style={{ fontWeight: 600 }}>Check the math yourself</span>
              <span class="muted">Restore a test seed, even a single word like "test", here and in Electrum with the BIP39 option on. For a test the other device doesn't have to be offline. Fingerprint and first address must match. Never send funds to that test wallet.</span>
            </div>
          </div>
          <InField id="custom" label="Custom words" priv textarea mono={false} value={text} onInput={setText} note="Any words, any number of them, any language."
            kb={{ what: 'custom seed words', isOpen: kb.id === 'custom', open: () => kb.open('custom') }} />
          {words.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <span class="tagbox" style={{ fontSize: '13px', padding: '5px 10px', background: 'var(--surface)', border: '1px solid var(--line)' }}>{words.length} word{words.length > 1 ? 's' : ''}</span>
              {notIn > 0 && <span style={{ fontSize: '13px', padding: '5px 10px', border: '1px solid var(--danger)', color: 'var(--danger)' }}>{notIn} not in BIP39 list</span>}
              <span style={{ fontSize: '13px', padding: '5px 10px', border: '1px solid var(--danger)', color: 'var(--danger)' }}>Checksum not checked</span>
            </div>
          )}
        </div>
      )}
      {step === 2 && preview && (
        <div class="stack14">
          <OutField label="Exact text used" priv spec={{ title: 'Exact text used', value: exact, file: 'custom-seed-words.txt' }} note={'Extra spaces were joined into one. Capital letters and accents are kept, so "Sol" and "sol" give different wallets.'} />
          <div class="stack14" style={{ padding: '14px', border: '1px solid var(--line)' }}>
            <span style={{ fontWeight: 600 }}>Does this match your old wallet?</span>
            <OutField label="Fingerprint" value={preview.fp} spec={{ title: 'Fingerprint', value: preview.fp, file: 'fingerprint.txt' }} />
            <OutField label="First receive address · m/84'/0'/0'/0/0" value={preview.first} spec={{ title: 'First receive address', value: preview.first, file: 'first-address.txt' }} />
            <span class="note">Shown without a passphrase. If they differ, go back and check every word, space and capital letter. A different script type or passphrase also changes them.</span>
          </div>
          <label class="toggleline" style={{ border: '1px solid var(--line)', justifyContent: 'flex-start', gap: '12px' }}>
            <input type="checkbox" checked={ack} onChange={() => setAck(!ack)} />
            <span>I understand these words are not checked and I accept the risk of losing access to funds.</span>
          </label>
        </div>
      )}
      <Spacer />
      {step === 1 ? (exact ? <button class="btn-primary" onClick={() => { kb.close(); setStep(2); }}>Check result</button> : <button class="btn-primary" disabled>Enter the words</button>) : (
        <div class="btncol">
          {ack ? <button class="btn-primary" onClick={() => { patch('flow', { origin: 'restore', custom: exact, words: null }); setText(''); go('passphrase'); }}>Restore with these words</button> : <button class="btn-primary" disabled>Confirm the risk to continue</button>}
          <button class="btn-secondary" onClick={() => { setStep(1); setAck(false); }}>Edit words</button>
        </div>
      )}
      <Keyboard kb={kb} targets={step === 1 ? { custom: { label: 'Custom seed words', layout: 'text', mask: false, value: text, onChange: setText, anchor: 'custom' } } : {}} />
    </FlowShell>
  );
}

// ---------- private key ----------
export function RestoreKey() {
  const { flow } = useStore();
  const [kind, setKind] = useState(flow.keyKind || 'master');
  const [raw, setRaw] = useState('');
  const [typing, setTyping] = useState(false);
  const kb = useKbd();
  const [err, setErr] = useState('');
  const master = kind === 'master';
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const A = master
    ? [['xprv / tprv', 'No address type inside. You pick it next.'], ['yprv · zprv', 'Nested or Native SegWit, read from the prefix.'], ['Descriptor', 'wpkh([fp/path]xprv…/<0;1>/*) or wpkh(xprv…/84h/0h/0h/<0;1>/*) — type, fingerprint and path included.']]
    : [['WIF', 'K…, L… or 5…. Address type is chosen next.'], ['p2wpkh:WIF', 'Electrum format with the type in front.'], ['Descriptor', 'wpkh(K…)#…, sh(wpkh()), pkh(), tr() — type included. combo() asks.'], ['Hex', '64 hex characters, no checksum. Network is chosen next.'], ['6P… (BIP38)', 'Password-protected key. Asks for the password.']];
  // Whatever tab it was entered on, an extended key goes to Check master key and single keys go to
  // Check private keys.
  const toMaster = (text) => {
    const info = readXkey(text);
    patch('flow', { origin: 'restore', xkey: info, keyKind: 'master' });
    setRaw('');
    go('check-master');
  };
  const toSingle = (ls) => {
    const keys = ls.map((l, i) => { try { return parseKeyLine(l); } catch (e) { throw new Error((ls.length > 1 ? 'Line ' + (i + 1) + ': ' : '') + e.message); } });
    if (!keys.length) throw new Error('Enter at least one key.');
    patch('flow', { origin: 'restore', keys, keyKind: 'single' });
    setRaw('');
    go('check-keys');
  };
  const check = () => {
    setErr('');
    try {
      const joined = lines.join('');
      if (looksExtended(joined) && (master || lines.length === 1)) toMaster(joined);
      else if (master && !looksExtended(joined) && lines.every((l) => { try { return !!parseKeyLine(l); } catch (e) { return false; } })) toSingle(lines);
      else if (master) toMaster(joined);
      else toSingle(lines);
    } catch (e) { setErr(e.message); }
  };
  return (
    <FlowShell max={640} gap={16}>
      <TitleRow back="restore" title="Restore from a private key" />
      <Seg items={[['master', 'Master key'], ['single', 'Single keys']]} value={kind} onChange={(k) => { setKind(k); setErr(''); }} />
      <span class="small">{master ? 'An extended private key, like Electrum’s “Use a master key”. All addresses are derived from it.' : 'One or more keys for individual addresses, like Electrum’s “Import private keys”. One per line.'}</span>
      <HiddenInField label={master ? 'Private key or extended key' : 'Private keys'} has={lines.length > 0} count={master ? '1 key' : lines.length + ' key' + (lines.length > 1 ? 's' : '')}
        id="rk-key" kb={{ what: 'the private key', isOpen: kb.id === 'key', open: () => kb.open('key') }}
        onValue={(v) => { setRaw(typeof v === 'string' ? v : new TextDecoder().decode(v)); setErr(''); }}
        onType={() => setTyping(true)}
        note={master ? 'Type, paste, scan or load it. It stays hidden; the next screen shows what it opens.' : 'Type, paste, scan or load them, one per line. They stay hidden; the next screen shows what they open.'} />
      {typing && (
        <div class="field">
          <span class="flabel">Type here · shown as dots</span>
          {master
            ? <input class="input" type="password" autocomplete="off" spellcheck={false} aria-label="Type the key" value={raw} onInput={(e) => setRaw(e.currentTarget.value)} autoFocus />
            : <textarea class="textarea masked" style={{ WebkitTextSecurity: 'disc' }} autocomplete="off" spellcheck={false} aria-label="Type the keys, one per line" value={raw} onInput={(e) => setRaw(e.currentTarget.value)} autoFocus />}
        </div>
      )}
      <div class="stack">
        <span class="caps s12">Accepted</span>
        <div class="card">{A.map(([n, d]) => <div key={n} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '8px 12px', borderTop: '1px solid var(--line)' }}><span class="mono" style={{ fontSize: '13px', minWidth: '110px' }}>{n}</span><span class="small">{d}</span></div>)}</div>
      </div>
      {err && <span class="note err">{err}</span>}
      <Spacer />
      {lines.length ? <button class="btn-primary" onClick={check}>Check key</button> : <button class="btn-primary" disabled>Enter a key</button>}
      <Keyboard kb={kb} targets={{ key: { label: master ? 'Master private key' : 'Private keys, one per line', layout: 'text', mask: true, multiline: !master, value: raw, onChange: (v) => { setRaw(v); setErr(''); }, anchor: 'rk-key' } }} />
    </FlowShell>
  );
}

const statusChip = (k) => {
  const st = { file: { background: '#FFFFFF', color: 'var(--surface)', border: 'none' }, key: { background: '#FFFFFF', color: 'var(--surface)', border: 'none' }, guessed: { border: '1px solid var(--accent)', color: 'var(--accent)' }, unknown: { border: '1px dashed var(--dim)', color: 'var(--muted)' } }[k];
  return <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 5px', ...st }}>{{ file: 'FROM FILE', key: 'FROM KEY', guessed: 'GUESSED', unknown: 'UNKNOWN' }[k]}</span>;
};

export function CheckMasterKey() {
  const { flow, settings } = useStore();
  const info = flow.xkey;
  const [type, setType] = useState(info && info.type ? info.type : 'wpkh');
  if (!info) { go('restore-key'); return null; }
  const w = walletFromXkey(info, type);
  const net = info.net === 'test' ? 'test' : 'main';
  const A = account(w, type, net, 0);
  const first = addressAt(A, type, net, 0, 0).address;
  const root = info.depth === 0;
  const facts = [['Format', info.format], ['Address type', info.type ? TYPES[info.type].label + ' (from ' + (info.desc ? 'descriptor' : 'prefix') + ')' : 'unknown · choose below'], ['Level', info.level]];
  if (!root) facts.push(info.desc ? ['Checksum', info.desc.checksum ? 'valid' : 'not given · fine'] : ['Parent fingerprint', info.parentFp]);
  const fpState = root ? 'key' : info.fp ? 'file' : 'unknown';
  const pathState = root ? 'key' : info.path ? 'file' : 'guessed';
  return (
    <FlowShell max={640} gap={16}>
      <TitleRow back="restore-key" title="Check master key" />
      <div class="stack14">
        <OutField label="Read from input" priv spec={{ title: 'Master key · as read', value: info.raw, file: 'master-key.txt' }} />
        <div class="card">{facts.map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 12px', fontSize: '13px', borderTop: '1px solid var(--line)' }}><span class="muted">{k}</span><span>{v}</span></div>)}</div>
        {!info.type && (
          <div class="stack" style={{ gap: '8px' }}>
            <span class="small"><b style={{ color: 'var(--text)' }}>Choose the address type.</b> {root ? 'A master key works with every type. Pick the one your old wallet used; you can switch later on the Addresses screen.' : 'A plain xprv doesn’t say which addresses it made. Pick the one whose first address matches your old wallet.'}</span>
            <Seg items={[['wpkh', 'Native SegWit'], ['shwpkh', 'Nested'], ['pkh', 'Legacy'], ['tr', 'Taproot']]} value={type} onChange={setType} />
          </div>
        )}
        <OutField label="Master fingerprint" extra={statusChip(fpState)} value={w.fpKnown ? w.fp : '00000000'} spec={{ title: 'Master fingerprint', value: w.fp, file: 'fingerprint.txt' }} />
        <div class="field">
          <div class="fhead"><span class="flabel">Account path {statusChip(pathState)}</span></div>
          <div class="valbox">{A.path}</div>
          <span class="note">{root ? 'A master key (depth 0): every standard path is derived from it, like a seed.' : info.path ? 'Fingerprint and path came with the descriptor, nothing to guess.' : 'This key can’t tell its master fingerprint or full path. The path shown is only a guess from type and depth, not proof. Signing still works: keys are matched by their last two path levels.'}</span>
        </div>
        <OutField label="First receive address" value={first} spec={{ title: 'First receive address', value: first, file: 'first-address.txt' }} note="Calculated from the key. Compare it with your old wallet." />
        <div class="warnline"><I.IWarn /><span>No seed words. This key is now your only backup: save it with the export button above before you receive funds.</span></div>
      </div>
      <button class="btn-primary" onClick={() => {
        const wallet = walletFromXkey(info, type);
        wallet.net = net;
        setState({ wallet, flow: { origin: 'restore', done: true }, addr: { ...getState().addr, type, cpath: {} }, settings: { ...settings, net } });
        go('wallet-ready');
      }}>Use this key</button>
    </FlowShell>
  );
}

export function CheckSingleKeys() {
  const { flow, settings } = useStore();
  const [keys, setKeys] = useState(() => (flow.keys || []).map((k) => ({ ...k, pick: k.type || (k.compressed === false ? 'pkh' : 'wpkh'), pw: '', busy: false, err: '' })));
  if (!flow.keys) { go('restore-key'); return null; }
  const up = (i, p) => setKeys((ks) => ks.map((k, j) => (j === i ? { ...k, ...p } : k)));
  const ready = keys.filter((k) => k.priv);
  const mixedNets = new Set(ready.map((k) => (k.net === 'test' ? 'test' : 'main'))).size > 1;
  const kb = useKbd();
  const pwTargets = {};
  keys.forEach((k, i) => {
    if (k.kind === 'bip38' && !k.priv) pwTargets['pw' + i] = { label: 'BIP38 password' + (keys.length > 1 ? ' · key ' + (i + 1) : ''), layout: 'text', mask: true, value: k.pw, onChange: (v) => up(i, { pw: v }), anchor: 'bip38pw' + i };
  });
  const decrypt = async (i) => {
    up(i, { busy: true, err: '', prog: 0 });
    try {
      const r = await decryptBIP38(keys[i].encrypted, keys[i].pw, (p) => up(i, { prog: p }));
      up(i, { priv: r.priv, compressed: r.compressed, net: 'main', busy: false, pw: '', pick: r.compressed ? 'wpkh' : 'pkh' });
    } catch (e) { up(i, { busy: false, err: e.message }); }
  };
  const kindName = (k) => ({ wif: 'WIF, ' + (k.compressed ? 'compressed' : 'uncompressed'), electrum: 'Electrum format', descriptor: 'Descriptor', hex: 'Hex, no checksum', bip38: 'BIP38, password-protected' }[k.kind]);
  const typeSource = (k) => (k.kind === 'descriptor' ? 'taken from the descriptor.' : 'taken from the ' + (ELECTRUM_PREFIX[k.type] || 'p2tr') + ': prefix.');
  return (
    <FlowShell max={680} gap={16}>
      <TitleRow back="restore-key" title="Check private keys" />
      {keys.map((k, i) => {
        const net = k.net === 'test' ? 'test' : 'main';
        // combo() covers Legacy, Nested and Native SegWit, not Taproot.
        const types = k.priv ? (!k.compressed ? ['pkh'] : k.kind === 'descriptor' ? ['wpkh', 'shwpkh', 'pkh'] : ['wpkh', 'shwpkh', 'pkh', 'tr']) : [];
        return (
          <div key={i} class="stack14" style={{ padding: '14px', border: '1px solid var(--line)' }}>
            <span style={{ fontWeight: 600 }}>Key {i + 1} · {kindName(k)}</span>
            <OutField label={k.kind === 'bip38' ? 'Encrypted private key' : 'Private key'} priv spec={{ title: 'Key ' + (i + 1), value: k.source, file: 'key-' + (i + 1) + '.txt' }} />
            {k.kind === 'bip38' && !k.priv && (
              <>
                <InField id={'bip38pw' + i} label="Password" priv password mono={false} value={k.pw} onInput={(v) => up(i, { pw: v })} placeholder="Password"
                  kb={{ what: 'the BIP38 password', isOpen: kb.id === 'pw' + i, open: () => kb.open('pw' + i) }}
                  note={k.err || (k.busy ? 'Decrypting… ' + Math.round((k.prog || 0) * 100) + '%' : 'Decrypting takes a few seconds on purpose.')} noteCls={k.err ? 'err' : ''} />
                <button class="btn-secondary btn-sm" disabled={k.busy || !k.pw} onClick={() => { kb.close(); decrypt(i); }}>{k.busy ? 'Decrypting…' : 'Decrypt'}</button>
              </>
            )}
            {k.kind === 'hex' && (
              <div class="stack" style={{ gap: '8px' }}>
                <span class="small"><b style={{ color: 'var(--text)' }}>Network.</b> A hex key doesn’t say which network it’s for.</span>
                <Seg items={[['main', 'Mainnet'], ['test', 'Testnet · Signet']]} value={net} onChange={(v) => up(i, { net: v })} />
              </div>
            )}
            {k.priv && k.type && (
              <OutField label="Address" value={keyAddress(k, k.type, net)} spec={{ title: TYPES[k.type].label + ' address', value: keyAddress(k, k.type, net), file: 'address-key-' + (i + 1) + '.txt' }} note={TYPES[k.type].label + ', ' + typeSource(k)} />
            )}
            {k.priv && !k.type && (
              <div class="stack" style={{ gap: '8px' }}>
                <span class="small"><b style={{ color: 'var(--text)' }}>Which address did it hold coins on?</b> One key gives {types.length > 1 ? types.length + ' different addresses' : 'one address'}. Pick the one your old wallet showed.</span>
                {types.map((t) => {
                  const a = keyAddress(k, t, net);
                  const on = k.pick === t;
                  return (
                    <div key={t} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button aria-pressed={on ? 'true' : 'false'} onClick={() => up(i, { pick: t })} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: on ? '7px 9px' : '8px 10px', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', border: on ? '2px solid #FFFFFF' : '1px solid var(--line)', textAlign: 'left' }}>
                        <span class={'radio' + (on ? ' on' : '')} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}><span class="mono" style={{ fontSize: '13px', wordBreak: 'break-all' }}>{a}</span><span class="note">{TYPES[t].label} · {a.slice(0, 4)}…{t === 'pkh' ? ' · what Electrum assumes without a prefix' : TYPES[t].electrum ? ' · Electrum ' + TYPES[t].electrum + ':' : ''}</span></span>
                      </button>
                      <ExportBtn spec={{ title: TYPES[t].label + ' address', value: a, file: 'address-' + t + '.txt' }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div class="infoline"><I.IInfo /><span>A wallet of single keys has no new addresses, and change goes back to one of these, which hurts privacy. Best use: move the coins to a seed-based wallet. Your online wallet builds that transaction, this device signs it.</span></div>
      {mixedNets && <span class="note err">These keys are for different networks. A wallet of single keys uses one network: restore them separately.</span>}
      {ready.length && !mixedNets ? <button class="btn-primary" onClick={() => {
        const wk = walletFromKeys(ready.map((k, i) => ({ priv: k.priv, compressed: k.compressed, type: k.type || k.pick, net: k.net || 'main', label: 'Key ' + (keys.indexOf(k) + 1) })));
        setState({ wallet: wk, flow: { origin: 'restore', done: true }, settings: { ...settings, net: wk.net } });
        go('wallet-ready');
      }}>Create wallet from {ready.length} key{ready.length > 1 ? 's' : ''}</button> : <button class="btn-primary" disabled>{mixedNets ? 'Keys from different networks' : 'Decrypt a key first'}</button>}
      <Keyboard kb={kb} targets={pwTargets} />
    </FlowShell>
  );
}
