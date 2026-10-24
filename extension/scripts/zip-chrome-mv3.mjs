/**
 * Pack .output/chrome-mv3 into .output/chrome-mv3.zip (overwrite each run).
 * Invoked after `wxt build` for Chrome store / manual upload.
 */
import { createZip } from '@aklinker1/zero-zip';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(extensionRoot, '.output', 'chrome-mv3');
const outZip = path.join(extensionRoot, '.output', 'chrome-mv3.zip');

async function main() {
  try {
    await access(sourceDir);
  } catch {
    console.error(`[zip-chrome-mv3] Missing build output: ${sourceDir}`);
    console.error('Run: npm run build (or wxt build) first.');
    process.exit(1);
  }

  const files = await glob(['**/*'], {
    cwd: sourceDir,
    onlyFiles: true,
  });

  if (files.length === 0) {
    console.error(`[zip-chrome-mv3] No files in ${sourceDir}`);
    process.exit(1);
  }

  const archive = createZip({ level: 9 });
  for (const file of files.sort()) {
    const absolutePath = path.join(sourceDir, file);
    const content = await readFile(absolutePath);
    archive.addFile(file.replaceAll('\\', '/'), content);
  }

  await writeFile(outZip, await archive.toBuffer());
  console.log(`[zip-chrome-mv3] Wrote ${outZip} (${files.length} files)`);
}

main().catch((err) => {
  console.error('[zip-chrome-mv3]', err);
  process.exit(1);
});
