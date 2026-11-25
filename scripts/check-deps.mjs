// Checks the dependency rules of docs/specs/architecture.md §2 (no tooling needed):
//   lib → state → components → features, one way only; features use each other only through index.ts;
//   only src/main.tsx loads features; the key vault does not depend on the app.
// Tests are exempt (they may wire features together). Exit code 1 when a rule is broken.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const isTest = (f) => /\.test\.tsx?$/.test(f);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const RULES = [
  { name: 'lib-is-independent', from: /^src\/lib\//, to: /^src\/(state|components|features)\//, why: 'lib/ is pure logic and storage' },
  { name: 'state-has-no-ui', from: /^src\/state\//, to: /^src\/(components|features)\//, why: 'state/ must not import UI or features' },
  { name: 'core-ui-knows-no-feature', from: /^src\/components\//, to: /^src\/features\//, why: 'core components use components/extensions.ts instead' },
  { name: 'only-the-entry-loads-features', from: /^src\/(?!features\/|main\.tsx$)/, to: /^src\/features\//, why: 'features are loaded from src/features/index.ts by main.tsx' },
  { name: 'vault-is-separate', from: /^vault\//, to: /^src\/(state|components|features)\//, why: 'the key vault page must not depend on the app' }
];

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'vault'))].filter((f) => !isTest(f));
const problems = [];
let edges = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const from = rel(file);
  const specs = [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
  for (const spec of specs) {
    const target = resolveImport(file, spec);
    if (!target) continue;
    edges++;
    const to = rel(target);
    for (const r of RULES) if (r.from.test(from) && r.to.test(to)) problems.push(`${r.name}: ${from} → ${to} (${r.why})`);
    // A feature may use another feature only through that feature's index.ts
    const a = /^src\/features\/([^/]+)\//.exec(from);
    const b = /^src\/features\/([^/]+)\/(.+)$/.exec(to);
    if (a && b && a[1] !== b[1] && !/^index\.tsx?$/.test(b[2])) problems.push(`features-use-public-api: ${from} → ${to} (use src/features/${b[1]}/index.ts)`);
  }
}

if (problems.length) {
  console.error(`Dependency rules broken (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Dependency rules OK (${files.length} files, ${edges} imports checked)`);
