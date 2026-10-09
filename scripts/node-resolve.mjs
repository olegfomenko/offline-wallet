// Resolve hook registered by node-hooks.mjs. Reads the `paths` table from tsconfig.json.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { paths } = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')).compilerOptions;

// Try the path as is, then .ts for a .js import (TypeScript convention), then common extensions.
function findFile(p) {
  const tries = [p];
  if (p.endsWith('.js')) tries.push(p.slice(0, -3) + '.ts');
  tries.push(p + '.ts', p + '.js', join(p, 'index.ts'), join(p, 'index.js'));
  return tries.find((t) => existsSync(t) && !t.endsWith('/'));
}

function mapAlias(spec) {
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) {
      const base = key.slice(0, -1);
      if (spec.startsWith(base)) return join(root, target.slice(0, -1) + spec.slice(base.length));
    } else if (spec === key) return join(root, target);
  }
  return null;
}

// Everything under src/ and vendor/ is an ES module (some vendored package.json files don't say so).
const hit = (f) => ({ url: pathToFileURL(f).href, format: f.endsWith('.ts') ? 'module-typescript' : 'module', shortCircuit: true });

export async function resolve(spec, context, next) {
  const alias = mapAlias(spec);
  if (alias) {
    const f = findFile(alias);
    if (f) return hit(f);
  }
  if ((spec.startsWith('./') || spec.startsWith('../')) && context.parentURL && context.parentURL.startsWith('file:')) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(join(root, 'vendor')) || parent.startsWith(join(root, 'src'))) {
      const f = findFile(join(dirname(parent), spec));
      if (f) return hit(f);
    }
  }
  return next(spec, context);
}
