// Offline Signer · entry point. One wallet per tab, nothing persisted, no network APIs used.
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute, go } from './ui/router.js';
import { useStore, getState, toast } from './ui/store.js';
import { Sheet } from './ui/sheet.jsx';
import { watchInjections } from './ui/env.js';
import * as C from './ui/screens/create.jsx';
import * as R from './ui/screens/restore.jsx';
import * as H from './ui/screens/home.jsx';
import * as A from './ui/screens/addresses.jsx';
import * as S from './ui/screens/signing.jsx';
import * as L from './ui/screens/logs.jsx';
import * as T from './ui/screens/tools.jsx';
import * as AE from './ui/screens/antiexfil.jsx';

watchInjections('app');

// Screens that work without a wallet, and screens that need one.
const OPEN = {
  welcome: C.Welcome, new: C.NewWallet, randomness: C.Randomness, 'add-randomness': C.AddRandomness,
  'write-seed': C.WriteSeed, 'check-backup': C.CheckBackup, passphrase: C.Passphrase, 'wallet-ready': C.WalletReady,
  restore: R.RestoreSeed, 'custom-seed': R.CustomSeed, 'restore-key': R.RestoreKey, 'check-master': R.CheckMasterKey, 'check-keys': R.CheckSingleKeys,
};
const WALLET = {
  main: H.Main, seed: H.Seed, settings: H.Settings, wordlist: H.WordList, lastword: H.LastWord, 'check-address': H.CheckAddress, 'check-passphrase': T.CheckPassphrase, 'text-qr': T.TextQr, hash: T.HashTool, secp256k1: T.Secp256k1Tool,
  addresses: A.Addresses, 'address-help': A.AddressHelp, 'edit-path': A.EditPath, address: A.AddressDetail, 'private-key': A.PrivateKey, 'sign-verify': A.SignVerify,
  source: S.SourceWallet, load: S.LoadTransaction, notpsbt: S.NotAPsbt, review: S.Review, 'signed-export': S.SignedExport, 'psbt-details': S.PsbtDetails, 'anti-exfil': AE.AntiExfil, 'anti-exfil-msg': AE.AntiExfil,
  signed: L.Signed,
};

function App() {
  const route = useRoute();
  const st = useStore();
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } };
    const leave = (e) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e) => {
      e.preventDefault(); setDrag(false);
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const s = getState();
      if (s.sheetDrop) s.sheetDrop(f);
      else if (s.pageDrop) s.pageDrop(f);
      else toast('Open an import button first, or drop a transaction on Sign transaction.');
    };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);
  let Screen = OPEN[route];
  if (!Screen && WALLET[route]) {
    if (!st.wallet) { setTimeout(() => go('welcome'), 0); return null; }
    Screen = WALLET[route];
  }
  if (!Screen) { setTimeout(() => go(st.wallet ? 'main' : 'welcome'), 0); return null; }
  return (
    <div class={drag ? 'dropzone-on' : ''}>
      <Screen key={route} />
      <Sheet />
      {st.toast && <div class="toast" role="status">{st.toast}</div>}
    </div>
  );
}

// A reload always starts empty, on the welcome screen.
if (location.hash && location.hash !== '#/welcome') history.replaceState(null, '', location.pathname + location.search + '#/welcome');
render(<App />, document.getElementById('app'));
