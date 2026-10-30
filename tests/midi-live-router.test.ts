import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveMidiRouter } from '../app/midi/live-router.ts';
import { MidiManager } from '../app/midi/manager.ts';

function mockPort(id = 'mac-bluetooth') {
  const sent: number[][] = [];
  let cleared = 0;
  const output = {
    id, name: 'Mac Bluetooth MIDI', state: 'connected' as 'connected' | 'disconnected',
    send(data: number[]) { sent.push([...data]); },
    clear() { cleared++; },
  };
  return { output, sent, get cleared() { return cleared; } };
}

function mockInput(id = 'longeye-usb') {
  return { id, name: 'Longeye Fold Pro II', state: 'connected' as 'connected' | 'disconnected', onmidimessage: null };
}

function accessWith(input: ReturnType<typeof mockInput>, output: ReturnType<typeof mockPort>['output']) {
  return { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null } as unknown as MIDIAccess;
}

test('live MIDI routing is opt-in, and input and output remain independently selected', async () => {
  const input = mockInput(), destination = mockPort(), midi = new MidiManager();
  await midi.connect(async () => accessWith(input, destination.output));
  assert.equal(midi.getSnapshot().selected, input.id);
  midi.selectOutput(destination.output.id);
  midi.receive([0x90, 60, 101], 10);
  assert.deepEqual(destination.sent, []); // No accidental feedback.
  midi.setLiveThru(true);
  midi.receive([0x91, 64, 103], 20);
  midi.receive([0x81, 64, 0], 30);
  assert.deepEqual(destination.sent, [[0x90, 64, 103], [0x80, 64, 0]]);
  assert.equal(midi.getSnapshot().selectedOutput, destination.output.id);
  assert.equal(midi.getSnapshot().liveThru, true);
  midi.disable();
});

test('live routing maps all source channels to chosen receiving channel, including sustain', async () => {
  const input = mockInput(), dest = mockPort(), midi = new MidiManager();
  await midi.connect(async () => accessWith(input, dest.output));
  midi.selectOutput(dest.output.id); midi.setOutputChannel(5); midi.setLiveThru(true);
  midi.receive([0x93, 48, 127], 1);
  midi.receive([0xb3, 64, 127], 2);
  midi.receive([0x83, 48, 0], 3);
  midi.receive([0xb3, 64, 0], 4);
  assert.deepEqual(dest.sent, [
    [0x94, 48, 127], [0xb4, 64, 127], [0x84, 48, 0], [0xb4, 64, 0],
  ]);
  midi.disable();
});

test('changing MIDI output or input safely releases routed notes and pedal', async () => {
  const input1 = mockInput(), input2 = mockInput('other-usb'), dest = mockPort(), midi = new MidiManager();
  const access = accessWith(input1, dest.output);
  (access.inputs as Map<string, typeof input1>).set(input2.id, input2);
  await midi.connect(async () => access);
  midi.selectOutput(dest.output.id); midi.setLiveThru(true);
  midi.receive([0x90, 60, 88], 1); midi.receive([0xb0, 64, 127], 2);
  midi.select(input2.id);
  assert.deepEqual(dest.sent.slice(-3), [[0xb0, 64, 0], [0x80, 60, 0], [0xb0, 123, 0]]);
  midi.receive([0x90, 67, 99], 3);
  midi.setLiveThru(false);
  assert.deepEqual(dest.sent.slice(-3), [[0xb0, 64, 0], [0x80, 67, 0], [0xb0, 123, 0]]);
  midi.disable();
});

test('never route an input back to the same MIDI device', async () => {
  const input = mockInput('same-port'), dest = mockPort('same-port'), midi = new MidiManager();
  await midi.connect(async () => accessWith(input, dest.output));
  midi.selectOutput('same-port'); midi.setLiveThru(true);
  assert.equal(midi.getSnapshot().liveThru, false);
  assert.match(midi.getSnapshot().outputMessage, /different MIDI output/i);
  midi.receive([0x90, 60, 90], 10);
  assert.deepEqual(dest.sent, []);
  midi.disable();
});

test('router handles duplicates, zero-velocity note-offs, panic, and disconnect safely', () => {
  const dest = mockPort(), router = new LiveMidiRouter();
  router.configure(dest.output, 3);
  router.forward([0x90, 60, 90]);
  router.forward([0x91, 60, 99]); // Two source channels play one pitch.
  router.forward([0x90, 60, 0]);
  assert.deepEqual(dest.sent, [[0x92, 60, 90], [0x92, 60, 99]]);
  router.forward([0x81, 60, 0]);
  assert.deepEqual(dest.sent.at(-1), [0x82, 60, 0]);
  router.forward([0x90, 70, 100]);
  router.forward([0xb0, 64, 127]);
  router.forward([0xb0, 123, 0]);
  assert.deepEqual(dest.sent.slice(-3), [[0xb2, 64, 0], [0x82, 70, 0], [0xb2, 123, 0]]);
  router.forward([0x90, 75, 100]);
  dest.output.state = 'disconnected';
  router.configure(null, 3); // Disconnected port cannot send, but held notes are cleared.
  assert.deepEqual(dest.sent.at(-1), [0x92, 75, 100]);
});
