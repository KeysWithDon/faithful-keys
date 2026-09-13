import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const root = 'ios/FaithfulKeys';
const web = `${root}/Web`;
const manifest = JSON.parse(await fs.readFile('desktop-assets/asset-manifest.json', 'utf8'));
if (manifest.length < 130) throw new Error('Run pnpm desktop:assets to prepare the complete offline sound pack.');
await fs.rm(web, { recursive: true, force: true });
await fs.cp('ios-dist', web, { recursive: true });
for (const sample of manifest) {
  const source = path.join('desktop-assets', sample.file);
  const data = await fs.readFile(source);
  if (createHash('sha256').update(data).digest('hex') !== sample.sha256) throw new Error(`Audio checksum mismatch: ${sample.file}`);
  const destination = path.join(web, sample.file.replace(/\.ogg$/, '.m4a'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (sample.file.endsWith('.ogg')) {
    // AAC is supported by every targeted iOS version, unlike Ogg/Vorbis.
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c:a', 'aac', '-b:a', '192k', destination]);
  } else await fs.copyFile(source, destination);
}
await fs.copyFile('THIRD_PARTY_NOTICES.md', `${web}/THIRD_PARTY_NOTICES.md`);
// Include the licenses for the packages actually shipped in the browser bundle.
for (const pkg of ['react', 'react-dom', 'smplr', '@fontsource/manrope', '@fontsource/dm-mono', '@fontsource/instrument-serif']) {
  const packageRoot = path.join('node_modules', pkg);
  for (const name of await fs.readdir(packageRoot)) {
    if (!/^(licen[sc]e|copying|notice|ofl)([._-]|$)/i.test(name)) continue;
    const destination = path.join(web, 'licenses', pkg, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(packageRoot, name), destination);
  }
}
const icons = `${root}/Assets.xcassets/AppIcon.appiconset`;
await fs.mkdir(icons, { recursive: true });
await sharp('public/favicon.svg', { density: 2048 }).resize(1024, 1024).flatten({ background: '#102535' }).png().toFile(`${icons}/AppIcon.png`);
await fs.writeFile(`${icons}/Contents.json`, JSON.stringify({ images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2));
await fs.writeFile(`${root}/Assets.xcassets/Contents.json`, JSON.stringify({ info: { author: 'xcode', version: 1 } }));
console.log(`iPhone resources ready: ${manifest.length} bundled samples, fonts, icon, and license notices.`);
