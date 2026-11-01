import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiManager } from '../app/midi/manager.ts';
import { ReaderContextDetector } from '../app/reader-context.ts';
import { identifyChord } from '../app/chord-reader.ts';
import { PerformanceRecorder } from '../app/performance-recording.ts';

test('quickly released chords remain readable and analyzable while sustained, with audio/recording note-offs at pedal-up', () => {
  const midi = new MidiManager(), detector = new ReaderContextDetector(), recorder = new PerformanceRecorder();
  const sounding = new Set<number>(); recorder.begin(0); detector.start([], 0);
  midi.onNote(event => {
    if (event.type === 'on') sounding.add(event.note);
    else sounding.delete(event.note);
    recorder.receive(event.type, event.note, event.velocity, event.channel, event.at);
  });
  for (const note of [60, 64, 67]) midi.receive([0x90, note, 1], 1);
  detector.update(midi.getSnapshot().active, 1);
  midi.receive([0xb0, 64, 127], 10);
  for (const note of [60, 64, 67]) midi.receive([0x90, note, 0], 30);
  detector.update(midi.getSnapshot().active, 30); detector.tick(120);
  assert.deepEqual(midi.getSnapshot().pressed, []);
  assert.deepEqual(midi.getSnapshot().sustained, [60, 64, 67]);
  assert.equal(identifyChord(midi.getSnapshot().active).matches[0], 'C');
  assert.equal(detector.result.current?.chord, 'C');
  assert.deepEqual([...sounding], [60, 64, 67]);
  midi.receive([0xb0, 64, 0], 500);
  detector.update(midi.getSnapshot().active, 500); detector.tick(650);
  assert.deepEqual(midi.getSnapshot().active, []); assert.equal(sounding.size, 0);
  assert.equal(detector.result.observations, 1); // Pedal-up never invents a chord.
  assert.deepEqual(recorder.finish(700).events.filter(e => e.type === 'off').map(e => [e.note, e.ms]), [[60, 500], [64, 500], [67, 500]]);
});

test('starting analysis after lifting the keys still captures the pedal-held chord', () => {
  const midi = new MidiManager(), detector = new ReaderContextDetector();
  midi.receive([0xb0, 64, 127], 0);
  for (const note of [48, 55, 59, 64]) midi.receive([0x90, note, 90], 1);
  for (const note of [48, 55, 59, 64]) midi.receive([0x80, note, 0], 20);
  detector.start(midi.getSnapshot().active, 100); detector.tick(220);
  assert.equal(detector.result.current?.chord, 'Cmaj7');
});

test('sustained ii–V–I chords with quick key releases produce the correct key and movement', () => {
  const midi = new MidiManager(), detector = new ReaderContextDetector(); detector.start([], 0);
  let now = 0;
  for (const notes of [[50, 57, 60, 65], [43, 55, 59, 65], [48, 55, 59, 64]]) {
    midi.receive([0xb0, 64, 127], now);
    for (const note of notes) midi.receive([0x90, note, 80], now + 1);
    detector.update(midi.getSnapshot().active, now + 1);
    for (const note of notes) midi.receive([0x80, note, 0], now + 30);
    detector.update(midi.getSnapshot().active, now + 30); detector.tick(now + 150);
    midi.receive([0xb0, 64, 0], now + 300);
    detector.update(midi.getSnapshot().active, now + 300); now += 400;
  }
  assert.equal(detector.result.key?.name, 'C major');
  assert.deepEqual(detector.result.progression.map(chord => chord.number), ['2', '5', '1']);
});
