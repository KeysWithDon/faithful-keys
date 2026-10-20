import test from "node:test";
import assert from "node:assert/strict";
import { COMMON_GOSPEL_PROGRESSIONS, commonGospelChords } from "../app/common-gospel.ts";
import { parseChordSymbol, voiceLeadProgression } from "../app/voice-leading.ts";

test("gospel presets preserve secondary dominants, passing chords and slash bass when transposed", () => {
  assert.deepEqual(commonGospelChords(0, "C"), ["Cmaj7", "A7", "Dm7", "G7"]);
  assert.deepEqual(commonGospelChords(0, "B♭"), ["B♭maj7", "G7", "Cm7", "F7"]);
  assert.deepEqual(commonGospelChords(2, "E♭"), ["E♭maj7/G", "A♭maj7", "Adim7", "E♭maj7/B♭"]);
  assert.deepEqual(commonGospelChords(4, "C"), ["Fmaj7", "Fm6", "Cmaj7", "Cmaj7"]);
});

test("every gospel preset voices with playable hands and correct bass in all twelve keys", () => {
  for (const key of ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]) {
    for (let preset = 0; preset < COMMON_GOSPEL_PROGRESSIONS.length; preset += 1) {
      const chords = commonGospelChords(preset, key);
      const voiced = voiceLeadProgression(chords, { style: "gospel" });
      assert.equal(voiced.length, 4);
      voiced.forEach((event, index) => {
        const parsed = parseChordSymbol(chords[index]);
        if (parsed.slashBass) assert.equal(event.bass % 12, parsed.bass);
        else assert.ok([parsed.root, ...parsed.roles.map(role => (parsed.root + role.interval) % 12)].includes(event.bass % 12));
        assert.ok(event.diagnostics.handSpan <= 12);
        assert.ok(event.upperVoices[0] - event.bass >= 9);
      });
    }
  }
});
