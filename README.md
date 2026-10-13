# Offline Signer

An offline, single-sig Bitcoin signer that compiles to **one self-contained HTML file**
(`offline-signer.html`, about 500 KB), published at
<https://olegfomenko.github.io/offline-wallet/>. Download it, then open it from a USB stick on a
computer that never goes online. It creates or restores a wallet, exports the xpub or descriptor to a watch-only wallet, and
signs PSBTs that arrive by QR, text or file. Nothing is saved: the wallet lives only in the open tab.

The UI follows the *Offline Bitcoin Wallet · Web* design canvas (Blockstream Blueprint styling) and
implements all 34 screens. The build approach follows
[EntropyLab](https://github.com/OogaBoogaX/entropylab): sources in `src/`, everything inlined into one
file, and a strict Content-Security-Policy with no network access.

> **Experimental software.** It was tested against published test vectors and reviewed for PSBT
> attacks, but it has not had a professional audit. Try it with small amounts and a test wallet first.

## Use

1. Download `offline-signer.html` and `SHA256SUMS` from
   <https://olegfomenko.github.io/offline-wallet/>, or build it yourself (see Build).
   `shasum -a 256 offline-signer.html` must match `SHA256SUMS`. Building from source gives the same
   hash.
2. Copy it to the offline computer. Open it in a private window with extensions off. Don't use the
   copy on the website for real keys; its welcome screen flags it as opened from a website.
3. **Create** (12/24 words, optional dice, coins or drawing) or **Restore** from BIP39 words, custom
   (non-BIP39) words, a master key (xprv/yprv/zprv/tprv or a private descriptor) or single keys
   (WIF, Electrum `p2wpkh:`, hex, BIP38).
4. **Addresses**: export the xpub, zpub or descriptor to your watch-only wallet (Sparrow, Electrum,
   BlueWallet, Nunchuk…).
5. **Sign transaction**: scan, paste, load or drop the PSBT. Check the review, sign, then send the
   result back as UR, BBQr, Base64 or Base43 QR, or as a `.psbt` file.

Every value works the same way. Outputs have an export button (QR · Copy · Download QR · Download
file). Inputs have an import button (Type · Paste · Scan QR · QR image · File). Private values stay
hidden until you reveal them.

Private fields (seed words, custom words, passphrase, private keys, BIP38 password) also have an
**on-screen keyboard**: click the keys instead of typing, so a keylogger on the computer records
nothing. Seed words get BIP39 suggestions and dimmed letters that no word continues with. **Shuffle
keys** mixes the key positions (from `crypto.getRandomValues`, new on every open). Hidden values show
as dots in the preview until you press Show. The physical keyboard keeps working alongside it.

## What a PSBT review checks

- **Input ownership.** The key is re-derived from the wallet and compared with the PSBT's pubkey and
  the previous output's script. A fingerprint alone is never trusted.
- **Input amounts.** These are proven from the full previous transaction (txid checked). SegWit v0
  and legacy inputs without it are reported as **missing data** and signing is blocked. Taproot
  inputs don't need it, because BIP341 commits to every amount.
- **Change.** An output counts as change only if its path re-derives to that exact script, it is on
  branch 1 of the same account and script type as the inputs, and its coin type matches the selected
  network. Any other output of this wallet must be confirmed as an "unusual path".
- **Blocked.** Signing is blocked for: non-ALL sighash, duplicate outpoints, a previous transaction
  that doesn't match, outputs larger than inputs, inputs from the other network, uncompressed keys,
  and PSBTs with no input of this wallet. When nothing matches, the review names the fingerprint the
  PSBT expects.
- **Must be confirmed one by one.** Fee above your limit (5% by default), fee rate above
  500 sat/vB, everything going to fee, payments to your own receive addresses, change at an index
  above 1000, and time-based locktimes.
- **Shown for information.** Block-height locktime, RBF, relative timelocks, inputs signed by
  someone else, and unknown PSBT fields (kept unchanged).
- **All-or-nothing signing.** Signing works on a copy of the PSBT. The result is kept only if every
  input of this wallet signs. If all inputs are signed, the final transaction hex and txid are shown
  too.

## Anti-exfil signing

A faulty or malicious signer could leak your key through the nonces in its signatures. Anti-exfil
signing ([Blockstream's protocol](https://blog.blockstream.com/anti-exfil-stopping-key-exfiltration/))
lets the host (your online wallet or a second device) mix its own randomness into every nonce. It sits
next to **Sign message** and **Approve & sign**, and works for ECDSA and Schnorr, messages and
transactions (one nonce per input of this wallet).

1. **Host commitment.** The host picks random data and gives only `c = SHA256(data)`, as hex or Base64.
2. **Signer nonce R.** The signer derives its nonce from the key, the message (or sighash) and `c`:
   RFC 6979 with `c` as extra data for ECDSA, BIP340 with `c` as aux data for Schnorr. It shows
   `R = k·G` (33 bytes compressed for ECDSA, 32 bytes x-only with even y for Schnorr) before it
   sees the data. The same commitment always gives the same R.
3. **Host data.** The host reveals the data (text, hex or Base64). Its SHA-256 must equal `c`.
4. **Final nonce.** The signature uses `k' = k + SHA256(R ‖ data) mod n`, so its nonce is
   `R' = R + SHA256(R ‖ data)·G`. The host checks `r == x(R') mod n` (ECDSA) or that the
   signature's first 32 bytes are `x(R')` (Schnorr). Every signature is also verified here before it
   is shown.

Retry a failed signing with the same data; it gives the same signature. A host that keeps asking
to start over with new data is suspicious. The commitment and tweak use plain SHA-256 as above,
not the tagged hashes of libsecp256k1-zkp's `ecdsa_s2c` module used by Jade, so a host must
follow these formulas.

## Cryptographic primitives and the libraries that provide them

All libraries are vendored from tagged upstream commits (see `vendor/VENDORED.md`). The `@noble` and
`@scure` libraries are Paul Miller's audited, dependency-free implementations, the same ones
EntropyLab uses as test oracles.

| Primitive | Used for | Library (module) | Standard |
|---|---|---|---|
| CSPRNG (`crypto.getRandomValues`) | Seed entropy (32 bytes XORed into the seed), BIP340 aux randomness, backup-check positions | Web Crypto API (browser) | — |
| SHA-256 / double SHA-256 | Entropy hashing, BIP39 checksum, Base58Check, txids, sighashes, message hash, UR RNG seeding | `@noble/hashes/sha2` | FIPS 180-4 |
| Tagged SHA-256 | Taproot tweak, BIP-322 message hash, BIP340 | `@noble/hashes` (+ `@noble/curves`, `@scure/btc-signer`) | BIP340/341/322 |
| HMAC-SHA512 | BIP32 child key derivation, master key from seed | `@noble/hashes/hmac` via `@scure/bip32` | RFC 2104, BIP32 |
| PBKDF2-HMAC-SHA512 (2048 rounds) | BIP39 seed from words and passphrase; custom words, Electrum-compatible | `@noble/hashes/pbkdf2` via `@scure/bip39`, and directly | RFC 8018, BIP39 |
| RIPEMD-160 (HASH160) | P2PKH, P2WPKH and P2SH hashes, BIP32 fingerprints | `@noble/hashes/legacy` | — |
| secp256k1 ECDSA, RFC 6979 nonces, low-S, low-R | Signing legacy, nested and native SegWit inputs; BIP-137 message signatures with public key recovery | `@noble/curves/secp256k1` (via `@scure/btc-signer` for PSBTs) | SEC 2, RFC 6979, BIP62/137 |
| Schnorr signatures | Taproot key-path signing; Schnorr message signatures | `@noble/curves/secp256k1` `schnorr` | BIP340 |
| SHA-256, SHA-512, secp256k1 point addition, doubling and scalar multiplication | Settings → Tools calculators | `@noble/hashes/sha2`, `@noble/curves/secp256k1` (via `calc.js`) | FIPS 180-4, SEC 2 |
| Anti-exfil nonces: SHA-256 commitment, RFC 6979 / BIP340 nonce with the commitment as extra data, tweak `R + SHA256(R‖data)·G`, signing with the tweaked nonce | Anti-exfil signing of messages and PSBT inputs | own (`antiexfil.js`) on `@noble/curves` (point and scalar math, HMAC-DRBG) and `@noble/hashes` | Blockstream anti-exfil, RFC 6979, BIP340 |
| Taproot output key tweak | P2TR addresses (BIP86), key-path signing | `@scure/btc-signer` on `@noble/curves` | BIP341/86 |
| BIP32 HD derivation | All keys, xpub/xprv | `@scure/bip32` | BIP32/44/49/84/86 |
| SLIP-132 version bytes | ypub/zpub/upub/vpub and their private keys | own (`src/core/hd.js`) | SLIP-132 |
| BIP39 wordlist and checksum | Mnemonics, word validation, finding the last word | `@scure/bip39` + own (`wallet.js`) | BIP39 |
| scrypt | BIP38 decryption (N=16384, r=8, p=8) | `@noble/hashes/scrypt` (`scryptAsync`) | RFC 7914, BIP38 |
| AES-256-ECB | BIP38 decryption, both modes | `@noble/ciphers/aes` | FIPS 197, BIP38 |
| secp256k1 scalar multiplication | BIP38 EC-multiply mode; public keys | `@noble/curves/secp256k1` | BIP38 |
| Base58Check | WIF, extended keys, legacy addresses | `@scure/base` | — |
| Bech32 / Bech32m | SegWit v0 and v1 addresses | `@scure/base` via `@scure/btc-signer` | BIP173/350 |
| Base64, hex, Base32 | PSBT text; BBQr | `@scure/base` | RFC 4648 |
| Base43 | Electrum's static QR | own (`transport.js`) | Electrum |
| PSBT v0/v2, sighash, finalization | Parse, sign, finalize, extract | `@scure/btc-signer` (+ `micro-packed`) | BIP174/370/143/341 |
| Output descriptor checksum | Descriptor export and parsing | own (`hd.js`) | BIP380 |
| CRC32, Xoshiro256\*\*, alias sampler, CBOR subset | UR fountain codes (animated QR) | own (`ur.js`), ported from the Blockchain Commons reference and checked against its test vectors | BCR-2020-005/006 |
| Raw DEFLATE (inflate only, with a size cap) | BBQr "Z" encoding | `fflate` | RFC 1951 |
| QR encode/decode (Reed–Solomon over GF(256)) | Every QR shown or scanned, SeedQR | `qr` (paulmillr) | ISO/IEC 18004 |

The UI is Preact 10. No other code runs. The build fails if the bundle contains `fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection` or
`importScripts`. The CSP (`connect-src 'none'`, `default-src 'none'`) blocks network access in any
case, and its `script-src` names the one inline script by its SHA-256 hash (filled in by the build),
so no other script, inline or injected, can run on the page.

## Build

Needs Node 22.18 or newer. The only package npm installs is esbuild. All runtime code is already in
`vendor/`.

```sh
npm ci             # once: installs esbuild exactly as pinned in package-lock.json
npm run build      # → dist/offline-signer.html and dist/SHA256SUMS
```

`dist/` is not committed. The build is reproducible: the same sources and esbuild version give a
byte-identical file, so you can rebuild and compare the hash with the published `SHA256SUMS`.

### CI and GitHub Pages

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, `npm test`, `npm run build`,
then a second build that must match the first byte for byte. It prints the SHA-256 in the log. On
`master` it publishes `index.html`, `offline-signer.html` and `SHA256SUMS` to GitHub Pages. Every
action is pinned to a full commit hash.

To turn Pages on once: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

`scripts/build.mjs` bundles `src/main.jsx` with esbuild, inlines the JS and CSS into
`src/index.html`, and writes the SHA-256. It refuses to build if a network API appears in the bundle.

## Test

```sh
npm test               # 61 tests on node:test: BIP32/39/44/49/84/86 vectors, SLIP-132, BIP380, WIF,
                       # BIP38, BIP-137/340 messages, UR (bc-ur reference vectors), BBQr (Coinkite's
                       # real scan), Base43, QR round trips, PSBT sign/finalize for all four script
                       # types, PSBT attack regressions, private-key restore round trips, and the
                       # on-screen keyboard logic (layouts, BIP39 letters and suggestions, shuffle),
                       # and anti-exfil signing (nonces match RFC 6979 / BIP340, host checks,
                       # BIP-137/340 messages, PSBTs of all four script types and mixed inputs),
                       # and the Settings calculators (SHA-256/512 vectors, secp256k1 point math)
npm run fixtures       # sample PSBTs for the public test seed "abandon … about" in test/data/
```

There are no automated UI tests. Test the UI by hand: open `dist/offline-signer.html` in a browser,
restore the test seed below, and load the sample PSBTs from `test/data/`.

The tests import the sources directly. Node strips the TypeScript types in the vendored files
itself, and `scripts/node-hooks.mjs` maps `@noble/…`, `@scure/…` and similar imports to `vendor/`,
using the same table as `tsconfig.json`.

The sample PSBTs in `test/data/sample-*.psbt` sign with the public test seed
`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`.
Never send funds to that seed.

## Layout

```
src/core/   wallet, hd (paths, SLIP-132, descriptors), keys (WIF, BIP38), entropy, message,
            psbt (review and signing), antiexfil (host-committed nonces), calc (SHA and secp256k1
            calculators), transport (formats, BBQr, Base43, pMofN), ur, search,
            encoding (text ↔ hex/Base64/UTF-8 bytes), util
src/ui/     store (in-memory state), router, kit (value-field pattern), sheet (export/import),
            io (QR, webcam, clipboard, files), kbd + Keyboard (on-screen keyboard),
            account (selected account and address → keys), screens/*
scripts/    build.mjs, node-hooks.mjs (test import mapping), vendor.sh
vendor/     pinned third-party sources (VENDORED.md)
test/       node:test tests, psbt-fixture (sample PSBT builder), fixtures in data/
```

## Known limits

- Single-sig only. There is no multisig or miniscript, and Taproot is key-path only.
- Uncompressed keys can be restored and viewed but not used to sign.
- Anti-exfil ECDSA signatures can't be ground to low-R (the nonce is fixed by the host's data), so
  about half of them are one byte longer than the fee estimate assumes.
- Webcam access from a `file://` page depends on the browser. Chrome and Edge ask for permission.
  When the camera isn't available, **QR image** and **File** still work.
- After a private copy, the clipboard is cleared once 60 seconds have passed and the tab has focus.
  Browsers don't allow writing to the clipboard from a background tab.
- JavaScript can't guarantee that secrets are erased from memory. Close the browser when you're
  done, and use a computer that never goes online.
- BBQr output uses Base32 without compression. All three encodings are read.
