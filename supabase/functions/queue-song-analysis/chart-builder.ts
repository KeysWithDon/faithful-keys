export type RecognitionEvent = {
  eventId?: string;
  startTime?: number;
  endTime?: number;
  chordSymbol?: string;
  originalChord?: string;
  confidenceScore?: number;
  bassNote?: string | null;
  detectedNotes?: string[];
  alternateCandidates?: string[];
  candidateScores?: Array<{ chord?: string; score?: number }>;
  review?: RecognitionReview;
  referenceEventId?: string;
  chartAuthority?: boolean;
  chartChord?: string;
  locked?: boolean;
  audioDetectedChord?: string | null;
  audioConfidence?: number;
  chartAudioAgreement?: number;
  detectedVoicing?: string[];
  accompanimentNotes?: string[];
  melodyNotes?: string[];
  possibleExtension?: string | null;
  extensionDecision?: "pending" | "accepted" | "rejected" | null;
  conflictingAudioInterpretation?: string | null;
  selectionReason?: string;
  needsUserReview?: boolean;
  passingChordSuggestion?: Record<string, unknown> | null;
};

export type RecognitionReview = {
  eventId: string;
  originalChord: string;
  recommendedChord: string;
  status: "Confirmed" | "Likely" | "Ambiguous" | "Unknown";
  confidence: number;
  reason: string;
  alternatives: string[];
  candidateRanking: string[];
  needsHumanReview: boolean;
};

export type RecognitionResult = {
  key?: string;
  mode?: string;
  bpm?: number;
  timeSignature?: string;
  beatTimes?: number[];
  events?: RecognitionEvent[];
  review?: { status?: string; provider?: string; model?: string | null; reviewedEvents?: number };
  chartFirst?: boolean;
};

type ChartEvent = {
  id: string;
  chordSymbol: string;
  nashvilleNumber: string;
  startTime: number;
  endTime: number;
  measureNumber: number;
  beat: number;
  confidence: "high" | "medium" | "low" | "uncertain";
  userEdited: false;
  confirmed: false;
  originalChord: string;
  confidenceScore: number;
  bassNote: string | null;
  detectedNotes: string[];
  alternateCandidates: string[];
  review: RecognitionReview;
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

const REVIEW_STATUSES = new Set(["Confirmed", "Likely", "Ambiguous", "Unknown"]);

function validReview(event: RecognitionEvent): event is RecognitionEvent & { review: RecognitionReview } {
  const review = event.review;
  if (!review || typeof review !== "object") return false;
  const original = String(event.originalChord ?? event.chordSymbol ?? "").trim();
  const allowed = new Set([original, ...(Array.isArray(event.alternateCandidates) ? event.alternateCandidates : [])]);
  const emittedChord = String(event.chordSymbol ?? original).trim();
  const scores = new Map((Array.isArray(event.candidateScores) ? event.candidateScores : [])
    .filter(item => item && typeof item.chord === "string" && Number.isFinite(item.score))
    .map(item => [item.chord as string, Number(item.score)]));
  const highConfidenceCorrection = finiteNumber(event.confidenceScore, .5) >= .85 && review.recommendedChord !== original;
  return typeof review.eventId === "string"
    && review.eventId === String(event.eventId ?? "")
    && review.originalChord === original
    && allowed.has(review.recommendedChord)
    && REVIEW_STATUSES.has(review.status)
    && Number.isFinite(review.confidence) && review.confidence >= 0 && review.confidence <= 1
    && typeof review.reason === "string" && review.reason.trim().length > 0 && review.reason.length <= 320
    && Array.isArray(review.alternatives) && review.alternatives.every(chord => typeof chord === "string" && allowed.has(chord))
    && Array.isArray(review.candidateRanking)
    && review.candidateRanking.length === allowed.size
    && new Set(review.candidateRanking).size === allowed.size
    && review.candidateRanking.every(chord => allowed.has(chord))
    && typeof review.needsHumanReview === "boolean"
    && (emittedChord === original || emittedChord === review.recommendedChord)
    && (review.status !== "Confirmed" || review.recommendedChord === original)
    && (!["Ambiguous", "Unknown"].includes(review.status) || review.recommendedChord === original)
    && (!highConfidenceCorrection || (review.confidence >= .92 && (scores.get(review.recommendedChord) ?? 0) >= (scores.get(original) ?? finiteNumber(event.confidenceScore, .5)) + .08));
}

function fallbackReview(event: RecognitionEvent, index: number): RecognitionReview {
  const original = String(event.originalChord ?? event.chordSymbol ?? "?").trim() || "?";
  const confidence = Math.max(0, Math.min(1, finiteNumber(event.confidenceScore, .5)));
  const status = confidence >= .85 ? "Confirmed" : confidence >= .67 ? "Likely" : confidence >= .4 ? "Ambiguous" : "Unknown";
  const alternatives = (Array.isArray(event.alternateCandidates) ? event.alternateCandidates : []).filter(chord => chord !== original);
  return {
    eventId: String(event.eventId ?? `detected-${index + 1}`), originalChord: original, recommendedChord: original,
    status, confidence, reason: "The completed audio detection was retained because a valid constrained AI review was unavailable.",
    alternatives, candidateRanking: [original, ...alternatives], needsHumanReview: status === "Ambiguous" || status === "Unknown",
  };
}

function chartConfidence(status: RecognitionReview["status"]): ChartEvent["confidence"] {
  return status === "Confirmed" ? "high" : status === "Likely" ? "medium" : status === "Ambiguous" ? "low" : "uncertain";
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
  const sourceEvents = result.events ?? [];
  const reviewValid = sourceEvents.length > 0 && sourceEvents.every(validReview);
  const mayApplyReview = reviewValid && result.review?.status === "completed";
  const events = sourceEvents
    .map((event, index) => ({
      index,
      eventId: String(event.eventId ?? `detected-${index + 1}`),
      originalChord: String(event.originalChord ?? event.chordSymbol ?? "").trim(),
      chordSymbol: String(
        mayApplyReview && event.review?.status === "Likely" && finiteNumber(event.review.confidence) >= .72
          ? event.chordSymbol
          : event.originalChord ?? event.chordSymbol ?? "",
      ).trim(),
      startTime: Math.max(0, finiteNumber(event.startTime)),
      endTime: Math.max(0, finiteNumber(event.endTime, finiteNumber(event.startTime))),
      confidenceScore: Math.max(0, Math.min(1, finiteNumber(event.confidenceScore, .5))),
      bassNote: typeof event.bassNote === "string" ? event.bassNote : null,
      detectedNotes: Array.isArray(event.detectedNotes) ? event.detectedNotes.filter(note => typeof note === "string") : [],
      alternateCandidates: Array.isArray(event.alternateCandidates) ? event.alternateCandidates.filter(chord => typeof chord === "string") : [],
      review: reviewValid ? event.review as RecognitionReview : fallbackReview(event, index),
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
      id: event.eventId,
      chordSymbol: event.chordSymbol,
      nashvilleNumber: "?",
      startTime: event.startTime,
      endTime: Math.max(event.startTime, event.endTime),
      measureNumber: 0,
      beat,
      confidence: chartConfidence(event.review.status),
      userEdited: false,
      confirmed: false,
      originalChord: event.originalChord,
      confidenceScore: event.confidenceScore,
      bassNote: event.bassNote,
      detectedNotes: event.detectedNotes,
      alternateCandidates: event.alternateCandidates,
      review: event.review,
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
          originalChord: event.originalChord,
          confidenceScore: event.confidenceScore,
          bassNote: event.bassNote,
          detectedNotes: event.detectedNotes,
          alternateCandidates: event.alternateCandidates,
          review: event.review,
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
  if (result.chartFirst && Array.isArray(chart.sections)) return chartWithReferenceResults(chart, result);
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
    analysisReview: {
      status: result.review?.status === "completed" && (result.events ?? []).every(validReview) ? "completed" : "unavailable",
      provider: result.review?.provider ?? "fallback",
      model: result.review?.model ?? null,
      reviewedEvents: result.review?.status === "completed" ? finiteNumber(result.review.reviewedEvents) : 0,
    },
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

function chartWithReferenceResults(chart: Record<string, unknown>, result: RecognitionResult) {
  const recognized = new Map((result.events ?? []).map((event, index) => [String(event.referenceEventId ?? event.eventId ?? `detected-${index + 1}`), event]));
  const sections = (chart.sections as Array<Record<string, unknown>>).map(section => {
    const measures = (Array.isArray(section.measures) ? section.measures : []).map(measureValue => {
      const measure = measureValue as Record<string, unknown>;
      const chordEvents = (Array.isArray(measure.chordEvents) ? measure.chordEvents : []).map((eventValue, index) => {
        const event = eventValue as Record<string, unknown>;
        const evidence = recognized.get(String(event.id ?? `chart-${index + 1}`));
        if (!evidence) return event;
        const review = validReview(evidence) ? evidence.review : fallbackReview(evidence, index);
        const chartChord = String(event.chartChord ?? event.chordSymbol ?? evidence.chartChord ?? evidence.originalChord ?? "?");
        return {
          ...event,
          chordSymbol: chartChord,
          chartChord,
          originalChord: chartChord,
          startTime: Math.max(0, finiteNumber(evidence.startTime)),
          endTime: Math.max(finiteNumber(evidence.startTime), finiteNumber(evidence.endTime)),
          confidence: chartConfidence(review.status),
          confidenceScore: Math.max(0, Math.min(1, finiteNumber(evidence.confidenceScore, .5))),
          audioConfidence: Math.max(0, Math.min(1, finiteNumber(evidence.audioConfidence, finiteNumber(evidence.confidenceScore, .5)))),
          chartAudioAgreement: Math.max(0, Math.min(1, finiteNumber(evidence.chartAudioAgreement))),
          bassNote: typeof evidence.bassNote === "string" ? evidence.bassNote : null,
          detectedNotes: Array.isArray(evidence.detectedNotes) ? evidence.detectedNotes.filter(note => typeof note === "string") : [],
          detectedVoicing: Array.isArray(evidence.detectedVoicing) ? evidence.detectedVoicing.filter(note => typeof note === "string") : [],
          accompanimentNotes: Array.isArray(evidence.accompanimentNotes) ? evidence.accompanimentNotes.filter(note => typeof note === "string") : [],
          melodyNotes: Array.isArray(evidence.melodyNotes) ? evidence.melodyNotes.filter(note => typeof note === "string") : [],
          alternateCandidates: Array.isArray(evidence.alternateCandidates) ? evidence.alternateCandidates.filter(chord => typeof chord === "string") : [],
          possibleExtension: typeof evidence.possibleExtension === "string" ? evidence.possibleExtension : null,
          extensionDecision: evidence.possibleExtension ? "pending" : event.extensionDecision ?? null,
          conflictingAudioInterpretation: typeof evidence.conflictingAudioInterpretation === "string" ? evidence.conflictingAudioInterpretation : null,
          selectionReason: typeof evidence.selectionReason === "string" ? evidence.selectionReason : review.reason,
          needsUserReview: Boolean(evidence.needsUserReview || review.needsHumanReview),
          passingChordSuggestion: evidence.passingChordSuggestion && typeof evidence.passingChordSuggestion === "object" ? evidence.passingChordSuggestion : null,
          locked: Boolean(event.locked || evidence.locked),
          review,
        };
      });
      return { ...measure, chordEvents };
    });
    const sectionEvents = measures.flatMap(measure => measure.chordEvents as Array<Record<string, unknown>>);
    return {
      ...section,
      measures,
      startTime: sectionEvents.length ? Math.min(...sectionEvents.map(event => finiteNumber(event.startTime))) : finiteNumber(section.startTime),
      endTime: sectionEvents.length ? Math.max(...sectionEvents.map(event => finiteNumber(event.endTime))) : finiteNumber(section.endTime),
    };
  });
  const events = sections.flatMap(section => (section.measures as Array<Record<string, unknown>>).flatMap(measure => measure.chordEvents as Array<Record<string, unknown>>));
  const reviewValid = (result.events ?? []).length > 0 && (result.events ?? []).every(validReview);
  return {
    ...chart,
    key: chart.key ?? result.key ?? "C",
    mode: chart.mode ?? result.mode ?? "major",
    bpm: result.bpm ?? chart.bpm ?? null,
    timeSignature: chart.timeSignature ?? result.timeSignature ?? "4/4",
    confidence: "medium",
    durationSeconds: Math.max(0, ...events.map(event => finiteNumber(event.endTime))),
    analysisReview: {
      status: result.review?.status === "completed" && reviewValid ? "completed" : "unavailable",
      provider: result.review?.provider ?? "fallback",
      model: result.review?.model ?? null,
      reviewedEvents: result.review?.status === "completed" ? finiteNumber(result.review.reviewedEvents) : 0,
    },
    sections,
    updatedAt: new Date().toISOString(),
  };
}
