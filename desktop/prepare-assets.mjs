import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ORCHESTRA_SAMPLE_MANIFEST } from '../app/sso-instruments.ts';

const root = path.resolve('desktop-assets');
await fs.mkdir(root, { recursive: true });
const smplr = await fs.readFile(fileURLToPath(import.meta.resolve('smplr')), 'utf8');
const pianoSource = smplr.slice(smplr.indexOf('var LAYERS = ['));
const pianoNames = [...new Set([...pianoSource.matchAll(/\[\d+, "([^"]+)"\]/g)].map(match => match[1]))];
if (pianoNames.length < 100) throw new Error('Grand piano manifest format changed; update the downloader before releasing.');
const grandRoot = 'https://raw.githubusercontent.com/smpldsnds/sfzinstruments-splendid-grand-piano/009793ebf849aee57f9a213aeaf8f2d1e2178f4f/samples';
const samples = [
  ...Object.values(ORCHESTRA_SAMPLE_MANIFEST).flat().map(sample => ({
    url: sample.file,
    file: 'audio/sso/' + decodeURIComponent(sample.file.split('/Samples/')[1]),
  })),
  ...pianoNames.map(name => ({ url: `${grandRoot}/${encodeURIComponent(name)}.ogg`, file: `audio/grand/${name}.ogg` })),
];

const manifest = [];
let next = 0;
async function worker() {
  while (next < samples.length) {
    const sample = samples[next++];
    const destination = path.join(root, sample.file);
    let data;
    try { data = await fs.readFile(destination); } catch { /* Download on the first build. */ }
    if (!data) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(sample.url, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`${response.status}: ${sample.url}`);
          data = Buffer.from(await response.arrayBuffer());
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
    }
    const signature = data.subarray(0, 4).toString();
    if (data.length < 100 || (sample.file.endsWith('.wav') ? signature !== 'RIFF' : signature !== 'OggS')) {
      throw new Error(`Invalid audio: ${sample.file}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, data);
    manifest.push({ ...sample, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    if (manifest.length % 25 === 0) console.log(`Bundled ${manifest.length}/${samples.length} audio files`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
manifest.sort((a, b) => a.file.localeCompare(b.file));
await fs.writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Offline audio ready: ${manifest.length} files, ${Math.round(manifest.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024)} MB`);
