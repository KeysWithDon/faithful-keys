export type RecognitionEvent = {
  startTime?: number;
  endTime?: number;
  chordSymbol?: string;
};

export type RecognitionResult = {
  key?: string;
  mode?: string;
  bpm?: number;
  beatTimes?: number[];
  events?: RecognitionEvent[];
};

type ChartEvent = {
  id: string;
  chordSymbol: string;
  nashvilleNumber: string;
  startTime: number;
  endTime: number;
  measureNumber: number;
  beat: number;
  confidence: "medium";
  userEdited: false;
  confirmed: false;
};

type CompactMeasure = {
  number: number;
  startTime: number;
  beats: number;
  chordEvents: ChartEvent[];
};

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function closestBeatIndex(beats: number[], time: number, bpm: number) {
  if (!beats.length) return Math.max(0, Math.round(time * bpm / 60));
  let best = 0;
  for (let index = 1; index < beats.length; index += 1) {
    if (Math.abs(beats[index] - time) < Math.abs(beats[best] - time)) best = index;
  }
  return best;
}

function sectionBaseNames(measures: CompactMeasure[]) {
  const phraseSize = 4;
  const chunks = Array.from(
    { length: Math.ceil(measures.length / phraseSize) },
    (_, index) => measures.slice(index * phraseSize, (index + 1) * phraseSize),
  );
  const signatures = chunks.map(chunk => chunk
    .map(measure => measure.chordEvents.map(event => event.chordSymbol).join("-"))
    .join("|"));
  const signatureCount = new Map<string, number>();
  signatures.forEach(signature => signatureCount.set(signature, (signatureCount.get(signature) ?? 0) + 1));
  const namesBySignature = new Map<string, string>();
  const usedNames = new Set<string>();

  return chunks.map((chunk, index) => {
    const signature = signatures[index];
    let base = namesBySignature.get(signature);
    if (!base) {
      const uniqueOpening = index === 0 && chunks.length >= 3 && signatureCount.get(signature) === 1;
      const shortFinale = index === chunks.length - 1 && chunks.length >= 4 && chunk.length < phraseSize;
      if (uniqueOpening) base = "Intro";
      else if (shortFinale) base = "Outro";
      else if (!usedNames.has("Verse")) base = "Verse";
      else if (!usedNames.has("Chorus")) base = "Chorus";
      else base = "Bridge";
      namesBySignature.set(signature, base);
      usedNames.add(base);
    }
    return { base, measures: chunk };
  });
}

/**
 * Turn timestamped recognition into a compact teaching chart. We intentionally
 * keep only bars containing detected harmony, then group those bars into
 * four-bar phrases. Repeated phrases retain their section identity.
 */
export function buildRecognizedSections(result: RecognitionResult) {
  const bpm = Math.max(finiteNumber(result.bpm, 72), 30);
  const numerator = 4;
  const beats = (result.beatTimes ?? []).map(value => finiteNumber(value, -1)).filter(value => value >= 0);
  const events = (result.events ?? [])
    .map((event, index) => ({
      index,
      chordSymbol: String(event.chordSymbol ?? "").trim(),
      startTime: Math.max(0, finiteNumber(event.startTime)),
      endTime: Math.max(0, finiteNumber(event.endTime, finiteNumber(event.startTime))),
    }))
    .filter(event => event.chordSymbol && event.chordSymbol !== "?")
    .sort((left, right) => left.startTime - right.startTime);

  const byMeasure = new Map<number, Array<ChartEvent & { snapDistance: number }>>();
  events.forEach(event => {
    const beatIndex = closestBeatIndex(beats, event.startTime, bpm);
    const absoluteMeasure = Math.floor(beatIndex / numerator);
    const beat = beatIndex % numerator + 1;
    const snappedTime = finiteNumber(beats[beatIndex], beatIndex * 60 / bpm);
    const chartEvent: ChartEvent & { snapDistance: number } = {
      id: `recognized-${event.index + 1}`,
      chordSymbol: event.chordSymbol,
      nashvilleNumber: "?",
      startTime: event.startTime,
      endTime: Math.max(event.startTime, event.endTime),
      measureNumber: 0,
      beat,
      confidence: "medium",
      userEdited: false,
      confirmed: false,
      snapDistance: Math.abs(snappedTime - event.startTime),
    };
    const measureEvents = byMeasure.get(absoluteMeasure) ?? [];
    const collision = measureEvents.findIndex(item => item.beat === beat);
    if (collision < 0) measureEvents.push(chartEvent);
    else if (chartEvent.snapDistance < measureEvents[collision].snapDistance) measureEvents[collision] = chartEvent;
    byMeasure.set(absoluteMeasure, measureEvents);
  });

  // Empty beat-grid bars are omitted. Their real timestamps remain on the next
  // detected chord, so the compact chart does not invent extra harmony.
  const measures: CompactMeasure[] = [...byMeasure.entries()]
    .sort(([left], [right]) => left - right)
    .map(([absoluteMeasure, measureEvents], index) => ({
      number: index + 1,
      startTime: finiteNumber(beats[absoluteMeasure * numerator], absoluteMeasure * numerator * 60 / bpm),
      beats: numerator,
      chordEvents: measureEvents
        .sort((left, right) => left.beat - right.beat)
        .map(event => ({
          id: event.id,
          chordSymbol: event.chordSymbol,
          nashvilleNumber: event.nashvilleNumber,
          startTime: event.startTime,
          endTime: event.endTime,
          measureNumber: index + 1,
          beat: event.beat,
          confidence: event.confidence,
          userEdited: event.userEdited,
          confirmed: event.confirmed,
        })),
    }));

  if (!measures.length) return [];
  const phrases = sectionBaseNames(measures);
  const occurrences = new Map<string, number>();
  return phrases.map((phrase, index) => {
    const occurrence = (occurrences.get(phrase.base) ?? 0) + 1;
    occurrences.set(phrase.base, occurrence);
    const finalEvent = phrase.measures.at(-1)?.chordEvents.at(-1);
    return {
      id: `recognized-section-${index + 1}`,
      name: occurrence > 1 ? `${phrase.base} ${occurrence}` : phrase.base,
      order: index + 1,
      startTime: phrase.measures[0]?.startTime ?? 0,
      endTime: finalEvent?.endTime ?? phrase.measures.at(-1)?.startTime ?? 0,
      confidence: "medium" as const,
      measures: phrase.measures,
    };
  });
}

export function chartWithResults(chart: Record<string, unknown>, result: RecognitionResult) {
  const events = result.events ?? [];
  const duration = Math.max(0, ...events.map(item => finiteNumber(item.endTime)));
  const sections = buildRecognizedSections(result);
  return {
    ...chart,
    key: result.key ?? chart.key ?? "C",
    mode: result.mode ?? chart.mode ?? "major",
    bpm: result.bpm ?? null,
    timeSignature: "4/4",
    confidence: "medium",
    durationSeconds: duration || null,
    sections: sections.length ? sections : [{
      id: "recognized-section-1",
      name: "Verse",
      order: 1,
      startTime: 0,
      endTime: duration,
      confidence: "uncertain",
      measures: [{ number: 1, startTime: 0, beats: 4, chordEvents: [] }],
    }],
    updatedAt: new Date().toISOString(),
  };
}
