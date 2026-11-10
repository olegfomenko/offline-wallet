// Tools: offline helpers that need no wallet and keep nothing.
import { boot } from '../ui/boot.jsx';
import * as I from '../ui/icons.jsx';
import * as T from '../ui/screens/tools.jsx';
import * as H from '../ui/screens/home.jsx';

boot({
  id: 'tools', name: 'Offline Signer · Tools', sub: 'Tools', start: 'tools', home: 'tools',
  features: [],
  nav: [
    ['tools', 'Tools home', I.IGrid, ['tools']],
    ['text-qr', 'Text to QR', I.IQrCode, ['text-qr']],
    ['hash', 'SHA-256 · SHA-512', I.IHash, ['hash']],
    ['secp256k1', 'secp256k1 calculator', I.ICurve, ['secp256k1']],
    ['wordlist', 'BIP39 word list', I.IWords, ['wordlist']],
    ['lastword', 'Find the last word', I.ILastWord, ['lastword']],
  ],
  open: {
    tools: T.ToolsHome, 'text-qr': T.TextQr, hash: T.HashTool, secp256k1: T.Secp256k1Tool, wordlist: H.WordList, lastword: H.LastWord,
  },
});
