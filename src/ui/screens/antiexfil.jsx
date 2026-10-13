// Anti-exfil signing, for messages (from Sign or verify) and transactions (from Review).
// Host commitment → signer nonce R → host data → final nonce → sign. See core/antiexfil.js.
//
// Keys: a message is signed with the key of the selected address, re-derived from the wallet when
// needed and never stored. A transaction keeps its prepared copy (with fresh key copies) in the
// store while the flow runs, and wipes them when the screen is left in any way.
import { h, Fragment } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { go } from '../router.js';
import { getState, setState, patch, useStore, addLog } from '../store.js';
import { NavShell, TitleRow, Seg, OutField, InField, fmtAmt, shortAddr } from '../kit.jsx';
import { resolveSel } from '../account.js';
import { textToBytes, bytesToText } from '../../core/encoding.js';
import { messageSignerNonce, signMessageAntiExfil } from '../../core/message.js';
import { prepareAntiExfil, wipeAntiExfil, antiExfilNonces, signPsbtAntiExfil, psbtJSON } from '../../core/psbt.js';
import { finalNonce, dataMatches } from '../../core/antiexfil.js';
import { hex, base64 } from '../../core/util.js';

const STEPS = {
  1: ['Host commitment', 'The host (your online wallet or a second device) picks random data and gives you only its SHA-256. You enter that hash here before seeing anything from this signer.'],
  2: ['Signer nonce R', 'This signer’s nonce, fixed before it learns the host data. Give R to the host now and save it: the host checks the final nonce against it.'],
  3: ['Host data', 'Now the host reveals the data it committed to. It is checked against the hash from step 1.'],
  4: ['Final nonce', 'Your data is mixed into the nonce, so this signer can’t pick a nonce that leaks your key. The signature will use this nonce.'],
};
const ALG_NAME = { ecdsa: 'ECDSA', schnorr: 'Schnorr (BIP340)' };

/** Open anti-exfil signing for a message. `m` = { alg, type, bytes, mfmt, msg, label, address, xpk, sel }. */
export function startMessageAntiExfil(m) {
  setState({ ae: { kind: 'msg', ...m } });
  go('anti-exfil-msg');
}

/** Open anti-exfil signing for the reviewed transaction. Throws if it can't be signed. */
export function startTxAntiExfil() {
  const { tx, wallet } = getState();
  const prep = prepareAntiExfil(tx.txObj, tx.analysis, wallet);
  setState({ ae: { kind: 'tx', prep } });
  go('anti-exfil');
}

function leave(to) {
  wipeAntiExfil(getState().ae && getState().ae.prep);
  setState({ ae: null });
  go(to);
}

const comBytes = (s, fmt) => {
  const t = String(s || '').replace(/\s+/g, '');
  if (!t) return null;
  const b = textToBytes(t, fmt);
  return b && b.length === 32 ? b : null;
};

export function AntiExfil() {
  const st = useStore();
  const ae = st.ae;
  const [S, set0] = useState({ step: 1, comFmt: 'hex', dataFmt: 'text', com: [], data: [], err: '' });
  const set = (p) => set0((s) => ({ ...s, ...p }));
  // Leaving this screen in any way (menu, back, reload) forgets the prepared keys.
  useEffect(() => () => {
    const a = getState().ae;
    if (a) { wipeAntiExfil(a.prep); setState({ ae: null }); }
  }, []);
  if (!ae) { go(st.tx && st.tx.analysis ? 'review' : 'main'); return null; }
  const isTx = ae.kind === 'tx';
  const back = isTx ? 'review' : 'sign-verify';
  const unit = st.settings.unit;
  const step = S.step;
  // The message key, re-derived from the wallet each time it is needed.
  const msgPriv = () => resolveSel(st.wallet, ae.sel, st.settings.net).priv;

  // One nonce per input of this wallet; a message has one.
  const items = isTx
    ? ae.prep.items.map((it) => ({ label: 'Input #' + it.n, sub: [shortAddr(it.address, 8, 6), it.amount === null ? null : fmtAmt(it.amount, unit)].filter(Boolean).join(' · '), alg: it.alg, n: it.n }))
    : [{ label: STEPS[step][0], sub: '', alg: ae.alg, n: 1 }];
  const N = items.length;
  const algs = [...new Set(items.map((x) => x.alg))];
  const pad = (a) => { const o = (a || []).slice(); while (o.length < N) o.push(''); return o; };
  const com = pad(S.com), data = pad(S.data);
  const comB = com.map((c) => comBytes(c, S.comFmt));
  const dataB = data.map((d) => (d === '' ? null : textToBytes(d, S.dataFmt)));
  const match = dataB.map((d, i) => dataMatches(d, comB[i]));
  const ok1 = comB.every(Boolean), ok3 = match.every(Boolean);

  // R depends only on the key, the message and the commitment: compute it on demand.
  let R = [];
  let rErr = '';
  if (step >= 2 && ok1) {
    try {
      R = isTx ? antiExfilNonces(ae.prep, comB) : [messageSignerNonce(ae.alg, msgPriv(), ae.bytes, comB[0])];
    } catch (e) { rErr = e.message; }
  }
  const fin = step === 4 && ok3 && R.length ? R.map((r, i) => finalNonce(r, dataB[i])) : [];

  const setCom = (i, v) => { const n = com.slice(); n[i] = v; set({ com: n, err: '' }); };
  const setData = (i, v) => { const n = data.slice(); n[i] = v; set({ data: n, err: '' }); };
  // A file or QR may bring raw bytes: a 32-byte commitment, or binary host data.
  const comFromImport = (i, v) => {
    if (v instanceof Uint8Array) {
      if (v.length === 32) return setCom(i, bytesToText(v, S.comFmt));
      v = new TextDecoder().decode(v);
    }
    setCom(i, String(v).trim());
  };
  const dataFromImport = (i, v) => {
    if (!(v instanceof Uint8Array)) return setData(i, String(v));
    const asFmt = bytesToText(v, S.dataFmt);
    if (asFmt !== null) return setData(i, asFmt);
    const n = data.map((d, j) => (j === i ? hex.encode(v) : dataB[j] ? hex.encode(dataB[j]) : d));
    set({ dataFmt: 'hex', data: n, err: '' });
  };
  const switchCom = (k) => set({ comFmt: k, com: com.map((c, i) => (comB[i] ? bytesToText(comB[i], k) : c)) });
  const switchData = (k) => {
    if (k === S.dataFmt) return;
    const out = data.map((d, i) => (dataB[i] ? bytesToText(dataB[i], k) : d));
    if (out.some((x, i) => dataB[i] && x === null)) return set({ err: 'This data isn’t readable text. Keep it as hex or Base64.' });
    set({ dataFmt: k, data: out, err: '' });
  };

  const sign = () => {
    set({ err: '' });
    try {
      if (isTx) {
        const { tx } = getState();
        const a = tx.analysis;
        const res = signPsbtAntiExfil(ae.prep, comB, dataB);
        const json = psbtJSON(tx.txObj, a);
        const ours = [...a.inputs.filter((x) => x.own).map((x) => x.address), ...a.outputs.filter((o) => o.own).map((o) => o.address)].filter(Boolean);
        addLog({ kind: 'psbt', txid: res.txid, main: shortAddr(res.txid, 4, 5), ours, ae: true, snapshot: { analysis: a, json, signed: res, format: tx.format, source: tx.source } });
        patch('tx', { signed: res, json });
        leave('signed-export');
      } else {
        const r = signMessageAntiExfil(ae.alg, msgPriv(), ae.bytes, ae.type, comB[0], dataB[0]);
        addLog({ kind: 'msg', main: ae.mfmt === 'text' ? ae.msg.slice(0, 120) : ae.mfmt + ' message · ' + ae.bytes.length + ' bytes', address: ae.address, alg: ae.alg, ae: true,
          prefill: { alg: ae.alg, mfmt: ae.mfmt, msg: ae.msg, vfmt: 'b64', sig: base64.encode(r.sig), who: ae.alg === 'ecdsa' ? ae.address : ae.xpk }, sel: ae.sel });
        setState({ sigDone: { alg: ae.alg, mfmt: ae.mfmt, msg: ae.msg, sig: r.sig, ae: true } });
        leave('sign-verify');
      }
    } catch (e) {
      set({ err: 'Signing failed: ' + e.message + ' Retry with the same data. Don’t start over with new data.' });
    }
  };

  const shown = isTx ? (() => { const a = st.tx.analysis; return a.sentExt > 0n ? a.sentExt : a.toSelf > 0n ? a.toSelf : a.outSum; })() : null;
  const what = isTx
    ? 'Transaction · ' + st.tx.analysis.inputs.length + ' input' + (st.tx.analysis.inputs.length > 1 ? 's' : '') + ' · ' + fmtAmt(shown, unit)
    : 'Message · ' + ae.label;
  const next = { 1: ok1, 2: !rErr && R.length === N, 3: ok3, 4: fin.length === N }[step];
  const plural = N > 1;

  const field = (it, i) => {
    if (step === 1) {
      const v = com[i], ok = !!comB[i];
      return (
        <InField id={'ae-c' + i} label={it.label} right={it.sub && <span class="mono muted" style={{ fontSize: '12px' }}>{it.sub}</span>} textarea rows={2} value={v} onInput={(x) => setCom(i, x)}
          placeholder={S.comFmt === 'hex' ? '64 hex characters' : '44 Base64 characters'} bad={!!v && !ok}
          note={!v ? 'SHA-256 of the host’s random data: 32 bytes.' : ok ? '✓ 32-byte SHA-256' : 'Not a 32-byte value in ' + (S.comFmt === 'hex' ? 'hex' : 'Base64') + '.'}
          noteCls={!v ? '' : ok ? 'ok' : 'err'}
          spec={{ title: 'Host commitment · ' + it.label, binary: true, onValue: (x) => comFromImport(i, x) }} />
      );
    }
    if (step === 2) {
      const r = R[i] ? hex.encode(R[i]) : '';
      return <OutField label={it.label} right={it.sub && <span class="mono muted" style={{ fontSize: '12px' }}>{it.sub}</span>} value={r} spec={{ title: 'Signer nonce R · ' + it.label, value: r, file: 'nonce-r-' + it.n + '.txt' }}
        note={it.alg === 'ecdsa' ? 'Compressed point, 33 bytes.' : 'x-only point, 32 bytes (BIP340).'} />;
    }
    if (step === 3) {
      const v = data[i], d = dataB[i];
      const short = match[i] && d.length < 32;
      return (
        <InField id={'ae-d' + i} label={it.label} right={it.sub && <span class="mono muted" style={{ fontSize: '12px' }}>{it.sub}</span>} textarea rows={3} mono={S.dataFmt !== 'text'} value={v} onInput={(x) => setData(i, x)}
          placeholder={S.dataFmt === 'text' ? 'The data the host committed to' : S.dataFmt === 'hex' ? 'Hex' : 'Base64'} bad={!!v && !match[i]}
          note={!v ? 'Its SHA-256 must equal the commitment from step 1.' : !d ? 'Not valid ' + (S.dataFmt === 'hex' ? 'hex' : 'Base64') + '.'
            : match[i] ? '✓ Matches the commitment · ' + d.length + ' bytes' + (short ? '. Under 32 bytes: unless it is random, the signer could guess it from the hash.' : '')
              : '✗ Doesn’t match the commitment. The host must reveal exactly what it committed to.'}
          noteCls={!v ? '' : short ? 'warn' : match[i] ? 'ok' : 'err'}
          spec={{ title: 'Host data · ' + it.label, binary: true, onValue: (x) => dataFromImport(i, x) }} />
      );
    }
    const f = fin[i] ? hex.encode(fin[i]) : '';
    return <OutField label={it.label} right={it.sub && <span class="mono muted" style={{ fontSize: '12px' }}>{it.sub}</span>} value={f} spec={{ title: 'Final nonce · ' + it.label, value: f, file: 'nonce-final-' + it.n + '.txt' }}
      note="R + SHA256(R ‖ data)·G. The host recomputes it to check the signature." />;
  };

  return (
    <NavShell max={760} gap={18}>
      <TitleRow onBack={() => (step === 1 ? leave(back) : set({ step: step - 1, data: step === 2 ? [] : S.data, err: '' }))} title="Anti-exfil signing"
        right={<span class="small" style={{ fontSize: '14px', flexShrink: 0 }}>Step {step} of 4</span>} />
      <div class="steps">{[1, 2, 3, 4].map((k) => <span key={k} class={k <= step ? 'on' : ''} />)}</div>
      <div class="aesum">
        <span>Signing <b>{what}</b></span>
        <span>Signature <b>{algs.map((x) => ALG_NAME[x]).join(' + ')}</b></span>
        <span>Nonces <b>{plural ? N + ', one per input' : '1'}</b></span>
      </div>
      <div class="stack" style={{ gap: '6px' }}>
        <h2 class="h20" style={{ margin: 0 }}>{STEPS[step][0]}</h2>
        <p class="small" style={{ margin: 0, fontSize: '14px', lineHeight: 1.55 }}>{STEPS[step][1]}</p>
      </div>
      {step === 1 && (
        <div class="stack" style={{ gap: '6px' }}>
          <span id="ae-cf" class="small">Commitment format</span>
          <Seg items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.comFmt} labelledBy="ae-cf" onChange={switchCom} />
        </div>
      )}
      {step === 3 && (
        <div class="stack" style={{ gap: '6px' }}>
          <span id="ae-df" class="small">Data format</span>
          <Seg items={[['text', 'Text'], ['hex', 'Hex'], ['b64', 'Base64']]} value={S.dataFmt} labelledBy="ae-df" onChange={switchData} />
        </div>
      )}
      {items.map((it, i) => <Fragment key={it.n}>{field(it, i)}</Fragment>)}
      {rErr && <span class="note err">{rErr}</span>}
      {step === 2 && <div class="aewarn warn"><b>!</b><span>Send R before the host reveals its data. Going back to step 1 with a new commitment gives a new R; a host that asks for that repeatedly is suspicious.</span></div>}
      {step === 4 && <div class="aewarn"><b>!</b><span>If signing fails, retry with the same data. Don’t start over with new data: a faulty signer could keep failing until it gets a nonce it likes.</span></div>}
      {S.err && <span class="note err" role="alert">{S.err}</span>}
      <div class="btnrow">
        {step === 1 ? <button class="btn-secondary bold" onClick={() => leave(back)}>Cancel</button>
          : <button class="btn-secondary bold" onClick={() => set({ step: step - 1, data: step === 2 ? [] : S.data, err: '' })}>Back</button>}
        {next ? <button class="btn-primary" onClick={() => (step === 4 ? sign() : set({ step: step + 1, err: '' }))}>{step === 4 ? (plural ? 'Sign with these nonces' : 'Sign with this nonce') : 'Next'}</button>
          : <button class="btn-primary" disabled>{step === 1 ? (plural ? 'Enter every commitment' : 'Enter the commitment') : step === 3 ? 'Data must match the commitment' : 'Can’t compute the nonce'}</button>}
      </div>
    </NavShell>
  );
}

