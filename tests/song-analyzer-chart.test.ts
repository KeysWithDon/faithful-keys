import assert from "node:assert/strict";
import test from "node:test";
import { buildRecognizedSections, chartWithResults } from "../supabase/functions/queue-song-analysis/chart-builder.ts";

const beatTimes = Array.from({ length: 64 }, (_, index) => index * .5);

test("recognized charts omit empty bars and use musical section names", () => {
  const events = [
    { startTime: 0, endTime: 1.8, chordSymbol: "C" },
    { startTime: 2, endTime: 3.8, chordSymbol: "F" },
    // Leave several real beat-grid bars silent to verify they are not rendered.
    { startTime: 8, endTime: 9.8, chordSymbol: "G7" },
    { startTime: 10, endTime: 11.8, chordSymbol: "C" },
    { startTime: 12, endTime: 13.8, chordSymbol: "Am" },
    { startTime: 14, endTime: 15.8, chordSymbol: "Dm7" },
    { startTime: 16, endTime: 17.8, chordSymbol: "G7" },
    { startTime: 18, endTime: 19.8, chordSymbol: "C" },
    { startTime: 20, endTime: 21.8, chordSymbol: "F" },
  ];
  const sections = buildRecognizedSections({ bpm: 120, beatTimes, events });
  const measures = sections.flatMap(section => section.measures);
  assert.deepEqual(sections.map(section => section.name), ["Intro", "Verse", "Chorus"]);
  assert.equal(measures.length, 9);
  assert.ok(measures.every(measure => measure.chordEvents.length > 0));
  assert.deepEqual(measures.map(measure => measure.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("recognition collisions keep one visible chord per beat", () => {
  const sections = buildRecognizedSections({
    bpm: 120,
    beatTimes,
    events: [
      { startTime: .06, endTime: .2, chordSymbol: "C" },
      { startTime: .2, endTime: .8, chordSymbol: "Dm" },
      { startTime: 2.02, endTime: 3, chordSymbol: "G7" },
    ],
  });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "Verse");
  assert.equal(sections[0].measures[0].chordEvents.length, 1);
  assert.equal(sections[0].measures[0].chordEvents[0].chordSymbol, "C");
});

test("completed recognition falls back to one review bar, never four empty bars", () => {
  const chart = chartWithResults({ id: "chart" }, { bpm: 80, events: [] });
  assert.equal(chart.sections.length, 1);
  assert.equal(chart.sections[0].name, "Verse");
  assert.equal(chart.sections[0].measures.length, 1);
});
