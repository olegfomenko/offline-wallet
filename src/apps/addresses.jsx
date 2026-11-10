// Addresses app: create or restore a wallet, export xpubs and descriptors, sign or verify messages
// and raw hashes (the PSBT Inspector's input hashes), with anti-exfil. No PSBT signing.
import { boot } from '../ui/boot.jsx';
import * as I from '../ui/icons.jsx';
import * as C from '../ui/screens/create.jsx';
import * as R from '../ui/screens/restore.jsx';
import * as H from '../ui/screens/home.jsx';
import * as A from '../ui/screens/addresses.jsx';
import * as L from '../ui/screens/logs.jsx';
import * as T from '../ui/screens/tools.jsx';
import * as AE from '../ui/screens/antiexfil.jsx';

boot({
  id: 'addresses', name: 'Offline Signer · Addresses', sub: 'Addresses', start: 'welcome', home: 'main',
  features: ['wallet'],
  nav: [
    ['main', 'Home', I.IHome, ['main']],
    ['addresses', 'Addresses', I.IList, ['addresses', 'address-help', 'edit-path', 'address', 'private-key', 'sign-verify', 'anti-exfil-msg']],
    ['signed', 'Signed', I.ISigned, ['signed']],
    ['seed', 'Seed', I.ILock, ['seed']],
    ['check-address', 'Check an address', I.IFind, ['check-address']],
    ['check-passphrase', 'Check passphrase', I.IKeyCheck, ['check-passphrase']],
  ],
  open: {
    welcome: C.Welcome, new: C.NewWallet, randomness: C.Randomness, 'add-randomness': C.AddRandomness,
    'write-seed': C.WriteSeed, 'check-backup': C.CheckBackup, passphrase: C.Passphrase, 'wallet-ready': C.WalletReady,
    restore: R.RestoreSeed, 'custom-seed': R.CustomSeed, 'restore-key': R.RestoreKey, 'check-master': R.CheckMasterKey, 'check-keys': R.CheckSingleKeys,
  },
  wallet: {
    main: H.Main, seed: H.Seed, 'check-address': H.CheckAddress, 'check-passphrase': T.CheckPassphrase,
    addresses: A.Addresses, 'address-help': A.AddressHelp, 'edit-path': A.EditPath, address: A.AddressDetail, 'private-key': A.PrivateKey, 'sign-verify': A.SignVerify,
    'anti-exfil-msg': AE.AntiExfil,
    signed: L.Signed,
  },
});
