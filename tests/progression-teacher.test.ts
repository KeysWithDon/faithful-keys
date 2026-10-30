import test from "node:test";
import assert from "node:assert/strict";
import {
  CIRCLE_KEYS, GOSPEL_LESSONS, REQUIRED_ROUNDS, acceptChord,
  emptyProgress, lessonVoicings, transposeLesson, voiceFeedback, withMistake,
  type MasteryProgress,
} from "../app/progression-teacher.ts";

const completeRound = (state: MasteryProgress, length: number) => {
  let next = state;
  for (let i = 0; i < length; i += 1) next = acceptChord(next, length);
  return next;
};

test("all seven gospel difficulty levels are present and ordered", () => {
  assert.deepEqual([...new Set(GOSPEL_LESSONS.map(l => l.level))], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(CIRCLE_KEYS, ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "B", "E", "A", "D", "G"]);
});

test("the circle transposes complete gospel progressions with correct spelling", () => {
  const lesson = GOSPEL_LESSONS.find(l => l.movement === "1–6–2–5–1" && l.level === 2);
  assert.ok(lesson);
  assert.deepEqual(transposeLesson(lesson, "F"), ["Fmaj7", "Dm7", "Gm7", "C7", "Fmaj7"]);
  assert.deepEqual(transposeLesson(lesson, "B♭"), ["B♭maj7", "Gm7", "Cm7", "F7", "B♭maj7"]);
  assert.deepEqual(transposeLesson(lesson, "B"), ["Bmaj7", "G♯m7", "C♯m7", "F♯7", "Bmaj7"]);
});

test("each progression yields the exact playable chord voices and a separate bass", () => {
  for (const lesson of GOSPEL_LESSONS) {
    for (const key of ["C", "F", "B♭", "B"]) {
      const voicings = lessonVoicings(lesson, key);
      assert.equal(voicings.length, lesson.chords.length, lesson.title + " " + key);
      for (const voice of voicings) {
        assert.ok(voice.upperVoices.length >= 3, voice.symbol);
        assert.ok(voice.upperVoices.length <= 10, voice.symbol);
        assert.ok(voice.diagnostics.handSpan <= 12, voice.symbol);
        assert.ok(voice.upperVoices[0] - voice.bass >= 9, voice.symbol);
      }
    }
  }
});

test("voice correction identifies precise movements while preserving good voices", () => {
  const response = voiceFeedback([60, 64, 67, 71], [60, 64, 69, 71], "Cmaj7");
  assert.equal(response.correct, false);
  assert.match(response.message, /Move A4 down one whole step to G4/);
  assert.match(response.message, /Keep C4, E4, B4 steady/);
  assert.equal(voiceFeedback([60, 64, 67], [67, 60, 64], "C").correct, true);
});

test("mastery cannot skip the guided repetition independent fluency or retention checkpoints", () => {
  let state = emptyProgress();
  const length = 3;
  state = completeRound(state, length);
  assert.equal(state.phase, "repetition");
  assert.equal(state.key, 0);
  state = completeRound(state, length);
  assert.equal(state.rounds, 1);
  state = withMistake(state);
  state = completeRound(state, length);
  assert.equal(state.phase, "repetition");
  state = completeRound(state, length);
  assert.equal(state.rounds, 3); // three successful complete rounds are required
  assert.equal(state.phase, "independent");
  for (const phase of ["independent", "fluency", "retention"] as const) {
    assert.equal(state.phase, phase);
    for (let n = 0; n < REQUIRED_ROUNDS[phase]; n += 1) state = completeRound(state, length);
  }
  assert.equal(state.key, 1);
  assert.equal(state.phase, "guided");
  assert.ok(state.completed.includes("0:0"));
});

test("all twelve keys plus a final full circle review are required before the next lesson", () => {
  let state = emptyProgress();
  const len = GOSPEL_LESSONS[0].chords.length;
  for (let key = 0; key < 12; key += 1) {
    assert.equal(state.key, key);
    for (const phase of ["guided", "repetition", "independent", "fluency", "retention"] as const) {
      assert.equal(state.phase, phase);
      for (let i = 0; i < REQUIRED_ROUNDS[phase]; i += 1) state = completeRound(state, len);
    }
  }
  assert.equal(state.lesson, 0);
  assert.equal(state.phase, "circle-review");
  assert.equal(state.completed.length, 12);
  for (let key = 0; key < 12; key += 1) {
    assert.equal(state.key, key);
    state = completeRound(state, len);
  }
  assert.equal(state.lesson, 1);
  assert.equal(state.key, 0);
  assert.equal(state.phase, "guided");
});
