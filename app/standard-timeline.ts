export const STANDARD_BEATS_PER_BAR = 4;

export type StandardBar =
  | string
  | string[]
  | {
      chords: string | string[];
      beats?: number;
      durations?: number[];
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

/**
 * A comfortable starting tempo for a chart. It is deliberately only a
 * suggestion: playback tempo stays editable after the chart loads.
 */
export function suggestedStandardTempo(standard: StandardSource) {
  const name = (standard.name ?? "").toLowerCase();
  const style = (standard.style ?? "").toLowerCase();
  const signature = standardTimeSignatureText(standard);

  if (/gospel|hymn/.test(style)) {
    if (/amazing grace|precious lord|old rugged cross|in the garden|peace in the valley|whispering hope/.test(name)) return 66;
    if (/i'll fly away|victory in jesus|when the roll is called|wonderful grace|higher ground|i saw the light/.test(name)) return 120;
    return 82;
  }
  if (/up tempo/.test(style)) return 190;
  if (/medium up/.test(style)) return 168;
  if (/medium swing/.test(style)) return 140;
  if (/slow swing/.test(style)) return 104;
  if (/ballad/.test(style)) return 70;
  if (/bossa/.test(style)) return 132;
  if (/latin/.test(style)) return 128;
  if (/funk/.test(style)) return 100;
  if (/fusion/.test(style)) return 108;
  if (/rock|even 8/.test(style)) return 112;
  if (/blues/.test(style)) return 116;
  if (signature === "6/8") return 112;
  if (signature === "3/4") return 132;
  return 126;
}

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
