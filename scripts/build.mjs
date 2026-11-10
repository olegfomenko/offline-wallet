// Builds the four single-file apps into dist/: the app's JS and CSS inlined into one HTML file each.
//   npm ci             (once, installs esbuild)
//   npm run build
//
//   offline-signer.html     Full: everything
//   offline-addresses.html  Addresses: wallet, addresses, messages and raw hashes (no PSBT signing)
//   psbt-inspector.html     PSBT Inspector: review and assemble a PSBT, no private keys
//   offline-tools.html      Tools: hashes, curve, text to QR, BIP39 word list, last word
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

// Text that must not be in an app's bundle: it would mean code from another app came along.
const APPS = [
  { entry: 'src/apps/full.jsx', file: 'offline-signer.html', title: 'Offline Signer', absent: [] },
  { entry: 'src/apps/addresses.jsx', file: 'offline-addresses.html', title: 'Offline Signer · Addresses', absent: ['Approve & sign', 'Load transaction to sign', 'Which wallet made the transaction'] },
  { entry: 'src/apps/inspector.jsx', file: 'psbt-inspector.html', title: 'PSBT Inspector', absent: ['Create new wallet', 'Restore from seed', 'How signing works', 'Write down'] },
  { entry: 'src/apps/tools.jsx', file: 'offline-tools.html', title: 'Offline Signer · Tools', absent: ['Create new wallet', 'Approve & sign', 'Load transaction to sign', 'How signing works'] },
];

mkdirSync('dist', { recursive: true });
const sums = [];
for (const a of APPS) {
  const result = await esbuild.build({
    entryPoints: [a.entry],
    bundle: true, minify: true, write: false, format: 'iife', target: 'es2022', charset: 'utf8', legalComments: 'none',
    tsconfig: 'tsconfig.json',            // maps @noble/…, @scure/… etc. to vendor/
    jsxFactory: 'h', jsxFragment: 'Fragment',
    define: { __APP_VERSION__: JSON.stringify(version) },
  });
  // A "</script" or DEL character inside the code would break the inline <script>.
  const js = result.outputFiles[0].text.split('</script').join('<\\/script').split('\x7f').join('\\x7f');

  // These are wallets: refuse to build if any network API made it into a bundle.
  for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection', 'importScripts']) {
    if (js.includes(api)) throw new Error(a.file + ': network API in bundle: ' + api);
  }
  for (const text of a.absent) {
    if (js.includes(text)) throw new Error(a.file + ': code from another app in the bundle ("' + text + '")');
  }

  // The CSP allows exactly this script by its hash, so no other inline script (injected by an
  // extension, or by someone editing the file) can run on the page.
  const scriptSrc = "'sha256-" + createHash('sha256').update(js).digest('base64') + "'";

  const html = readFileSync('src/index.html', 'utf8')
    .replace('/*@@CSS@@*/', () => readFileSync('src/styles.css', 'utf8'))
    .replace('/*@@JS@@*/', () => js)
    .replace('{{SCRIPT_SRC}}', () => scriptSrc)
    .replaceAll('{{TITLE}}', a.title)
    .replaceAll('{{FILE}}', a.file)
    .replaceAll('{{VERSION}}', version);

  writeFileSync('dist/' + a.file, html);
  const sha = createHash('sha256').update(html).digest('hex');
  sums.push(sha + '  ' + a.file);
  console.log(`dist/${a.file.padEnd(23)} v${version}  ${String(Math.round(html.length / 1024)).padStart(3)} KB  sha256 ${sha}`);
}
writeFileSync('dist/SHA256SUMS', sums.join('\n') + '\n');
