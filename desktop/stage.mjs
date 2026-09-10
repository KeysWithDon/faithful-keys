import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const manifest = JSON.parse(await fs.readFile('desktop-assets/asset-manifest.json', 'utf8'));
if (manifest.length < 130) throw new Error('Offline sound pack is incomplete. Run pnpm desktop:assets.');
for (const sample of manifest) {
  const data = await fs.readFile(path.join('desktop-assets', sample.file));
  if (createHash('sha256').update(data).digest('hex') !== sample.sha256) throw new Error(`Audio checksum mismatch: ${sample.file}`);
}
const appDir = 'desktop-app';
await fs.rm(appDir, { recursive: true, force: true });
await fs.mkdir(appDir, { recursive: true });
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'faithful-keys-desktop', productName: 'Faithful Keys', version: pkg.version,
  description: 'Faithful Keys music learning and piano practice',
  author: 'Donovan Teasley', private: true, type: 'module', main: 'main.mjs',
}, null, 2));
await fs.cp('desktop-dist', path.join(appDir, 'web'), { recursive: true });
await fs.cp('desktop-assets/audio', path.join(appDir, 'web/audio'), { recursive: true });
await fs.copyFile('desktop-assets/asset-manifest.json', path.join(appDir, 'web/asset-manifest.json'));
await fs.copyFile('desktop/guide.html', path.join(appDir, 'web/desktop-guide.html'));
for (const file of ['main.mjs', 'security.mjs']) await fs.copyFile(`desktop/${file}`, path.join(appDir, file));
await fs.copyFile('THIRD_PARTY_NOTICES.md', path.join(appDir, 'THIRD_PARTY_NOTICES.md'));
// Reuse the existing app icon; do not invent a replacement brand mark.
await sharp('public/favicon.svg', { density: 2048 }).resize(1024, 1024).png().toFile('desktop-assets/icon.png');
await fs.copyFile('desktop-assets/icon.png', path.join(appDir, 'icon.png'));
// Include license texts from installed dependencies, including bundled browser code/fonts.
async function licensesIn(packageDir, destination) {
  let entries;
  try { entries = await fs.readdir(packageDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isFile() && /^(licen[sc]e|copying|notice|ofl)([._-]|$)/i.test(entry.name)) {
      await fs.mkdir(destination, { recursive: true });
      await fs.copyFile(path.join(packageDir, entry.name), path.join(destination, entry.name));
    }
  }
}
for (const item of await fs.readdir('node_modules/.pnpm', { withFileTypes: true })) {
  if (!item.isDirectory() || item.name === 'node_modules') continue;
  const modules = path.join('node_modules/.pnpm', item.name, 'node_modules');
  let entries;
  try { entries = await fs.readdir(modules, { withFileTypes: true }); } catch { continue; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(modules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of await fs.readdir(packageDir)) {
        await licensesIn(path.join(packageDir, scoped), path.join(appDir, 'licenses', entry.name, scoped));
      }
    } else await licensesIn(packageDir, path.join(appDir, 'licenses', entry.name));
  }
}
console.log('Desktop application staged with verified sounds, local fonts and license notices.');
