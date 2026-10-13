// Settings tools: Check passphrase and Text to QR.
import { h, Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import { NavShell, TitleRow, Seg, InField, ImportBtn, I } from '../kit.jsx';
import { Keyboard, useKbd } from '../Keyboard.jsx';
import { QR } from '../sheet.jsx';
import { useFingerprint } from './create.jsx';
import { qrMatrix, qrSvgPath, qrPngBlob, download } from '../io.js';
import { textQRFrames } from '../../core/transport.js';
import { utf8 } from '../../core/util.js';

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
