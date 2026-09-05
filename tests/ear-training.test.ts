import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERVALS,
  calculateAccuracy,
  chooseWeightedInterval,
  createIntervalQuestion,
  formatAccuracy,
  isTestComplete,
  intervalsForDifficulty,
} from "../app/ear-training.ts";

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
