// Signed: PSBTs and messages signed in this tab only.
import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { go } from '../router.js';
import { setState, patch, useStore } from '../store.js';
import { NavShell, I, fmtTime } from '../kit.jsx';
import { download } from '../io.js';

function Retention({ prefsKey, keepLabel, clearLabel, onClear }) {
  const st = useStore();
  const P = st[prefsKey];
  const [open, setOpen] = useState(false);
  const set = (p) => patch(prefsKey, p);
  const clamp = (n, max) => Math.max(0, Math.min(max, isNaN(n) ? 0 : Math.floor(n)));
  const zero = P.d === 0 && P.h === 0;
  const label = !P.retOn ? 'Never' : zero ? 'Not set' : [P.d ? P.d + (P.d === 1 ? ' day' : ' days') : '', P.h ? P.h + (P.h === 1 ? ' hour' : ' hours') : ''].filter(Boolean).join(' ');
  const Q = [['1 hour', 0, 1], ['1 day', 1, 0], ['7 days', 7, 0], ['30 days', 30, 0], ['90 days', 90, 0]];
  return (
    <div class="stack">
      <span class="caps s12">{prefsKey === 'logPrefs' ? 'Log settings' : 'List settings'}</span>
      <div class="card">
        <label class="toggleline"><span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span>{keepLabel}</span><span class="note">Only in this tab. Anyone at this computer can read it</span></span><input type="checkbox" checked={P.keep} onChange={() => set({ keep: !P.keep })} /></label>
        <button class="toggleline" style={{ background: 'none', border: 'none', borderTop: '1px solid var(--line)', color: 'var(--text)', width: '100%', fontFamily: 'var(--sans)' }} aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}>
          <span>Delete entries after</span><span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>{label}<I.IChevDown style={{ transform: open ? 'rotate(180deg)' : '' }} /></span>
        </button>
        {open && (
          <div class="stack14" style={{ padding: '12px 14px', borderTop: '1px solid var(--line)' }}>
            <div class="seg" role="group" aria-label="Delete entries" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[[false, 'Never'], [true, 'After a time']].map(([on, l]) => <button aria-pressed={P.retOn === on ? 'true' : 'false'} class={P.retOn === on ? 'on' : ''} onClick={() => set({ retOn: on })}>{l}</button>)}
            </div>
            {P.retOn && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[['d', 'Days', 365], ['h', 'Hours', 23]].map(([k, l, max]) => (
                    <div class="stack" style={{ gap: '4px' }}>
                      <label for={prefsKey + k} class="note">{l}</label>
                      <div class="stepper">
                        <button aria-label={'Fewer ' + l.toLowerCase()} onClick={() => set({ [k]: clamp(P[k] - 1, max) })}>−</button>
                        <input id={prefsKey + k} type="number" inputmode="numeric" min="0" max={max} value={P[k]} onInput={(e) => set({ [k]: clamp(parseInt(e.currentTarget.value, 10), max) })} style={{ width: '100%', minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', color: 'var(--text)', font: '400 16px var(--mono)' }} />
                        <button aria-label={'More ' + l.toLowerCase()} onClick={() => set({ [k]: clamp(P[k] + 1, max) })}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div class="quick">{Q.map(([l, d, hh]) => <button class={P.d === d && P.h === hh ? 'on' : ''} aria-pressed={P.d === d && P.h === hh ? 'true' : 'false'} onClick={() => set({ d, h: hh })}>{l}</button>)}</div>
                <span class={'note' + (zero ? ' err' : '')}>{zero ? 'Set at least 1 hour.' : 'Entries older than ' + label + ' are deleted automatically, checked every minute. Uses the device clock.'}</span>
              </>
            )}
          </div>
        )}
        <button class="toggleline" style={{ background: 'none', border: 'none', borderTop: '1px solid var(--line)', color: 'var(--danger)', width: '100%', fontFamily: 'var(--sans)', justifyContent: 'flex-start' }} onClick={onClear}>{clearLabel}</button>
      </div>
    </div>
  );
}

function Downloads({ name, csv, json }) {
  const [saved, setSaved] = useState('');
  return (
    <div class="stack">
      {saved && <span role="status" class="status">Saved <span class="mono">{saved}</span> to Downloads.</span>}
      <div class="btnrow">
        <button class="btn-secondary btn-sm" onClick={() => { download(name + '.csv', csv(), 'text/csv'); setSaved(name + '.csv'); }}><I.IDownload />Download CSV</button>
        <button class="btn-secondary btn-sm" onClick={() => { download(name + '.json', json(), 'application/json'); setSaved(name + '.json'); }}><I.IDownload />Download JSON</button>
      </div>
    </div>
  );
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export function Signed() {
  const st = useStore();
  const log = st.log;
  const open = (x) => {
    if (x.kind === 'psbt') { setState({ tx: { ...x.snapshot, detailsFrom: 'signed' } }); go('psbt-details'); }
    else { setState({ addrSel: x.sel, sigPrefill: x.prefill }); go('sign-verify'); }
  };
  return (
    <NavShell max={1040} gap={16}>
      <h1>Signed</h1>
      <span class="small">Transactions and messages signed on this device, newest first. It can't see the network, so it never knows if a transaction was broadcast. Times use the device clock.</span>
      <div class="cols2">
        <div>
          <div class="stack">
            <span class="caps s12">All · {log.length}</span>
            {log.length ? (
              <div class="card">{log.map((x) => (
                <button class="listrow" onClick={() => open(x)}>
                  <div class="top"><span class={'main' + (x.kind === 'psbt' ? ' mono' : '')}>{x.main}</span><span class="typ" style={{ color: x.kind === 'psbt' ? 'var(--accent)' : 'var(--muted)' }}>{x.kind === 'psbt' ? 'PSBT' : 'Message'}</span></div>
                  <span class="date">{fmtTime(x.time)}</span>
                </button>
              ))}</div>
            ) : <div class="infoline">Nothing signed yet in this tab.</div>}
          </div>
        </div>
        <div>
          <Retention prefsKey="logPrefs" keepLabel="Keep a log" clearLabel="Clear the log" onClear={() => setState({ log: [] })} />
        </div>
      </div>
      <Downloads name="signed-log"
        csv={() => 'time,type,id,summary\n' + log.map((x) => [new Date(x.time).toISOString(), x.kind, x.txid || x.address, x.kind === 'psbt' ? x.snapshot.analysis.outputs.length + ' outputs' : x.main].map(csvCell).join(',')).join('\n') + '\n'}
        json={() => JSON.stringify(log.map((x) => ({ time: new Date(x.time).toISOString(), type: x.kind, txid: x.txid, address: x.address, message: x.kind === 'msg' ? x.prefill.msg : undefined, signature: x.kind === 'msg' ? x.prefill.sig : undefined })), null, 2)} />
    </NavShell>
  );
}
