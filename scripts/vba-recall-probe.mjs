/**
 * Recall probe — measure edge counts on the REAL Dysflow fixtures.
 *
 * Usage (from the repo root, with build artifacts in dist/):
 *   node --import tsx scripts/vba-recall-probe.mjs
 *
 * Or via npx:
 *   npx tsx scripts/vba-recall-probe.mjs
 *
 * Reports per-file counts of:
 *   - nodes by kind
 *   - edges by kind + by provenance
 *   - edge kinds × metadata.synthesizedBy
 *   - per-proc node startLine/endLine span
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const repoRoot = process.cwd();
const FIXTURES_DIR = path.join(repoRoot, '__tests__', 'fixtures', 'vba');

async function main() {
  // Use the BUILT extractors from dist/. Fall back to source via tsx if dist is
  // missing. Both paths use the same extractor entry points.
  const distDir = path.join(repoRoot, 'dist', 'extraction');
  const useDist = fs.existsSync(path.join(distDir, 'vba-extractor.js'));
  const base = useDist ? distDir : path.join(repoRoot, 'src', 'extraction');
  const mod = await import(pathToFileURL(path.join(base, 'vba-extractor.js')).href);
  const modForm = await import(pathToFileURL(path.join(base, 'vba-form-extractor.js')).href);
  const { VbaExtractor } = mod;
  const { VbaFormExtractor } = modForm;

  const fixtures = collectFixtures(FIXTURES_DIR);
  if (fixtures.length === 0) {
    console.error(`No fixtures under ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const grand = {
    nodes: 0,
    edges: 0,
    byNodeKind: new Map(),
    byEdgeKind: new Map(),
    bySynthesizedBy: new Map(),
    byProvenance: new Map(),
    endLineEqualsStartLine: 0,
    procsWithBody: 0,
    procsTotal: 0,
  };

  for (const fix of fixtures) {
    const src = fs.readFileSync(fix.absPath, 'utf8');
    const Extractor = fix.isFormFile ? VbaFormExtractor : VbaExtractor;
    const r = new Extractor(fix.absPath, src).extract();

    console.log(`\n## ${path.relative(repoRoot, fix.absPath)}`);
    console.log(`   nodes: ${r.nodes.length}  edges: ${r.edges.length}  unresolvedRefs: ${r.unresolvedReferences.length}  errors: ${r.errors.length}`);

    const byKind = countBy(r.nodes, (n) => n.kind);
    console.log(`   nodes by kind:`, Object.fromEntries(byKind));

    const byEdge = countBy(r.edges, (e) => e.kind);
    console.log(`   edges by kind:`, Object.fromEntries(byEdge));

    const bySynth = countBy(r.edges, (e) => e.metadata?.synthesizedBy ?? '(none)');
    console.log(`   edges by synthesizedBy:`, Object.fromEntries(bySynth));

    const byProv = countBy(r.edges, (e) => e.provenance ?? '(none)');
    console.log(`   edges by provenance:`, Object.fromEntries(byProv));

    // For procs: how many have a body span (endLine > startLine)?
    for (const n of r.nodes) {
      if (n.kind === 'function') {
        grand.procsTotal++;
        if (n.startLine === n.endLine) grand.endLineEqualsStartLine++;
        else grand.procsWithBody++;
      }
    }

    accumulate(grand, r);
  }

  console.log(`\n## Grand total`);
  console.log(`   nodes: ${grand.nodes}  edges: ${grand.edges}`);
  console.log(`   nodes by kind:`, Object.fromEntries(grand.byNodeKind));
  console.log(`   edges by kind:`, Object.fromEntries(grand.byEdgeKind));
  console.log(`   edges by synthesizedBy:`, Object.fromEntries(grand.bySynthesizedBy));
  console.log(`   edges by provenance:`, Object.fromEntries(grand.byProvenance));
  console.log(
    `   procs: total=${grand.procsTotal}, with_body=${grand.procsWithBody}, endLine==startLine=${grand.endLineEqualsStartLine}`,
  );
}

function collectFixtures(dir) {
  const out = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(bas|cls|frm|dsr|form\.txt|report\.txt)$/i.test(entry.name)) {
        out.push({
          absPath: p,
          isFormFile: /\.form\.txt$|\.report\.txt$/i.test(entry.name),
        });
      }
    }
  }
  walk(dir);
  return out;
}

function countBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function accumulate(grand, r) {
  grand.nodes += r.nodes.length;
  grand.edges += r.edges.length;
  for (const n of r.nodes) {
    grand.byNodeKind.set(n.kind, (grand.byNodeKind.get(n.kind) ?? 0) + 1);
  }
  for (const e of r.edges) {
    grand.byEdgeKind.set(e.kind, (grand.byEdgeKind.get(e.kind) ?? 0) + 1);
    grand.bySynthesizedBy.set(
      e.metadata?.synthesizedBy ?? '(none)',
      (grand.bySynthesizedBy.get(e.metadata?.synthesizedBy ?? '(none)') ?? 0) + 1,
    );
    grand.byProvenance.set(
      e.provenance ?? '(none)',
      (grand.byProvenance.get(e.provenance ?? '(none)') ?? 0) + 1,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
