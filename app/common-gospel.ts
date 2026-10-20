import { parseChordParts, parseSpelledNote, spellInterval } from "./music-theory.ts";

export const COMMON_GOSPEL_PROGRESSIONS = [
  { name: "Gospel turnaround · I–VI7–ii–V7", chords: ["Cmaj7", "A7", "Dm7", "G7"] },
  { name: "Gospel resolution · ii–V7–I–I", chords: ["Dm7", "G7", "Cmaj7", "Cmaj7"] },
  { name: "Gospel walk-up · I/3–IV–♯iv°7–I/5", chords: ["Cmaj7/E", "Fmaj7", "F♯dim7", "Cmaj7/G"] },
  { name: "Passing diminished · I–IV–♯iv°7–I/5", chords: ["Cmaj7", "Fmaj7", "F♯dim7", "Cmaj7/G"] },
  { name: "Gospel Amen · IV–iv–I–I", chords: ["Fmaj7", "Fm6", "Cmaj7", "Cmaj7"] },
  { name: "Gospel backdoor · iv–♭VII7–I–I", chords: ["Fm7", "B♭7", "Cmaj7", "Cmaj7"] },
  { name: "Gospel 3–6–2–5 · iii–VI7–ii–V7", chords: ["Em7", "A7", "Dm7", "G7"] },
  { name: "Gospel 7–3–6 · viiø7–III7–vi–VI7", chords: ["Bm7♭5", "E7", "Am7", "A7"] },
  { name: "Gospel 6–2–5–1 · vi–ii–V7–I", chords: ["Am7", "Dm7", "G7", "Cmaj7"] },
] as const;

export function commonGospelChords(preset: number, key: string): string[] {
  const tonic = parseSpelledNote(key);
  const steps = ["C", "D", "E", "F", "G", "A", "B"].indexOf(tonic.letter);
  const transpose = (note: string) => spellInterval(note, steps, tonic.pitchClass);
  return (COMMON_GOSPEL_PROGRESSIONS[preset] ?? COMMON_GOSPEL_PROGRESSIONS[0]).chords.map(symbol => {
    const chord = parseChordParts(symbol);
    return `${transpose(chord.root.display)}${chord.suffix}${chord.slashBass ? `/${transpose(chord.slashBass.display)}` : ""}`;
  });
}
