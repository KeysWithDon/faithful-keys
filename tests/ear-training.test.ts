import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCLE_PITCH_CLASSES,
  CIRCLE_NOTE_NAMES,
  INTERVALS,
  SCALES,
  calculateAccuracy,
  chooseWeightedInterval,
  createCircleIntervalQuestion,
  createIntervalQuestion,
  formatAccuracy,
  isTestComplete,
  intervalsForDifficulty,
  createScaleQuestion,
  scaleNoteNames,
  scalePlaybackMidis,
  scalesForDifficulty,
} from "../app/ear-training.ts";

test("circle practice follows complete fourths and fifths cycles", () => {
  assert.deepEqual(CIRCLE_PITCH_CLASSES.fourths, [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]);
  assert.deepEqual(CIRCLE_PITCH_CLASSES.fifths, [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
  assert.deepEqual(CIRCLE_NOTE_NAMES.fourths.slice(4, 7), ["A♭", "D♭", "G♭"]);
  assert.deepEqual(CIRCLE_NOTE_NAMES.fifths.slice(6, 9), ["F♯", "C♯", "G♯"]);
});

test("circle questions stay inside the keyboard in both directions", () => {
  const doubleOctave = INTERVALS[24];
  const ascending = createCircleIntervalQuestion(doubleOctave, 11, "up");
  const descending = createCircleIntervalQuestion(doubleOctave, 0, "down");
  assert.deepEqual([ascending.rootMidi, ascending.targetMidi], [59, 83]);
  assert.deepEqual([descending.rootMidi, descending.targetMidi], [48, 72]);
});

test("easy contains exactly unison through octave and hard contains all compound intervals", () => {
  assert.deepEqual(intervalsForDifficulty("easy").map(interval => interval.semitones), Array.from({ length: 13 }, (_, index) => index));
  assert.deepEqual(intervalsForDifficulty("hard").map(interval => interval.semitones), Array.from({ length: 25 }, (_, index) => index));
  assert.equal(INTERVALS[15].name, "Minor 10th");
  assert.equal(INTERVALS[24].name, "Double Octave");
});

test("attempt-based accuracy retains every wrong guess", () => {
  assert.equal(calculateAccuracy(1, 1), 100);
  assert.equal(calculateAccuracy(1, 4), 25);
  assert.equal(calculateAccuracy(2, 5), 40);
  assert.equal(formatAccuracy(25, 31), "80.6%");
  assert.equal(formatAccuracy(0, 0), "0.0%");
});

test("questions always fit the full keyboard range, including double octave", () => {
  const doubleOctave = INTERVALS[24];
  for (const random of [0, .25, .5, .999999]) {
    const question = createIntervalQuestion(doubleOctave, random);
    assert.ok(question.rootMidi >= 48);
    assert.ok(question.targetMidi <= 84);
    assert.equal(question.targetMidi - question.rootMidi, 24);
  }
});

test("each supported test length completes only after that many correct questions", () => {
  for (const target of [10, 15, 25, 50]) {
    assert.equal(isTestComplete(target - 1, target), false);
    assert.equal(isTestComplete(target, target), true);
  }
});

test("controlled weighting penalizes an immediate repeat", () => {
  const pool = INTERVALS.slice(0, 2);
  const selected = chooseWeightedInterval(pool, {}, [pool[0].id], .3);
  assert.equal(selected.id, pool[1].id);
});

test("scale catalog exposes the requested practical and advanced material", () => {
  const level1 = scalesForDifficulty("beginnerIntermediate").map(scale => scale.id);
  const level2 = scalesForDifficulty("advancedHighlyAdvanced").map(scale => scale.id);
  assert.equal(level1.length, 13);
  assert.ok(level1.includes("major"));
  assert.ok(level1.includes("locrian"));
  assert.ok(level2.includes("chromatic"));
  assert.ok(level2.includes("altered"));
  assert.ok(level2.includes("phrygian-dominant"));
  assert.ok(level2.includes("melodic-minor"));
  assert.ok(level2.includes("harmonic-minor"));
  assert.equal(new Set(SCALES.map(scale => scale.id)).size, SCALES.length);
});

test("scale questions preserve their own tonic and correct playback direction", () => {
  const dorian = SCALES.find(scale => scale.id === "dorian")!;
  const question = createScaleQuestion(dorian, 2, "ascending-descending");
  assert.equal(question.rootName, "D");
  assert.deepEqual(question.ascendingMidis, [62, 64, 65, 67, 69, 71, 72, 74]);
  assert.deepEqual(scalePlaybackMidis(question), [62, 64, 65, 67, 69, 71, 72, 74, 72, 71, 69, 67, 65, 64, 62]);
});

test("scale note labels use sensible flat-key spellings", () => {
  const major = SCALES.find(scale => scale.id === "major")!;
  assert.deepEqual(scaleNoteNames(major, 3), ["E♭", "F", "G", "A♭", "B♭", "C", "D", "E♭"]);
});
