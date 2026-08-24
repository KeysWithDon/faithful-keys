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

test("validated constrained reviews carry evidence and supplied corrections into the chart", () => {
  const originalChord = "Em7";
  const recommendedChord = "Cmaj7/E";
  const review = {
    eventId: "detected-1", originalChord, recommendedChord, status: "Likely" as const,
    confidence: .81, reason: "The bass is E while C, E, G, and B persist above it.",
    alternatives: [originalChord], candidateRanking: [recommendedChord, originalChord], needsHumanReview: false,
  };
  const chart = chartWithResults({ id: "chart", correctionHistory: [] }, {
    bpm: 90, key: "C", mode: "major", beatTimes: [0, .667, 1.333, 2],
    review: { status: "completed", provider: "openai", model: "test", reviewedEvents: 1 },
    events: [{
      eventId: "detected-1", startTime: 0, endTime: 2, chordSymbol: recommendedChord,
      originalChord, confidenceScore: .58, bassNote: "E", detectedNotes: ["C", "E", "G", "B"],
      alternateCandidates: [recommendedChord], review,
    }],
  });
  const event = chart.sections[0].measures[0].chordEvents[0];
  assert.equal(event.chordSymbol, recommendedChord);
  assert.equal(event.originalChord, originalChord);
  assert.equal(event.bassNote, "E");
  assert.deepEqual(event.detectedNotes, ["C", "E", "G", "B"]);
  assert.equal(event.review.status, "Likely");
  assert.equal(chart.analysisReview.status, "completed");
});

test("invalid or invented review output cannot update the completed detector chart", () => {
  const chart = chartWithResults({ id: "chart", correctionHistory: [] }, {
    bpm: 90, beatTimes: [0, .667, 1.333, 2],
    review: { status: "completed", provider: "openai", model: "test", reviewedEvents: 1 },
    events: [{
      eventId: "detected-1", startTime: 0, endTime: 2, chordSymbol: "A7", originalChord: "Em7",
      confidenceScore: .58, bassNote: "E", detectedNotes: ["E", "G", "B", "D"],
      alternateCandidates: ["Cmaj7/E"],
      review: {
        eventId: "detected-1", originalChord: "Em7", recommendedChord: "A7", status: "Likely",
        confidence: .8, reason: "It would sound good.", alternatives: [], candidateRanking: ["A7"], needsHumanReview: false,
      },
    }],
  });
  const event = chart.sections[0].measures[0].chordEvents[0];
  assert.equal(event.chordSymbol, "Em7");
  assert.equal(event.review.recommendedChord, "Em7");
  assert.equal(chart.analysisReview.status, "unavailable");
});

test("high-confidence detector chords require substantially stronger correction evidence", () => {
  const originalChord = "G7";
  const recommendedChord = "D♭7";
  const chart = chartWithResults({ id: "chart", correctionHistory: [] }, {
    bpm: 100, beatTimes: [0, .6, 1.2, 1.8],
    review: { status: "completed", provider: "openai", model: "test", reviewedEvents: 1 },
    events: [{
      eventId: "detected-1", startTime: 0, endTime: 2, chordSymbol: recommendedChord,
      originalChord, confidenceScore: .9, alternateCandidates: [recommendedChord],
      candidateScores: [{ chord: originalChord, score: .9 }, { chord: recommendedChord, score: .91 }],
      review: {
        eventId: "detected-1", originalChord, recommendedChord, status: "Likely", confidence: .95,
        reason: "The alternative was supplied but is not materially stronger.", alternatives: [originalChord],
        candidateRanking: [recommendedChord, originalChord], needsHumanReview: false,
      },
    }],
  });
  assert.equal(chart.sections[0].measures[0].chordEvents[0].chordSymbol, originalChord);
  assert.equal(chart.analysisReview.status, "unavailable");
});
