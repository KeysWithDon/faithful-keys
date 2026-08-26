export type RecognitionEvent = {
  eventId?: string;
  startTime?: number;
  endTime?: number;
  chordSymbol?: string;
  originalChord?: string;
  confidenceScore?: number;
  timingConfidence?: number;
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
  rhythmVersion?: number;
  beat?: number;
  rhythmStrength?: number;
  releaseStyle?: "connected" | "detached" | "held";
  phraseBoundary?: boolean;
  sustainAcrossBar?: boolean;
  timingAdjusted?: boolean;
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
  timingOnly?: boolean;
  swingPercent?: number;
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

function swingPercent(value: unknown) {
  return Math.round(Math.max(50, Math.min(75, finiteNumber(value, 50))));
}

function swingBeatPosition(position: number, value: unknown) {
  const whole = Math.floor(position);
  const fraction = position - whole;
  const swing = swingPercent(value) / 100;
  if (fraction <= .5) return whole + fraction * 2 * swing;
  return whole + swing + (fraction - .5) * 2 * (1 - swing);
}

function halfBeatTime(beats: number[], halfBeatIndex: number, bpm: number) {
  const logicalBeat = halfBeatIndex / 2;
  if (!beats.length) return logicalBeat * 60 / bpm;
  const lower = Math.floor(logicalBeat);
  const fraction = logicalBeat - lower;
  if (lower + 1 < beats.length) return beats[lower] + (beats[lower + 1] - beats[lower]) * fraction;
  return beats.at(-1)! + (logicalBeat - beats.length + 1) * 60 / bpm;
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

function closestHalfBeatIndex(beats: number[], time: number, bpm: number) {
  if (!beats.length) return Math.max(0, Math.round(time * bpm / 30));
  const approximate = Math.max(0, Math.round((time - beats[0]) * bpm / 30));
  let best = 0;
  for (let index = Math.max(0, approximate - 4); index <= approximate + 4; index += 1) {
    if (Math.abs(halfBeatTime(beats, index, bpm) - time) < Math.abs(halfBeatTime(beats, best, bpm) - time)) best = index;
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
    const halfBeatIndex = closestHalfBeatIndex(beats, event.startTime, bpm);
    const absoluteMeasure = Math.floor(halfBeatIndex / (numerator * 2));
    const beat = (halfBeatIndex % (numerator * 2)) / 2 + 1;
    const snappedTime = halfBeatTime(beats, halfBeatIndex, bpm);
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
  // Every queued analysis starts from an imported chart. Existing chart
  // sections therefore force the chart-authority merge even if an outdated or
  // malformed worker omits its chartFirst/timingOnly flags.
  if (Array.isArray(chart.sections) && chart.sections.length > 0) return chartWithReferenceResults(chart, result);
  const events = result.events ?? [];
  const duration = Math.max(0, ...events.map(item => finiteNumber(item.endTime)));
  const sections = buildRecognizedSections(result);
  return {
    ...chart,
    key: result.key ?? chart.key ?? "C",
    mode: result.mode ?? chart.mode ?? "major",
    bpm: result.bpm ?? null,
    swingPercent: swingPercent(result.swingPercent),
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
  const authority = chart.harmonicAuthority && typeof chart.harmonicAuthority === "object"
    ? chart.harmonicAuthority as Record<string, unknown>
    : null;
  const authoritativeSections = authority && Array.isArray(authority.sections) && authority.sections.length
    ? authority.sections as Array<Record<string, unknown>>
    : chart.sections as Array<Record<string, unknown>>;
  const selectedBpm = finiteNumber(chart.bpm, -1);
  const selectedSwing = swingPercent(authority?.swingPercent ?? chart.swingPercent);
  const fixedTiming = new Map<string, { startTime: number; endTime: number }>();
  if (selectedBpm >= 10 && selectedBpm <= 250) {
    const secondsPerBeat = 60 / selectedBpm;
    const firstBeatTime = Math.max(0, finiteNumber(result.beatTimes?.[0], 0));
    const positions: Array<{ id: string; absoluteBeat: number }> = [];
    let beatCursor = 0;
    authoritativeSections.forEach(section => {
      (Array.isArray(section.measures) ? section.measures : []).forEach(measureValue => {
        const measure = measureValue as Record<string, unknown>;
        const beats = Math.max(1, finiteNumber(measure.beats, 4));
        (Array.isArray(measure.chordEvents) ? measure.chordEvents : []).forEach(eventValue => {
          const event = eventValue as Record<string, unknown>;
          const beat = Math.max(1, Math.min(beats + .5, Math.round(finiteNumber(event.beat, 1) * 2) / 2));
          positions.push({ id: String(event.id ?? `chart-${positions.length + 1}`), absoluteBeat: beatCursor + beat - 1 });
        });
        beatCursor += beats;
      });
    });
    positions.sort((left, right) => left.absoluteBeat - right.absoluteBeat);
    positions.forEach((position, index) => {
      const nextBeat = positions[index + 1]?.absoluteBeat ?? beatCursor;
      fixedTiming.set(position.id, {
        startTime: firstBeatTime + swingBeatPosition(position.absoluteBeat, selectedSwing) * secondsPerBeat,
        endTime: firstBeatTime + swingBeatPosition(Math.max(position.absoluteBeat + .25, nextBeat), selectedSwing) * secondsPerBeat,
      });
    });
  }
  const sections = authoritativeSections.map(section => {
    const measures = (Array.isArray(section.measures) ? section.measures : []).map(measureValue => {
      const measure = measureValue as Record<string, unknown>;
      const chordEvents = (Array.isArray(measure.chordEvents) ? measure.chordEvents : []).map((eventValue, index) => {
        const event = eventValue as Record<string, unknown>;
        const evidence = recognized.get(String(event.id ?? `chart-${index + 1}`));
        // The persisted chart is the sole harmonic source. Even a malformed or
        // legacy worker response cannot inject a chord, inversion, extension,
        // bass note, voicing, or passing chord into a chart-first result.
        const chartChord = String(event.chartChord ?? event.chordSymbol ?? "?");
        const timingConfidence = Math.max(0, Math.min(1, finiteNumber(evidence?.timingConfidence, finiteNumber(evidence?.confidenceScore, finiteNumber(event.timingConfidence, .5)))));
        const eventId = String(event.id ?? `chart-${index + 1}`);
        const selectedTiming = fixedTiming.get(eventId);
        const trustedPhrasing = finiteNumber(evidence?.rhythmVersion) >= 2 && evidence?.chartAuthority === true;
        const measuredStart = Math.max(0, finiteNumber(evidence?.startTime, -1));
        const measuredEnd = Math.max(measuredStart, finiteNumber(evidence?.endTime, -1));
        const startTime = trustedPhrasing && measuredStart >= 0
          ? measuredStart
          : selectedTiming?.startTime ?? Math.max(0, finiteNumber(evidence?.startTime, finiteNumber(event.startTime)));
        const endTime = trustedPhrasing && measuredEnd >= measuredStart
          ? measuredEnd
          : selectedTiming?.endTime ?? Math.max(
            finiteNumber(evidence?.startTime, finiteNumber(event.startTime)),
            finiteNumber(evidence?.endTime, finiteNumber(event.endTime)),
          );
        const measuredBeat = trustedPhrasing
          ? Math.max(1, Math.min(finiteNumber(measure.beats, 4) + .5, Math.round(finiteNumber(evidence?.beat, finiteNumber(event.beat, 1)) * 2) / 2))
          : finiteNumber(event.beat, 1);
        const timingReason = trustedPhrasing && typeof evidence?.selectionReason === "string"
          ? evidence.selectionReason
          : "The uploaded chart supplied this chord; the performance supplied only its rhythmic start and duration.";
        const review: RecognitionReview = {
          eventId,
          originalChord: chartChord,
          recommendedChord: chartChord,
          status: timingConfidence >= .8 ? "Confirmed" : "Likely",
          confidence: timingConfidence,
          reason: timingReason,
          alternatives: [],
          candidateRanking: [chartChord],
          needsHumanReview: false,
        };
        return {
          ...event,
          chordSymbol: chartChord,
          chartChord,
          originalChord: chartChord,
          beat: measuredBeat,
          startTime,
          endTime,
          confidence: chartConfidence(review.status),
          confidenceScore: timingConfidence,
          timingConfidence,
          audioConfidence: null,
          chartAudioAgreement: null,
          bassNote: null,
          detectedNotes: [],
          detectedVoicing: [],
          accompanimentNotes: [],
          melodyNotes: [],
          alternateCandidates: [],
          possibleExtension: null,
          extensionDecision: null,
          conflictingAudioInterpretation: null,
          rhythmStrength: trustedPhrasing ? Math.max(0, Math.min(1, finiteNumber(evidence?.rhythmStrength))) : null,
          releaseStyle: trustedPhrasing && ["connected", "detached", "held"].includes(String(evidence?.releaseStyle)) ? evidence?.releaseStyle : null,
          phraseBoundary: trustedPhrasing ? Boolean(evidence?.phraseBoundary) : false,
          sustainAcrossBar: trustedPhrasing ? Boolean(evidence?.sustainAcrossBar) : Boolean(event.sustainAcrossBar),
          timingAdjusted: trustedPhrasing ? Boolean(evidence?.timingAdjusted) : false,
          selectionReason: review.reason,
          needsUserReview: false,
          passingChordSuggestion: null,
          audioDetectedPassingChord: false,
          locked: Boolean(event.locked),
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
  return {
    ...chart,
    harmonicAuthority: undefined,
    key: authority?.key ?? chart.key ?? result.key ?? "C",
    mode: authority?.mode ?? chart.mode ?? result.mode ?? "major",
    // A chart-first job's preselected tempo is authoritative. This also
    // protects saved charts from an older worker that returns an estimate.
    bpm: chart.bpm ?? result.bpm ?? null,
    swingPercent: selectedSwing,
    timeSignature: authority?.timeSignature ?? chart.timeSignature ?? result.timeSignature ?? "4/4",
    confidence: "medium",
    durationSeconds: Math.max(0, ...events.map(event => finiteNumber(event.endTime))),
    analysisReview: {
      status: (result.events ?? []).length > 0 ? "completed" : "unavailable",
      provider: "chart-timing",
      model: null,
      reviewedEvents: result.review?.status === "completed" ? finiteNumber(result.review.reviewedEvents) : 0,
    },
    sections,
    updatedAt: new Date().toISOString(),
  };
}
