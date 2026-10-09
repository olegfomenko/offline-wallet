# Vendored dependencies

Every third-party module the app uses is copied here from a tagged upstream commit, so the build
needs no network and no npm registry. Only each project's `src/` (or `index.ts`), `LICENSE` and
`package.json` are kept. Tests, benchmarks and `.d.ts` files were removed.

Imports such as `@noble/curves/secp256k1.js` resolve to these folders through the `paths` map in
`../tsconfig.json`.

| Folder | Upstream | Tag | Commit | License |
|---|---|---|---|---|
| noble-hashes | github.com/paulmillr/noble-hashes | 2.4.0 | 663c2aeeffc308ac0cded59bd32f7c212adacfc2 | MIT |
| noble-curves | github.com/paulmillr/noble-curves | 2.4.0 | 656c4364dffa44c64aa0c49914b8000b278b67a9 | MIT |
| noble-ciphers | github.com/paulmillr/noble-ciphers | 2.4.0 | d9e8a6a599e7ed729d9be03854c46a3c73bd9a79 | MIT |
| scure-base | github.com/paulmillr/scure-base | 2.4.0 | d93da4f8fbd7146c3af51c72d65945af72193a7c | MIT |
| scure-bip32 | github.com/paulmillr/scure-bip32 | 2.4.0 | ab00d7f78d067422898fc0adb8a7ef740b79386a | MIT |
| scure-bip39 | github.com/paulmillr/scure-bip39 | 2.4.0 | 2c8cf46fb4da10ea715aa56fee846142a2c0fa80 | MIT |
| scure-btc-signer | github.com/paulmillr/scure-btc-signer | 2.4.1 | 373d2f3ed32478fcf52a088c14c769df3d29acb8 | MIT |
| micro-packed | github.com/paulmillr/micro-packed | 0.11.1 | 4cf227ad2f96b4f477469b95f6f64a134791b12c | MIT |
| qr | github.com/paulmillr/qr | 0.7.2 | 951806df842fb7c9214012a73b00e60b259243d3 | MIT / Apache-2.0 |
| fflate | github.com/101arrowz/fflate | v0.8.3 | dcb3714a6c25db3a2748641019c5277413d09714 | MIT |
| preact | github.com/preactjs/preact | 10.29.8 | 389c7bcc5140566f3fbae73cf17edf4ab44f4d96 | MIT |

There is one local change. `fflate/src/node-worker.ts` is a copy of the upstream `worker.ts`, the
browser variant, so the bundle never references Node's `worker_threads`. The app only calls the
synchronous `Inflate` stream, so no worker is ever created. The CSP also sets `worker-src 'none'`.

## Verify against upstream

```sh
git clone --depth 1 --branch 2.4.0 https://github.com/paulmillr/noble-curves /tmp/nc
diff -r /tmp/nc/src vendor/noble-curves/src     # expect: only the removed .d.ts files, if any
```

Do the same for each row. `scripts/vendor.sh` re-fetches all of them.
