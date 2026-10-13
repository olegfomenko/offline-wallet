// The export sheet (QR · Copy · Download QR · Download file) and import sheet
// (Type · Paste · Scan QR · QR image · File). Centered dialog on desktop, bottom sheet on phones.
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { getState, setState, useStore } from './store.js';
import * as I from './icons.jsx';
import { qrMatrix, qrSvgPath, qrPngBlob, download, copyText, pasteText, pickFile, fileBytes, decodeImageFile, startCamera, stopCamera, scanLoop } from './io.js';
import { MultiPartCollector } from '../core/transport.js';
import { hex } from '../core/util.js';

const close = () => setState({ sheet: null });
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function Sheet() {
  const { sheet } = useStore();
  useEffect(() => {
    if (!sheet) return;
    const f = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [sheet]);
  if (!sheet) return null;
  return (
    <div class="scrim">
      <button class="closer" aria-label="Close" tabIndex={-1} onClick={close} />
      <div role="dialog" aria-modal="true" aria-label={sheet.title} class={'dialog' + (sheet.wide ? ' wide' : '')}>
        <span aria-hidden="true" class="handle" />
        <div class="dhead">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <span class={'kind' + (sheet.priv ? ' priv' : '')}>{(sheet.mode === 'export' ? 'Export' : 'Enter') + (sheet.priv ? ' · private' : '')}</span>
            <span class="ttl">{sheet.title}</span>
          </div>
          <button class="xbtn" aria-label="Close" onClick={close}><I.IClose /></button>
        </div>
        {sheet.mode === 'export' ? <ExportBody s={sheet} key={sheet.title + sheet.value} /> : <ImportBody s={sheet} key={sheet.title} />}
      </div>
    </div>
  );
}

// ---------- QR display ----------
export function QR({ text, frames, next, numeric, blur, label, size = 280, interval = 280, ecc }) {
  const [i, setI] = useState(0);
  const [cur, setCur] = useState(() => (next ? next() : null));
  const animated = !!next || (frames && frames.length > 1);
  useEffect(() => {
    if (!animated) return;
    const t = setInterval(() => {
      if (next) setCur(next()); else setI((x) => (x + 1) % frames.length);
    }, interval);
    return () => clearInterval(t);
  }, [animated, next, frames]);
  const value = next ? cur : frames ? frames[i % frames.length] : text;
  const m = useMemo(() => { try { return qrMatrix(value, { numeric, ecc }); } catch (e) { return null; } }, [value, numeric, ecc]);
  if (!m) return <div class="note err">Too large for one QR code. Use the file instead.</div>;
  return (
    <div class="qrwrap">
      <svg role="img" aria-label={'QR code of ' + label} viewBox={'0 0 ' + m.length + ' ' + m.length} shape-rendering="crispEdges" style={{ maxWidth: size + 'px', filter: blur ? 'blur(8px)' : 'none' }}>
        <path d={qrSvgPath(m)} fill="#000" />
      </svg>
      {animated && <span class="qrmeta">Animated · {frames ? frames.length + ' parts, ' + ((i % frames.length) + 1) + ' shown' : 'fountain-coded, scan until your wallet completes'}</span>}
    </div>
  );
}

// While a private value is hidden, draw a QR of filler of the same size so nothing real is on screen.
function decoy(qr) {
  const t = qr.text || (qr.frames && qr.frames[0]) || '';
  return qr.numeric ? '0'.repeat(t.length || 48) : 'X'.repeat(Math.max(20, t.length));
}

function ExportBody({ s }) {
  const qrOnly = s.qrOnly !== undefined ? s.qrOnly : !s.priv;
  const [tab, setTab] = useState(qrOnly ? 'qr' : 'text');
  const [shown, setShown] = useState(!s.priv);
  const [msg, setMsg] = useState('');
  const file = s.file || slug(s.title) + '.txt';
  const qrFile = file.replace(/\.[a-z0-9]+$/i, '') + '-qr.png';
  const qr = s.qr || { text: s.qrText || s.value };
  const isQr = qrOnly || tab === 'qr';
  const doCopy = async () => {
    const ok = await copyText(s.copyText || s.value, { priv: s.priv });
    setMsg(ok ? 'Copied.' + (s.priv ? ' The clipboard is cleared after 60 seconds while this tab has focus. Copy something else when you’re done to be sure.' : '') : 'The browser blocked the clipboard. Select the text and copy it yourself.');
  };
  const doQr = async () => {
    const value = qr.frames ? qr.frames[0] : qr.next ? null : qr.text;
    if (!value) { setMsg('An animated QR can’t be saved as one picture. Download the file instead.'); return; }
    if (qr.frames && qr.frames.length > 1) {
      for (let k = 0; k < qr.frames.length; k++) download(qrFile.replace('-qr.png', '-qr-' + (k + 1) + 'of' + qr.frames.length + '.png'), await qrPngBlob(qrMatrix(qr.frames[k])));
      setMsg('Downloaded ' + qr.frames.length + ' QR pictures.');
      return;
    }
    download(qrFile, await qrPngBlob(qrMatrix(value, { numeric: qr.numeric })));
    setMsg('Downloaded ' + qrFile + '.');
  };
  const doFile = () => {
    download(file, s.fileData !== undefined ? s.fileData : s.value + '\n', s.fileType || 'text/plain');
    setMsg('Downloaded ' + file + '.');
  };
  return (
    <>
      {s.priv && <span class="warnbox">Anyone who sees, scans or gets a copy of this can spend. Check that no one can see your screen.</span>}
      {!qrOnly && (
        <div role="tablist" class="seg dark" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {[['text', 'Text'], ['qr', 'QR']].map(([k, l]) => <button role="tab" aria-selected={tab === k ? 'true' : 'false'} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      )}
      {s.extra}
      <div style={{ position: 'relative' }}>
        {isQr
          ? (shown ? <QR {...qr} label={s.title} /> : <QR text={decoy(qr)} numeric={qr.numeric} blur label="hidden value" />)
          : <div class="valbox tall on-surface" style={{ minHeight: '72px', fontSize: '14px', filter: shown ? 'none' : 'blur(6px)', userSelect: shown ? 'text' : 'none' }}>{shown ? s.value : '•••••••••••••••• •••••••••••• ••••••••••••••'}</div>}
        {!shown && <button class="revealbtn" onClick={() => setShown(true)}><I.IEye />{isQr ? 'Click to show QR' : 'Click to reveal'}</button>}
      </div>
      {s.priv && shown && <button class="linkbtn" onClick={() => setShown(false)}>Hide again</button>}
      <div class="actions3">
        <button onClick={doCopy}><I.ICopy />Copy</button>
        <button onClick={doQr}><I.IQr />Download QR</button>
        <button onClick={doFile}><I.IFile />Download file</button>
      </div>
      {msg && <span role="status" class="status">{msg}</span>}
    </>
  );
}

// ---------- import ----------
function ImportBody({ s }) {
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const done = (v, how) => {
    try {
      const r = s.onValue(v, how);
      if (r && r.error) { setMsg(r.error); return; }
      close();
    } catch (e) { setMsg(e.message || String(e)); }
  };
  const O = [
    ['type', 'Type it', s.priv ? 'Type in the field. Turn off password managers and keyboard sync for this page.' : 'Type in the field', I.IKeyboard],
    ['paste', 'Paste', s.priv ? 'Other apps can read the clipboard. Prefer scanning.' : 'From the clipboard', I.IPaste],
    ['scan', 'Scan QR', 'Webcam · static or animated QR', I.ICamera],
    ['image', 'QR image', 'A picture of a QR from your computer', I.IImage],
    ['file', 'File', 'Text or binary file · or drop it on this page', I.IFile],
  ].filter((x) => !(s.only && !s.only.includes(x[0])) && !(x[0] === 'type' && s.noType));
  // Private fields with an on-screen keyboard offer it first.
  if (s.priv && s.kb) O.unshift(['kbd', 'On-screen keyboard', 'Click the keys. Nothing goes through the computer keyboard, so a keylogger can’t record it.', I.IKeyboard]);
  const pick = async (k) => {
    setMsg('');
    if (k === 'kbd') { close(); s.kb(); return; }
    if (k === 'type') {
      close();
      if (s.onType) s.onType();
      else if (s.focusId) setTimeout(() => { const el = document.getElementById(s.focusId); if (el) el.focus(); }, 30);
      return;
    }
    if (k === 'paste') {
      try { const t = await pasteText(); if (!t) { setMsg('The clipboard is empty.'); return; } done(t, 'paste'); }
      catch (e) { setMsg('The browser blocked reading the clipboard. Click in the field and press Ctrl+V (⌘V on a Mac) instead.'); }
      return;
    }
    if (k === 'scan') { setScan(true); return; }
    if (k === 'image') {
      const f = await pickFile('image/*');
      if (!f) return;
      setBusy(true);
      try { done(await decodeImageFile(f), 'image'); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
      return;
    }
    if (k === 'file') {
      const f = await pickFile(s.accept);
      if (!f) return;
      const b = await fileBytes(f);
      done(s.binary ? b : asText(b), 'file:' + f.name);
    }
  };
  useEffect(() => {
    setState({ sheetDrop: async (f) => { const b = await fileBytes(f); done(s.binary ? b : asText(b), 'file:' + f.name); } });
    return () => setState({ sheetDrop: null });
  }, []);
  return (
    <>
      {s.priv && <span class="warnbox">This is a private value. Enter it only on this offline computer.</span>}
      {scan ? <Scanner multi={s.multi} onText={(t) => done(t, 'scan')} onCancel={() => setScan(false)} /> : (
        <div class="optlist">
          {O.map(([k, l, sub, Icon]) => (
            <button onClick={() => pick(k)}>
              <span class="oi"><Icon /></span>
              <span class="ot"><b>{l}</b><small class={s.priv && k === 'paste' ? 'warn' : ''}>{sub}</small></span>
            </button>
          ))}
        </div>
      )}
      {busy && <span class="status"><span class="spin" /> Reading…</span>}
      {msg && <span role="status" class="status" style={{ color: 'var(--danger)' }}>{msg}</span>}
    </>
  );
}
function asText(b) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return 'BIN:' + hex.encode(b); }
}

function Scanner({ multi, onText, onCancel }) {
  const vref = useRef(null);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState(null);
  useEffect(() => {
    let stream, stop, dead = false;
    const col = new MultiPartCollector();
    (async () => {
      try {
        stream = await startCamera(vref.current);
        if (dead) { stopCamera(stream); return; }
        stop = scanLoop(vref.current, (t) => {
          if (multi) {
            const r = col.receive(t);
            if (r.status === 'partial') { setProg(r); return; }
            if (r.status === 'ignored') return;
            if (r.status === 'done') { finish(r.payload); return; }
          }
          finish(t);
        });
      } catch (e) {
        setErr(e && e.name === 'NotAllowedError' ? 'Webcam access was refused. Allow the camera for this page, or use QR image instead.' : (e.message || 'No webcam found.'));
      }
    })();
    const finish = (payload) => { dead = true; if (stop) stop(); stopCamera(stream); onText(payload); };
    return () => { dead = true; if (stop) stop(); stopCamera(stream); };
  }, []);
  return (
    <>
      <div class="viewfinder">
        <video ref={vref} aria-label="Webcam preview" />
        <span class="corner c1" /><span class="corner c2" /><span class="corner c3" /><span class="corner c4" />
        <span class="vlabel">{prog ? prog.kind + ' · ' + prog.got + ' of ' + prog.total + ' parts' : 'Webcam preview · static and animated QR'}</span>
      </div>
      {prog && <div class="progressbar" aria-label="Parts read"><i style={{ width: Math.round(prog.progress * 100) + '%' }} /></div>}
      {err && <span role="status" class="status" style={{ color: 'var(--danger)' }}>{err}</span>}
      <button class="linkbtn" onClick={onCancel}>Back to options</button>
    </>
  );
}
