// Writes sample PSBTs for the BIP39 test seed "abandon … about" (fingerprint 73C5DA0A) to test/data/.
// Use them to try the signing screens:  npm run fixtures
// NEVER send real funds to this seed: it is public.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64 } from '../src/core/util.js';
import { buildPsbt } from './psbt-fixture.js';

const out = {
  'sample-clean.psbt': buildPsbt({}),
  'sample-taproot.psbt': buildPsbt({ type: 'tr' }),
  'sample-warnings.psbt': buildPsbt({ fee: 186000n, selfOut: true, lockTime: 1800000000 }),
  'sample-blocked.psbt': buildPsbt({ full: false, sighash: 2 }),
};
for (const [name, bytes] of Object.entries(out)) {
  writeFileSync(join(import.meta.dirname, 'data', name), bytes);
  writeFileSync(join(import.meta.dirname, 'data', name.replace('.psbt', '.b64.txt')), base64.encode(bytes) + '\n');
}
console.log('wrote', Object.keys(out).join(', '));
