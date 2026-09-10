import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const files = (await fs.readdir('release')).filter(name => /\.(dmg|zip|exe|json)$/.test(name) && !name.startsWith('builder'));
const lines = [];
for (const file of files.sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join('release', file))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await fs.writeFile(`release/SHA256SUMS-${process.platform}-${process.arch}.txt`, lines.join('\n') + '\n');
