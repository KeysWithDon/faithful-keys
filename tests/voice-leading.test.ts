import assert from "node:assert/strict";
import test from "node:test";
import { CIRCLE_APPROACH_OPTIONS, CIRCLE_NOTES, buildCircleWarmup } from "../app/circle-warmups.ts";
import { standardTimeline } from "../app/standard-timeline.ts";
import { STANDARDS } from "../app/standards.ts";
import { MAXIMUM_AVERAGE_HAND_SPAN, parseChordSymbol, voiceLeadProgression, type VoicingLayout } from "../app/voice-leading.ts";

const pc = (midi: number) => ((midi % 12) + 12) % 12;

const standardChordSymbols = [...new Set(STANDARDS.flatMap((standard) => standard.bars.flatMap((bar) =>
  typeof bar === "string" ? [bar] : Array.isArray(bar) ? bar : bar.chords,
)))];

test("ii-V-I holds guide tones and resolves the dominant third and seventh", () => {
  const [ii, dominant, tonic] = voiceLeadProgression(["Dm7", "G7", "Cmaj7"], { style: "jazz" });
  assert.ok(ii.upperVoices.some((note) => dominant.upperVoices.includes(note) && pc(note) === 5), "F should remain common from ii to V");
  assert.ok(ii.upperVoices.some((note, index) => pc(note) === 0 && dominant.upperVoices[index] === note - 1), "C should move to B");
  assert.ok(dominant.upperVoices.some((note, index) => pc(note) === 11 && tonic.upperVoices[index] === note + 1), "B should resolve to C");
  assert.ok(dominant.upperVoices.some((note, index) => pc(note) === 5 && tonic.upperVoices[index] === note - 1), "F should resolve to E");
});

test("secondary and altered dominants resolve every active guide tone", () => {
  const [a7, dm] = voiceLeadProgression(["A7", "Dm7"], { style: "gospel" });
  assert.ok(a7.upperVoices.some((note, index) => pc(note) === 1 && dm.upperVoices[index] === note + 1), "C sharp should resolve to D");
  assert.ok(a7.upperVoices.some((note, index) => pc(note) === 7 && dm.upperVoices[index] === note - 2), "G should resolve to F");

  const [altered, c] = voiceLeadProgression(["G7b9", "Cmaj7"], { style: "gospel" });
  assert.ok(altered.upperVoices.some((note, index) => pc(note) === 8 && c.upperVoices[index] === note - 1), "A flat should resolve to G");
  assert.equal(c.diagnostics.resolutions.length, 3);
});

test("slash bass is hard constrained and the bass line remains melodic", () => {
  const events = voiceLeadProgression(["C", "G/B", "Am7", "Fmaj7"], { style: "ccm" });
  assert.deepEqual(events.map((event) => event.bass), [48, 47, 45, 41]);
  assert.equal(pc(events[1].bass), 11);
  assert.ok(events.every((event) => event.bass < event.upperVoices[0]));
});

test("extended slash chords keep the written bass in playback and voicing", () => {
  const events = voiceLeadProgression(["E♭maj9/G", "B♭13♭9/E♭", "A♭m11/C♭"], { style: "gospel" });
  assert.deepEqual(events.map(event => pc(event.bass)), [7, 3, 11]);
  assert.ok(events.every(event => event.parsed.slashBass));
  assert.ok(events.every(event => event.bass < event.upperVoices[0]));
});

test("written 13ths sound the guide tones and all stacked extensions", () => {
  const [g13] = voiceLeadProgression(["G13"], { style: "jazz" });
  const sounded = new Set(g13.upperVoices.map(pc));
  for (const required of [11, 5, 9, 0, 4]) assert.ok(sounded.has(required), `missing pitch class ${required}`);
  assert.equal(g13.upperVoices.length, 5);
});

test("add extensions sound only the specifically written color tones", () => {
  const parsed = parseChordSymbol("C7add9add13");
  const roleNames = parsed.roles.map(role => role.name);
  assert.ok(roleNames.includes("9th"));
  assert.ok(roleNames.includes("13th"));
  assert.equal(roleNames.includes("11th"), false);
});

test("repeated chords vary gently without register drift", () => {
  const events = voiceLeadProgression(Array.from({ length: 8 }, () => "Cmaj7"));
  assert.ok(events.some((event, index) => index > 0 && event.upperVoices.join(",") !== events[index - 1].upperVoices.join(",")));
  assert.ok(events.every((event) => event.upperVoices[0] >= 48 && event.upperVoices.at(-1)! <= 76));
  assert.ok(Math.max(...events.map((event) => event.upperVoices.at(-1)!)) - Math.min(...events.map((event) => event.upperVoices.at(-1)!)) <= 4);
});

test("keeps bass and chord in clear, playable registers across every layout", () => {
  const circleSequences = (["fourths", "fifths"] as const).flatMap((direction) => CIRCLE_APPROACH_OPTIONS.map((option) =>
    buildCircleWarmup({ startNote: "C", direction, approach: option.id }).map((event) => event.chord),
  ));
  const sequences = [
    ["Cmaj7", "Dm7", "G7", "Cmaj7"],
    ["C", "G/B", "Am7", "Fmaj7"],
    ["Dm9", "G13", "Cmaj9", "A7b9", "Dm9", "Db7", "Cmaj9"],
    ...circleSequences,
  ];

  for (const layout of ["close", "open", "drop2"] satisfies VoicingLayout[]) {
    for (const chords of sequences) {
      const events = voiceLeadProgression(chords, {
        style: "jazz",
        layout,
        upperRange: [55, 81],
        bassRange: [36, 48],
        minimumBassGap: 9,
      });
      for (const event of events) {
        const lowestUpper = event.upperVoices[0];
        assert.ok(event.bass >= 36 && event.bass <= 48, `${event.symbol} bass left the teaching range`);
        assert.ok(lowestUpper >= 57, `${event.symbol} ${layout} chord fell into a muddy register`);
        assert.ok(lowestUpper - event.bass >= 9, `${event.symbol} ${layout} bass-to-chord gap is too tight`);
        assert.ok(event.upperVoices.at(-1)! <= 81, `${event.symbol} ${layout} chord left the upper teaching range`);
        assert.equal(new Set(event.upperVoices).size, event.upperVoices.length, `${event.symbol} ${layout} doubled an identical key`);
        assert.ok(event.upperVoices.at(-1)! - lowestUpper <= MAXIMUM_AVERAGE_HAND_SPAN, `${event.symbol} ${layout} requires more than an octave reach`);
        assert.equal(event.diagnostics.handSpan, event.upperVoices.at(-1)! - lowestUpper);
      }
    }
  }
});

test("all 677 standards symbols keep every required tone inside an average hand span", () => {
  assert.equal(standardChordSymbols.length, 677);
  for (const layout of ["close", "open", "drop2"] satisfies VoicingLayout[]) {
    const options = {
      style: "jazz" as const,
      layout,
      upperRange: [55, 81] as const,
      bassRange: [36, 48] as const,
      minimumBassGap: 9,
      maximumHandSpan: MAXIMUM_AVERAGE_HAND_SPAN,
      beamWidth: 8,
    };
    const events = voiceLeadProgression(standardChordSymbols, options);
    const replay = voiceLeadProgression(standardChordSymbols, options);
    assert.deepEqual(
      replay.map((event) => `${event.bass}|${event.upperVoices.join(",")}`),
      events.map((event) => `${event.bass}|${event.upperVoices.join(",")}`),
      `${layout} voicings should be deterministic`,
    );

    for (const event of events) {
      const upper = event.upperVoices;
      const upperPcs = new Set(upper.map(pc));
      const requiredPcs = new Set(event.parsed.roles.filter((role) => role.required).map((role) => pc(event.parsed.root + role.interval)));
      const hasWrittenColorTone = event.parsed.roles.some((role) => /7th|6th|9th|11th|13th/.test(role.name));
      const expectedVoiceCount = Math.min(5, Math.max(hasWrittenColorTone ? 4 : 3, requiredPcs.size));
      assert.equal(upper.length, expectedVoiceCount, `${event.symbol} ${layout} uses an unexpected number of fingers`);
      assert.equal(new Set(upper).size, upper.length, `${event.symbol} ${layout} repeats an identical piano key`);
      assert.ok(upper.at(-1)! - upper[0] <= MAXIMUM_AVERAGE_HAND_SPAN, `${event.symbol} ${layout} exceeds a one-octave reach`);
      assert.ok(upper[0] >= 57 && upper.at(-1)! <= 81, `${event.symbol} ${layout} left the teaching register`);
      assert.ok(event.bass >= 36 && event.bass <= 48, `${event.symbol} ${layout} bass left its register`);
      assert.ok(upper[0] - event.bass >= 9, `${event.symbol} ${layout} bass is too close to the upper hand`);
      if (event.parsed.slashBass) assert.equal(pc(event.bass), event.parsed.bass, `${event.symbol} lost its written slash bass`);
      for (const requiredPc of requiredPcs) assert.ok(upperPcs.has(requiredPc), `${event.symbol} ${layout} omitted required pitch class ${requiredPc}`);
    }
  }
});

test("lower, middle, and upper choices are distinct ergonomic positions", () => {
  const chords = ["Cmaj7", "Dm7", "G7", "Cmaj7"];
  const variants = (["close", "open", "drop2"] satisfies VoicingLayout[]).map((layout) =>
    voiceLeadProgression(chords, { style: "jazz", layout, maximumHandSpan: 12 }),
  );
  const signatures = variants.map((events) => events.map((event) => event.upperVoices.join(",")).join("|"));
  assert.equal(new Set(signatures).size, 3);
  const averageCenters = variants.map((events) => events.reduce((sum, event) =>
    sum + event.upperVoices.reduce((voiceSum, note) => voiceSum + note, 0) / event.upperVoices.length,
  0) / events.length);
  assert.ok(averageCenters[0] < averageCenters[1] && averageCenters[1] < averageCenters[2]);
  for (const events of variants) assert.ok(events.every((event) => event.diagnostics.handSpan <= 12));
});

test("a requested ten-semitone hand reach is honored across every standards symbol", () => {
  for (const layout of ["close", "open", "drop2"] satisfies VoicingLayout[]) {
    const events = voiceLeadProgression(standardChordSymbols, {
      style: "jazz",
      layout,
      maximumHandSpan: 10,
      beamWidth: 8,
    });
    assert.ok(events.every((event) => event.diagnostics.handSpan <= 10), `${layout} exceeded the requested hand reach`);
  }
});

test("complete standards and circle libraries voice-lead in their real sequence order", () => {
  const standardsSequence = STANDARDS.flatMap((standard) => standardTimeline(standard).map((event) => event.chord));
  const circleSequence = CIRCLE_NOTES.flatMap((startNote) => (["fourths", "fifths"] as const).flatMap((direction) =>
    CIRCLE_APPROACH_OPTIONS.flatMap((option) => buildCircleWarmup({ startNote, direction, approach: option.id }).map((event) => event.chord)),
  ));
  for (const [name, chords] of [["standards", standardsSequence], ["circle", circleSequence]] as const) {
    const events = voiceLeadProgression(chords, { style: "jazz", layout: "open", maximumHandSpan: 12, beamWidth: 8 });
    assert.equal(events.length, chords.length);
    assert.ok(events.every((event) => event.diagnostics.handSpan <= 12), `${name} produced an oversized hand shape`);
    assert.ok(events.every((event) => event.upperVoices[0] - event.bass >= 9), `${name} crowded the bass register`);
  }
});

test("a substitution causes the destination transition to be reconsidered in context", () => {
  const original = voiceLeadProgression(["Cmaj7", "Fmaj7", "Dm7", "G7"]);
  const substituted = voiceLeadProgression(["Cmaj7", "Fmaj7", "Bm7", "E7", "G7"]);
  assert.notDeepEqual(original[3].diagnostics.upperMovement, substituted[4].diagnostics.upperMovement);
  assert.deepEqual(substituted[4].diagnostics.upperMovement, substituted[4].upperVoices.map((note, index) => note - substituted[3].upperVoices[index]));
  assert.equal(substituted[4].diagnostics.upperMovement.length, 4);
});

test("parser distinguishes add, sus, altered fifth, and minor-major symbols", () => {
  const add9 = parseChordSymbol("Cadd9");
  assert.ok(add9.roles.some((role) => role.interval === 2));
  assert.ok(!add9.roles.some((role) => role.interval === 10));
  assert.ok(parseChordSymbol("Esus2").roles.some((role) => role.interval === 2 && role.required));
  assert.ok(parseChordSymbol("Cmaj7#5").roles.some((role) => role.interval === 8 && role.required));
  assert.equal(parseChordSymbol("Fm/maj7").quality, "minor-major");
});
