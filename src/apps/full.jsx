// Full app: everything in one file. Create or restore a wallet, addresses and messages, PSBT
// signing (directly, or input by input for keys on another device) and the tools.
import { boot } from '../ui/boot.jsx';
import * as I from '../ui/icons.jsx';
import * as C from '../ui/screens/create.jsx';
import * as R from '../ui/screens/restore.jsx';
import * as H from '../ui/screens/home.jsx';
import * as A from '../ui/screens/addresses.jsx';
import * as S from '../ui/screens/signing.jsx';
import * as L from '../ui/screens/logs.jsx';
import * as T from '../ui/screens/tools.jsx';
import * as AE from '../ui/screens/antiexfil.jsx';

boot({
  id: 'full', name: 'Offline Signer', sub: 'Bitcoin · single-sig', start: 'welcome', home: 'main',
  features: ['wallet', 'psbt', 'settings'],
  dropHint: 'Open an import button first, or drop a transaction on Sign transaction.',
  nav: [
    ['main', 'Home', I.IHome, ['main']],
    ['source', 'Sign transaction', I.IScan, ['source', 'load', 'notpsbt', 'review', 'anti-exfil', 'sign-inputs', 'signed-export', 'psbt-details']],
    ['addresses', 'Addresses', I.IList, ['addresses', 'address-help', 'edit-path', 'address', 'private-key', 'sign-verify', 'anti-exfil-msg']],
    ['signed', 'Signed', I.ISigned, ['signed']],
    ['seed', 'Seed', I.ILock, ['seed']],
    ['settings', 'Settings', I.IGear, ['settings', 'wordlist', 'lastword', 'check-address', 'check-passphrase', 'text-qr', 'hash', 'secp256k1']],
  ],
  open: {
    welcome: C.Welcome, new: C.NewWallet, randomness: C.Randomness, 'add-randomness': C.AddRandomness,
    'write-seed': C.WriteSeed, 'check-backup': C.CheckBackup, passphrase: C.Passphrase, 'wallet-ready': C.WalletReady,
    restore: R.RestoreSeed, 'custom-seed': R.CustomSeed, 'restore-key': R.RestoreKey, 'check-master': R.CheckMasterKey, 'check-keys': R.CheckSingleKeys,
  },
  wallet: {
    main: H.Main, seed: H.Seed, settings: H.Settings, wordlist: H.WordList, lastword: H.LastWord, 'check-address': H.CheckAddress,
    'check-passphrase': T.CheckPassphrase, 'text-qr': T.TextQr, hash: T.HashTool, secp256k1: T.Secp256k1Tool,
    addresses: A.Addresses, 'address-help': A.AddressHelp, 'edit-path': A.EditPath, address: A.AddressDetail, 'private-key': A.PrivateKey, 'sign-verify': A.SignVerify,
    source: S.SourceWallet, load: S.LoadTransaction, notpsbt: S.NotAPsbt, review: S.Review, 'sign-inputs': S.SignInputs, 'signed-export': S.SignedExport, 'psbt-details': S.PsbtDetails,
    'anti-exfil': AE.AntiExfil, 'anti-exfil-msg': AE.AntiExfil,
    signed: L.Signed,
  },
});
