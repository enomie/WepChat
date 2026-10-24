/**
 * SpacetimeDB CLI 2.0.x generate omits `accessor` on index defs; spacetimedb npm 2.13+ requires it.
 * Re-run after every `spacetime generate`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const indexPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/lib/spacetimedb/index.ts'
);

if (!fs.existsSync(indexPath)) {
  console.log('[patch-codegen] no index.ts, skipping.');
  process.exit(0);
}

let content = fs.readFileSync(indexPath, 'utf8');

// { name: 'col', algorithm: ... -> { accessor: 'col', name: 'col', algorithm: ...
const patched = content.replace(
  /(\{\s*)name: '([^']+)', algorithm: 'btree', columns: \[\s*'([^']+)',/g,
  (match, open, indexName, colName) => {
    if (match.includes('accessor:')) return match;
    const accessor = colName === indexName ? colName : indexName;
    return `${open}accessor: '${accessor}', name: '${indexName}', algorithm: 'btree', columns: [
        '${colName}',`;
  }
);

if (patched !== content) {
  fs.writeFileSync(indexPath, patched);
  console.log('[patch-codegen] added index accessors in spacetimedb/index.ts');
} else if (!content.includes("accessor: '")) {
  console.warn('[patch-codegen] index.ts unchanged — check generator output format.');
}
