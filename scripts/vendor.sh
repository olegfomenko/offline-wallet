#!/usr/bin/env bash
# Re-fetch vendored dependencies from their tagged upstream commits and check the commit hashes.
# Needs git and network access. Run from the repository root:  bash scripts/vendor.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fetch() { # folder repo tag commit paths...
  local name=$1 repo=$2 tag=$3 commit=$4; shift 4
  git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$TMP/$name"
  local got; got=$(git -C "$TMP/$name" rev-parse HEAD)
  [ "$got" = "$commit" ] || { echo "$name: tag $tag is $got, expected $commit" >&2; exit 1; }
  rm -rf "vendor/$name"; mkdir -p "vendor/$name"
  for p in "$@"; do mkdir -p "vendor/$name/$(dirname "$p")"; cp -r "$TMP/$name/$p" "vendor/$name/$p"; done
  cp "$TMP/$name"/LICENSE* "$TMP/$name/package.json" "vendor/$name/"
  find "vendor/$name" -name '*.d.ts' -delete
  echo "ok $name $tag $commit"
}

fetch noble-hashes paulmillr/noble-hashes 2.4.0 663c2aeeffc308ac0cded59bd32f7c212adacfc2 src
fetch noble-curves paulmillr/noble-curves 2.4.0 656c4364dffa44c64aa0c49914b8000b278b67a9 src
fetch noble-ciphers paulmillr/noble-ciphers 2.4.0 d9e8a6a599e7ed729d9be03854c46a3c73bd9a79 src
fetch scure-base paulmillr/scure-base 2.4.0 d93da4f8fbd7146c3af51c72d65945af72193a7c index.ts
fetch scure-bip32 paulmillr/scure-bip32 2.4.0 ab00d7f78d067422898fc0adb8a7ef740b79386a index.ts
fetch scure-bip39 paulmillr/scure-bip39 2.4.0 2c8cf46fb4da10ea715aa56fee846142a2c0fa80 src
fetch scure-btc-signer paulmillr/scure-btc-signer 2.4.1 373d2f3ed32478fcf52a088c14c769df3d29acb8 src
fetch micro-packed paulmillr/micro-packed 0.11.1 4cf227ad2f96b4f477469b95f6f64a134791b12c src
fetch qr paulmillr/qr 0.7.2 951806df842fb7c9214012a73b00e60b259243d3 src
fetch fflate 101arrowz/fflate v0.8.3 dcb3714a6c25db3a2748641019c5277413d09714 src
fetch preact preactjs/preact 10.29.8 389c7bcc5140566f3fbae73cf17edf4ab44f4d96 src hooks/src
rm -f vendor/scure-btc-signer/src/_type_test.ts vendor/micro-packed/src/_type_test.ts
cp vendor/fflate/src/worker.ts vendor/fflate/src/node-worker.ts
echo "done"
