// Builds dist/offline-signer.html: the app's JS and CSS inlined into one file.
//   npm ci             (once, installs esbuild)
//   npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const result = await esbuild.build({
  entryPoints: ['src/main.jsx'],
  bundle: true, minify: true, write: false, format: 'iife', target: 'es2022', charset: 'utf8', legalComments: 'none',
  tsconfig: 'tsconfig.json',            // maps @noble/…, @scure/… etc. to vendor/
  jsxFactory: 'h', jsxFragment: 'Fragment',
  define: { __APP_VERSION__: JSON.stringify(version) },
});
// A "</script" or DEL character inside the code would break the inline <script>.
const js = result.outputFiles[0].text.split('</script').join('<\\/script').split('\x7f').join('\\x7f');

// This is a wallet: refuse to build if any network API made it into the bundle.
for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'RTCPeerConnection']) {
  if (js.includes(api)) throw new Error('Network API in bundle: ' + api);
}

const html = readFileSync('src/index.html', 'utf8')
  .replace('/*@@CSS@@*/', () => readFileSync('src/styles.css', 'utf8'))
  .replace('/*@@JS@@*/', () => js)
  .replaceAll('{{VERSION}}', version);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/offline-signer.html', html);
const sha = createHash('sha256').update(html).digest('hex');
writeFileSync('dist/SHA256SUMS', sha + '  offline-signer.html\n');
console.log(`dist/offline-signer.html  v${version}  ${Math.round(html.length / 1024)} KB  sha256 ${sha}`);
