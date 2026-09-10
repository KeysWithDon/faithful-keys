import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { APP_URL, allowPermission, externalLink, isAppUrl, resolveAsset } from './security.mjs';

test('asset protocol only serves files inside the bundled web root', () => {
  const root = path.resolve('desktop-app/web');
  assert.equal(resolveAsset(root, APP_URL), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, APP_URL + 'audio/grand/PP%20C%232.ogg'), path.join(root, 'audio/grand/PP C#2.ogg'));
  for (const value of [APP_URL + '%2e%2e%2fpackage.json', APP_URL + '%5c..%5csecret', APP_URL + '%00', APP_URL + '%broken', 'file:///etc/passwd', 'faithful-keys://other/index.html', 'faithful-keys://user@app/']) {
    assert.equal(resolveAsset(root, value), null, value);
  }
});
test('only the trusted top-level application can use MIDI; SysEx and unrelated permissions stay denied', () => {
  assert.equal(allowPermission('midi', APP_URL, APP_URL), true);
  for (const permission of ['midiSysex', 'media', 'geolocation', 'hid', 'serial']) assert.equal(allowPermission(permission, APP_URL, APP_URL), false);
  assert.equal(allowPermission('midi', 'https://example.com', APP_URL), false);
  assert.equal(allowPermission('midi', APP_URL, 'https://example.com'), false);
  assert.equal(allowPermission('midi', APP_URL, APP_URL, false), false);
  assert.equal(isAppUrl('faithful-keys://app.evil/'), false);
});
test('external navigation never opens files, executable protocols, or lookalike hosts', () => {
  assert.equal(externalLink('https://github.com/KeysWithDon/faithful-keys/releases'), 'https://github.com/KeysWithDon/faithful-keys/releases');
  for (const value of ['file:///tmp/test', 'javascript:alert(1)', 'ms-settings:test', 'https://github.com.evil/', 'https://evil@github.com/']) assert.equal(externalLink(value), null);
});
