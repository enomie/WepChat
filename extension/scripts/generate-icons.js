/**
 * Rasterize public/icon/logo.svg to manifest PNG sizes.
 * Green artwork only, transparent background (fit inside square, centered).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public/icon/logo.svg');
const outDir = join(root, 'public/icon');
const sizes = [16, 32, 48, 96, 128];

/** Raster width before downscale (keeps edges crisp at 16px) */
const MASTER_WIDTH = 1024;

const svg = readFileSync(svgPath, 'utf8');

for (const size of sizes) {
  const out = join(outDir, `${size}.png`);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: MASTER_WIDTH },
    background: 'transparent',
  });
  const tmp = join(tmpdir(), `wepchat-icon-${size}-${process.pid}.png`);
  writeFileSync(tmp, resvg.render().asPng());

  const filter = size <= 32 ? 'Point' : 'Lanczos';
  execFileSync(
    'magick',
    [
      tmp,
      '-trim',
      '+repage',
      '-filter',
      filter,
      '-resize',
      `${size}x${size}`,
      '-gravity',
      'center',
      '-background',
      'none',
      '-extent',
      `${size}x${size}`,
      out,
    ],
    { stdio: 'inherit' },
  );
  unlinkSync(tmp);
  console.log(`wrote ${out} (${filter}, trim + fit ${size}px, transparent)`);
}
