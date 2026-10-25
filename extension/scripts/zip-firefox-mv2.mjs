/**
 * Pack .output/firefox-mv2 into .output/firefox-mv2.zip (overwrite each run).
 * Invoked after `wxt build -b firefox` for AMO / manual upload.
 */
import { createZip } from '@aklinker1/zero-zip';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(extensionRoot, '.output', 'firefox-mv2');
const outZip = path.join(extensionRoot, '.output', 'firefox-mv2.zip');
const outXpi = path.join(extensionRoot, '.output', 'firefox-mv2.xpi');

async function main() {
  try {
    await access(sourceDir);
  } catch {
    console.error(`[zip-firefox-mv2] Missing build output: ${sourceDir}`);
    console.error('Run: npm run build:firefox (or wxt build -b firefox) first.');
    process.exit(1);
  }

  const files = await glob(['**/*'], {
    cwd: sourceDir,
    onlyFiles: true,
  });

  if (files.length === 0) {
    console.error(`[zip-firefox-mv2] No files in ${sourceDir}`);
    process.exit(1);
  }

  const archive = createZip({ level: 9 });
  for (const file of files.sort()) {
    const absolutePath = path.join(sourceDir, file);
    const content = await readFile(absolutePath);
    archive.addFile(file.replaceAll('\\', '/'), content);
  }

  const buffer = await archive.toBuffer();
  await writeFile(outZip, buffer);
  await writeFile(outXpi, buffer);
  console.log(`[zip-firefox-mv2] Wrote ${outZip} and ${outXpi} (${files.length} files)`);
}

main().catch((err) => {
  console.error('[zip-firefox-mv2]', err);
  process.exit(1);
});
