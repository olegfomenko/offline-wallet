// Signing: which wallet made it → load → review (with every check explained) → sign → export.
import { h, Fragment } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { go } from '../router.js';
import { getState, setState, patch, useStore, addLog, signNetOf } from '../store.js';
import { NavShell, TitleRow, Seg, UTabs, Spacer, OutField, ExportBtn, InField, I, Card, Addr, fmtAmt, unitName, shortAddr, KV, Section } from '../kit.jsx';
import { classify, classifyPayload, psbtQRFrames, base43 } from '../../core/transport.js';
import { parsePsbt, analyzePsbt, signPsbt, psbtJSON, fmtPct, fmtRate, fmtDate } from '../../core/psbt.js';
import { base64, hex } from '../../core/util.js';
import { NETS, TYPES } from '../../core/hd.js';
import { startTxAntiExfil } from './antiexfil.jsx';

const WALLETS = [
  ['sparrow', 'Sparrow', 'Create the send, then show it as QR for an air-gapped signer. Large ones come as animated BBQr or UR, both work.', 'BBQr or UR', 'UR'],
  ['electrum', 'Electrum', 'Preview the payment and show it as QR. Electrum’s QR is one static code, so save large ones to a file instead.', 'Base43 · file', 'Base43'],
  ['bluewallet', 'BlueWallet', 'Create the send and choose to sign with another device. It shows an animated QR.', 'UR', 'UR'],
  ['nunchuk', 'Nunchuk', 'Export the transaction as QR (UR or BBQr) or as a file.', 'UR · BBQr · file', 'UR'],
  ['specter', 'Specter', 'Choose to sign with this device by QR, or save the PSBT file.', 'UR · pMofN · file', 'UR'],
  ['caravan', 'Caravan', 'Copy or save the unsigned PSBT. Caravan works with text and files.', 'Base64 · file', 'Base64'],
  ['other', 'Other or not sure', 'Scan or load whatever you have. We read every common format and tell you what we found.', 'anything', 'UR'],
];

export function SourceWallet() {
  const st = useStore();
  const { tx } = st;
  const cur = tx.source || 'sparrow';
  const W = WALLETS.find((x) => x[0] === cur);
  const net = signNetOf(st);
  return (
    <NavShell max={720} gap={14}>
      <TitleRow back="main" title="Sign a transaction" />
      <div class="stack" style={{ gap: '6px' }}>
        <span id="sw-net" style={{ fontSize: '15px', fontWeight: 600 }}>Network</span>
        <Seg items={[['main', 'Mainnet'], ['test', 'Testnet'], ['signet', 'Signet'], ['regtest', 'Regtest']]} value={net} labelledBy="sw-net" onChange={(v) => patch('settings', { signNet: v })} />
        <span class="note" style={{ color: net === 'main' ? 'var(--muted)' : 'var(--warn)' }}>{net === 'main'
          ? 'Real bitcoin. Pick the network your online wallet uses; a transaction for another network is blocked.'
          : 'Test coins with no value. Addresses and keys use the ' + (net === 'regtest' ? 'regtest (bcrt1…)' : 'testnet (tb1…)') + ' format; a mainnet transaction is blocked.'}</span>
      </div>
      <span style={{ fontSize: '17px', fontWeight: 600, marginTop: '8px' }}>Which wallet made the transaction?</span>
      <span class="small" style={{ marginTop: '-8px' }}>So we can tell you where to find it there, and send the signed result back in a form it reads.</span>
      <div class="stack" style={{ gap: '8px' }}>
        {WALLETS.map(([id, name, how, fmt]) => (
          <button class={'opt' + (cur === id ? ' on' : '')} aria-pressed={cur === id ? 'true' : 'false'} onClick={() => patch('tx', { source: id })}>
            <span class="t"><b>{name}</b><span>{fmt}</span></span>
            {cur === id && <span class="how">{how}</span>}
          </button>
        ))}
      </div>
      <span class="note">Menu names change between versions. Whatever you pick, any format still works.</span>
      <button class="btn-primary" onClick={() => { setState({ tx: { source: cur } }); go('load'); }}>{cur === 'other' ? 'Scan or load it' : 'Scan or load from ' + W[1]}</button>
    </NavShell>
  );
}

const FORMATS = [
  ['UR', 'Sparrow, BlueWallet, Nunchuk, Keystone, Jade'], ['BBQr', 'Sparrow, Nunchuk, Coldcard Q, Krux'], ['Base43', 'Electrum (single QR)'],
  ['Base64', 'Sparrow, Specter, Caravan (single QR or text)'], ['pMofN', 'Specter Desktop, Krux'], ['Hex · .psbt file', 'Bitcoin Core, Sparrow, Electrum, Nunchuk'],
];

function describeHow(how, input) {
  if (!how) return '';
  if (how === 'scan') return input && ['UR', 'BBQr', 'pMofN'].includes(input.format) ? 'Read from an animated QR' : 'Read from a QR';
  if (how === 'image') return 'Read from a QR picture';
  if (how === 'paste') return 'Pasted from the clipboard';
  if (how.startsWith('file:')) return 'Read from ' + how.slice(5);
  return '';
}

export function loadInput(v, how) {
  let r;
  try {
    if (v && typeof v === 'object' && !(v instanceof Uint8Array) && v.kind) r = classifyPayload(v);
    else r = classify(v);
  } catch (e) { r = { kind: 'unknown', raw: typeof v === 'string' ? v : '', why: e.message }; }
  const text = typeof v === 'string' ? v : r.kind === 'psbt' ? base64.encode(r.bytes) : r.raw || '';
  patch('tx', { text, input: r, how, txObj: null, analysis: null, signed: null, acks: {} });
}

export function LoadTransaction() {
  const st = useStore();
  const tx = st.tx;
  const [manual, setManual] = useState(false);
  const [err, setErr] = useState('');
  const r = tx.input;
  useEffect(() => {
    setState({ pageDrop: async (file) => { const b = new Uint8Array(await file.arrayBuffer()); loadInput(b, 'file:' + file.name); } });
    return () => setState({ pageDrop: null });
  }, []);
  let note = 'Base64, Base43, hex, UR or BBQr. Scan QR also reads animated codes.', noteCls = '';
  if (r && r.kind === 'psbt') {
    let n = '';
    try { const t = parsePsbt(r.bytes); n = 'PSBT · ' + t.inputsLength + ' input' + (t.inputsLength > 1 ? 's' : '') + ', ' + t.outputsLength + ' output' + (t.outputsLength > 1 ? 's' : '') + '. Check everything on the next screen.'; }
    catch (e) { n = 'It looks like a PSBT but can’t be read: ' + e.message; noteCls = 'err'; }
    note = [describeHow(tx.how, r), r.format, n].filter(Boolean).join(' · ');
  } else if (r && r.kind === 'partial') { note = r.format + ': ' + r.got + ' of ' + r.total + ' parts so far. Scan or paste the rest.'; }
  else if (r && r.kind !== 'empty') { note = 'This doesn’t look like a PSBT.'; noteCls = 'err'; }
  const review = () => {
    setErr('');
    try {
      const t = parsePsbt(r.bytes);
      const w = getState().wallet;
      const a = analyzePsbt(t, w, { net: signNetOf(st), feeLimitPct: st.settings.feeLimit });
      patch('tx', { txObj: t, analysis: a, acks: {}, signed: null, bytes: r.bytes, format: r.format });
      go('review');
    } catch (e) { setErr(e.message); }
  };
  const isPsbt = r && r.kind === 'psbt' && noteCls !== 'err';
  return (
    <NavShell max={760} gap={18}>
      <TitleRow back="source" title="Load transaction to sign" />
      <span class="small">Your online wallet builds the transaction and shows it as a QR, text or file. Bring it here with the import button, paste it, or drop the file on this page.</span>
      <InField id="psbt" label="Transaction (PSBT)" textarea value={tx.text || ''} onInput={(v) => { if (v.trim()) loadInput(v, ''); else patch('tx', { text: '', input: null }); }}
        placeholder="cHNidP8B… · hex · ur:crypto-psbt/… · B$…" note={note} noteCls={noteCls}
        spec={{ title: 'Transaction (PSBT)', multi: true, binary: true, accept: '.psbt,.txt,.txn,application/octet-stream,text/plain', onValue: (v, how) => loadInput(v, how) }} />
      <div class="card">
        <button class="toggleline" style={{ background: 'none', border: 'none', color: 'var(--text)', width: '100%', fontFamily: 'var(--sans)' }} aria-expanded={manual ? 'true' : 'false'} onClick={() => setManual(!manual)}><span>Accepted formats</span><span>{manual ? '−' : '+'}</span></button>
        {manual && (
          <>
            {FORMATS.map(([n, ws]) => <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '9px 14px', borderTop: '1px solid var(--line)' }}><span class="mono" style={{ fontSize: '13px', minWidth: '110px' }}>{n}</span><span class="small">{ws}</span></div>)}
            <span class="note" style={{ padding: '9px 14px', borderTop: '1px solid var(--line)' }}>The format is detected automatically. Animated codes (UR, BBQr) need every part, so scan them with the webcam rather than from a picture.</span>
          </>
        )}
      </div>
      {err && <span class="note err">{err}</span>}
      {isPsbt ? <button class="btn-primary" onClick={review}>Review transaction</button>
        : r && r.kind !== 'empty' && r.kind !== 'partial' && r.kind !== 'psbt' ? <button class="btn-secondary bold" onClick={() => go('notpsbt')}>See what was read</button>
          : <button class="btn-primary" disabled>{r && r.kind === 'partial' ? 'Waiting for the other parts' : 'Enter a transaction'}</button>}
    </NavShell>
  );
}

export function NotAPsbt() {
  const st = useStore();
  const r = st.tx.input;
  if (!r) { go('load'); return null; }
  const raw = r.raw || '';
  const title = { bip21: 'This is a payment request', address: 'This is an address', rawtx: 'This is a finished transaction', xpub: 'This is an extended public key', unknown: 'We couldn’t recognize this' }[r.kind] || 'We couldn’t recognize this';
  return (
    <NavShell max={760} gap={18}>
      <TitleRow back="load" title="What we read" />
      <OutField label={'Raw text that was read · ' + raw.length + ' chars'} value={raw} spec={{ title: 'Raw text', value: raw, file: 'qr-text.txt' }} />
      <div class="card" style={{ padding: '14px', gap: '12px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, fontSize: '16px' }}><I.IInfo />{title}</span>
        {r.kind === 'bip21' && (
          <>
            <div class="rowb" style={{ padding: 0 }}><div class="kv"><span>Format</span><span>BIP21 URI</span></div></div>
            <OutField label="Address" value={r.address} spec={{ title: 'Address', value: r.address, file: 'address.txt' }} />
            {r.amount && <div class="rowb" style={{ padding: 0 }}><div class="kv"><span>Amount</span><span class="mono">{r.amount} BTC</span></div></div>}
            <p class="small" style={{ margin: 0 }}>We were expecting a transaction to sign. This device holds no balances, so it can't build a transaction from an address.</p>
          </>
        )}
        {r.kind === 'address' && <p class="small" style={{ margin: 0 }}>An address to pay to. This device holds no balances, so it can't build a transaction from it. Check if it’s yours, or create the send in your online wallet.</p>}
        {r.kind === 'rawtx' && <p class="small" style={{ margin: 0 }}>A signed, finished transaction (not a PSBT). It’s ready to broadcast from an online wallet or node; there is nothing left to sign.</p>}
        {r.kind === 'xpub' && <p class="small" style={{ margin: 0 }}>A watch-only key, as exported to an online wallet. It can’t be signed.</p>}
        {r.kind === 'unknown' && <p class="small" style={{ margin: 0 }}>{r.why && r.why !== 'unrecognized' ? r.why + '. ' : ''}It isn’t a PSBT in any format we read (Base64, Base43, hex, UR, BBQr, pMofN, binary file).</p>}
      </div>
      <div class="stack" style={{ gap: '8px' }}>
        <div class="caps s12">How to fix</div>
        <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', lineHeight: 1.5, color: 'var(--muted)' }}>
          <li>Open your online wallet (Sparrow, BlueWallet, Nunchuk, Electrum…) and create the send{r.address ? ' to this address' : ''}.</li>
          <li>Choose to show it as a QR for an air-gapped signer, or save the PSBT file.</li>
          <li>Scan or load that here.</li>
        </ol>
      </div>
      <Spacer />
      <div class="btnrow">
        <button class="btn-primary" onClick={() => go('load')}>Load the transaction</button>
        {(r.kind === 'bip21' || r.kind === 'address') && <button class="btn-secondary bold" onClick={() => go('check-address')}>Check if this address is mine</button>}
      </div>
    </NavShell>
  );
}

function OutputRow({ o, unit, net }) {
  const kindLabel = { external: 'External', change: 'Change', mine: 'Yours · not change', unusual: 'Yours · unusual path', data: 'Data' }[o.kind];
  const sub = o.kind === 'external' ? 'Not in this wallet.' : o.kind === 'change' ? 'Verified · ' + (o.own.path || o.own.label || 'single key') : o.kind === 'mine' ? 'Receive #' + o.own.index + ' · ' + o.own.path : o.kind === 'unusual' ? 'Derived from this wallet · ' + o.own.path : null;
  return (
    <div class="outrow">
      <div class="kv"><span class="muted">#{o.n} · <b>{kindLabel}</b> · {o.scriptName}</span><span class="mono">{fmtAmt(o.amount, unit, false)}</span></div>
      {o.kind === 'data' ? (
        <>
          {o.data.text !== null && <span class="small">Text: “{o.data.text}”</span>}
          <div class="addr"><span class="muted">Hex: {o.data.hex || '(empty)'}</span><ExportBtn spec={{ title: 'Output ' + o.n + ' · OP_RETURN data (hex)', value: o.data.hex, file: 'output-' + o.n + '-data.txt' }} /></div>
        </>
      ) : (
        <div class="addr"><span><Addr a={o.address || o.script} /></span><ExportBtn spec={{ title: 'Output ' + o.n + ' · address', value: o.address || o.script, file: 'output-' + o.n + '-address.txt' }} /></div>
      )}
      {sub && <span class="note">{sub}</span>}
    </div>
  );
}

function TxSection({ a }) {
  return (
    <Section title="Transaction">
      <Card>
        <KV k="Locktime" v={a.lt.kind === 'none' ? 'None' : a.lockTime.toLocaleString('en-US')} mono sub={a.lt.kind === 'block' ? 'Block height. Can’t be mined before this block. Check the current height in your online wallet.' : a.lt.kind === 'time' ? 'Unix time · ' + fmtDate(a.lt.date) : null} />
        <KV k="Replace-by-fee" v={a.rbf ? 'On' : 'Off'} sub={a.rbf ? 'Sequence below 0xFFFFFFFE on an input. The sender can raise the fee later.' : 'Sequences are final. The fee can’t be raised later.'} />
        <KV k="Relative timelock" v={a.inputs.some((x) => x.rel) ? 'Yes' : 'None'} />
        <KV k="Tx version" v={a.version} mono />
        <KV k="PSBT version" v={a.psbtVersion} mono />
        <KV k="Network" v={NETS[a.net].name} />
      </Card>
    </Section>
  );
}

function Group({ title, items, mark, col, check, acks, onToggle }) {
  if (!items.length) return null;
  return (
    <div class="issuegrp">
      <span class="caps s12">{title}</span>
      <div class="card">{items.map((x) => (
        <label class="issue" style={{ cursor: check ? 'pointer' : 'default' }}>
          {check ? <input type="checkbox" checked={!!acks[x.id]} onChange={() => onToggle(x.id)} /> : <span class="mark" style={{ color: col }}>{mark}</span>}
          <span><b>{x.title}</b><span class="txt">{x.body}</span></span>
        </label>
      ))}</div>
    </div>
  );
}

export function Review() {
  const st = useStore();
  const { tx, settings } = st;
  const [details, setDetails] = useState(false);
  const [err, setErr] = useState('');
  const a = tx.analysis;
  if (!a) { go('load'); return null; }
  const unit = settings.unit;
  const acks = tx.acks || {};
  const allAck = a.confirm.every((c) => acks[c.id]);
  const canSign = a.canSign && allAck;
  const shown = a.sentExt > 0n ? a.sentExt : a.toSelf > 0n ? a.toSelf : a.outSum;
  const amtParts = fmtAmt(shown, unit).split(' ');
  const sign = () => {
    setErr('');
    try {
      const w = getState().wallet;
      const res = signPsbt(tx.txObj, a, w);
      const json = psbtJSON(tx.txObj, a);
      const ours = [...a.inputs.filter((x) => x.own).map((x) => x.address), ...a.outputs.filter((o) => o.own).map((o) => o.address)].filter(Boolean);
      const snapshot = { analysis: a, json, signed: res, format: tx.format, source: tx.source };
      addLog({ kind: 'psbt', txid: res.txid, main: shortAddr(res.txid, 4, 5), ours, snapshot });
      patch('tx', { signed: res, json });
      go('signed-export');
    } catch (e) { setErr('Signing failed: ' + e.message); }
  };
  const nB = a.blockers.length, nM = a.missing.length;
  const head = nB || nM
    ? 'Can’t sign yet: ' + [nB ? nB + ' blocker' + (nB > 1 ? 's' : '') : '', nM ? nM + ' missing piece' + (nM > 1 ? 's' : '') : ''].filter(Boolean).join(' and ') + '. ' + (nB ? 'Fix them in your online wallet and scan again.' : 'Export again with full input data and scan again.')
    : a.confirm.length ? 'Confirm each item below to sign.' : null;
  return (
    <NavShell max={1120} gap={12}>
      <TitleRow back="load" title="Review transaction" />
      <div class="cols2">
        <div>
          <div class="stack" style={{ gap: '2px' }}>
            <span class="amtbig">{amtParts[0]} <small>{amtParts.slice(1).join(' ')}</small></span>
            {a.sentExt === 0n && <span class="note">Nothing leaves this wallet except the fee.</span>}
            {a.fee !== null && <span class="note">plus {fmtAmt(a.fee, unit)} fee{a.feePct !== null ? ' · ' + fmtPct(a.feePct) + ' of the amount' : ''}</span>}
          </div>
          <Section title="Outputs" right={a.outputs.length + ' output' + (a.outputs.length > 1 ? 's' : '')}>
            <Card>{a.outputs.map((o) => <OutputRow o={o} unit={unit} net={a.net} />)}</Card>
          </Section>
          <Section title="Fee">
            <Card>
              <KV k="Fee" v={a.fee === null ? 'Unknown' : fmtAmt(a.fee, unit)} mono sub={a.fee === null ? 'An input amount is missing.' : Number(a.fee).toLocaleString('en-US') + ' sats' + (a.feePct !== null ? ' · ' + fmtPct(a.feePct) + ' of the amount sent' : '')} />
              <KV k="Fee rate" v={a.feeRate === null ? '?' : fmtRate(a.feeRate) + ' sat/vB'} sub={'Estimated size ' + a.vsize + ' vB after signing'} />
              <KV k="Inputs − outputs" v={(a.inSum === null ? '?' : fmtAmt(a.inSum, unit, false)) + ' − ' + fmtAmt(a.outSum, unit, false)} mono />
            </Card>
          </Section>
          {!a.clean && (
            <Section title="Inputs" right={a.inputs.length + ' input' + (a.inputs.length > 1 ? 's' : '')}>
              <Card>{a.inputs.map((x) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderTop: x.n > 1 ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}><span class="muted">Input {x.n} · outpoint</span><span class="mono">{x.amount === null ? '?' : fmtAmt(x.amount, unit, false)}</span></span>
                    <span class="mono" style={{ fontSize: '12px', wordBreak: 'break-all' }}>{x.outpoint}</span>
                    <span class="note">{[x.own ? x.own.path || x.own.label || 'this wallet' : 'not this wallet', x.amountProven ? null : 'amount only, no full previous tx', x.sighash && x.sighash > 1 ? 'SIGHASH_' + x.sighashName : null, x.rel ? (x.rel.kind === 'blocks' ? 'CSV ' + x.rel.blocks : 'CSV time') : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ExportBtn spec={{ title: 'Input ' + x.n + ' · outpoint', value: x.outpoint, file: 'input-' + x.n + '-outpoint.txt' }} />
                </div>
              ))}<KV k="Total in" v={a.inSum === null ? '?' : fmtAmt(a.inSum, unit, false)} mono /></Card>
            </Section>
          )}
          {!a.clean && <TxSection a={a} />}
          <button class="linkbtn" onClick={() => { patch('tx', { detailsFrom: 'review' }); go('psbt-details'); }}>Raw fields &amp; JSON</button>
        </div>
        <div>
          {a.clean ? (
            <>
              <Section title="Before you sign">
                <Card>{a.notes.map((n) => (
                  <div class="check"><span class="mark" style={{ color: n.mark === '✓' ? 'var(--text)' : 'var(--accent)' }}>{n.mark}</span><span>{n.text} {n.details && <button class="linkbtn" style={{ minHeight: 0, fontSize: '13px', display: 'inline' }} onClick={() => setDetails(!details)}>{details ? 'Hide details' : 'Show all checks'}</button>}</span></div>
                ))}</Card>
              </Section>
              {details && (
                <>
                  <Section title="Checks">
                    <Card>{a.checks.map((c) => <div class="check">{c.ok ? <I.ICheck style={{ flexShrink: 0, marginTop: '2px', color: '#fff' }} /> : <span class="mark" style={{ color: 'var(--accent)' }}>!</span>}<span>{c.text}</span></div>)}</Card>
                  </Section>
                  {a.info.length > 0 && <Group title="Good to know" items={a.info} mark="i" col="var(--muted)" />}
                  <TxSection a={a} />
                </>
              )}
            </>
          ) : (
            <>
              {head && <div class="blockhead" style={{ borderColor: nB || nM ? 'var(--danger)' : 'var(--warn)' }}>{head}</div>}
              <Group title="Blocks signing" items={a.blockers} mark="×" col="var(--danger)" />
              <Group title="Missing data" items={a.missing} mark="?" col="var(--warn)" />
              <Group title="Confirm you mean it" items={a.confirm} check acks={acks} onToggle={(id) => patch('tx', { acks: { ...acks, [id]: !acks[id] } })} />
              <Group title="Good to know" items={a.info} mark="i" col="var(--muted)" />
            </>
          )}
        </div>
      </div>
      {!a.clean && <span class="note">{a.canSign ? 'Tick each item above to make Sign active.' : 'Once blockers are gone, the items above are confirmed one by one before Sign becomes active.'}</span>}
      {err && <span class="note err">{err}</span>}
      <div class="btnrow">
        <button class="btn-secondary bold" onClick={() => { setState({ tx: { source: tx.source } }); go('main'); }}>Reject</button>
        {canSign && <button class="btn-secondary bold" title="The host adds its own randomness to each nonce, so this signer can’t leak your key through the signatures"
          onClick={() => { setErr(''); try { startTxAntiExfil(); } catch (e) { setErr('Anti-exfil signing isn’t possible: ' + e.message); } }}>Anti-exfil signing</button>}
        {canSign ? <button class="btn-primary" onClick={sign}>{a.clean ? 'Approve & sign' : 'Sign'}</button> : <button class="btn-primary" disabled>{a.canSign ? 'Confirm the items first' : 'Blocked'}</button>}
      </div>
    </NavShell>
  );
}

export function SignedExport() {
  const st = useStore();
  const tx = st.tx;
  const [help, setHelp] = useState(false);
  const s = tx.signed;
  const W = WALLETS.find((x) => x[0] === (tx.source || 'other'));
  const defFmt = ['UR', 'BBQr', 'Base43', 'Base64'].includes(tx.format) ? tx.format : W ? W[4] : 'UR';
  const fmt = tx.qrFormat || defFmt;
  const b64 = s ? base64.encode(s.psbt) : '';
  const qr = useMemo(() => (s ? psbtQRFrames(s.psbt, fmt) : null), [fmt, b64]);
  if (!s) { go('main'); return null; }
  const spec = { title: 'Signed PSBT', value: b64, file: 'signed.psbt', fileData: s.psbt, fileType: 'application/octet-stream', qr: { frames: qr.frames, next: qr.next },
    extra: <span class="note">QR format: {fmt}{qr.animated ? ' · animated' : ''}. Change it on the screen below the field.</span> };
  const rows = [['UR · animated', 'Sparrow, BlueWallet, Nunchuk, Keystone, Jade'], ['BBQr · animated', 'Sparrow, Nunchuk, Coldcard Q, Krux'], ['Base43 · one QR', 'Electrum'], ['Base64 · one QR', 'Sparrow, Specter, Caravan'], ['.psbt / .txn file', 'Sparrow, Electrum, Nunchuk, Bitcoin Core']];
  return (
    <NavShell max={1040} gap={18}>
      <TitleRow back="main" title="Signed" />
      <div class="okbanner"><I.ICheck size={20} /><span>{s.final ? 'Signed and complete. Move it to your online wallet to broadcast.' : 'Signature added. Move it to your online wallet; other signers still have to sign.'}</span></div>
      <div class="cols2">
        <div>
          <OutField label="Signed PSBT · Base64" spec={spec} note="Load it back into the wallet that made the PSBT."><span style={{ display: 'block', maxHeight: '160px', overflowY: 'auto' }}>{b64}</span></OutField>
          <div class="stack" style={{ gap: '6px' }}>
            <span class="note">QR format for {W ? W[1] : 'your wallet'}</span>
            <Seg items={[['UR', 'UR'], ['BBQr', 'BBQr'], ['Base64', 'Base64'], ['Base43', 'Base43']]} value={fmt} onChange={(v) => patch('tx', { qrFormat: v })} />
          </div>
          {s.final && (
            <>
              <OutField label="Final transaction · hex" spec={{ title: 'Final transaction', value: s.txHex, file: 'final-tx.txn' }} note="Fully signed. Ready to broadcast from any online wallet or node."><span style={{ display: 'block', maxHeight: '120px', overflowY: 'auto' }}>{s.txHex}</span></OutField>
              <OutField label="Transaction ID (txid)" value={s.txid} spec={{ title: 'Transaction ID', value: s.txid, file: 'txid.txt' }} />
            </>
          )}
        </div>
        <div>
          <div class="card">
            <button class="toggleline" style={{ background: 'none', border: 'none', color: 'var(--text)', width: '100%', fontFamily: 'var(--sans)' }} aria-expanded={help ? 'true' : 'false'} onClick={() => setHelp(!help)}><span>Which wallet will read it?</span><span>{help ? '−' : '+'}</span></button>
            {help && rows.map(([f, ws]) => <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '9px 14px', borderTop: '1px solid var(--line)' }}><span style={{ fontSize: '13px', minWidth: '130px' }}>{f}</span><span class="small">{ws}</span></div>)}
          </div>
        </div>
      </div>
      <div class="btnrow">
        <button class="btn-secondary bold" onClick={() => { patch('tx', { detailsFrom: 'signed-export' }); go('psbt-details'); }}>View PSBT details &amp; JSON</button>
        <button class="btn-primary" onClick={() => { setState({ tx: { source: tx.source } }); go('main'); }}>Done</button>
      </div>
    </NavShell>
  );
}

export function PsbtDetails() {
  const st = useStore();
  const tx = st.tx;
  const [tab, setTab] = useState('sum');
  const a = tx.analysis;
  if (!a) { go('signed'); return null; }
  const unit = st.settings.unit;
  const json = tx.json || (tx.txObj ? psbtJSON(tx.txObj, a) : '{}');
  const txid = (tx.signed && tx.signed.txid) || a.txid;
  const back = tx.detailsFrom || 'signed';
  const Row = ({ k, v, ex, mono }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderTop: '1px solid var(--line)' }}>
      <span style={{ display: 'flex', flexDirection: ex || mono ? 'column' : 'row', justifyContent: 'space-between', gap: '2px 10px', flex: '1 1 auto', minWidth: 0, fontSize: '14px' }}><span class="muted">{k}</span><span class={mono ? 'mono' : ''} style={{ fontSize: mono ? '12px' : '14px', wordBreak: 'break-all' }}>{v}</span></span>
      {ex && <ExportBtn spec={ex} />}
    </div>
  );
  return (
    <NavShell max={1040} gap={16}>
      <TitleRow back={back} title="PSBT details" />
      <Seg items={[['sum', 'Summary'], ['json', 'JSON']]} value={tab} onChange={setTab} />
      {a.unknownCount > 0 && <div class="infoline"><I.IInfo /><span>{a.unknownCount} unknown field{a.unknownCount > 1 ? 's' : ''} this device doesn't understand. Kept as is and shown in JSON.</span></div>}
      {tab === 'sum' ? (
        <div class="cols2">
          <div>
            <Section title="Transaction"><Card>
              <Row k="Transaction ID (txid)" v={txid} mono ex={{ title: 'Transaction ID', value: txid, file: 'txid.txt' }} />
              <Row k="Version" v={a.version} /><Row k="Locktime" v={a.lt.kind === 'none' ? '0' : a.lockTime.toLocaleString('en-US') + ' (' + (a.lt.kind === 'block' ? 'block' : 'time') + ')'} />
              <Row k="Replace-by-fee" v={a.rbf ? 'On' : 'Off'} />
            </Card></Section>
            {a.inputs.map((x) => (
              <Section title={'Input ' + x.n + ' · ' + (x.amount === null ? '?' : fmtAmt(x.amount, unit, false))}><Card>
                <Row k="Outpoint" v={x.outpoint} mono ex={{ title: 'Input ' + x.n + ' · outpoint', value: x.outpoint, file: 'input-' + x.n + '-outpoint.txt' }} />
                {x.own && x.own.path && <Row k="Path" v={x.own.path} mono />}
                {x.pubkey && <Row k="Public key" v={x.pubkey} mono ex={{ title: 'Input ' + x.n + ' · public key', value: x.pubkey, file: 'input-' + x.n + '-pubkey.txt' }} />}
                <Row k="Type" v={x.scriptName} />
                <Row k="Sighash" v={x.sighashName} />
                <Row k="Belongs to" v={x.own ? 'This wallet' : 'Not this wallet'} />
              </Card></Section>
            ))}
          </div>
          <div>
            {a.outputs.map((o) => (
              <Section title={'Output ' + o.n + ' · ' + fmtAmt(o.amount, unit, false)}><Card>
                {o.kind === 'data' ? <Row k="OP_RETURN data" v={o.data.hex} mono ex={{ title: 'Output ' + o.n + ' · data', value: o.data.hex, file: 'output-' + o.n + '-data.txt' }} />
                  : <Row k="Address" v={o.address || o.script} mono ex={{ title: 'Output ' + o.n + ' · address', value: o.address || o.script, file: 'output-' + o.n + '-address.txt' }} />}
                <Row k="Type" v={o.scriptName} />
                <Row k="Belongs to" v={{ external: 'Not this wallet', change: 'This wallet · change', mine: 'This wallet · receive', unusual: 'This wallet · unusual path', data: 'Nobody (data)' }[o.kind]} />
                {o.own && o.own.path && <Row k="Path" v={o.own.path} mono />}
              </Card></Section>
            ))}
            <Section title="Fee"><Card>
              <Row k="Fee" v={a.fee === null ? '?' : fmtAmt(a.fee, unit, false)} />
              <Row k="Inputs − outputs" v={(a.inSum === null ? '?' : fmtAmt(a.inSum, unit, false)) + ' − ' + fmtAmt(a.outSum, unit, false)} />
            </Card></Section>
          </div>
        </div>
      ) : (
        <div class="stack" style={{ gap: '8px' }}>
          <div class="fhead"><span class="flabel">PSBT as JSON</span><ExportBtn spec={{ title: 'PSBT as JSON', value: json, file: 'psbt.json', fileType: 'application/json', qr: { text: json.length < 2500 ? json : 'Too large for a QR: download the file.' } }} /></div>
          <pre class="json">{json}</pre>
        </div>
      )}
    </NavShell>
  );
}
