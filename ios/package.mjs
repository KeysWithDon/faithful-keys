import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = 'ios/package/FaithfulKeys-iPhone';
await fs.access('ios/FaithfulKeys/Web/index.html');
await fs.rm('ios/package', { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
for (const name of ['FaithfulKeys.xcodeproj', 'FaithfulKeys', 'Tests', 'UITests']) {
  await fs.cp(`ios/${name}`, `${root}/${name}`, { recursive: true, filter: path => !path.includes('xcuserdata') });
}
await fs.copyFile('ios/INSTALL.md', `${root}/START-HERE.md`);
await fs.copyFile('THIRD_PARTY_NOTICES.md', `${root}/THIRD_PARTY_NOTICES.md`);
await fs.writeFile(`${root}/BUILD.txt`, `Faithful Keys for iPhone\nSource: ${process.env.GITHUB_SHA || 'local working tree'}\nRequires Apple signing in Xcode. This is a ready-to-open project, not a signed IPA.\n`);
execFileSync('python3', ['-m', 'zipfile', '-c', '../FaithfulKeys-iPhone-Xcode.zip', 'FaithfulKeys-iPhone'], { cwd: 'ios/package' });
console.log('Created ios/FaithfulKeys-iPhone-Xcode.zip');
