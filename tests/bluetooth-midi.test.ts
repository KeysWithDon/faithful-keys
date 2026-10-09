import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBleMidi, BLE_MIDI_SERVICE, BLE_MIDI_CHARACTERISTIC } from '../app/midi/bluetooth.ts';

test('uses standard Bluetooth LE MIDI service and characteristic', () => {
  assert.equal(BLE_MIDI_SERVICE, '03b80e5a-ede8-4b33-a751-6ce34ec4c700');
  assert.equal(BLE_MIDI_CHARACTERISTIC, '7772e5db-3868-4112-a1a9-f2669d106bf3');
});

test('decodes BLE MIDI note on and note off messages', () => {
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x90, 60, 100]), [[0x90, 60, 100]]);
  assert.deepEqual(decodeBleMidi([0x80, 0x81, 0x80, 60, 0]), [[0x80, 60, 0]]);
});

test('decodes multiple timestamped messages in one BLE packet', () => {
  const packet = [0x80, 0x80, 0x90, 60, 120, 0x81, 0x90, 64, 90];
  assert.deepEqual(decodeBleMidi(packet), [[0x90, 60, 120], [0x90, 64, 90]]);
});

test('decodes running-status messages with or without repeated timestamp', () => {
  assert.deepEqual(
    decodeBleMidi([0x80, 0x80, 0x90, 60, 100, 62, 80, 0x81, 64, 72]),
    [[0x90, 60, 100], [0x90, 62, 80], [0x90, 64, 72]],
  );
});

test('preserves channel bytes and all-notes-off controllers', () => {
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x92, 72, 100, 0x80, 0xb2, 123, 0]),
    [[0x92, 72, 100], [0xb2, 123, 0]]);
});

test('does not send malformed packets or system messages into note evaluation', () => {
  assert.deepEqual(decodeBleMidi([0, 0x80, 0x90, 60, 100]), []);
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0xf0, 1, 2, 0x81, 0xf7]), []);
  assert.deepEqual(decodeBleMidi([0x80, 0x80, 0x90, 60]), []);
});
