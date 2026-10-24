import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const en = JSON.parse(readFileSync(resolve(root, 'src/locales/en.json'), 'utf8'));
const de = JSON.parse(readFileSync(resolve(root, 'src/locales/de.json'), 'utf8'));

const enKeys = flattenKeys(en);
const deKeys = flattenKeys(de);

const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
const missingInEn = deKeys.filter((k) => !enKeys.includes(k));

if (missingInDe.length || missingInEn.length) {
  console.error('Locale key mismatch:');
  if (missingInDe.length) console.error('  missing in de.json:', missingInDe);
  if (missingInEn.length) console.error('  missing in en.json:', missingInEn);
  process.exit(1);
}

console.log(`Locale keys OK (${enKeys.length} keys)`);
