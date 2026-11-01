// scripts/generate-icons.mjs
// Builds PNG icons from public/icon.svg. Run: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const brandSrc = readFileSync('lib/brand.ts', 'utf8');
const bg = brandSrc.match(/themeColor:\s*'(#[0-9a-fA-F]{6})'/)[1];
const svg = readFileSync('public/icon.svg');

const targets = [
  { file: 'public/icon-192.png', size: 192, flat: false },
  { file: 'public/icon-512.png', size: 512, flat: false },
  { file: 'public/icon.png', size: 180, flat: true }, // apple-touch: no transparent corners
];

for (const { file, size, flat } of targets) {
  let img = sharp(svg, { density: 384 }).resize(size, size);
  if (flat) img = img.flatten({ background: bg });
  await img.png().toFile(file);
  console.log('Created', file);
}
