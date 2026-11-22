import fs from 'node:fs';
import path from 'node:path';

const source = path.join(import.meta.dirname, '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js');
const targetDir = path.join(import.meta.dirname, '..', 'public', 'vendor');
const target = path.join(targetDir, 'jsqr.js');

if (!fs.existsSync(source)) {
  console.error('找不到 node_modules/jsqr/dist/jsQR.js，請先 npm install');
  process.exit(1);
}
fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`✓ 已複製掃描器到 ${target}`);
