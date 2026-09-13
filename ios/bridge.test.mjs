import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./FaithfulKeys/midi-bridge.js', import.meta.url), 'utf8');
function bridge(overrides = {}) {
  const sent = [];
  const document = { hidden: false, addEventListener() {} };
  const context = { navigator: {}, location: { protocol: 'faithful-keys:', host: 'app' }, document,
    performance: { now: () => 1000 }, DOMException, Uint8Array, setTimeout, clearTimeout,
    webkit: { messageHandlers: { faithfulKeys: { postMessage: message => sent.push(message) } } }, ...overrides };
  context.window = context; context.top = context;
  vm.runInNewContext(source, context);
  return { context, sent, receive: message => context.__faithfulKeysReceive(message) };
}
async function connect(b) {
  const promise = b.context.navigator.requestMIDIAccess();
  const id = b.sent.at(-1).id;
  b.receive({ type: 'devices', id, inputs: [{ id: '12', name: 'Piano' }] });
  return { access: await promise, id };
}
test('native MIDI is restricted to the bundled origin and rejects SysEx', async () => {
  assert.equal(bridge({ location: { protocol: 'https:', host: 'example.com' } }).context.navigator.requestMIDIAccess, undefined);
  assert.equal(bridge({ webkit: {} }).context.navigator.requestMIDIAccess, undefined);
  const b = bridge();
  await assert.rejects(b.context.navigator.requestMIDIAccess({ sysex: true }), { name: 'NotSupportedError' });
  assert.equal(b.sent.length, 0);
});
test('notes preserve channel, velocity-zero releases and timing; device changes preserve handlers', async () => {
  const b = bridge(); const { access, id } = await connect(b);
  const input = access.inputs.get('12'); const notes = [];
  input.onmidimessage = event => notes.push(event);
  b.receive({ type: 'devices', id, inputs: [{ id: '12', name: 'Renamed piano' }, { id: '13', name: 'Other keyboard' }] });
  assert.equal(access.inputs.get('12'), input);
  b.receive({ type: 'messages', id, now: 5000, events: [{ id: '12', data: [0x92, 60, 100], at: 4990 }, { id: '12', data: [0x92, 60, 0], at: 4995 }] });
  assert.deepEqual([...notes[0].data], [0x92, 60, 100]);
  assert.equal(notes[0].timeStamp, 990); assert.equal(notes[1].timeStamp, 995);
  let changes = 0; access.onstatechange = () => changes++;
  b.receive({ type: 'devices', id, inputs: [] });
  assert.equal(input.state, 'disconnected'); assert.equal(access.inputs.size, 0); assert.equal(changes, 1);
});
test('disable cancels an outstanding request and ignores delayed native messages', async () => {
  const b = bridge(); const pending = b.context.navigator.requestMIDIAccess();
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  const staleID = b.sent[0].id;
  b.context.faithfulKeysIOS.disconnect(); await cancelled;
  const { access, id } = await connect(b); const notes = [];
  access.inputs.get('12').onmidimessage = event => notes.push(event);
  b.receive({ type: 'devices', id: staleID, inputs: [] });
  b.receive({ type: 'messages', id: staleID, events: [{ id: '12', data: [144, 60, 127], at: 1 }], now: 1 });
  assert.equal(access.inputs.size, 1); assert.equal(notes.length, 0);
  b.context.document.hidden = true;
  b.receive({ type: 'messages', id, events: [{ id: '12', data: [144, 60, 127], at: 1 }], now: 1 });
  assert.equal(notes.length, 0);
  b.context.faithfulKeysIOS.disconnect();
  assert.deepEqual([...notes[0].data], [176, 123, 0]);
});
test('save shares exact JSON and reports native cancellation or failure', async () => {
  const b = bridge();
  const content = JSON.stringify({ format: 'faithful-keys-progression', progression: [{ chord: 'Cmaj7', beats: 4 }] });
  const saved = b.context.faithfulKeysIOS.saveProgression('my-song.json', content);
  assert.equal(b.sent[0].text, content);
  b.receive({ type: 'saved', completed: true }); assert.equal(await saved, true);
  const cancelled = b.context.faithfulKeysIOS.saveProgression('song.json', content);
  b.receive({ type: 'saved', completed: false }); assert.equal(await cancelled, false);
  const failed = b.context.faithfulKeysIOS.saveProgression('song.json', content);
  b.receive({ type: 'saved', error: 'No disk space' }); await assert.rejects(failed, /No disk space/);
});
