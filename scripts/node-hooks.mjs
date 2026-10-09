// Lets plain Node (22.18+, which strips TypeScript types itself) run the sources and tests
// directly: maps `@noble/…`, `@scure/…`, `qr`, `fflate`, `preact` to the vendored folders, using the
// same `paths` table as tsconfig.json, and resolves the vendored files' `.js` / extensionless imports.
//
//   node --import ./scripts/node-hooks.mjs --test test/
import { register } from 'node:module';

register('./node-resolve.mjs', import.meta.url);
