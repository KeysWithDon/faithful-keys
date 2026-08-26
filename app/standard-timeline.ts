export const STANDARD_BEATS_PER_BAR = 4;

export type StandardBar =
  | string
  | string[]
  | {
      chords: string | string[];
      beats?: number;
      durations?: number[];
      sustainAcrossBars?: boolean[];
    };

export type StandardSource = {
  name?: string;
  style?: string;
  chords?: string[];
  bars?: StandardBar[];
  /** Optional chart melody anchors, one per expanded timeline event. */
  melody?: string[];
  meter?: string;
  timeSignature?: string | readonly [number, number];
  TimeSignature?: string;
  swingPercent?: number;
};

export function standardTimeSignatureText(standard: StandardSource) {
  const signature = standard.meter ?? standard.timeSignature ?? standard.TimeSignature ?? "4/4";
  return typeof signature === "string" ? signature : signature.join("/");
}

export type StandardTimelineEvent = {
  chord: string;
  beats: number;
  bar: number;
  part: number;
  parts: number;
  sustainAcrossBar: boolean;
};

export function standardBeatsPerBar(standard: StandardSource) {
  const signature = standard.meter ?? standard.timeSignature ?? standard.TimeSignature ?? "4/4";
  const [numerator, denominator] = typeof signature === "string"
    ? signature.split("/").map(Number)
    : signature;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return STANDARD_BEATS_PER_BAR;
  }
  // Playback durations use quarter-note beats. This makes 3/4 three beats,
  // while 6/8 occupies three quarter-note beats rather than six.
  return numerator * 4 / denominator;
}

/**
 * Turn a lead-sheet-style bar list into playback events. A single chord owns
 * the full bar; two or more chords share the bar unless explicit durations
 * are supplied. Legacy flat chord arrays are treated as one chord per bar.
 * Repeated chords intentionally remain separate events so a student can see
 * and hear the form rather than having neighboring bars collapsed together.
 */
export function standardTimeline(
  standard: StandardSource,
  beatsPerBar = standardBeatsPerBar(standard),
): StandardTimelineEvent[] {
  const bars: StandardBar[] = standard.bars?.length
    ? standard.bars
    : (standard.chords ?? []);

  return bars.flatMap((bar, barIndex) => {
    const barObject = typeof bar === "object" && !Array.isArray(bar) ? bar : null;
    const rawChords: string | string[] = barObject ? barObject.chords : bar as string | string[];
    const chords = (Array.isArray(rawChords) ? rawChords : [rawChords])
      .map((chord) => chord.trim())
      .filter(Boolean);
    if (!chords.length) return [];

    const barBeats = barObject?.beats && barObject.beats > 0
      ? barObject.beats
      : beatsPerBar;
    const explicit = barObject?.durations;
    const explicitTotal = explicit?.reduce((sum, beats) => sum + Math.max(0, beats), 0) ?? 0;
    const durations = explicit?.length === chords.length && explicitTotal > 0
      ? explicit.map((beats) => Math.max(0, beats) * barBeats / explicitTotal)
      : chords.map(() => barBeats / chords.length);

    return chords.map((chord, part) => ({
      chord,
      beats: durations[part],
      bar: barIndex + 1,
      part: part + 1,
      parts: chords.length,
      sustainAcrossBar: Boolean(barObject?.sustainAcrossBars?.[part]),
    }));
  });
}

export function barPosition(durations: number[], index: number, beatsPerBar = STANDARD_BEATS_PER_BAR) {
  const elapsed = durations.slice(0, index).reduce((sum, beats) => sum + beats, 0);
  const bar = Math.floor((elapsed + 0.0001) / beatsPerBar) + 1;
  const beat = elapsed % beatsPerBar + 1;
  return { bar, beat };
}

export function standardTimingLabel(durations: number[], index: number, beatsPerBar = STANDARD_BEATS_PER_BAR) {
  const duration = durations[index] ?? beatsPerBar;
  const { bar } = barPosition(durations, index, beatsPerBar);
  if (Math.abs(duration - beatsPerBar) < 0.001) return `BAR ${String(bar).padStart(2, "0")} · WHOLE BAR`;
  const beats = Number.isInteger(duration) ? String(duration) : duration.toFixed(1).replace(/\.0$/, "");
  return `BAR ${String(bar).padStart(2, "0")} · ${beats} ${duration === 1 ? "BEAT" : "BEATS"}`;
}
