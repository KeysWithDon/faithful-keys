import { parseChordParts, parseSpelledNote, spellChordPitch, spellInterval } from "./music-theory";
import { voiceLeadProgression, type VoicedChord } from "./voice-leading";

export const CIRCLE_KEYS = ["C", "F", "B♭", "E♭", "A♭", "D♭", "G♭", "B", "E", "A", "D", "G"] as const;

export type GospelLesson = { level: number; title: string; movement: string; explanation: string; chords: string[] };

export const GOSPEL_LESSONS: GospelLesson[] = [
  {level: 1, title: "Home to the four", movement: "1–4–1", explanation: "Learn the feeling of leaving home and coming back. Keep common tones steady.", chords: ["C", "F", "C"]},
  {level: 1, title: "Home to the five", movement: "1–5–1", explanation: "Hear the five chord create an expectation of home.", chords: ["C", "G", "C"]},
  {level: 1, title: "The simple gospel cadence", movement: "1–4–5–1", explanation: "Connect three major chords with the smallest useful upper-voice movements.", chords: ["C", "F", "G", "C"]},
  {level: 1, title: "The worship loop", movement: "1–6–4–5", explanation: "Introduce the minor six without losing the sound of the home key.", chords: ["C", "Am", "F", "G"]},
  {level: 2, title: "Two–five–one", movement: "2–5–1", explanation: "Follow the pull of the dominant seventh back to the major seventh.", chords: ["Dm7", "G7", "Cmaj7"]},
  {level: 2, title: "The classic gospel turnaround", movement: "1–6–2–5–1", explanation: "Keep shared tones and move your voices economically.", chords: ["Cmaj7", "Am7", "Dm7", "G7", "Cmaj7"]},
  {level: 2, title: "Three–six–two–five–one", movement: "3–6–2–5–1", explanation: "Hear a longer chain of resolutions with steady bass direction.", chords: ["Em7", "Am7", "Dm7", "G7", "Cmaj7"]},
  {level: 3, title: "Diminished passing movement", movement: "1–♯1°–2–5–1", explanation: "Approach the two chord using a diminished passing chord.", chords: ["C", "C♯dim7", "Dm7", "G7", "C"]},
  {level: 3, title: "The three–six pull", movement: "7–3–6", explanation: "Use the three dominant to resolve into the minor six.", chords: ["Bm7♭5", "E7", "Am7"]},
  {level: 3, title: "Secondary dominant turnaround", movement: "1–VI7–2–V7–1", explanation: "Hear the six dominant draw your ear into the two.", chords: ["Cmaj7", "A7", "Dm7", "G7", "Cmaj7"]},
  {level: 3, title: "The gospel amen", movement: "4–iv–1", explanation: "Listen to the emotional movement of the borrowed minor four.", chords: ["Fmaj7", "Fm6", "Cmaj7"]},
  {level: 4, title: "Ninth chord color", movement: "1–6–2–5–1", explanation: "Add ninths while keeping smooth motion between upper voices.", chords: ["Cmaj9", "Am9", "Dm9", "G9", "Cmaj9"]},
  {level: 4, title: "Suspension and release", movement: "4–5sus–5–1", explanation: "Hear a suspended dominant resolve before reaching home.", chords: ["Fmaj9", "G9sus4", "G13", "Cmaj9"]},
  {level: 4, title: "Thirteenth turnaround", movement: "3–6–2–5–1", explanation: "Use richer dominant colors without overcrowding the right hand.", chords: ["Em9", "A13", "Dm9", "G13", "Cmaj9"]},
  {level: 5, title: "Altered dominant resolution", movement: "2–V7alt–1", explanation: "Resolve altered dominant tension into the home chord.", chords: ["Dm9", "G7♭9", "Cmaj9"]},
  {level: 5, title: "Tritone approach", movement: "2–♭2–1", explanation: "Replace the five dominant with a nearby chromatic dominant.", chords: ["Dm9", "D♭7", "Cmaj9"]},
  {level: 5, title: "Approach the minor six", movement: "7–III7–6", explanation: "Use the dominant three to lead into the relative minor.", chords: ["Bm7♭5", "E7♭9", "Am9"]},
  {level: 6, title: "Contemporary gospel colors", movement: "1–6–2–5–1", explanation: "Combine extensions and altered tension with clean inner-voice movement.", chords: ["C6/9", "A7♯5", "Dm11", "G13", "Cmaj9"]},
  {level: 6, title: "Rich amen movement", movement: "4–iv–1", explanation: "Color the familiar gospel amen with richer voicings.", chords: ["Fmaj9", "Fm9", "C6/9"]},
  {level: 6, title: "Advanced backdoor", movement: "4–iv–♭VII7–1", explanation: "Hear the backdoor dominant carry the borrowed minor-four color home.", chords: ["Fmaj9", "Fm9", "B♭13", "Cmaj9"]},
  {level: 7, title: "Extended gospel flow", movement: "3–VI7–2–V7–1", explanation: "Connect rich chords as a single fluent musical statement.", chords: ["Em9", "A7♭9", "Dm11", "G13", "C6/9"]},
  {level: 7, title: "Worship-to-gospel resolution", movement: "1–6–4–iv–1", explanation: "Bring familiar worship harmony into a gospel minor-four resolution.", chords: ["Cmaj9", "Am9", "Fmaj9", "Fm9", "C6/9"]},
  {level: 7, title: "Turnaround with chromatic color", movement: "1–VI7–2–♭2–1", explanation: "Connect the secondary dominant and chromatic substitute into home.", chords: ["Cmaj9", "A7♯5", "Dm9", "D♭13", "C6/9"]},
];

export function transposeLesson(lesson: GospelLesson, key: string): string[] {
  const tonic = parseSpelledNote(key);
  const letters = ["C", "D", "E", "F", "G", "A", "B"];
  const steps = letters.indexOf(tonic.letter);
  return lesson.chords.map(symbol => {
    const parts = parseChordParts(symbol);
    const root = spellInterval(parts.root.display, steps, tonic.pitchClass);
    const bass = parts.slashBass ? "/" + spellInterval(parts.slashBass.display, steps, tonic.pitchClass) : "";
    return root + parts.suffix + bass;
  });
}

export function lessonVoicings(lesson: GospelLesson, key: string): VoicedChord[] {
  return voiceLeadProgression(transposeLesson(lesson, key), {
    style: "gospel", layout: "close", includeBass: true,
    upperRange: [59, 82], bassRange: [36, 50], maximumHandSpan: 12,
  });
}

export function nameMidi(note: number, chord: string): string {
  return spellChordPitch(chord, note % 12) + String(Math.floor(note / 12) - 1);
}

const sorted = (notes: readonly number[]) => [...notes].sort((a, b) => a - b);
const equal = (a: readonly number[], b: readonly number[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const remaining = (a: readonly number[], b: readonly number[]) => {
  const pool = [...b];
  return a.filter(note => {
    const match = pool.indexOf(note);
    if (match < 0) return true;
    pool.splice(match, 1);
    return false;
  });
};

export function voiceFeedback(expected: readonly number[], played: readonly number[], chord: string): {
  correct: boolean; message: string; correctNotes: number[]; missing: number[]; extra: number[];
} {
  const correct = equal(expected, played);
  const missing = remaining(expected, played);
  const extra = remaining(played, expected);
  const correctNotes = remaining(expected, missing);
  if (correct) return {correct, message: "That's the chord. Keep the movement smooth.", correctNotes, missing, extra};
  if (!played.length) return {correct, message: "Play the highlighted chord when you are ready.", correctNotes, missing, extra};
  const held = correctNotes.length
    ? " Keep " + correctNotes.map(n => nameMidi(n, chord)).join(", ") + " steady."
    : "";
  if (missing.length === 1 && extra.length === 1) {
    const from = extra[0], to = missing[0], distance = Math.abs(to - from);
    const direction = to > from ? "up" : "down";
    const interval = distance === 1 ? "one semitone" : distance === 2 ? "one whole step" : String(distance) + " semitones";
    return {correct, message: "Almost there. Move " + nameMidi(from, chord) + " " + direction + " " + interval + " to " + nameMidi(to, chord) + "." + held, correctNotes, missing, extra};
  }
  if (missing.length && !extra.length)
    return {correct, message: "Add " + missing.slice(0, 2).map(n => nameMidi(n, chord)).join(" and ") + "." + held, correctNotes, missing, extra};
  if (extra.length && !missing.length)
    return {correct, message: "Release " + extra.slice(0, 2).map(n => nameMidi(n, chord)).join(" and ") + "." + held, correctNotes, missing, extra};
  const from = extra[0], to = missing.reduce((best, n) => Math.abs(n-from) < Math.abs(best-from) ? n : best, missing[0]);
  const movement = to > from ? "up" : "down";
  return {correct, message: "Try moving " + nameMidi(from, chord) + " " + movement + " to " + nameMidi(to, chord) + " first." + held, correctNotes, missing, extra};
}

export type MasteryPhase = "guided" | "repetition" | "independent" | "fluency" | "retention" | "circle-review";
export const PHASES: MasteryPhase[] = ["guided", "repetition", "independent", "fluency", "retention"];
export const REQUIRED_ROUNDS: Record<MasteryPhase, number> = {
  guided: 1, repetition: 3, independent: 2, fluency: 2, retention: 1, "circle-review": 1,
};
export type MasteryProgress = {
  lesson: number; key: number; phase: MasteryPhase; step: number;
  rounds: number; mistakes: number; completed: string[]; notice: string;
};
export const emptyProgress = (): MasteryProgress => ({
  lesson: 0, key: 0, phase: "guided", step: 0, rounds: 0, mistakes: 0, completed: [],
  notice: "Follow the highlighted notes, then play the full movement.",
});
export function withMistake(progress: MasteryProgress): MasteryProgress {
  return {...progress, mistakes: 1};
}
export function acceptChord(progress: MasteryProgress, chordCount: number): MasteryProgress {
  if (progress.lesson >= GOSPEL_LESSONS.length) return progress;
  if (progress.step + 1 < chordCount)
    return {...progress, step: progress.step + 1, notice: "Good. Move to the next chord."};
  if (progress.mistakes) return {...progress, step: 0, mistakes: 0, notice: "Good correction. Now repeat the full movement cleanly to count toward mastery."};
  const rounds = progress.rounds + 1;
  if (rounds < REQUIRED_ROUNDS[progress.phase])
    return {...progress, step: 0, rounds, notice: "Clean repetition " + rounds + " complete. Repeat the movement."};
  if (progress.phase === "circle-review") {
    if (progress.key < CIRCLE_KEYS.length - 1)
      return {...progress, key: progress.key + 1, step: 0, rounds: 0, notice: "Circle review passed. Keep going around the fourths."};
    const nextLesson = progress.lesson + 1;
    return {...progress, lesson: nextLesson, key: 0, phase: "guided", step: 0, rounds: 0, mistakes: 0,
      notice: nextLesson >= GOSPEL_LESSONS.length ? "You mastered the complete gospel progression course across all 12 keys." : "All 12 keys reviewed. Your next gospel movement is unlocked."};
  }
  if (progress.phase === "retention") {
    const completed = Array.from(new Set([...progress.completed, String(progress.lesson) + ":" + String(progress.key)]));
    if (progress.key < CIRCLE_KEYS.length - 1)
      return {...progress, completed, key: progress.key + 1, phase: "guided", step: 0, rounds: 0, mistakes: 0, notice: "Key mastered. Continue around the circle of fourths."};
    return {...progress, completed, key: 0, phase: "circle-review", step: 0, rounds: 0, mistakes: 0, notice: "All 12 keys practiced. Complete one final clean performance in each key."};
  }
  const next = PHASES[PHASES.indexOf(progress.phase) + 1];
  return {...progress, phase: next, step: 0, rounds: 0, mistakes: 0,
    notice: next === "retention" ? "Retention: recall the movement after practice. The chord visual stays visible." : next === "fluency" ? "Fluency: play every transition steadily, without long hesitations." : "Stage complete. The chords remain visible as you build confidence."};
}
