// Settings tools: Check passphrase, Text to QR, SHA-256 · SHA-512 and the secp256k1 calculator.
import { h, Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import { NavShell, TitleRow, Seg, Chips, InField, ImportBtn, ExportBtn, I } from '../kit.jsx';
import { Keyboard, useKbd } from '../Keyboard.jsx';
import { QR } from '../sheet.jsx';
import { useFingerprint } from './create.jsx';
import { qrMatrix, qrSvgPath, qrPngBlob, download } from '../io.js';
import { textQRFrames } from '../../core/transport.js';
import { utf8, hex } from '../../core/util.js';
import { digest, decodeBytes, encodeBytes, parseNum, formatNum, modN, N, G, parsePoint, encodePoint, ecOp, yOdd } from '../../core/calc.js';

// ---------- Check passphrase ----------
export function CheckPassphrase() {
  const { wallet: w } = useStore();
  const [p1, setP1] = useState('');
  const kb = useKbd();
  const src = w.kind === 'seed' ? { words: w.words } : w.kind === 'custom' ? { custom: w.text } : null;
  const fp = useFingerprint(src, p1, !!p1);
  if (!src) {
    return (
      <NavShell max={640} gap={16}>
        <TitleRow back="settings" title="Check passphrase" />
        <p class="lead">This wallet was restored from a key, not from seed words, so it has no passphrase to check.</p>
      </NavShell>
    );
  }
  const ok = !!p1 && !!fp && fp === w.fp;
  const verdict = !p1 ? 'Enter the passphrase' : !fp ? 'Checking…' : ok ? '✓ Matches this wallet' : '✗ Different wallet';
  const col = !p1 || !fp ? 'var(--line)' : ok ? 'var(--accent)' : 'var(--danger)';
  return (
    <NavShell max={640} gap={16}>
      <TitleRow back="settings" title="Check passphrase" />
      <p class="lead">Type the passphrase from your backup. If it gives this wallet’s fingerprint, the backup is right. Nothing is saved.</p>
      <InField id="cp1" label="Passphrase" priv password mono={false} value={p1} onInput={setP1} placeholder="Enter passphrase"
        kb={{ what: 'the passphrase', isOpen: kb.id === 'p1', open: () => kb.open('p1') }} />
      <div class="fptable">
        <div><span class="small" style={{ fontSize: '14px' }}>This wallet</span><span class="fpval">{w.fp}</span></div>
        <div><span class="small" style={{ fontSize: '14px' }}>With this passphrase</span><span class={'fpval' + (!p1 || !fp ? ' wait' : ok ? ' ok' : ' bad')}>{p1 && fp ? fp : '········'}</span></div>
      </div>
      <div role="status" class="verdict" style={{ borderColor: col }}>
        <b style={{ color: !p1 || !fp ? 'var(--text)' : col }}>{verdict}</b>
        <span class="small">{!p1 ? 'Capital letters, spaces and accents all count.'
          : !fp ? ' ' : ok ? 'Your written passphrase is right. Keep it apart from the seed words.'
            : 'This passphrase opens a different wallet. Check capitals, spaces and accents, and that the backup is for this seed.'}</span>
      </div>
      <Keyboard kb={kb} targets={{ p1: { label: 'Passphrase', layout: 'text', mask: true, value: p1, onChange: setP1, anchor: 'cp1' } }} />
    </NavShell>
  );
}

// ---------- Text to QR ----------
const ECC = { L: 'low', M: 'medium', Q: 'quartile', H: 'high' };
const CAP = { L: 2953, M: 2331, Q: 1663, H: 1273 }; // bytes in one version-40 QR code

function svgOf(m) {
  const n = m.length;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + n * 8 + '" height="' + n * 8 + '" shape-rendering="crispEdges">'
    + '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + qrSvgPath(m) + '" fill="#000"/></svg>';
}

export function TextQr() {
  const [text, setText] = useState('');
  const [ec, setEc] = useState('M');
  const [mode, setMode] = useState('bbqr');
  const [msg, setMsg] = useState('');
  const [part, setPart] = useState(0);
  const bytes = useMemo(() => utf8.encode(text).length, [text]);
  const ascii = /^[\x00-\x7F]*$/.test(text);
  const ecc = ECC[ec];
  // One QR when it fits at this level; otherwise the chosen multi-part format.
  const one = useMemo(() => { if (!text) return false; try { qrMatrix(text, { ecc }); return true; } catch (e) { return false; } }, [text, ecc]);
  const multi = useMemo(() => (text && !one ? textQRFrames(text, mode) : null), [text, one, mode]);
  const parts = one ? 1 : multi ? (multi.frames ? multi.frames.length : multi.seqLen) : 0;
  const i = Math.min(part, Math.max(0, parts - 1));
  const label = one ? 'One QR · ' + bytes + ' bytes · level ' + ec
    : mode === 'split' ? parts + ' numbered QRs, ' + (i + 1) + ' of ' + parts
      : 'Animated ' + (mode === 'ur' ? 'UR' : 'BBQr') + ' · ' + parts + ' frames';
  const reset = (f) => (v) => { f(v); setMsg(''); setPart(0); };

  // Downloads: one file, or one per part (for UR, its original parts).
  const allFrames = () => (one ? [text] : multi.frames ? multi.frames : (() => { const m = textQRFrames(text, 'ur'); return Array.from({ length: m.seqLen }, () => m.next()); })());
  const save = async (kind) => {
    const fr = allFrames();
    for (let k = 0; k < fr.length; k++) {
      const m = qrMatrix(fr[k], { ecc });
      const name = 'text-qr' + (fr.length > 1 ? '-' + (k + 1) + 'of' + fr.length : '') + '.' + kind;
      if (kind === 'png') download(name, await qrPngBlob(m), 'image/png');
      else download(name, svgOf(m), 'image/svg+xml');
    }
    setMsg(fr.length > 1 ? 'Downloaded ' + fr.length + ' ' + kind.toUpperCase() + ' files.' : 'Downloaded text-qr.' + kind + '.');
  };

  return (
    <NavShell max={760} gap={12}>
      <TitleRow back="settings" title="Text to QR" />
      <p class="lead">Show any text as a QR code: a note, an address, a URL, a descriptor. Nothing is kept.</p>
      <div class="qrtool">
        <div class="stack" style={{ gap: '16px', minWidth: 0 }}>
          <div class="field">
            <div class="fhead"><span class="flabel">Text</span><span class="note">{bytes + (bytes === 1 ? ' byte' : ' bytes') + (ascii ? '' : ' · UTF-8')}</span></div>
            <div class="fbody">
              <textarea id="qt-text" class="textarea" rows={8} value={text} spellcheck={false} autocomplete="off" placeholder="Type or paste text" aria-label="Text to show as QR"
                onInput={(e) => reset(setText)(e.currentTarget.value)} />
              <ImportBtn spec={{ title: 'Text', focusId: 'qt-text', onValue: (v) => reset(setText)(typeof v === 'string' ? v : new TextDecoder().decode(v)) }} />
            </div>
            <span class="note">Not for seed words or private keys: their own screens hide them and warn the viewer.</span>
          </div>
          <div class="stack" style={{ gap: '8px' }}>
            <span id="qt-ec" class="small" style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 600 }}>Error correction</span>
            <Seg labelledBy="qt-ec" items={[['L', 'L · 7%'], ['M', 'M · 15%'], ['Q', 'Q · 25%'], ['H', 'H · 30%']]} value={ec} onChange={reset(setEc)} />
            <span class="note">Higher survives smudges and glare but holds less: up to {CAP[ec].toLocaleString('en-US')} bytes in one QR at {ec}.</span>
          </div>
          <div class="stack" style={{ gap: '8px' }}>
            <span id="qt-mode" class="small" style={{ fontSize: '14px', color: 'var(--text)', fontWeight: 600 }}>When it doesn’t fit one QR</span>
            <Seg labelledBy="qt-mode" items={[['bbqr', 'Animated BBQr'], ['ur', 'Animated UR'], ['split', 'Numbered QRs']]} value={mode} onChange={reset(setMode)} />
          </div>
        </div>
        <div class="stack" style={{ gap: '12px', minWidth: 0 }}>
          {text ? (
            <>
              {one ? <QR text={text} ecc={ecc} label="your text" size={320} />
                : mode === 'split' ? <QR text={multi.frames[i]} ecc={ecc} label={'part ' + (i + 1) + ' of ' + parts} size={320} />
                  : <QR frames={multi.frames} next={multi.next} ecc={ecc} label="your text, animated" size={320} />}
              <span class="small" style={{ textAlign: 'center' }}>{label}</span>
              {!one && mode === 'split' && (
                <div class="grid2">
                  <button class="btn-secondary btn-sm" disabled={i === 0} onClick={() => setPart(i - 1)}>Previous</button>
                  <button class="btn-secondary btn-sm" disabled={i >= parts - 1} onClick={() => setPart(i + 1)}>Next</button>
                </div>
              )}
              <div class="grid2">
                <button class="btn-secondary bold" onClick={() => save('png')}>Download QR</button>
                <button class="btn-secondary bold" onClick={() => save('svg')}>Download SVG</button>
              </div>
              {msg && <span role="status" class="note ok">{msg}</span>}
            </>
          ) : <div class="qrempty">The QR appears here</div>}
        </div>
      </div>
    </NavShell>
  );
}

// ---------- shared bits for the calculators ----------
const asText = (b) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return null; } };
function bytesIn(s, fmt) {
  if (fmt === 'text') return utf8.encode(s);
  return s.trim() === '' ? new Uint8Array(0) : decodeBytes(s, fmt);
}
function bytesOut(b, fmt) { return fmt === 'text' ? asText(b) : encodeBytes(b, fmt); }

/** An output value with its label, format chips and an export button (none until there is a value). */
function CalcOut({ label, meta, value, empty, chips, spec, note }) {
  return (
    <div class="field">
      <div class="fhead"><span class="flabel">{label} {meta && <span class="note">{meta}</span>}</span><span>{chips}</span></div>
      <div class="fbody">
        <div class="valbox" style={value ? null : { color: 'var(--dim)' }}>{value || empty}</div>
        {value && <ExportBtn spec={{ ...spec, value }} />}
      </div>
      {note && <span class="note">{note}</span>}
    </div>
  );
}

// ---------- SHA-256 · SHA-512 ----------
export function HashTool() {
  const [S, set0] = useState({ alg: 'sha256', inFmt: 'text', outFmt: 'hex', input: 'abc', err: '' });
  const set = (p) => set0((s) => ({ ...s, err: '', ...p }));
  const bytes = bytesIn(S.input, S.inFmt);
  const d = bytes ? digest(S.alg, bytes) : null;
  const name = S.alg === 'sha512' ? 'SHA-512' : 'SHA-256';
  const switchIn = (k) => {
    if (k === S.inFmt) return;
    if (!bytes) return set({ inFmt: k });
    const out = bytesOut(bytes, k);
    if (out === null) return set({ err: 'These bytes aren’t readable text. Keep them as hex or Base64.' });
    set({ inFmt: k, input: out });
  };
  // A file brings raw bytes: keep the format if it can show them, else switch to hex.
  const fromImport = (v) => {
    if (!(v instanceof Uint8Array)) return set({ input: String(v) });
    const out = bytesOut(v, S.inFmt);
    out === null ? set({ inFmt: 'hex', input: hex.encode(v) }) : set({ input: out });
  };
  const encName = { text: 'text', hex: 'hex', b64: 'Base64' }[S.inFmt];
  const out = d ? encodeBytes(d, S.outFmt) : '';
  return (
    <NavShell max={1120} gap={16}>
      <TitleRow back="settings" title="SHA-256 · SHA-512" />
      <p class="lead">Hash any text or bytes. Computed on this computer as you type.</p>
      <div class="cols2">
        <div>
          <div class="stack"><span id="h-alg" class="small">Algorithm</span><Seg items={[['sha256', 'SHA-256'], ['sha512', 'SHA-512']]} value={S.alg} labelledBy="h-alg" onChange={(v) => set({ alg: v })} /></div>
          <div class="stack"><span id="h-in" class="small">Input format</span><Seg items={[['text', 'Text'], ['hex', 'Hex'], ['b64', 'Base64']]} value={S.inFmt} labelledBy="h-in" onChange={switchIn} /></div>
          <InField id="h-input" label="Input" textarea rows={6} value={S.input} onInput={(v) => set({ input: v })}
            right={bytes && <span class="note">{bytes.length + (bytes.length === 1 ? ' byte' : ' bytes')}</span>}
            placeholder={S.inFmt === 'text' ? 'Type or paste text' : S.inFmt === 'hex' ? 'Hex bytes' : 'Base64'} bad={!bytes}
            note={S.err || (bytes ? (S.inFmt === 'text' ? 'Hashed as UTF-8 bytes, exactly as typed: spaces and line breaks count.' : 'Hashed as raw bytes.') : 'Not valid ' + encName + '.')}
            noteCls={S.err || !bytes ? 'err' : ''}
            spec={{ title: 'Input to hash', binary: true, onValue: fromImport }} />
        </div>
        <div>
          <div class="stack"><span id="h-out" class="small">Output format</span><Seg items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.outFmt} labelledBy="h-out" onChange={(v) => set({ outFmt: v })} /></div>
          <CalcOut label={name} meta={d ? d.length + ' bytes' : ''} value={out} empty="Fix the input first" spec={{ title: name, file: S.alg + '.txt' }}
            note={S.alg === 'sha512' ? 'Used by BIP32 (as HMAC) and BIP39 (as PBKDF2).' : 'Bitcoin uses it twice (SHA256d) for txids and block hashes.'} />
        </div>
      </div>
    </NavShell>
  );
}

// ---------- secp256k1 calculator ----------
const PT_FMT = { comp: 'compressed · 33 bytes', xonly: 'x-only · 32 bytes', uncomp: 'uncompressed · 65 bytes' };

function PointIn({ id, label, f, onChange }) {
  const r = f.g ? { pt: G } : f.v.trim() === '' ? { err: '' } : parsePoint(decodeBytes(f.v, f.enc));
  const reenc = (k) => { const b = f.v.trim() === '' ? null : decodeBytes(f.v, f.enc); onChange({ ...f, enc: k, v: b ? encodeBytes(b, k) : f.v }); };
  const right = (
    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Chips label={label + ' format'} items={[['hex', 'Hex'], ['b64', 'Base64']]} value={f.enc} onChange={reenc} />
      <button type="button" class={'gbtn' + (f.g ? ' on' : '')} aria-pressed={f.g ? 'true' : 'false'} title="Use the generator point G" onClick={() => onChange({ ...f, g: !f.g })}>{f.g ? 'Using G ✓' : 'Use G'}</button>
    </span>
  );
  const meta = r.pt && !f.g ? ' · ' + r.kind : '';
  if (f.g) {
    return (
      <div class="field">
        <div class="fhead"><span class="flabel">{label}</span><span>{right}</span></div>
        <div class="fbody"><div class="valbox"><b class="gmark">G</b> · {encodeBytes(encodePoint(G, 'comp'), f.enc)}</div></div>
        <span class="note">The secp256k1 generator, shown compressed.</span>
      </div>
    );
  }
  return (
    <InField id={id} label={label + meta} textarea rows={3} value={f.v} onInput={(v) => onChange({ ...f, v })} right={right} bad={!!r.err}
      placeholder={f.enc === 'hex' ? '02…, 03…, 04… or 32-byte x-only' : 'Base64 of a 33, 65 or 32-byte point'}
      note={r.err === '' ? 'Any format: compressed, uncompressed or x-only (taken with even y).' : r.err ? r.err : '✓ On the curve'} noteCls={r.err === '' ? '' : r.err ? 'err' : 'ok'}
      spec={{ title: label, onValue: (v) => onChange({ ...f, v: typeof v === 'string' ? v.trim() : new TextDecoder().decode(v).trim() }) }} />
  );
}
const pointOf = (f) => (f.g ? G : f.v.trim() === '' ? null : parsePoint(decodeBytes(f.v, f.enc)).pt || null);

export function Secp256k1Tool() {
  const [S, set0] = useState({ op: 'mul', fmt: 'comp', kEnc: 'dec', k: '', rEnc: 'hex', p: { g: false, v: '', enc: 'hex' }, q: { g: false, v: '', enc: 'hex' } });
  const set = (p) => set0((s) => ({ ...s, ...p }));
  const kv = parseNum(S.k, S.kEnc);
  const kRed = kv === null ? null : modN(kv);
  const kOk = kRed !== null && kRed !== 0n;
  const P = pointOf(S.p), Q = pointOf(S.q);
  const ready = S.op === 'mul' ? kOk && !!P : S.op === 'add' ? !!P && !!Q : !!P;
  const res = ready ? ecOp(S.op, { k: kRed, P, Q }) : null;
  const what = { mul: 'k × P', add: 'P + Q', dbl: '2P' }[S.op];
  const rv = res ? encodeBytes(encodePoint(res, S.fmt), S.rEnc) : '';
  const kNote = S.k.trim() === '' ? 'Any integer. Negative values and values ≥ n are taken mod n (−1 means n−1).'
    : kv === null ? 'Not a valid ' + { dec: 'decimal number', hex: 'hex number', b64: 'Base64 value (no sign)' }[S.kEnc] + '.'
      : !kOk ? 'Zero mod n gives no point. Use any other value.'
        : '✓ Valid scalar' + (kv < 0n || kv >= N ? ' · taken mod n' : '') + (S.kEnc === 'dec' ? ' · 0x' + kRed.toString(16) : ' · ' + (kRed.toString(10).length > 24 ? kRed.toString(10).slice(0, 24) + '…' : kRed.toString(10)));
  const kField = (
    <InField id="ec-k" label="Scalar k" textarea rows={2} value={S.k} onInput={(v) => set({ k: v })} bad={S.k.trim() !== '' && !kOk}
      right={<Chips label="Scalar k format" items={[['dec', 'Dec'], ['hex', 'Hex'], ['b64', 'Base64']]} value={S.kEnc} onChange={(k) => set({ kEnc: k, k: kv !== null ? formatNum(kv, k) : S.k })} />}
      placeholder={{ dec: 'A number, may be negative (e.g. -1)', hex: 'Hex, may start with - or 0x', b64: 'Base64, big-endian' }[S.kEnc]}
      note={kNote} noteCls={S.k.trim() === '' ? '' : kOk ? 'ok' : 'err'}
      spec={{ title: 'Scalar k', onValue: (v) => set({ k: typeof v === 'string' ? v.trim() : new TextDecoder().decode(v).trim() }) }} />
  );
  const pIn = <PointIn id="ec-p" label="Point P" f={S.p} onChange={(p) => set({ p })} />;
  const qIn = <PointIn id="ec-q" label="Point Q" f={S.q} onChange={(q) => set({ q })} />;
  return (
    <NavShell max={1120} gap={16}>
      <TitleRow back="settings" title="secp256k1 calculator" />
      <p class="lead">Point arithmetic on the Bitcoin curve: multiply a point by a scalar, add two points, or double one. Use it to check keys, nonces and tweaks by hand.</p>
      <div class="cols2">
        <div>
          <div class="stack"><span id="ec-op" class="small">Operation</span><Seg items={[['mul', 'k × P'], ['add', 'P + Q'], ['dbl', '2P']]} value={S.op} labelledBy="ec-op" onChange={(v) => set({ op: v })} /></div>
          {S.op === 'mul' ? <>{kField}{pIn}</> : S.op === 'add' ? <>{pIn}{qIn}</> : pIn}
        </div>
        <div>
          <div class="stack"><span id="ec-fmt" class="small">Result format</span><Seg items={[['comp', 'Compressed'], ['xonly', 'x-only'], ['uncomp', 'Uncompressed']]} value={S.fmt} labelledBy="ec-fmt" onChange={(v) => set({ fmt: v })} /></div>
          <CalcOut label={'Result · ' + what} meta={res ? '· ' + PT_FMT[S.fmt] : ''} value={rv} empty={ready ? 'Point at infinity (no encoding)' : 'Fill in the inputs'}
            chips={<Chips label="Result format" items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.rEnc} onChange={(v) => set({ rEnc: v })} />}
            spec={{ title: 'Result · ' + what, file: 'point.txt' }}
            note={!res ? (ready ? 'The two points cancel out, or P has y = 0.' : '') : S.fmt === 'xonly' ? 'x-only drops the y sign. Here y is ' + (yOdd(res) ? 'odd, so BIP340 reads it as the negated point.' : 'even.') : 'y is ' + (yOdd(res) ? 'odd.' : 'even.')} />
        </div>
      </div>
    </NavShell>
  );
}
