// Addresses: type, account, path, xpub/descriptor export, address list, detail, private keys,
// path editor, and message signing.
import { h, Fragment } from 'preact';
import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import { go } from '../router.js';
import { getState, setState, patch, useStore, addLog } from '../store.js';
import { NavShell, TitleRow, Seg, Chips, UTabs, OutField, ExportBtn, InField, I, Addr, shortAddr, fmtTime } from '../kit.jsx';
import { accountOf, resolveSel } from '../account.js';
import { download } from '../io.js';
import { accountKeys, addressAt } from '../../core/wallet.js';
import { TYPES, TYPE_ORDER, NETS, stdAccountPath, normPath, payment, xonly, withChecksum } from '../../core/hd.js';
import { encodeWIF, pubOf, ELECTRUM_PREFIX } from '../../core/keys.js';
import { signDigest, verifyDigest, signingPub, toDER, isDER } from '../../core/message.js';
import { hex, base64, hash160, isHex } from '../../core/util.js';
import { textToBytes, bytesToText } from '../../core/encoding.js';
import { startMessageAntiExfil } from './antiexfil.jsx';

const TYPE_HINT = { wpkh: 'P2WPKH · BIP84', tr: 'P2TR · BIP86', shwpkh: 'P2SH-P2WPKH · BIP49', pkh: 'P2PKH · BIP44' };

export function Addresses() {
  const st = useStore();
  const w = st.wallet;
  if (w.kind === 'keys') return <KeyAddresses />;
  const a = st.addr;
  const { net, type, cp, K, fixed } = accountOf(st);
  const set = (p) => patch('addr', p);
  const prv = a.kmode === 'prv';
  const xName = K.xName, sName = K.sName;
  const F3 = [['x', xName]].concat(sName ? [['slip', sName]] : []).concat([['desc', 'Descriptor']]);
  const fmt = F3.some((f) => f[0] === a.fmt) ? a.fmt : 'x';
  const fmtLabel = F3.find((f) => f[0] === fmt)[1];
  const keyValue = fmt === 'x' ? K.x : fmt === 'slip' ? K.slip : K.desc;
  const notes = {
    x: 'Extended public key at ' + K.path + '. Works in every watch-only wallet; the address type is set there.',
    slip: sName + ' is the same key with the address type in its prefix (SLIP-132). Electrum and some mobile wallets want it.',
    desc: 'Output descriptor: key origin, address type, receive and change. The most exact way to set up a watch-only wallet.' + (K.fpKnown ? '' : ' The master fingerprint is unknown, so the descriptor has no key origin.'),
  };
  const rows = [];
  for (let i = a.idx; i < a.idx + 8; i++) {
    const x = addressAt(K, type, net, a.branch, i);
    rows.push({ i, addr: x.address, sel: { type, base: K.path, branch: a.branch, i, net, addr: x.address, custom: !!cp } });
  }
  return (
    <NavShell max={1120} gap={8}>
      <div class="backrow" style={{ marginRight: '-12px' }}>
        <h1 style={{ fontSize: '20px', flexGrow: 1, marginLeft: '12px' }}>Addresses</h1>
        <a href="#/address-help" class="backbtn" aria-label="Which address type and path does my wallet use?" style={{ textDecoration: 'none' }}><span class="qhelp">?</span></a>
      </div>
      <div class="cols2" style={{ paddingBottom: '24px' }}>
        <div>
          {w.kind === 'xkey' && w.typeFixed ? (
            <div class="infoline"><I.IInfo /><span>{TYPES[type].label} · {TYPE_HINT[type]}. The key’s prefix fixes the address type.</span></div>
          ) : (
            <div class="typegrid" role="radiogroup" aria-label="Address type">
              {TYPE_ORDER.map((t) => (
                <button key={t} role="radio" aria-checked={type === t ? 'true' : 'false'} class={type === t ? 'on' : ''} onClick={() => set({ type: t, idx: 0 })}>
                  <b>{TYPES[t].label}</b><span>{w.root && a.cpath[t] ? 'Custom path' : TYPE_HINT[t]}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '8px' }}>
            <div class="stack" style={{ gap: '4px' }}>
              <span class="note">Account</span>
              {fixed || cp ? <div style={{ display: 'flex', alignItems: 'center', height: '44px', padding: '0 12px', border: '1px solid var(--line)', color: 'var(--muted)', fontSize: '13px' }}>{fixed ? 'Set by the key' : 'Set by custom path'}</div> : (
                <div class="stepper">
                  <button aria-label="Previous account" onClick={() => set({ acct: Math.max(0, a.acct - 1), idx: 0 })}>−</button>
                  <span>{a.acct}</span>
                  <button aria-label="Next account" onClick={() => set({ acct: Math.min(99, a.acct + 1), idx: 0 })}>+</button>
                </div>
              )}
            </div>
            <div class="stack" style={{ gap: '4px' }}>
              <label for="ad-net" class="note">Network</label>
              <select id="ad-net" class="select" value={net} onChange={(e) => { patch('settings', { net: e.currentTarget.value }); set({ idx: 0 }); }}>
                {Object.values(NETS).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
          </div>
          <div class="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
              <div class="stack" style={{ gap: '3px', minWidth: 0 }}>
                <span class="note" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Account path {cp && <span class="tag" style={{ color: 'var(--warn)' }}>CUSTOM</span>}{fixed && !K.pathKnown && <span class="tag" style={{ color: 'var(--accent)' }}>GUESSED</span>}</span>
                <span class="mono" style={{ fontSize: '15px', wordBreak: 'break-all' }}>{K.path}</span>
                <span class="note">Script <span class="mono" style={{ color: 'var(--text)' }}>{TYPES[type].tmpl}</span></span>
              </div>
              {!fixed && (
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <button class="btn-secondary bold btn-xs" onClick={() => go('edit-path')}>Edit path</button>
                  {cp && <button class="btn-danger btn-xs" aria-label={'Drop custom path and go back to BIP' + TYPES[type].purpose + ' standard path'} onClick={() => { const m = { ...a.cpath }; delete m[type]; set({ cpath: m, idx: 0 }); }}>Drop</button>}
                </div>
              )}
            </div>
            <div role="tablist" aria-label="Key kind" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', padding: '10px 14px 0' }}>
              {[['pub', 'Public key'], ['prv', 'Private key']].map(([id, l]) => {
                const on = (a.kmode || 'pub') === id;
                return <button key={id} role="tab" aria-selected={on ? 'true' : 'false'} onClick={() => set({ kmode: id })} style={{ height: '36px', font: '600 14px var(--sans)', cursor: 'pointer', background: 'transparent', border: '1px solid ' + (on ? (id === 'prv' ? 'var(--danger)' : '#fff') : 'var(--line)'), color: on ? (id === 'prv' ? 'var(--danger)' : '#fff') : 'var(--muted)' }}>{l}</button>;
              })}
            </div>
            {prv ? (
              <div class="stack" style={{ gap: '12px', padding: '14px' }}>
                <span style={{ display: 'flex', gap: '10px', fontSize: '13px', lineHeight: 1.5, color: 'var(--muted)' }}><I.ILock size={20} style={{ flexShrink: 0, color: '#fff' }} /><span>Account private key for <span class="mono" style={{ color: 'var(--text)' }}>{K.path}</span>. Anyone who has it can spend everything on this path. It opens on its own screen with QR, image, text and file export.</span></span>
                <button class="btn-primary btn-sm" onClick={() => { setState({ keyScope: 'acct' }); go('private-key'); }}>Show account private key</button>
              </div>
            ) : (
              <>
                <div class="utabs" role="tablist" aria-label="Key format" style={{ gridTemplateColumns: 'repeat(' + F3.length + ', minmax(0,1fr))', padding: '0 6px' }}>
                  {F3.map(([id, l]) => <button key={id} role="tab" aria-selected={fmt === id ? 'true' : 'false'} class={fmt === id ? 'on' : ''} onClick={() => set({ fmt: id })}>{l}</button>)}
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <OutField label={fmtLabel} value={keyValue} spec={{ title: fmtLabel + ' · ' + TYPES[type].label, value: keyValue, file: (fmt === 'desc' ? 'descriptor' : fmtLabel) + '-' + type + '.txt' }} note={notes[fmt]} />
                </div>
              </>
            )}
          </div>
        </div>
        <div>
          <div class="card">
            <UTabs items={[[0, 'Receiving (0)'], [1, 'Change (1)']]} value={a.branch} onChange={(b) => set({ branch: b, idx: 0 })} label="Branch" />
            {rows.map((r) => (
              <button key={r.i} class="addrrow" onClick={() => { setState({ addrSel: r.sel }); go('address'); }}>
                <span class="i">#{r.i}</span><span class="a">{r.addr}</span><I.IChev />
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '10px', alignItems: 'center' }}>
            <button class="btn-secondary bold btn-sm" disabled={a.idx === 0} style={a.idx === 0 ? { borderColor: 'var(--line)', color: 'var(--ph)' } : null} onClick={() => set({ idx: Math.max(0, a.idx - 8) })}>Previous 8</button>
            <span class="note">from #{a.idx}</span>
            <button class="btn-secondary bold btn-sm" onClick={() => set({ idx: a.idx + 8 })}>Next 8</button>
          </div>
        </div>
      </div>
    </NavShell>
  );
}

function KeyAddresses() {
  const st = useStore();
  const w = st.wallet;
  const net = st.settings.net;
  return (
    <NavShell max={860} gap={16}>
      <h1 style={{ fontSize: '20px' }}>Addresses</h1>
      <span class="small">One address per key. Change goes back to one of them.</span>
      <div class="card">
        {w.keys.map((k, i) => {
          const a = payment(k.type, pubOf(k.priv, k.compressed), net).address;
          return <button key={i} class="addrrow" onClick={() => { setState({ addrSel: { keyIdx: i, type: k.type, net, addr: a } }); go('address'); }}><span class="i">{k.label || 'Key ' + (i + 1)}</span><span class="a">{a}</span><I.IChev /></button>;
        })}
      </div>
    </NavShell>
  );
}

export function AddressHelp() {
  const apply = (type, path, std) => {
    const a = getState().addr;
    const m = { ...a.cpath };
    if (std) delete m[type]; else m[type] = path;
    patch('addr', { type, acct: 0, cpath: m, idx: 0 });
    go('addresses');
  };
  const STD = [
    { type: 'wpkh', name: 'Native SegWit', path: "m/84'/0'/0'", prefix: 'bc1q…', rec: true, yes: 'Sparrow, Bitcoin Safe, Bitcoin Core, Blockstream Green, BlueWallet, Electrum, Cake Wallet', no: '' },
    { type: 'tr', name: 'Taproot', path: "m/86'/0'/0'", prefix: 'bc1p…', yes: 'Sparrow, Bitcoin Safe, Bitcoin Core', no: 'Blockstream Green, BlueWallet, Electrum, Cake Wallet' },
    { type: 'shwpkh', name: 'Nested SegWit', path: "m/49'/0'/0'", prefix: '3…', yes: 'Sparrow, Bitcoin Safe, Bitcoin Core, Blockstream Green, BlueWallet, Electrum, Cake Wallet', no: '' },
    { type: 'pkh', name: 'Legacy', path: "m/44'/0'/0'", prefix: '1…', yes: 'Sparrow, Bitcoin Safe, Bitcoin Core, Blockstream Green, BlueWallet, Electrum, Cake Wallet, Blockchain.com', no: '' },
  ];
  const SP = [
    { wallet: 'BRD / Breadwallet', type: 'pkh', name: 'Legacy', path: "m/0'", note: 'Receive m/0′/0/*, change m/0′/1/*. If coins are missing, try Native SegWit on the same path.' },
    { wallet: 'Samourai / Ashigaru post-mix', type: 'wpkh', name: 'Native SegWit', path: "m/84'/0'/2147483646'", note: 'Whirlpool post-mix account. Deposits use the standard m/84′/0′/0′.' },
    { wallet: 'Bisq', type: 'wpkh', name: 'Native SegWit', path: "m/44'/0'/1'", note: 'SegWit addresses on the BIP44 path, account 1. A case where path and type don’t follow the same BIP.' },
  ];
  const Item = ({ head, sub, onApply, label, children }) => (
    <div class="stack" style={{ gap: '6px', padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <div class="stack" style={{ gap: '2px' }}><span style={{ fontWeight: 600, display: 'flex', gap: '8px', alignItems: 'center' }}>{head}</span><span class="note mono">{sub}</span></div>
        <button class="btn-secondary bold btn-xs" aria-label={label} onClick={onApply}>Apply</button>
      </div>
      {children}
    </div>
  );
  return (
    <NavShell max={860} gap={16}>
      <TitleRow back="addresses" title="Which type and path?" />
      <span class="small">Your watch-only wallet must use the same address type and path as this device, or it shows different addresses. Apply one below to switch the Addresses screen to it.</span>
      <span class="caps s12">Standard types</span>
      {STD.map((o) => (
        <Item key={o.type} head={<>{o.name}{o.rec && <span class="tag" style={{ color: 'var(--accent)' }}>RECOMMENDED</span>}</>} sub={o.path + ' · ' + o.prefix} label={'Apply ' + o.name + ' ' + o.path} onApply={() => apply(o.type, o.path, true)}>
          <span class="small"><span style={{ color: 'var(--text)' }}>Works in </span>{o.yes}</span>
          {o.no && <span class="small"><span style={{ color: 'var(--text)' }}>Not in </span>{o.no}</span>}
        </Item>
      ))}
      <span class="caps s12">Wallet-specific paths</span>
      {SP.map((o) => <Item key={o.wallet} head={o.wallet} sub={o.path + ' · ' + o.name} label={'Apply ' + o.wallet + ' path'} onApply={() => apply(o.type, o.path, false)}><span class="small">{o.note}</span></Item>)}
      <div class="stack" style={{ gap: '6px', padding: '12px 14px', border: '1px solid var(--line)' }}>
        <span style={{ fontWeight: 600 }}>Not sure?</span>
        <span class="small">Open your other wallet, find its first receive address, and compare it with #0 on the Addresses screen. If they differ, try another type here, or use Check an address.</span>
        <span class="small">Bitcoin Core and Sparrow can import any type and path as a descriptor.</span>
      </div>
      <span class="note">Based on walletsrecovery.org. Wallets change between versions; check your wallet's own docs.</span>
    </NavShell>
  );
}

function checkPath(p) {
  const s = String(p).trim();
  if (!s) return { ok: false, msg: 'Enter a path that starts with m' };
  if (!/^m(\/\d+['hH]?)*$/.test(s)) return { ok: false, msg: "Use m/ then numbers, with ' or h for hardened steps" };
  const parts = s.split('/').slice(1);
  if (!parts.length) return { ok: false, msg: 'Add at least one level after m' };
  if (parts.some((x) => parseInt(x, 10) >= 2147483648)) return { ok: false, msg: 'Each level must be below 2147483648' };
  const hard = parts.filter((x) => /['hH]$/.test(x)).length;
  return { ok: true, parts, msg: 'Valid · depth ' + parts.length + ' · ' + hard + ' hardened · addresses add /branch/index' };
}

export function EditPath() {
  const st = useStore();
  const w = st.wallet;
  const a = st.addr;
  const net = st.settings.net;
  const type = a.type;
  const T = TYPES[type];
  const std = stdAccountPath(type, net, a.acct);
  const [path, setPath] = useState(a.cpath[type] || std);
  const c = checkPath(path);
  const norm = c.ok ? normPath(path) : null;
  const preview = useMemo(() => {
    if (!c.ok) return null;
    const A = accountKeys(w, type, net, 0, norm);
    return { first: addressAt(A, type, net, 0, 0).address, x: A.x };
  }, [norm, type, net]);
  const warns = [];
  if (c.ok) {
    const P = c.parts;
    const pur = parseInt(P[0], 10);
    const pmap = { 44: 'P2PKH', 49: 'P2SH-P2WPKH', 84: 'P2WPKH', 86: 'P2TR' };
    if (pmap[pur] && pur !== T.purpose) warns.push('BIP' + pur + ' paths are normally used for ' + pmap[pur] + '. Allowed, but a standard wallet expects ' + T.script + ' at m/' + T.purpose + "'/…, so it won't find these addresses.");
    if (P.length !== 3) warns.push('Most wallets use an account path of depth 3 (purpose/coin/account). Depth ' + P.length + ' only matches wallets that use exactly this path.');
    if (P.length >= 2 && pmap[pur]) {
      if (/^1['hH]$/.test(P[1]) && net === 'main') warns.push("Coin type 1' is the test-network convention, but Mainnet is selected.");
      if (/^0['hH]$/.test(P[1]) && net !== 'main') warns.push("Coin type 0' is the mainnet convention, but " + NETS[net].name + ' is selected.');
    }
    if (P.some((x) => !/['hH]$/.test(x))) warns.push('Unhardened levels above the account let anyone with the account key and one child private key work out the parent key. Prefer hardened (′) levels here.');
  }
  const isStd = norm === std;
  const quick = [[std, 'Standard · ' + std], ["m/0'", "m/0'"], ["m/84'/0'/2147483646'", "m/84'/0'/2147483646'"], ["m/44'/0'/1'", "m/44'/0'/1'"]];
  const levels = c.ok ? c.parts.map((v, i) => ({ v, k: c.parts.length === 3 && [44, 49, 84, 86].includes(parseInt(c.parts[0], 10)) ? ['purpose', 'coin', 'account'][i] : 'level ' + (i + 1) })) : [];
  const apply = () => { const m = { ...a.cpath }; if (isStd) delete m[type]; else m[type] = norm; patch('addr', { cpath: m, idx: 0 }); go('addresses'); };
  return (
    <NavShell max={760} gap={16}>
      <TitleRow back="addresses" title="Edit path" sub={T.label + ' · ' + T.script} />
      <span class="small">Choose where in your seed this address type's keys come from. The address type stays {T.script}: path and type are independent.</span>
      <InField id="pb-path" label={'Account path · from seed ' + w.fp} value={path} onInput={setPath} placeholder={std} bad={!c.ok} note={c.msg} noteCls={c.ok ? '' : 'err'} />
      {c.ok && <div class="pathlevels" aria-label="Path levels">{levels.map((l) => <div><b>{l.v}</b><span>{l.k}</span></div>)}<div class="fixed"><b>0 / 1</b><span>branch</span></div><div class="fixed"><b>*</b><span>index</span></div></div>}
      <div class="stack" style={{ gap: '8px' }}>
        <span class="caps s12">Quick picks</span>
        <div class="quick">{quick.map(([p, l]) => <button key={p} onClick={() => setPath(p)}>{l}</button>)}</div>
      </div>
      {warns.length > 0 && <div class="stack" style={{ gap: '8px', padding: '12px 14px', border: '1px solid var(--warn)' }}>{warns.map((t) => <span style={{ fontSize: '13px', lineHeight: 1.5 }}>{t}</span>)}</div>}
      {preview && (
        <>
          <OutField label={'First receive address · ' + norm + '/0/0 · ' + NETS[net].name} value={preview.first} spec={{ title: 'First receive address', value: preview.first, file: 'first-address.txt' }} />
          <OutField label="Key at this path" value={preview.x} spec={{ title: 'Key at ' + norm, value: preview.x, file: 'xpub.txt' }} />
          <span class="note">Compare the first address with your other wallet before relying on this path.</span>
        </>
      )}
      <div class="btncol">
        {c.ok ? <button class="btn-primary" onClick={apply}>{isStd ? 'Use standard path' : 'Use this path'}</button> : <button class="btn-primary" disabled>Fix the path first</button>}
        <button class="btn-secondary" onClick={() => { const m = { ...a.cpath }; delete m[type]; patch('addr', { cpath: m, idx: 0 }); go('addresses'); }}>Reset to BIP{T.purpose} standard</button>
      </div>
    </NavShell>
  );
}

export function AddressDetail() {
  const st = useStore();
  const w = st.wallet;
  const sel = st.addrSel;
  if (!sel) { go('addresses'); return null; }
  const net = sel.net || st.settings.net;
  const R = resolveSel(w, sel, net);
  const T = TYPES[R.type];
  const p = payment(R.type, R.pub, net);
  const tr = R.type === 'tr';
  const pubShown = tr ? hex.encode(xonly(R.pub)) : hex.encode(R.pub);
  const hashShown = hex.encode(tr ? p.script.subarray(2) : hash160(R.pub));
  const spk = hex.encode(p.script);
  const txs = st.log.filter((x) => x.kind === 'psbt' && x.ours && x.ours.includes(R.address));
  const isKey = sel.keyIdx !== undefined;
  const title = isKey ? (R.key.label || 'Key') + ' address' : (sel.branch ? 'Change' : 'Receive') + ' address #' + sel.i;
  const D = ({ k, v, ex }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', minWidth: 0 }}><span class="note">{k}</span><span class="mono" style={{ fontSize: '13px', wordBreak: 'break-all' }}>{v}</span></span>
      {ex && <ExportBtn spec={ex} />}
    </div>
  );
  const dl = (fmt) => {
    const rows = txs.map((x) => ({ date: new Date(x.time).toISOString(), txid: x.txid }));
    const name = 'signed-' + R.type + '-' + (isKey ? 'key' : sel.branch + '-' + sel.i) + '.' + fmt;
    download(name, fmt === 'csv' ? 'date,txid\n' + rows.map((r) => r.date + ',' + r.txid).join('\n') + '\n' : JSON.stringify(rows, null, 2), fmt === 'csv' ? 'text/csv' : 'application/json');
  };
  return (
    <NavShell max={1040} gap={18}>
      <TitleRow back="addresses" title={title} sub={T.label + (sel.custom ? ' · custom path' : '')} />
      <div class="cols2">
        <div>
          <div class="field">
            <div class="fhead"><span class="flabel">Address</span></div>
            <div class="fbody"><div class="valbox" style={{ padding: '12px 14px' }}><Addr a={R.address} chunks /></div><ExportBtn spec={{ title: 'Address', value: R.address, file: 'address.txt' }} /></div>
          </div>
          <div class="stack">
            <span class="caps s12">Details</span>
            <div class="card" style={{ borderTop: 'none' }}>
              {R.path && <D k="Path" v={R.path} />}
              <D k="Script type" v={T.script} />
              <D k="Network" v={NETS[net].name} />
              <D k="Made with" v={isKey ? 'Imported private key' : sel.custom ? 'Custom path · ' + sel.base : w.root ? 'Standard preset · BIP' + T.purpose : 'Account key · ' + sel.base} />
              <D k={tr ? 'Internal key (x-only)' : 'Public key'} v={pubShown} ex={{ title: tr ? 'Internal key (x-only)' : 'Public key', value: pubShown, file: 'public-key.txt' }} />
              <D k={tr ? 'Output key (tweaked)' : 'Public key hash'} v={hashShown} ex={{ title: tr ? 'Output key (tweaked)' : 'Public key hash', value: hashShown, file: tr ? 'output-key.txt' : 'pubkey-hash.txt' }} />
              <D k="scriptPubKey" v={spk} ex={{ title: 'scriptPubKey', value: spk, file: 'scriptpubkey.txt' }} />
            </div>
          </div>
        </div>
        <div>
          <div class="stack">
            <span class="caps s12">Signed with this address · {txs.length}</span>
            {txs.length ? (
              <>
                <div class="card">{txs.map((x) => <button key={x.id} class="listrow" onClick={() => { setState({ tx: x.snapshot }); go('psbt-details'); }}><div class="top"><span class="main mono">{shortAddr(x.txid, 4, 5)}</span><span class="typ" style={{ color: 'var(--accent)' }}>Signed</span></div><span class="date">{fmtTime(x.time)}</span></button>)}</div>
                <div class="btnrow"><button class="btn-secondary btn-sm" onClick={() => dl('csv')}><I.IDownload />Download CSV</button><button class="btn-secondary btn-sm" onClick={() => dl('json')}><I.IDownload />Download JSON</button></div>
              </>
            ) : <div class="infoline">Nothing signed with this address yet. Transactions appear here once this device signs an input that spends from it.</div>}
          </div>
        </div>
      </div>
      <div class="btnrow">
        <button class="btn-danger" onClick={() => { setState({ keyScope: 'addr' }); go('private-key'); }}><I.ILock />Private key</button>
        <button class="btn-secondary bold" onClick={() => go('sign-verify')}>Sign / verify</button>
      </div>
    </NavShell>
  );
}

export function PrivateKey() {
  const st = useStore();
  const w = st.wallet;
  const net = st.settings.net;
  const [fmtSel, setFmt] = useState('');
  let C;
  if (st.keyScope === 'acct') {
    const { type } = accountOf(st);
    const P = accountKeys(w, type, net, st.addr.acct, w.root ? st.addr.cpath[type] : null, true);
    const fmts = [{ id: 'x', label: P.xName, value: P.x, works: 'Sparrow · Bitcoin Core (in a descriptor)', note: type === 'pkh' ? 'Extended private key at ' + P.path + '. Restores this account in another wallet, which then can spend.' : 'A bare ' + P.xName + ' has no address type, so the wallet asks for it. Electrum reads it as Legacy.' }];
    if (P.slip) fmts.push({ id: 'slip', label: P.sName, value: P.slip, works: 'Electrum', note: 'Same key with the address type in its prefix (SLIP-132), so Electrum shows the right addresses.' });
    fmts.push({ id: 'desc', label: 'Descriptor', value: P.desc, works: 'Bitcoin Core (importdescriptors) · Sparrow', note: 'Carries fingerprint, path, address type, receive and change, so nothing is guessed.' });
    C = { title: 'Account private key', sub: TYPES[type].label + ' · ' + P.path + (net === 'main' ? '' : ' · ' + NETS[net].name), warn: 'This key spends every address of this account, receive and change, now and in the future. Never type or scan it into a device that goes online, unless you are moving to a new wallet.', back: 'addresses', fmts, def: P.slip ? 'slip' : 'x', file: 'account-key' };
  } else {
    const sel = st.addrSel;
    if (!sel) { go('addresses'); return null; }
    const R = resolveSel(w, sel, net);
    const wif = encodeWIF(R.priv, net === 'main' ? 'main' : 'test', R.compressed);
    const short = shortAddr(R.address, 10, 6);
    const el = ELECTRUM_PREFIX[R.type];
    const desc = withChecksum(TYPES[R.type].tmpl.replace('KEY', wif));
    const fmts = [{ id: 'wif', label: 'WIF', value: wif, works: 'BlueWallet · Sparrow (sweep) · Bitcoin Core', note: 'A bare WIF has no address type. Some wallets show it as a Legacy 1… address.' }];
    if (el) fmts.push({ id: 'el', label: 'Electrum', value: el + ':' + wif, works: 'Electrum', note: 'The prefix tells Electrum the address type, so it shows ' + short + '.' });
    fmts.push({ id: 'hex', label: 'Hex', value: hex.encode(R.priv), works: 'Developer tools', note: 'Raw 32 bytes, no checksum: a typo is not detected. Avoid for manual copying.' });
    fmts.push({ id: 'desc', label: 'Descriptor', value: desc, works: 'Bitcoin Core (importdescriptors)' + (R.type === 'tr' ? ' · Sparrow' : ''), note: 'Carries the address type and a checksum, so nothing is guessed.' });
    C = { title: 'Private key · ' + (sel.keyIdx !== undefined ? R.key.label || 'Key' : (sel.branch ? 'Change' : 'Receive') + ' #' + sel.i), sub: short + (sel.custom ? ' · custom path' : ''), warn: 'This key spends everything ever sent to ' + short + '. If you move it to another wallet, sweep the coins to a new address instead of importing the key.', back: 'address', fmts, def: el ? 'el' : 'wif', file: 'address-key' };
  }
  const fid = C.fmts.some((f) => f.id === fmtSel) ? fmtSel : C.def;
  const cur = C.fmts.find((f) => f.id === fid);
  return (
    <NavShell max={760} gap={18}>
      <TitleRow back={C.back} title={C.title} sub={C.sub} />
      <div class="warnline"><I.IWarn /><span>{C.warn}</span></div>
      <Seg items={C.fmts.map((f) => [f.id, f.label])} value={fid} onChange={setFmt} />
      <OutField label={cur.label} priv spec={{ title: C.title + ' · ' + cur.label, value: cur.value, file: C.file + '-' + cur.id + '.txt' }} />
      <div class="stack" style={{ gap: '4px' }}><span style={{ fontSize: '14px' }}><span class="muted">Works with </span>{cur.works}</span><span class="note">{cur.note}</span></div>
    </NavShell>
  );
}

// ---------- message and raw-digest signing ----------
const SIG_FMT = (alg, efmt) => (alg === 'schnorr' ? 'Schnorr · 64 bytes' : efmt === 'der' ? 'ECDSA · DER' : 'ECDSA · 65 bytes');
const keyLabel = (sel, R) => (sel.keyIdx !== undefined ? R.key.label || 'Key' : (sel.branch ? 'Change' : 'Receive') + ' #' + sel.i);

/** Add a message or raw-digest signature to the Signed log, with what Verify needs to check it again. */
export function logSignature({ raw, alg, efmt, mfmt, msg, bytes, sig, address, who, sel, ae }) {
  const prefill = raw
    ? { what: 'raw', alg, dfmt: 'hex', dig: hex.encode(bytes), vfmt: 'b64', sig: base64.encode(sig), who }
    : { what: 'msg', alg, mfmt, msg, vfmt: 'b64', sig: base64.encode(sig), who };
  const main = raw ? hex.encode(bytes).slice(0, 8) + '…' + hex.encode(bytes).slice(-8) : mfmt === 'text' ? msg.slice(0, 120) : mfmt + ' message · ' + bytes.length + ' bytes';
  addLog({ kind: raw ? 'raw' : 'msg', main, fmt: SIG_FMT(alg, efmt), address, alg, ae: !!ae, prefill, sel });
}

/** The "?" panel: how the signing options work, instead of notes under every field. */
function SignHelp({ onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    if (ref.current) ref.current.focus();
    const f = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', f);
    return () => { window.removeEventListener('keydown', f); if (back && back.focus) back.focus(); };
  }, []);
  const Sec = ({ t, children }) => <section class="helpsec"><h3>{t}</h3><ul>{children}</ul></section>;
  return (
    <div class="scrim">
      <button class="closer" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="sv-help-title" class="dialog helpdlg">
        <span aria-hidden="true" class="handle" />
        <div class="dhead"><h2 id="sv-help-title" class="ttl">How signing works</h2><button ref={ref} class="xbtn" aria-label="Close" onClick={onClose}><I.IClose /></button></div>
        <Sec t="Message">
          <li><b>ECDSA:</b> a classic Bitcoin signed message (BIP-137). The message gets the “Bitcoin Signed Message” prefix and is hashed, so the signature can never spend coins. 65 bytes; Electrum, Sparrow and most wallets verify it with just the address.</li>
          <li><b>Schnorr:</b> BIP-340 over the BIP-322 message hash, 64 bytes. Verifiers need your x-only public key. Few wallets check it yet.</li>
        </Sec>
        <Sec t="Raw hash">
          <li>Signs exactly the 32 bytes you enter, with no prefix and no hashing. Use it for transaction sighashes or digests your own software computed.</li>
          <li class="danger"><b>Warning:</b> a raw signature can authorize spending the coins on this address. Only sign digests you computed or trust.</li>
          <li><b>ECDSA in a transaction:</b> use DER and append the sighash byte (01 for SIGHASH_ALL).</li>
        </Sec>
        <Sec t="Signature formats">
          <li><b>65 bytes (recoverable):</b> the key can be recovered from it, so the address is enough to verify.</li>
          <li><b>DER:</b> the standard ECDSA encoding used inside transactions. The verifier needs the public key or address.</li>
          <li><b>Schnorr:</b> always 64 bytes. The verifier needs the x-only key.</li>
          <li><b>Taproot address:</b> Schnorr signs with the address’s own key, the tweaked output key, for messages and raw hashes alike, as a Taproot key-path spend needs. “Public key used” shows it.</li>
        </Sec>
        <Sec t="Anti-exfil signing">
          <li>Your online wallet adds its own randomness to the nonce, so this signer can’t leak your key through the signature. The signature format stays the same.</li>
        </Sec>
        <Sec t="Verify">
          <li>ECDSA checks against an address; Schnorr checks against an x-only public key. Nothing leaves this computer.</li>
        </Sec>
      </div>
    </div>
  );
}

export function SignVerify() {
  const st = useStore();
  const w = st.wallet;
  const net = st.settings.net;
  const sel = st.addrSel;
  const pre = st.sigPrefill;
  const done = st.sigDone; // back from anti-exfil signing with its signature
  const [S, set0] = useState(() => {
    const base = { tab: 'sign', what: 'msg', alg: 'ecdsa', mfmt: 'text', msg: '', dfmt: 'hex', dig: '', msgErr: '', sig: null, ae: false, efmt: null, sfmt: 'b64', vfmt: 'b64', vsig: '', who: null, res: null, help: false };
    if (done) return { ...base, what: done.what, alg: done.alg, mfmt: done.mfmt, msg: done.msg, dfmt: done.dfmt, dig: done.dig, sig: done.sig, efmt: done.efmt, ae: true };
    if (pre) return { ...base, tab: 'verify', what: pre.what || 'msg', alg: pre.alg, mfmt: pre.mfmt || 'text', msg: pre.msg || '', dfmt: pre.dfmt || 'hex', dig: pre.dig || '', vfmt: pre.vfmt, vsig: pre.sig, who: pre.who };
    return base;
  });
  useEffect(() => { if (done) setState({ sigDone: null }); }, []);
  const set = (p) => set0((s) => ({ ...s, ...(('sig' in p) && !('ae' in p) ? { ae: false } : {}), ...p }));
  if (!sel) { go('addresses'); return null; }
  const R = resolveSel(w, sel, net);
  const raw = S.what === 'raw';
  const isSign = S.tab === 'sign';
  const fmt = raw ? S.dfmt : S.mfmt;
  const bytes = textToBytes(raw ? S.dig : S.msg, fmt);
  const msgBad = !bytes || (raw && bytes.length !== 32);
  const efmt = S.efmt || (raw ? 'der' : 'rec');
  // The key a verifier needs: 33-byte for ECDSA; x-only for Schnorr (on Taproot, the key in the address).
  const pubUsed = hex.encode(signingPub(S.alg, R.priv, R.type));
  const who = S.who !== null ? S.who : S.alg === 'ecdsa' ? R.address : pubUsed;
  const switchMsg = (k) => {
    if (k === S.mfmt) return;
    if (!bytes) return set({ msgErr: S.mfmt === 'hex' ? 'Fix the hex first: pairs of 0–9 and a–f.' : 'Fix the base64 first.' });
    const out = bytesToText(bytes, k);
    if (out === null) return set({ msgErr: 'These bytes are not readable text. Keep them as hex or base64.' });
    set({ mfmt: k, msg: out, msgErr: '', res: null });
  };
  const switchDig = (k) => { if (k !== S.dfmt) set({ dfmt: k, dig: bytes && S.dig.trim() ? bytesToText(bytes, k) : S.dig, res: null }); };
  const fmtName = fmt === 'hex' ? 'hex' : 'base64';
  const msgNote = raw
    ? (!bytes ? 'Not valid ' + fmtName + '.' : bytes.length === 32 ? '✓ 32 bytes' : 'Must be exactly 32 bytes; got ' + bytes.length)
    : S.msgErr || (msgBad ? 'Not valid ' + fmtName + '.' : bytes.length + ' bytes' + (S.mfmt === 'text' ? ' · UTF-8' : ''));
  const msgNoteCls = raw ? (msgBad ? (S.dig.trim() ? 'err' : '') : 'ok') : S.msgErr || msgBad ? 'err' : '';
  const run = () => {
    if (msgBad) return;
    if (isSign) {
      const sig = signDigest(S.alg, R.priv, R.type, bytes, raw);
      set({ sig, ae: false });
      logSignature({ raw, alg: S.alg, efmt, mfmt: S.mfmt, msg: S.msg, bytes, sig, address: R.address, who: S.alg === 'ecdsa' ? R.address : pubUsed, sel });
    } else {
      const sig = textToBytes(S.vsig, S.vfmt);
      if (!sig) return set({ res: { ok: false, why: 'The signature isn’t valid ' + (S.vfmt === 'hex' ? 'hex' : 'base64') + '.' } });
      if (S.alg === 'ecdsa') set({ res: verifyDigest('ecdsa', who.trim(), bytes, sig, raw) });
      else {
        const k = who.trim();
        set({ res: isHex(k) && k.length === 64 ? verifyDigest('schnorr', hex.decode(k), bytes, sig, raw) : { ok: false, why: 'Paste the 32-byte x-only public key as 64 hex characters.' } });
      }
    }
  };
  // ECDSA signatures are kept as 65 bytes; DER is another view of the same r and s.
  const shownSig = S.sig ? (S.alg === 'ecdsa' && efmt === 'der' ? toDER(S.sig) : S.sig) : null;
  const sigText = shownSig ? (S.sfmt === 'hex' ? hex.encode(shownSig) : base64.encode(shownSig)) : '';
  const vb = textToBytes(S.vsig, S.vfmt);
  const vNote = !S.vsig.trim() ? (S.alg === 'ecdsa' ? 'ECDSA: 65 bytes (recoverable) or DER.' : 'Schnorr: 64 bytes.')
    : !vb ? 'Not valid ' + (S.vfmt === 'hex' ? 'hex' : 'base64') + '.'
      : S.alg === 'schnorr' ? (vb.length === 64 ? 'Read as 64 bytes.' : 'Schnorr needs 64 bytes; got ' + vb.length + '.')
        : vb.length === 65 && vb[0] !== 0x30 ? 'Read as 65 bytes (recoverable).' : isDER(vb) ? 'Read as DER · ' + vb.length + ' bytes.' : 'ECDSA needs 65 bytes or DER; got ' + vb.length + ' bytes.';
  const vBad = !!S.vsig.trim() && !/^Read as/.test(vNote);
  const res = S.res;
  const thing = raw ? 'digest' : 'message';
  const fmtChips = raw
    ? <Chips label="Digest format" items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.dfmt} onChange={switchDig} />
    : <Chips label="Message format" items={[['text', 'Text'], ['hex', 'Hex'], ['b64', 'Base64']]} value={S.mfmt} onChange={switchMsg} />;
  const label = keyLabel(sel, R);
  return (
    <NavShell max={1040} gap={16}>
      <TitleRow back="address" onBack={() => { setState({ sigPrefill: null }); go('address'); }} title="Sign or verify"
        right={<button class="helpbtn" aria-label="How signing works" aria-haspopup="dialog" onClick={() => set({ help: true })}><span aria-hidden="true">?</span></button>} />
      <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}><span style={{ fontWeight: 600 }}>{label}</span><span class="mono muted" style={{ fontSize: '13px' }}>{shortAddr(R.address, 8, 6)}</span></div>
      <Seg items={[['sign', 'Sign'], ['verify', 'Verify']]} value={S.tab} onChange={(t) => set({ tab: t, res: null })} />
      <div class="cols2">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <span class="flabel">Signature type</span>
            <div class="seg h34" style={{ gridTemplateColumns: '1fr 1fr', width: '200px' }}>{[['ecdsa', 'ECDSA'], ['schnorr', 'Schnorr']].map(([k, l]) => <button key={k} aria-pressed={S.alg === k ? 'true' : 'false'} class={S.alg === k ? 'on' : ''} onClick={() => set({ alg: k, who: null, sig: null, res: null })}>{l}</button>)}</div>
          </div>
          {!isSign && <InField id="cr-who" label={S.alg === 'ecdsa' ? 'Address' : 'Public key (x-only, hex)'} value={who} onInput={(v) => set({ who: v, res: null })} />}
          <InField id="cr-msg" label={raw ? 'Raw hash (32 bytes)' : 'Message'} textarea mono={fmt !== 'text'} value={raw ? S.dig : S.msg}
            onInput={(v) => set(raw ? { dig: v, sig: null, res: null } : { msg: v, msgErr: '', sig: null, res: null })}
            head={<Chips label="What to sign" items={[['msg', 'Message'], ['raw', 'Raw hash']]} value={S.what} onChange={(k) => k !== S.what && set({ what: k, sig: null, res: null, efmt: null, msgErr: '', who: null })} />}
            placeholder={raw ? (S.dfmt === 'hex' ? '64 hex characters' : '44 Base64 characters') : { text: 'Type the message', hex: '48656c6c6f…', b64: 'SGVsbG8…' }[S.mfmt]}
            bad={msgNoteCls === 'err'} note={msgNote} noteCls={msgNoteCls} right={fmtChips}
            spec={raw ? { title: 'Raw hash (32 bytes)', binary: true, onValue: (v) => set({ dig: v instanceof Uint8Array ? (v.length === 32 ? bytesToText(v, S.dfmt) : new TextDecoder().decode(v).trim()) : String(v).trim(), sig: null, res: null }) } : undefined} />
          {!isSign && (
            <>
              <InField id="cr-sig" label="Signature" textarea value={S.vsig} onInput={(v) => set({ vsig: v, res: null })} bad={vBad} note={vNote} noteCls={vBad ? 'err' : ''}
                right={<Chips label="Signature format" items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.vfmt} onChange={(k) => set({ vfmt: k, res: null })} />} />
              <div class="resultbox" role="status" style={{ border: res ? (res.ok ? '2px solid var(--ok)' : '2px solid var(--danger)') : '1px dashed var(--line2)' }}>
                <b style={{ color: res ? (res.ok ? 'var(--ok)' : 'var(--danger)') : 'var(--muted)' }}>{res ? (res.ok ? 'Valid ' + (S.alg === 'ecdsa' ? 'ECDSA' : 'Schnorr') + ' signature' : 'Not valid') : 'Not checked yet'}</b>
                {res && <span class="small">{res.ok ? (S.alg === 'ecdsa' ? 'Signed by the key of this address. The ' + thing + ' is exactly as signed.' : 'Signed by this public key. The ' + thing + ' is exactly as signed.')
                  : res.why && res.why !== 'mismatch' ? res.why : 'The signature doesn’t match this ' + thing + ' and ' + (S.alg === 'ecdsa' ? 'address' : 'key') + '. Check the signature type and ' + (raw ? 'that you pasted the digest that was signed.' : 'that the message format is the one that was signed.')}</span>}
              </div>
            </>
          )}
        </div>
        <div>
          {isSign && S.sig && (
            <>
              <OutField label={'Signature' + (S.ae ? ' · anti-exfil' : '')} value={sigText}
                right={<span class="chiprow">{S.alg === 'ecdsa' && <Chips label="ECDSA format" items={[['rec', '65 bytes (recoverable)'], ['der', 'DER']]} value={efmt} onChange={(k) => set({ efmt: k })} />}<Chips label="Signature encoding" items={[['hex', 'Hex'], ['b64', 'Base64']]} value={S.sfmt} onChange={(k) => set({ sfmt: k })} /></span>}
                spec={{ title: (S.alg === 'ecdsa' ? 'ECDSA' + (efmt === 'der' ? ' DER' : '') : 'Schnorr') + ' signature · ' + (S.sfmt === 'hex' ? 'hex' : 'base64'), value: sigText, file: 'signature-' + S.alg + (S.alg === 'ecdsa' && efmt === 'der' ? '-der' : '') + (S.sfmt === 'hex' ? '.hex' : '.txt') }} />
              <OutField label="Public key used" value={pubUsed} right={<span class="note">{S.alg === 'ecdsa' ? 'compressed · 33 bytes' : 'x-only · 32 bytes'}</span>}
                spec={{ title: 'Public key · ' + (S.alg === 'ecdsa' ? 'compressed' : 'x-only'), value: pubUsed, file: 'public-key.txt' }} />
            </>
          )}
        </div>
      </div>
      {isSign ? (
        <div class="btnrow">
          <button class="btn-primary" disabled={msgBad} onClick={run}>{S.sig ? 'Sign again' : raw ? 'Sign digest' : 'Sign message'}</button>
          <button class="btn-secondary bold" disabled={msgBad} title="The host adds its own randomness to the nonce, so this signer can’t leak your key through the signature"
            onClick={() => startMessageAntiExfil({ raw, alg: S.alg, type: R.type, bytes, efmt, mfmt: S.mfmt, msg: S.msg, dfmt: S.dfmt, dig: S.dig, address: R.address, who: S.alg === 'ecdsa' ? R.address : pubUsed, sel, label })}>Anti-exfil signing</button>
        </div>
      ) : <button class="btn-primary" disabled={msgBad} onClick={run}>Verify</button>}
      {S.help && <SignHelp onClose={() => set({ help: false })} />}
    </NavShell>
  );
}
