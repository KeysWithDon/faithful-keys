import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderContextDetector, describeReaderChord, readerContextShortcut } from '../app/reader-context.ts';

function session(chords: number[][]) {
  const detector = new ReaderContextDetector();
  detector.start([], 0);
  let now = 0;
  for (const notes of chords) {
    detector.update(notes, now); detector.tick(now + 150);
    detector.update([], now + 400); now += 500;
  }
  return { detector, now };
}
const major251 = [[50, 57, 60, 65], [43, 55, 59, 65], [48, 55, 59, 64]];
const minor251 = [[47, 53, 57, 62], [40, 56, 59, 62], [45, 55, 60, 64]];

test('detects major ii–V–I in all 12 keys and assigns chord functions', () => {
  for (let shift = 0; shift < 12; shift++) {
    const { detector } = session(major251.map(notes => notes.map(note => note + shift)));
    assert.equal(detector.result.key?.tonic, shift);
    assert.equal(detector.result.key?.mode, 'major');
    assert.equal(detector.result.confidence, 'Strong estimate');
    assert.deepEqual(detector.result.progression.map(step => step.roman), ['ii7', 'V7', 'Imaj7']);
    assert.deepEqual(detector.result.progression.map(step => step.number), ['2', '5', '1']);
  }
});

test('distinguishes minor iiø–V–i from the relative major in all 12 keys', () => {
  for (let shift = 0; shift < 12; shift++) {
    const { detector } = session(minor251.map(notes => notes.map(note => note + shift)));
    assert.equal(detector.result.key?.tonic, (9 + shift) % 12);
    assert.equal(detector.result.key?.mode, 'minor');
    assert.deepEqual(detector.result.progression.map(step => step.roman), ['iiø7', 'V7', 'i7']);
  }
});

test('a single chord remains tentative and a uniform chromatic cluster has no clear key', () => {
  assert.equal(session([[60, 64, 67]]).detector.result.confidence, 'Tentative');
  const { detector } = session([Array.from({ length: 12 }, (_, i) => 60 + i)]);
  assert.equal(detector.result.key, null);
  assert.equal(detector.result.current, null);
});

test('supports melody-only key estimates without inventing chord functions', () => {
  const melody = [60, 64, 67, 65, 62, 67, 71, 72, 67, 64, 62, 60];
  const { detector } = session(melody.map(note => [note]));
  assert.equal(detector.result.key?.name, 'C major');
  assert.equal(detector.result.current, null);
  assert.deepEqual(detector.result.progression, []);
});

test('groups rolled attacks, ignores release fragments, and counts held chords only once', () => {
  const detector = new ReaderContextDetector(); detector.start([], 0);
  detector.update([60], 0); detector.update([60, 64], 25); detector.update([60, 64, 67], 50);
  assert.equal(detector.tick(150).observations, 1);
  detector.tick(5000); assert.equal(detector.result.observations, 1);
  detector.update([60, 67], 5100); detector.tick(5500);
  detector.update([60], 5600); detector.tick(6000); detector.update([], 6100);
  assert.equal(detector.result.observations, 1);
  assert.equal(detector.result.current?.chord, 'C');
  detector.update([60, 64, 67], 6200); detector.tick(6350);
  assert.equal(detector.result.observations, 2);
  assert.equal(detector.result.progression.length, 1);
});

test('stop freezes results, flushes a stable last chord, and restart begins fresh', () => {
  const { detector, now } = session(major251.slice(0, 2));
  detector.update(major251[2], now);
  const result = detector.stop(now + 100);
  assert.equal(result.key?.name, 'C major');
  detector.update(minor251[0], now + 500); detector.tick(now + 1000);
  assert.equal(detector.result, result);
  assert.equal(detector.running, false);
  detector.start([], now + 1200);
  assert.equal(detector.result.observations, 0);
  assert.equal(detector.result.key, null);
  assert.deepEqual(detector.result.progression, []);
});

test('start includes already pressed notes and filters invalid MIDI', () => {
  const detector = new ReaderContextDetector();
  detector.start([60, 64, 67, NaN, -1, 128, 60.5], 0);
  detector.tick(100);
  assert.equal(detector.result.current?.chord, 'C');
  assert.equal(detector.result.observations, 1);
});

test('recognizes applied dominants, borrowed chords, inversions and theoretical spelling', () => {
  const key = { tonic: 0, mode: 'major' as const, name: 'C major' };
  assert.equal(describeReaderChord('E7', key).roman, 'V7/vi');
  assert.match(describeReaderChord('E7', key).role, /leads to the 6/);
  assert.match(describeReaderChord('Fm', key).role, /Borrowed/);
  assert.equal(describeReaderChord('C/E', key).bass, '3');
  assert.equal(describeReaderChord('Db7', key).roman, 'subV7/I');
  assert.equal(describeReaderChord('Gb7', { tonic: 11, mode: 'major', name: 'B major' }).chord, 'F♯7');
});

test('a passing secondary dominant retains the established key, sustained cadences can modulate', () => {
  const { detector, now } = session([...major251, [52, 56, 59, 62], [45, 55, 60, 64]]);
  assert.equal(detector.result.key?.name, 'C major');
  let time = now;
  for (let i = 0; i < 5; i++) for (const notes of major251.map(chord => chord.map(note => note + 2))) {
    detector.update(notes, time); detector.tick(time + 150); detector.update([], time + 400); time += 500;
  }
  assert.equal(detector.result.key?.name, 'D major');
  assert.equal(detector.result.observations, 20);
});

test('space toggles once without stealing shortcuts from controls, typing or dialogs', () => {
  assert.equal(readerContextShortcut({ key: ' ', code: 'Space' }, false, false), true);
  for (const event of [{ key: ' ', repeat: true }, { key: ' ', ctrlKey: true }, { key: ' ', metaKey: true }, { key: ' ', altKey: true }, { key: ' ', shiftKey: true }, { key: ' ', defaultPrevented: true }, { key: 'Enter' }]) {
    assert.equal(readerContextShortcut(event, false, false), false);
  }
  assert.equal(readerContextShortcut({ key: ' ' }, true, false), false);
  assert.equal(readerContextShortcut({ key: ' ' }, false, true), false);
});
