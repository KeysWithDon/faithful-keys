import test from "node:test";
import assert from "node:assert/strict";
import { generateCustomProgression, type CustomProgressionStyle } from "../app/custom-progression.ts";
import { chordBankForKey } from "../app/song-analyzer.ts";

function seeded(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

test("home-key generation uses only the selected chord bank and supported durations", () => {
  const generated = generateCustomProgression({ key: "C", mode: "major", style: "gospel", random: seeded([.9, .1, .4, .2, .7]) });
  const available = new Set(chordBankForKey("C", "major").map(choice => choice.chord));
  assert.equal(generated.modulated, false);
  assert.ok(generated.chords.length >= 6);
  assert.ok(generated.chords.every(chord => available.has(chord)));
  assert.ok(generated.durations.every(beats => [.25, .5, 1, 1.5, 2, 3, 4, 8].includes(beats)));
});

test("a settled modulation uses chords from the home and destination banks", () => {
  const generated = generateCustomProgression({ key: "C", mode: "major", style: "jazz", random: seeded([.05, .55, .8, .6, .2, .7]) });
  const available = new Set([
    ...chordBankForKey("C", "major").map(choice => choice.chord),
    ...chordBankForKey(generated.establishedKey, "major").map(choice => choice.chord),
  ]);
  assert.equal(generated.modulated, true);
  assert.notEqual(generated.establishedKey, "C");
  assert.ok(generated.chords.every(chord => available.has(chord)));
});

test("every style produces a complete editable progression", () => {
  for (const style of ["gospel", "jazz", "ccm", "worship"] satisfies CustomProgressionStyle[]) {
    const generated = generateCustomProgression({ key: "E♭", mode: "minor", style, random: seeded([.8, .3, .6, .1]) });
    assert.equal(generated.chords.length, generated.durations.length);
    assert.ok(generated.chords.length >= 6);
  }
});

test("modulation always settles on a key the Faithful Keys selector can display", () => {
  const keys = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  for (const key of keys) {
    const generated = generateCustomProgression({ key, mode: "major", style: "worship", random: seeded([.01, .95, .2, .9, .4]) });
    assert.ok(keys.includes(generated.establishedKey));
  }
});
