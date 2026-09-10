import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Run against the packaged executable on its native OS, never a mocked web page.
const executablePath = path.resolve(process.env.FK_DESKTOP_EXECUTABLE || process.argv[2] || '');
if (!process.env.FK_DESKTOP_EXECUTABLE && !process.argv[2]) throw new Error('Supply the packaged executable path.');
const report = { platform: process.platform, arch: process.arch, executable: path.basename(executablePath), checks: [] };
let app;
const start = async () => {
  app = await electron.launch({ executablePath, timeout: 60000 });
  await app.evaluate(({ session }) => {
    session.fromPartition('persist:faithful-keys').webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  });
  const page = await app.firstWindow();
  await page.goto('faithful-keys://app/');
  await page.getByRole('button', { name: 'Guided Mode', exact: true }).waitFor({ timeout: 30000 });
  return page;
};
try {
  let page = await start();
  const capabilities = await page.evaluate(async () => {
    await document.fonts.ready;
    const midi = await navigator.requestMIDIAccess({ sysex: false });
    let sysexDenied = false;
    try { await navigator.requestMIDIAccess({ sysex: true }); } catch { sysexDenied = true; }
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.resume();
    const manifest = await fetch('/asset-manifest.json').then(r => r.json());
    const selected = [manifest.find(f => f.file.endsWith('.ogg')),
      manifest.find(f => f.file.includes('/Basses/')), manifest.find(f => f.file.includes('/Horns/'))];
    const decoded = [];
    for (const sample of selected) {
      const response = await fetch('/' + sample.file.split('/').map(encodeURIComponent).join('/'));
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      decoded.push({ file: sample.file, seconds: buffer.duration });
    }
    const audioRunning = context.state === 'running';
    await context.close();
    return { secure: isSecureContext, noNode: typeof window.require === 'undefined' && typeof window.process === 'undefined',
      midiInputs: midi.inputs.size, sysexDenied, audioRunning, decoded,
      fontsReady: document.fonts.check('16px Manrope') && document.fonts.check('16px "Instrument Serif"'),
      sampleCount: manifest.length };
  });
  assert.ok(capabilities.secure && capabilities.noNode && capabilities.sysexDenied && capabilities.audioRunning && capabilities.fontsReady);
  assert.ok(capabilities.sampleCount > 130 && capabilities.decoded.every(f => f.seconds > 0));
  report.checks.push({ offlineCapabilities: capabilities });

  await page.getByRole('button', { name: 'Guided Mode', exact: true }).click();
  await page.getByRole('heading', { name: 'One faithful step at a time.' }).waitFor();
  const saved = await page.evaluate(() => localStorage.getItem('faithful-keys-learning-v1'));
  assert.equal(JSON.parse(saved).mode, 'guided');
  await app.close(); app = null;
  page = await start();
  await page.getByRole('heading', { name: 'One faithful step at a time.' }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('faithful-keys-learning-v1')).mode), 'guided');
  report.checks.push('Actual Guided Mode progress persisted through app shutdown and restart.');

  await page.getByRole('button', { name: 'Explore Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Ear Training', exact: true }).click();
  await page.getByRole('button', { name: /Hear It/ }).first().waitFor();
  report.checks.push('Explore Mode and lazy-loaded Ear Training open offline.');
  await page.goto('faithful-keys://app/desktop-guide.html');
  await page.getByRole('heading', { name: 'Faithful Keys on your desktop' }).waitFor();
  report.checks.push('Bundled desktop guide opens.');
  report.hardwareMidi = 'Web MIDI API and permission checks passed; physical USB/Bluetooth keyboards require a device test.';
  console.log(JSON.stringify(report, null, 2));
  await fs.mkdir('release', { recursive: true });
  await fs.writeFile(`release/verification-${process.platform}-${process.arch}.json`, JSON.stringify(report, null, 2));
} finally { if (app) await app.close(); }
