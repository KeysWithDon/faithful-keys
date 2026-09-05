"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  CIRCLE_APPROACH_OPTIONS,
  buildCircleWarmup,
  type CircleApproach,
  type CircleDirection,
  type CircleNote,
} from "./circle-warmups";
import { standardBeatsPerBar, standardTimeSignatureText, standardTimeline, standardTimingLabel, type StandardSource } from "./standard-timeline";
import { STANDARDS } from "./standards";
import { GOSPEL_STANDARDS } from "./gospel-standards";
import { voiceLeadProgression, type VoicedChord, type VoiceLeadingStyle, type VoicingLayout } from "./voice-leading";
import { buildDiatonicSevenths, parseChordParts, parseChordRoot, parseSpelledNote, spellChordPitch, spellInterval, spellRomanDegree } from "./music-theory";
import { buildFunctionReharm } from "./reharm";
import { chordBankForKey, normalizeSwingPercent, swingBeatPosition } from "./song-analyzer";
import { loadPublishedGospelStandards } from "./admin-gospel-standards";
import { createInteractiveAudioContext, resumeAudioFromGesture } from "./mobile-audio";
import { createOrchestraInstrument, type OrchestraPatch } from "./sso-instruments";
import { generateCustomProgression, type CustomProgressionStyle } from "./custom-progression";

const SongAnalyzer = lazy(() => import("./song-analyzer-ui"));
const EarTraining = lazy(() => import("./ear-training-ui"));

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR: Record<string,string[]> = Object.fromEntries(NOTES.map(note=>[note,buildDiatonicSevenths(note).slice(0,6)]));
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

function randomIndex(length: number) {
  return length > 0 ? Math.floor(Math.random() * length) : 0;
}

function transposeChartChord(symbol:string, fromKey:string, toKey:string) {
  if (fromKey === toKey) return symbol;
  const sourceKey = parseSpelledNote(fromKey); const destinationKey = parseSpelledNote(toKey);
  const steps = (LETTERS.indexOf(destinationKey.letter) - LETTERS.indexOf(sourceKey.letter) + 7) % 7;
  const semitones = (destinationKey.pitchClass - sourceKey.pitchClass + 12) % 12;
  const transposeNote = (note:string) => spellInterval(note,steps,semitones);
  const parsed = parseChordParts(symbol);
  return `${transposeNote(parsed.root.display)}${parsed.suffix}${parsed.slashBass?`/${transposeNote(parsed.slashBass.display)}`:""}`;
}

const PROGRESSIONS = [
  { name: "Pop anthem · I–V–vi–IV", degrees: [0,4,5,3] },
  { name: "50s changes · I–vi–IV–V", degrees: [0,5,3,4] },
  { name: "Jazz turnaround · I–vi–ii–V", degrees: [0,5,1,4] },
  { name: "Soul lift · I–iii–IV–V", degrees: [0,2,3,4] },
  { name: "Sensitive pop · vi–IV–I–V", degrees: [5,3,0,4] },
  { name: "Gospel walk · I–IV–ii–V", degrees: [0,3,1,4] },
  { name: "Doo-wop · I–vi–ii–V", degrees: [0,5,1,4] },
  { name: "Royal road · IV–V–iii–vi", degrees: [3,4,2,5] },
  { name: "Plagal soul · I–IV–I–IV", degrees: [0,3,0,3] },
];

type GeneratorMode = "common" | "custom" | "resolve" | "circle" | "standards" | "gospel";

function parseChord(chord: string) {
  const parsedRoot = parseChordParts(chord);
  const root = parsedRoot.root.pitchClass;
  const suffix = parsedRoot.suffix;
  const hasExtension = /7|9|11|13/.test(suffix);
  const isMinor = suffix.startsWith("m") && !suffix.startsWith("maj");
  const quality = /mMaj7/i.test(suffix) ? "minorMajor7"
    : isMinor && suffix.includes("♭5") ? "halfDim7"
    : suffix.includes("maj") && suffix.includes("♭5") ? "maj7Flat5"
    : /^m(?:6|69|6\/9)/.test(suffix) ? "minor6"
    : /^(?:6|69|6\/9|M6)/.test(suffix) ? "major6"
    : suffix.includes("sus") ? hasExtension ? "sus7" : "sus"
    : suffix.includes("♯5") ? "aug7"
    : suffix.includes("dim") ? hasExtension ? "dim7" : "dim"
    : suffix.includes("aug") ? hasExtension ? "aug7" : "aug"
    : /^(?:maj|M7|7\+)/.test(suffix) ? "maj7"
    : suffix.startsWith("m+") ? "minorAug"
    : isMinor ? hasExtension ? "m7" : "minor"
    : hasExtension ? "7" : "major";
  return { root: Math.max(0, root), quality };
}

function setChordComplexity(chord:string, level:"triad"|"7"|"9"|"11"|"13") {
  const parsed = parseChordParts(chord);
  const rootName = parsed.root.display;
  const bass = parsed.slashBass ? `/${parsed.slashBass.display}` : "";
  const suffix = parsed.suffix;
  if (suffix.includes("m6")) return `${rootName}m6${bass}`;
  const family = suffix.includes("♭5") ? "half-diminished" : suffix.includes("dim") ? "diminished" : suffix.includes("aug") ? "augmented" : suffix.includes("maj") ? "major" : suffix.includes("m") ? "minor" : "dominant";
  if (family === "half-diminished") return `${level==="triad"?`${rootName}dim`:`${rootName}m7♭5`}${bass}`;
  if (level === "triad") return `${rootName}${family==="minor"?"m":family==="diminished"?"dim":family==="augmented"?"aug":""}${bass}`;
  if (suffix.includes("♭9")) return `${rootName}7♭9${bass}`;
  if (suffix.includes("♯5")) return `${rootName}7♯5${bass}`;
  if (level === "7") return `${rootName}${family==="major"?"maj7":family==="minor"?"m7":family==="diminished"?"dim7":family==="augmented"?"aug7":"7"}${bass}`;
  return `${rootName}${family==="major"?`maj${level}`:family==="minor"?`m${level}`:family==="diminished"?`dim${level}`:family==="augmented"?`aug${level}`:level}${bass}`;
}

function targetChord(note:string, quality:"major"|"minor"|"dominant"|"diminished"|"augmented") {
  return `${note}${quality==="major"?"maj7":quality==="minor"?"m7":quality==="dominant"?"7":quality==="diminished"?"dim7":"aug7"}`;
}

function musicalComplexity(chord:string, requested:"7"|"9"|"11"|"13") {
  const {quality} = parseChord(chord);
  if (["halfDim7","dim","dim7","aug","aug7"].includes(quality)) return "7" as const;
  if (quality === "major" || quality === "maj7") return requested === "11" || requested === "13" ? "9" as const : requested;
  if (quality === "minor" || quality === "m7" || quality === "minor6") return requested === "13" ? "11" as const : requested;
  return requested === "11" ? "9" as const : requested;
}

function noteName(midi: number) {
  return `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function chordNoteName(midi:number,chord:string){return `${spellChordPitch(chord,midi%12)}${Math.floor(midi/12)-1}`}

function melodyMidiForWrittenNote(note:string, low=67, high=84) {
  const pitchClass = parseSpelledNote(note).pitchClass;
  let midi = low + ((pitchClass - low % 12 + 12) % 12);
  while (midi > high) midi -= 12;
  return midi;
}

function rightHandFinger(index: number, voiceCount: number) {
  const fingerings: Record<number, number[]> = {
    3: [1, 3, 5],
    4: [1, 2, 3, 5],
    5: [1, 2, 3, 4, 5],
  };
  return fingerings[voiceCount]?.[index] ?? index + 1;
}

function leftHandFinger(index: number, voiceCount: number) {
  const fingerings: Record<number, number[]> = {
    1: [5],
    2: [5, 2],
    3: [5, 3, 1],
    4: [5, 4, 2, 1],
  };
  return fingerings[voiceCount]?.[index] ?? Math.max(1, 5 - index);
}

/**
 * Cadence's own soft EP is deliberately synth based: it is instant, works
 * offline, and retains the sound long-time users expect. The sampled piano
 * and orchestra patches load only when the musician chooses them.
 */
type SoundPatch = "cadence" | "grand" | OrchestraPatch;
type NoteStop = (time?: number) => void;
type SampledInstrument = {
  ready: Promise<unknown>;
  start: (event: { note: number; time?: number; duration?: number; velocity?: number }) => NoteStop;
};

let sharedAudioContext: AudioContext | null = null;
let sampledContext: AudioContext | null = null;
const sampledInstruments: Partial<Record<SoundPatch, SampledInstrument>> = {};
const sampledLoads: Partial<Record<SoundPatch, Promise<void>>> = {};
let activeSamplePatch: SoundPatch = "cadence";
let activeNoteStops: NoteStop[] = [];
let activeMetronomeNodes: OscillatorNode[] = [];
let pendingSampleRequest = 0;

function silenceActiveNotes(ctx?: AudioContext, stopMetronome = true) {
  pendingSampleRequest += 1;
  const time = ctx?.currentTime;
  activeNoteStops.forEach(stop => {
    try { stop(time); } catch { /* A completed voice has nothing left to stop. */ }
  });
  activeNoteStops = [];
  if (stopMetronome) {
    activeMetronomeNodes.forEach(node => { try { node.stop(time); } catch { /* already finished */ } });
    activeMetronomeNodes = [];
  }
}

function releaseUnusedSamplePatches(keep:SoundPatch) {
  (Object.keys(sampledInstruments) as SoundPatch[]).forEach(patch => { if (patch !== keep) delete sampledInstruments[patch]; });
}

function disposeAudioEngine() {
  silenceActiveNotes(sharedAudioContext ?? undefined);
  const context = sharedAudioContext;
  sharedAudioContext = null; sampledContext = null; activeSamplePatch = "cadence";
  (Object.keys(sampledInstruments) as SoundPatch[]).forEach(key => delete sampledInstruments[key]);
  (Object.keys(sampledLoads) as SoundPatch[]).forEach(key => delete sampledLoads[key]);
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
}

function activateAudioFromGesture() {
  sharedAudioContext = createInteractiveAudioContext(
    window as typeof window & { webkitAudioContext?: typeof AudioContext },
    sharedAudioContext,
  );
  if (sharedAudioContext) void resumeAudioFromGesture(sharedAudioContext);
  return sharedAudioContext;
}

function playNotes(midis: number[], holdSeconds = 1.15, bassMidi?: number, patch: SoundPatch = "cadence", phraseIndex = 0) {
  // Build and start the actual notes before the trusted gesture returns. Safari
  // may reject an oscillator created only after resume() has been awaited.
  const ctx = activateAudioFromGesture();
  if (!ctx) return Promise.resolve(false);
  silenceActiveNotes(ctx);
  activeNoteStops = schedulePlayableNotes(ctx, midis, holdSeconds, bassMidi, patch, phraseIndex);
  return resumeAudioFromGesture(ctx).then(ready => {
    if (!ready && sharedAudioContext === ctx && ctx.state !== "running") sharedAudioContext = null;
    return ready;
  });
}

function playEarTrainingNotes(midis: number[], holdSeconds: number, volume: number) {
  const ctx = activateAudioFromGesture();
  if (!ctx) return;
  silenceActiveNotes(ctx);
  const now = ctx.currentTime;
  const level = Math.max(0, Math.min(1, volume));
  activeNoteStops = midis.map((midi, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const startedAt = now + index * .012;
    const releaseAt = startedAt + Math.max(.2, holdSeconds);
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), startedAt);
    gain.gain.setValueAtTime(.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0001, .12 * level), startedAt + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, releaseAt);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(startedAt);
    oscillator.stop(releaseAt + .04);
    return (time = ctx.currentTime) => {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setTargetAtTime(.0001, time, .012);
      try { oscillator.stop(time + .05); } catch { /* already stopped */ }
    };
  });
  void resumeAudioFromGesture(ctx);
}

function stopEarTrainingAudio() {
  silenceActiveNotes(sharedAudioContext ?? undefined);
}

function scheduleNotes(ctx: AudioContext, midis: number[], holdSeconds = 1.15, bassMidi?: number): NoteStop[] {
  const releaseAt = Math.max(.2, holdSeconds);
  midis.forEach((midi, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const isBass = i === 0 && midi === bassMidi;
    const noteStart = ctx.currentTime + i * 0.035;
    osc.type = isBass ? "sine" : "triangle";
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    // Original Cadence Soft EP envelope: let each note end naturally.
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(isBass ? .15 : .09, noteStart + .02);
    gain.gain.exponentialRampToValueAtTime(.001, noteStart + releaseAt);
    osc.connect(gain).connect(ctx.destination);
    osc.start(noteStart);
    osc.stop(noteStart + releaseAt + .05);
  });
  // Do not force-stop the original Soft EP; that was the source of its click.
  return [];
}

function warmSampledInstrument(ctx: AudioContext, patch: SoundPatch) {
  if (patch === "cadence") return;
  if (sampledContext !== ctx) {
    sampledContext = ctx;
    (Object.keys(sampledInstruments) as SoundPatch[]).forEach(key => delete sampledInstruments[key]);
    (Object.keys(sampledLoads) as SoundPatch[]).forEach(key => delete sampledLoads[key]);
  }
  if (sampledInstruments[patch] || sampledLoads[patch]) return;
  if (patch === "grand") {
    sampledLoads[patch] = import("smplr").then(({ SplendidGrandPiano }) => {
      const instrument = SplendidGrandPiano(ctx, { volume: 86, decayTime: 1.5 });
      return instrument.ready.then(() => { if (activeSamplePatch === patch && sharedAudioContext === ctx) sampledInstruments[patch] = instrument; });
    }).catch(() => undefined).finally(() => { delete sampledLoads[patch]; });
    return;
  }
  const instrument = createOrchestraInstrument(ctx, patch);
  sampledLoads[patch] = instrument.ready.then(() => {
    if (activeSamplePatch === patch && sharedAudioContext === ctx) sampledInstruments[patch] = instrument;
  }).catch(() => undefined).finally(() => { delete sampledLoads[patch]; });
}

function scheduleSampledNotes(ctx: AudioContext, midis: number[], holdSeconds: number, bassMidi: number | undefined, patch: SoundPatch, phraseIndex = 0): NoteStop[] | null {
  if (patch === "cadence") return null;
  const instrument = sampledInstruments[patch];
  if (!instrument) return null;
  const releaseAt = Math.max(.16, holdSeconds - .035);
  const playerAccent = (phraseIndex % 4) * 2;
  return midis.map((midi, index) => {
    const isBass = midi === bassMidi;
    const velocity = Math.max(68, Math.min(112, (isBass ? 78 : 94 + playerAccent) - Math.min(index, 4) * 2));
    return instrument.start({
    note: midi,
    // A tiny roll lets a held chord breathe without becoming an arpeggio.
    time: ctx.currentTime + index * .018,
    duration: releaseAt,
    velocity,
    });
  });
}

function schedulePlayableNotes(ctx: AudioContext, midis: number[], holdSeconds: number, bassMidi: number | undefined, patch: SoundPatch, phraseIndex = 0): NoteStop[] {
  const sampledStops = scheduleSampledNotes(ctx, midis, holdSeconds, bassMidi, patch, phraseIndex);
  if (sampledStops) return sampledStops;
  if (patch === "cadence") return scheduleNotes(ctx, midis, holdSeconds, bassMidi);

  warmSampledInstrument(ctx, patch);
  const request = ++pendingSampleRequest;
  void sampledLoads[patch]?.then(() => {
    if (request !== pendingSampleRequest || sharedAudioContext !== ctx) return;
    const delayedStops = scheduleSampledNotes(ctx, midis, holdSeconds, bassMidi, patch, phraseIndex);
    if (delayedStops) activeNoteStops = delayedStops;
  });
  // Never play a different patch while the selected instrument is loading.
  return [];
}

function scheduleWoodblock(ctx: AudioContext, offsetSeconds: number, accented: boolean) {
  const start = ctx.currentTime + Math.max(0, offsetSeconds);
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(accented ? 2140 : 1460, start);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(accented ? .17 : .09, start + .001);
  gain.gain.exponentialRampToValueAtTime(.0001, start + .055);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + .06);
  activeMetronomeNodes.push(oscillator);
  oscillator.onended = () => { activeMetronomeNodes = activeMetronomeNodes.filter(node => node !== oscillator); };
}

function expandDegrees(degrees: number[], length: number) {
  return Array.from({length}, (_,i)=>degrees[i % degrees.length]);
}

function durationLabel(beats:number) {
  return `${Number.isInteger(beats) ? beats : beats.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} ${beats === 1 ? "BEAT" : "BEATS"}`;
}

const NOTE_LENGTHS = [
  {beats:.25,label:"𝅘𝅥𝅯 Sixteenth"}, {beats:.5,label:"♪ Eighth"}, {beats:1,label:"♩ Quarter"},
  {beats:1.5,label:"♩. Dotted quarter"}, {beats:2,label:"𝅗𝅥 Half"}, {beats:3,label:"𝅗𝅥. Dotted half"},
  {beats:4,label:"𝅝 Whole"}, {beats:8,label:"2 whole notes"},
];

function leadToTarget(chords: string[], target: string, quality:"major"|"minor"|"dominant"|"diminished"|"augmented"="major") {
  const result = [...chords];
  if (result.length === 0) return result;
  result[result.length-1] = targetChord(target,quality);
  if (quality === "minor") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7♭9`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7♭5`;
  } else if (quality === "diminished") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,7)}dim7`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,5)}7♭9`;
  } else if (quality === "augmented") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7♯5`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7`;
  } else {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7`;
  }
  return result;
}

function resolutionPath(sourceNote:string, sourceQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", target:string, targetQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", length:number) {
  const source = targetChord(sourceNote,sourceQuality);
  const cadence = leadToTarget([source,source,source],target,targetQuality);
  const bridgeLength = Math.max(0,length-4);
  const bridge = Array.from({length:bridgeLength},(_,i)=>i%2===0?`${spellRomanDegree(target,6)}m7`:`${spellRomanDegree(target,2)}m7`);
  return [source,...bridge,...cadence].slice(0,length);
}

function audibleNotes(event: VoicedChord, includeBass: boolean) {
  return includeBass ? [event.bass, ...event.upperVoices] : event.upperVoices;
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [adminRoute, setAdminRoute] = useState(false);
  const [earTrainingOpen, setEarTrainingOpen] = useState(false);
  const [key, setKey] = useState("C");
  const [customMode, setCustomMode] = useState<"major" | "minor">("major");
  const [customStyle, setCustomStyle] = useState<CustomProgressionStyle>("gospel");
  const [generatorMode, setGeneratorMode] = useState<GeneratorMode>("common");
  const [circleDirection, setCircleDirection] = useState<CircleDirection>("fourths");
  const [circleApproach, setCircleApproach] = useState<CircleApproach>("ii-v");
  const [extensionsEnabled, setExtensionsEnabled] = useState(true);
  const [extensionLevel, setExtensionLevel] = useState<"7"|"9"|"11"|"13">("7");
  const [preset, setPreset] = useState(0);
  const [standardIndex, setStandardIndex] = useState(0);
  const [standardKey, setStandardKey] = useState("original");
  const [publishedGospelStandards, setPublishedGospelStandards] = useState<StandardSource[]>([]);
  const [controlsOpen, setControlsOpen] = useState(false);
  const progressionLength = 4;
  const [progression, setProgression] = useState(["Cmaj7", "Dm7", "G7", "Cmaj7"]);
  const [durations, setDurations] = useState([1,1,1,1]);
  const [sustainAcrossBars, setSustainAcrossBars] = useState<boolean[]>([]);
  const [selected, setSelected] = useState(0);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [substitutionTarget, setSubstitutionTarget] = useState("next");
  const [showBlockedInfo, setShowBlockedInfo] = useState(false);
  const [globalTarget, setGlobalTarget] = useState("C");
  const [targetQuality, setTargetQuality] = useState<"major"|"minor"|"dominant"|"diminished"|"augmented">("major");
  const [sourceNote, setSourceNote] = useState("C");
  const [sourceQuality, setSourceQuality] = useState<"major"|"minor"|"dominant"|"diminished"|"augmented">("major");
  const [voicing, setVoicing] = useState(0);
  const [fingers, setFingers] = useState(true);
  const [includeBass, setIncludeBass] = useState(true);
  const [compMode, setCompMode] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [soundPatch, setSoundPatch] = useState<SoundPatch>("cadence");
  const soundPatchRef = useRef<SoundPatch>("cadence");
  const [tempo, setTempo] = useState(82);
  const [swingPercent, setSwingPercent] = useState(50);
  const [practiceMeter, setPracticeMeter] = useState("4/4");
  const [activeMidi, setActiveMidi] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [substitutionHistory, setSubstitutionHistory] = useState<Array<{progression:string[];durations:number[];selected:number}>>([]);
  const [reharmTurn, setReharmTurn] = useState(0);
  const reharmBaseRef = useRef<{chords:string[];durations:number[]}|null>(null);
  const playbackTimers = useRef<number[]>([]);
  const progressionRowRef = useRef<HTMLDivElement | null>(null);
  const customImportRef = useRef<HTMLInputElement | null>(null);
  const [customFileNotice, setCustomFileNotice] = useState("");
  const [customUndoSnapshot, setCustomUndoSnapshot] = useState<null | {progression:string[];durations:number[];selected:number;key:string;mode:"major"|"minor"}>(null);
  const lastGeneratedSignature = useRef("");

  useEffect(() => {
    const themeFrame=requestAnimationFrame(()=>setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    const syncFullscreen=()=>setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange",syncFullscreen);
    return ()=>{cancelAnimationFrame(themeFrame);document.removeEventListener("fullscreenchange",syncFullscreen)};
  }, []);
  useEffect(() => {
    // Capture the earliest mobile gesture, before React handlers or progression
    // timers run. Repeating this is intentional: iOS may suspend Web Audio after
    // a tab is backgrounded, a call ends, or the output device changes.
    const unlock = () => { activateAudioFromGesture(); };
    const restore = () => {
      if (document.visibilityState === "visible" && sharedAudioContext) {
        void resumeAudioFromGesture(sharedAudioContext);
      } else if (document.visibilityState === "hidden" && sharedAudioContext?.state === "running") {
        void sharedAudioContext.suspend().catch(() => undefined);
      }
    };
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("touchend", unlock, { capture: true, passive: true });
    // WebKit treats a completed click as the most reliable audio gesture. Run
    // in capture phase so it precedes React's chord/play button handlers.
    window.addEventListener("click", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", restore);
    };
  }, []);
  useEffect(() => {
    if (adminRoute) {
      playbackTimers.current.forEach(clearTimeout); playbackTimers.current = [];
      disposeAudioEngine(); setIsPlaying(false);
    }
    return undefined;
  }, [adminRoute]);
  useEffect(() => () => {
    playbackTimers.current.forEach(clearTimeout); playbackTimers.current = [];
    disposeAudioEngine();
  }, []);
  useEffect(() => {
    const syncAdminRoute = () => setAdminRoute(new URLSearchParams(window.location.search).get("admin") === "1");
    const routeFrame = window.requestAnimationFrame(syncAdminRoute);
    window.addEventListener("popstate", syncAdminRoute);
    return () => { window.cancelAnimationFrame(routeFrame); window.removeEventListener("popstate", syncAdminRoute); };
  }, []);
  useEffect(()=>{ soundPatchRef.current = soundPatch; },[soundPatch]);
  useEffect(() => {
    if (!customFileNotice) return;
    const timer = window.setTimeout(() => setCustomFileNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [customFileNotice]);
  useEffect(() => {
    if (generatorMode !== "custom") return;
    const frame = window.requestAnimationFrame(() => {
      const row = progressionRowRef.current;
      const card = chordCardRefs.current[progression.length - 1];
      if (row && card) row.scrollTo({left:card.offsetLeft-row.clientWidth/2+card.clientWidth/2,behavior:"smooth"});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [generatorMode, progression.length]);
  useEffect(() => {
    const previewEditorChord = (event: Event) => {
      const chordSymbol = (event as CustomEvent<{ chordSymbol?: string }>).detail?.chordSymbol?.trim();
      if (!chordSymbol) return;
      try {
        const [preview] = voiceLeadProgression([chordSymbol], {
          style: "jazz",
          layout: "close",
          includeBass: true,
          upperRange: [55, 81],
          bassRange: [36, 48],
          minimumBassGap: 9,
          maximumHandSpan: 12,
        });
        if (preview) void playNotes(audibleNotes(preview, true), 1.35, preview.bass, soundPatchRef.current);
      } catch {
        // An incomplete symbol can be edited further without interrupting chart work.
      }
    };
    window.addEventListener("faithful-keys-preview-chord", previewEditorChord);
    return () => window.removeEventListener("faithful-keys-preview-chord", previewEditorChord);
  }, []);
  useEffect(() => {
    const refresh = () => { void loadPublishedGospelStandards().then(setPublishedGospelStandards).catch(() => setPublishedGospelStandards([])); };
    refresh();
    window.addEventListener("faithful-keys-gospel-standards", refresh);
    return () => window.removeEventListener("faithful-keys-gospel-standards", refresh);
  }, []);

  function changeSoundPatch(nextPatch: SoundPatch) {
    setSoundPatch(nextPatch);
    soundPatchRef.current = nextPatch;
    activeSamplePatch = nextPatch;
    releaseUnusedSamplePatches(nextPatch);
    // Selecting a sample is a user gesture, so warm it before the next chord.
    const ctx = activateAudioFromGesture();
    if (ctx) void resumeAudioFromGesture(ctx).then(ready => { if (ready) warmSampledInstrument(ctx, nextPatch); });
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("faithful-keys-theme", nextTheme);
  }
  async function toggleFullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}
  const chordCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const chord = progression[selected];
  const gospelStandards = useMemo(() => Array.from(new Map(
    [...GOSPEL_STANDARDS, ...publishedGospelStandards].map(standard => [standard.name, standard]),
  ).values()), [publishedGospelStandards]);
  const activeStandards = generatorMode === "gospel" ? gospelStandards : STANDARDS;
  const isStandardMode = generatorMode === "standards" || generatorMode === "gospel";
  const activeStandard = activeStandards[standardIndex] ?? activeStandards[0];
  const customChordBank = useMemo(() => chordBankForKey(key, customMode), [key, customMode]);
  const standardBarBeats = standardBeatsPerBar(activeStandard as StandardSource);
  const standardMeterText = standardTimeSignatureText(activeStandard as StandardSource);
  const [practiceNumerator, practiceDenominator] = practiceMeter.split("/").map(Number);
  const practiceBeatsPerBar = practiceNumerator * 4 / practiceDenominator;
  const voiceStyle: VoiceLeadingStyle = generatorMode === "standards" ? "jazz"
    : generatorMode === "gospel" ? "gospel"
    : generatorMode === "custom" ? customStyle === "worship" ? "ccm" : customStyle
    : generatorMode === "circle" ? /gospel|iv-iv/.test(circleApproach) ? "gospel" : "jazz"
    : PROGRESSIONS[preset]?.name.includes("Gospel") || PROGRESSIONS[preset]?.name.includes("Soul") ? "gospel"
    : /Pop|Worship|Sensitive/.test(PROGRESSIONS[preset]?.name ?? "") ? "ccm"
    : "traditional";
  const voiceLayout = (["close", "open", "drop2"] as const)[voicing] satisfies VoicingLayout;
  const standardVoicedProgression = useMemo(() => voiceLeadProgression(progression, {
    style: voiceStyle,
    layout: voiceLayout,
    includeBass: true,
    upperRange: [55, 81],
    bassRange: [36, 48],
    minimumBassGap: 9,
    maximumHandSpan: 12,
  }), [progression, voiceStyle, voiceLayout]);
  const chartMelodyAnchors = useMemo(() => {
    if (!isStandardMode) return [] as Array<number | undefined>;
    const writtenMelody = (activeStandard as StandardSource).melody ?? [];
    return writtenMelody.map(note => melodyMidiForWrittenNote(
      standardKey === "original" ? note : transposeChartChord(note, activeStandard.key, standardKey),
    ));
  }, [activeStandard, isStandardMode, standardKey]);
  const compVoicedProgression = useMemo(() => {
    const leftHand = voiceLeadProgression(progression, {
      style: voiceStyle, layout: "close", includeBass: true,
      upperRange: [47, 61], bassRange: [33, 42], minimumBassGap: 7, maximumHandSpan: 10,
    });
    const melody = voiceLeadProgression(progression, {
      style: voiceStyle, layout: "close", includeBass: false,
      upperRange: [67, 79], bassRange: [36, 48], minimumBassGap: 9, maximumHandSpan: 10,
    });
    return leftHand.map((event,index) => {
      // Never invent a melody for a standard: a right-hand note is used only
      // when it is supplied by the chart's melody data.
      const melodyNote = isStandardMode ? chartMelodyAnchors[index] : melody[index]?.upperVoices.at(-1) ?? event.upperVoices.at(-1)! + 12;
      const upperVoices = melodyNote === undefined ? event.upperVoices : [...event.upperVoices, melodyNote];
      return {...event, upperVoices, notes:[event.bass,...upperVoices]};
    });
  }, [chartMelodyAnchors, isStandardMode, progression, voiceStyle]);
  const voicedProgression = compMode ? compVoicedProgression : standardVoicedProgression;
  const voicedChord = voicedProgression[selected] ?? voicedProgression[0];
  const chordMidis = voicedChord?.upperVoices ?? [48,52,55,59];

  const standardSequence = (index=standardIndex, requestedKey=standardKey) => {
    const standard = activeStandards[index] ?? activeStandards[0];
    const events = standardTimeline(standard as StandardSource);
    const keyToUse = requestedKey === "original" ? standard.key : requestedKey;
    return {
      chords: events.map(event=>transposeChartChord(event.chord,standard.key,keyToUse)),
      durations: events.map(event=>event.beats),
      sustainAcrossBars: events.map(event=>event.sustainAcrossBar),
    };
  };

  function reharmProgression() {
    // Always rethink from the original chart. This avoids stacking accidental
    // substitutions and lets each press demonstrate a fresh functional route.
    const original = reharmBaseRef.current ?? {chords:[...progression], durations:[...durations]};
    if (!reharmBaseRef.current) reharmBaseRef.current = original;
    const reharmTonic = generatorMode === "resolve" ? globalTarget : isStandardMode && standardKey === "original" ? activeStandard.key : isStandardMode ? standardKey : key;
    const result = buildFunctionReharm(original.chords, original.durations, reharmTonic, reharmTurn, isStandardMode || extensionsEnabled);
    if (result.changedIndex === null) return;
    setProgression(result.chords); setDurations(result.durations); setSelected(result.changedIndex); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
    setReharmTurn(turn => turn + 1);
  }

  function clearReharm() {
    reharmBaseRef.current = null; setReharmTurn(0);
  }
  const routeForMode = (chords:string[], mode=generatorMode, length=progressionLength, quality=targetQuality) => (mode==="standards"||mode==="gospel")?standardSequence(standardIndex).chords:mode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,quality,length):chords;

  const applyComplexity = (chords:string[], enabled=extensionsEnabled, level=extensionLevel, mode=generatorMode) => chords.map((chordName,index)=>{
    if (mode === "standards" || mode === "gospel") return chordName;
    if (!enabled) return setChordComplexity(chordName,"triad");
    const isTarget = mode!=="common" && index===chords.length-1;
    const isDominant = !chordName.includes("maj") && !chordName.includes("m") && !chordName.includes("dim") && !chordName.includes("aug");
    const isMinor = chordName.includes("m") && !chordName.includes("maj");
    const isPhraseTonic = index%4===0;
    const isPredominant = index===chords.length-3;
    if (isTarget) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isDominant) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isMinor && isPredominant) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isPhraseTonic) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    return setChordComplexity(chordName,"triad");
  });

  const circleSequence = (
    startNote=key as CircleNote,
    direction=circleDirection,
    approach=circleApproach,
    enabled=extensionsEnabled,
    level=extensionLevel,
  ) => {
    const events = buildCircleWarmup({startNote,direction,approach});
    const chords = events.map((event) => {
      if (!enabled) return setChordComplexity(event.chord,"triad");
      if (event.role === "target") {
        // State the destinations clearly. Add color only at four-key landmarks
        // and the final homecoming instead of extending every target chord.
        const landmark = event.legIndex%4===0 || event.legIndex===12;
        return setChordComplexity(event.chord,landmark?musicalComplexity(event.chord,level):"triad");
      }
      const finalApproach = event.approachStep === (event.approachStepCount??1)-1;
      const phraseColor = finalApproach && event.legIndex%3===0 && level!=="7";
      return setChordComplexity(event.chord,phraseColor?musicalComplexity(event.chord,level):"7");
    });
    return {events,chords,durations:events.map(event=>event.duration)};
  };

  const loadCircleSequence = (
    direction=circleDirection,
    approach=circleApproach,
    startNote=key as CircleNote,
    enabled=extensionsEnabled,
    level=extensionLevel,
  ) => {
    const sequence = circleSequence(startNote,direction,approach,enabled,level);
    setProgression(sequence.chords); setDurations(sequence.durations);
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  };

  function generate() {
    clearReharm();
    if (isStandardMode) {
      const sequence = standardSequence();
      setProgression(sequence.chords); setDurations(sequence.durations); setSustainAcrossBars(sequence.sustainAcrossBars);
      setSelected(0); setEditTarget(null); setSubstitutionHistory([]); setVoicing(0); return;
    }
    if (generatorMode === "circle") {
      loadCircleSequence();
      return;
    }
    const pool = MAJOR[key] || MAJOR.C;
    const tonicFirst = PROGRESSIONS.map((p,i)=>({p,i})).filter(({p})=>p.degrees[0]===0 && p.degrees.includes(0));
    const alternatives = tonicFirst.filter(({i})=>i!==preset);
    const next = alternatives[randomIndex(alternatives.length)] || tonicFirst[0];
    setPreset(next.i);
    const degrees = expandDegrees(next.p.degrees, progressionLength);
    const nextChords = degrees.map((n) => pool[n]);
    setProgression(applyComplexity(routeForMode(nextChords)));
    setDurations(degrees.map(()=>1));
    setSelected(0);
    setEditTarget(null);
    setSubstitutionHistory([]);
    setVoicing(0);
  }

  function choosePreset(index: number) {
    clearReharm();
    const pool = MAJOR[key] || MAJOR.C;
    setPreset(index);
    const degrees = expandDegrees(PROGRESSIONS[index].degrees, progressionLength);
    const nextChords = degrees.map(n=>pool[n]);
    setProgression(applyComplexity(routeForMode(nextChords)));
    setDurations(degrees.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function applySubstitution(chords: string[]) {
    if (editTarget === null) return;
    const index = editTarget;
    const coloredChords = applyComplexity(chords);
    setSubstitutionHistory(h=>[...h,{progression:[...progression],durations:[...durations],selected}]);
    setProgression((p) => [...p.slice(0,index), ...coloredChords, ...p.slice(index+1)]);
    setDurations((d) => {
      const replacedBeats = d[index] ?? 1;
      return [...d.slice(0,index), ...coloredChords.map(()=>replacedBeats/coloredChords.length), ...d.slice(index+1)];
    });
    setSelected(index); setVoicing(0); setEditTarget(null);
  }

  function chooseGlobalTarget(note: string) {
    clearReharm();
    setGlobalTarget(note);
    const pool = MAJOR[key] || MAJOR.C;
    const base = expandDegrees(PROGRESSIONS[preset].degrees,progressionLength).map(n=>pool[n]);
    const routed = generatorMode==="resolve"?resolutionPath(sourceNote,sourceQuality,note,targetQuality,progressionLength):leadToTarget(base,note,targetQuality);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,generatorMode));
    setDurations(d=>d.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseTargetQuality(quality:"major"|"minor"|"dominant"|"diminished"|"augmented") {
    clearReharm();
    setTargetQuality(quality);
    const pool = MAJOR[key] || MAJOR.C;
    const base = expandDegrees(PROGRESSIONS[preset].degrees,progressionLength).map(n=>pool[n]);
    const routed = generatorMode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,quality,progressionLength):leadToTarget(base,globalTarget,quality);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,generatorMode));
    setDurations(d=>d.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseSource(note:string, quality=sourceQuality) {
    clearReharm();
    setSourceNote(note); setSourceQuality(quality);
    const routed = resolutionPath(note,quality,globalTarget,targetQuality,progressionLength);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,"resolve"));
    setDurations(routed.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseGeneratorMode(nextMode:GeneratorMode) {
    clearReharm();
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const nextChords = degrees.map(n=>pool[n]);
    setGeneratorMode(nextMode); setControlsOpen(false);
    if (nextMode === "custom") {
      const homeChord = chordBankForKey(key, customMode)[0]?.chord ?? `${key}maj7`;
      setProgression([homeChord]); setDurations([1]); setSustainAcrossBars([]);
      setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
      setCustomUndoSnapshot(null);
      return;
    }
    if (nextMode === "circle") {
      loadCircleSequence();
      return;
    }
    const nextLibrary = nextMode === "gospel" ? gospelStandards : STANDARDS;
    const nextStandard = nextLibrary[0];
    const standardEvents = standardTimeline(nextStandard as StandardSource);
    const standard = {chords:standardEvents.map(event=>event.chord),durations:standardEvents.map(event=>event.beats),sustainAcrossBars:standardEvents.map(event=>event.sustainAcrossBar)};
    const isNextStandardMode = nextMode==="standards" || nextMode==="gospel";
    const routed = isNextStandardMode?standard.chords:nextMode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,targetQuality,progressionLength):nextChords;
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,nextMode));
    setStandardIndex(0); setStandardKey("original"); setDurations(isNextStandardMode?standard.durations:degrees.map(()=>1));
    setSustainAcrossBars(isNextStandardMode ? standard.sustainAcrossBars : []);
    if (isNextStandardMode) {
      setSwingPercent(normalizeSwingPercent(nextStandard.swingPercent));
    }
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function addCustomChord(chordName:string) {
    if (progression.length >= 256) { setCustomFileNotice("This progression has reached the 256-chord device safety limit."); return; }
    clearReharm();
    setProgression(chords => [...chords, chordName]);
    setDurations(values => [...values, 1]);
    setSelected(progression.length); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function generateCustomIdea() {
    playbackTimers.current.forEach(clearTimeout); playbackTimers.current = [];
    if (isPlaying) silenceActiveNotes(sharedAudioContext ?? undefined);
    setIsPlaying(false); clearReharm();
    setCustomUndoSnapshot({progression:[...progression],durations:[...durations],selected,key,mode:customMode});
    let generated = generateCustomProgression({key,mode:customMode,style:customStyle,meterBeats:practiceBeatsPerBar});
    let signature = `${generated.establishedKey}|${generated.chords.join("|")}|${generated.durations.join("|")}`;
    for (let attempt = 0; attempt < 5 && signature === lastGeneratedSignature.current; attempt += 1) {
      generated = generateCustomProgression({key,mode:customMode,style:customStyle,meterBeats:practiceBeatsPerBar});
      signature = `${generated.establishedKey}|${generated.chords.join("|")}|${generated.durations.join("|")}`;
    }
    lastGeneratedSignature.current = signature;
    setProgression(generated.chords); setDurations(generated.durations); setSustainAcrossBars([]);
    setKey(generated.establishedKey); setSelected(0); setEditTarget(null); setSubstitutionHistory([]);
    setCustomFileNotice(generated.modulated
      ? generated.returnedHome ? "Generated a progression that travels to another key and returns home." : `Generated a progression that settles naturally in ${generated.establishedKey}.`
      : `Generated a fresh ${customStyle === "ccm" ? "CCM" : customStyle} progression in ${key}.`);
  }

  function undoCustomGeneration() {
    if (!customUndoSnapshot) return;
    setProgression(customUndoSnapshot.progression); setDurations(customUndoSnapshot.durations);
    setSelected(customUndoSnapshot.selected); setKey(customUndoSnapshot.key); setCustomMode(customUndoSnapshot.mode);
    setEditTarget(null); setSubstitutionHistory([]); setCustomUndoSnapshot(null); setVoicing(0); clearReharm();
    setCustomFileNotice("Previous custom progression restored.");
  }

  function removeCustomChord(index:number) {
    if (progression.length <= 1) return;
    setProgression(chords => chords.filter((_, chordIndex) => chordIndex !== index));
    setDurations(values => values.filter((_, chordIndex) => chordIndex !== index));
    setSelected(current => Math.max(0, Math.min(current > index ? current - 1 : current, progression.length - 2)));
    setEditTarget(null); setSubstitutionHistory([]); setVoicing(0);
  }

  function setCustomChordDuration(index:number, beats:number) {
    if (!Number.isFinite(beats)) return;
    const nextDuration = Math.max(.25, Math.min(64, Math.round(beats * 4) / 4));
    setDurations(values => values.map((duration, chordIndex) => chordIndex === index ? nextDuration : duration));
  }

  function clearCustomProgression() {
    const homeChord = customChordBank[0]?.chord ?? `${key}maj7`;
    setProgression([homeChord]); setDurations([1]); setSelected(0);
    setEditTarget(null); setSubstitutionHistory([]); setCustomUndoSnapshot(null); setVoicing(0); clearReharm();
  }

  async function downloadCustomProgression() {
    const payload = {
      format: "faithful-keys-progression",
      version: 1,
      savedAt: new Date().toISOString(),
      chordBank: { key, mode: customMode },
      playback: { meter: practiceMeter, tempo, swingPercent },
      generator: { style: customStyle },
      progression: progression.map((chordName,index)=>({ chord: chordName, beats: durations[index] ?? 1 })),
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const suggestedName = `faithful-keys-${key.replace(/♯/g,"sharp").replace(/♭/g,"flat")}-progression.json`;
    const savePicker = (window as typeof window & {showSaveFilePicker?: (options:{suggestedName:string;types:Array<{description:string;accept:Record<string,string[]>}>})=>Promise<{createWritable:()=>Promise<{write:(data:Blob)=>Promise<void>;close:()=>Promise<void>}>}>}).showSaveFilePicker;
    if (savePicker) {
      try {
        const handle = await savePicker({suggestedName,types:[{description:"Faithful Keys progression",accept:{"application/json":[".json"]}}]});
        const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
        setCustomFileNotice("Progression saved to this device."); return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCustomFileNotice("The save browser could not finish. Trying the device download instead.");
      }
    }
    const shareFile = new File([blob],suggestedName,{type:"application/json"});
    if (navigator.canShare?.({files:[shareFile]})) {
      try { await navigator.share({files:[shareFile],title:"Save Faithful Keys progression"}); setCustomFileNotice("Progression sent to the selected location."); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setCustomFileNotice("Progression downloaded to this device.");
  }

  async function importCustomProgression(file:File) {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose a Faithful Keys progression file under 2 MB.");
      const payload = JSON.parse(await file.text()) as {
        format?:string; version?:number; chordBank?:{key?:string;mode?:string};
        playback?:{meter?:string;tempo?:number;swingPercent?:number}; generator?:{style?:string}; progression?:Array<{chord?:string;beats?:number}>;
      };
      if (payload.format !== "faithful-keys-progression" || payload.version !== 1 || !Array.isArray(payload.progression) || payload.progression.length === 0) throw new Error("This is not a valid Faithful Keys progression file.");
      if (payload.progression.length > 256) throw new Error("This file exceeds the 256-chord device safety limit.");
      const imported = payload.progression.map(item=>{
        const chordName = item.chord?.trim();
        if (!chordName) throw new Error("The progression contains an empty chord.");
        parseChordParts(chordName);
        const beats = Number(item.beats);
        if (!Number.isFinite(beats) || beats < .25 || beats > 64) throw new Error(`The duration for ${chordName} is outside the supported range.`);
        return {chord:chordName,beats:Math.round(beats*4)/4};
      });
      const importedKey = payload.chordBank?.key;
      const importedMode = payload.chordBank?.mode;
      if (importedKey && NOTES.includes(importedKey)) setKey(importedKey);
      if (importedMode === "major" || importedMode === "minor") setCustomMode(importedMode);
      if (payload.playback?.meter && ["2/4","3/4","4/4","5/4","6/8","7/8"].includes(payload.playback.meter)) setPracticeMeter(payload.playback.meter);
      if (Number.isFinite(payload.playback?.tempo)) setTempo(Math.max(10,Math.min(250,Math.round(payload.playback!.tempo!))));
      if (Number.isFinite(payload.playback?.swingPercent)) setSwingPercent(normalizeSwingPercent(payload.playback!.swingPercent!));
      if (["gospel","jazz","ccm","worship"].includes(payload.generator?.style ?? "")) setCustomStyle(payload.generator!.style as CustomProgressionStyle);
      setProgression(imported.map(item=>item.chord)); setDurations(imported.map(item=>item.beats));
      setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]); setCustomUndoSnapshot(null); clearReharm();
      setCustomFileNotice(`Imported ${imported.length} chord${imported.length===1?"":"s"} from ${file.name}.`);
    } catch (error) {
      setCustomFileNotice(error instanceof Error ? error.message : "The progression could not be imported.");
    } finally {
      if (customImportRef.current) customImportRef.current.value = "";
    }
  }

  function chooseStandard(index:number) {
    clearReharm();
    const sequence = standardSequence(index);
    const nextStandard = activeStandards[index] ?? activeStandards[0];
    setStandardIndex(index); setProgression(sequence.chords); setDurations(sequence.durations); setSustainAcrossBars(sequence.sustainAcrossBars);
    setSwingPercent(normalizeSwingPercent(nextStandard.swingPercent));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseStandardKey(nextKey:string) {
    clearReharm();
    const sequence = standardSequence(standardIndex,nextKey);
    setStandardKey(nextKey); setProgression(sequence.chords); setDurations(sequence.durations); setSustainAcrossBars(sequence.sustainAcrossBars);
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseCircleDirection(direction:CircleDirection) {
    clearReharm();
    setCircleDirection(direction);
    loadCircleSequence(direction);
  }

  function chooseCircleApproach(approach:CircleApproach) {
    clearReharm();
    setCircleApproach(approach);
    loadCircleSequence(circleDirection,approach);
  }

  function chooseComplexity(enabled:boolean, level=extensionLevel) {
    clearReharm();
    setExtensionsEnabled(enabled); setExtensionLevel(level);
    if (generatorMode === "circle") {
      loadCircleSequence(circleDirection,circleApproach,key as CircleNote,enabled,level);
      return;
    }
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const baseChords = degrees.map(n=>pool[n]);
    const routed = routeForMode(baseChords);
    setProgression(applyComplexity(routed,enabled,level,generatorMode));
    setDurations(degrees.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function undoSubstitution() {
    const previous = substitutionHistory[substitutionHistory.length-1];
    if (!previous) return;
    setProgression(previous.progression); setDurations(previous.durations); setSelected(previous.selected);
    setSubstitutionHistory(h=>h.slice(0,-1)); setEditTarget(null); setVoicing(0);
  }

  function reset() {
    clearReharm();
    setGeneratorMode("common"); setKey("C"); setPreset(0);
    setCustomStyle("gospel"); setCustomUndoSnapshot(null);
    setCircleDirection("fourths"); setCircleApproach("ii-v");
    setExtensionsEnabled(true); setExtensionLevel("7");
    setSwingPercent(50);
    setControlsOpen(false);
    setProgression(["Cmaj7", "Dm7", "G7", "Cmaj7"]);
    setDurations([1,1,1,1]);
    setGlobalTarget("C");
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function playProgression() {
    playbackTimers.current.forEach(clearTimeout);
    playbackTimers.current = [];
    if (isPlaying) { silenceActiveNotes(sharedAudioContext ?? undefined); setIsPlaying(false); return; }

    // Unlock audio while this click still counts as a user gesture. The actual
    // progression notes are dispatched by timers, which cannot unlock audio.
    const ctx = activateAudioFromGesture();
    if (!ctx) { setIsPlaying(false); return; }
    void resumeAudioFromGesture(ctx).then(ready => {
      if (ready) return;
      playbackTimers.current.forEach(clearTimeout);
      playbackTimers.current = [];
      if (sharedAudioContext === ctx) sharedAudioContext = null;
      setIsPlaying(false);
    });

    silenceActiveNotes(ctx);
    setIsPlaying(true);
    const beat = 60000 / tempo;
    const totalBeats = durations.reduce((total, duration) => total + (duration ?? 1), 0);
    const beatsPerAccent = isStandardMode ? standardBarBeats : practiceBeatsPerBar;
    if (metronomeEnabled) {
      for (let beatIndex = 0; beatIndex < totalBeats - .001; beatIndex += 1) {
        const isFirstBeat = Math.abs(beatIndex % beatsPerAccent) < .001;
        scheduleWoodblock(ctx, beatIndex * beat / 1000, isFirstBeat);
      }
    }
    let elapsed = 0;
    progression.forEach((_chordName, i) => {
      const eventBeats = durations[i] ?? 1;
      const eventStart = swingBeatPosition(elapsed, swingPercent);
      const eventEnd = swingBeatPosition(elapsed + eventBeats, swingPercent);
      const eventDuration = Math.max(.05, eventEnd - eventStart);
      const playEvent = () => {
      const event = voicedProgression[i];
      if (!event) return;
      setSelected(i);
      const notes = audibleNotes(event, includeBass);
      const sustainThroughBar = isStandardMode && Boolean(sustainAcrossBars[i]);
      const previousSustains = isStandardMode && i > 0 && Boolean(sustainAcrossBars[i - 1]);
      const playbackLength = eventDuration * beat / 1000 * (sustainThroughBar ? 1.12 : .94);
      if (ctx.state === "running") {
        if (!previousSustains) silenceActiveNotes(ctx, false);
        activeNoteStops = schedulePlayableNotes(ctx, notes, playbackLength, includeBass ? event.bass : undefined, soundPatchRef.current, i);
      } else {
        void playNotes(notes, playbackLength, includeBass ? event.bass : undefined, soundPatch);
      }
      const row = progressionRowRef.current;
      const card = chordCardRefs.current[i];
      if (row && card) row.scrollTo({left:card.offsetLeft-row.clientWidth/2+card.clientWidth/2,behavior:"smooth"});
      };
      if (elapsed === 0) playEvent();
      else playbackTimers.current.push(window.setTimeout(playEvent, eventStart * beat));
      elapsed += durations[i] ?? 1;
    });
    playbackTimers.current.push(window.setTimeout(()=>{setIsPlaying(false);playbackTimers.current=[];activeMetronomeNodes=[]}, swingBeatPosition(elapsed, swingPercent) * beat));
  }

  const bassMidi = voicedChord?.bass ?? 36;
  const keyboardNotes = includeBass?[bassMidi, ...chordMidis]:chordMidis;
  const compLeftHandMidis = compMode ? chordMidis.slice(0,-1) : [];
  const keyboardFinger = (midi:number) => {
    if (includeBass && midi === bassMidi) return <b className="bass-finger">{leftHandFinger(0,1)}</b>;
    if (compMode && compLeftHandMidis.includes(midi)) return <b className="bass-finger">{leftHandFinger(compLeftHandMidis.indexOf(midi),compLeftHandMidis.length)}</b>;
    if (chordMidis.includes(midi) && fingers) return <b>{compMode ? 1 : rightHandFinger(chordMidis.indexOf(midi),chordMidis.length)}</b>;
    return null;
  };
  const whites = Array.from({length:49},(_,i)=>36+i).filter(m=>![1,3,6,8,10].includes(m%12));
  const blacks = Array.from({length:49},(_,i)=>36+i).filter(m=>[1,3,6,8,10].includes(m%12));
  const nextDestination = editTarget === null ? chord : progression[(editTarget+1)%progression.length];
  const editDestination = substitutionTarget === "next" ? nextDestination : `${substitutionTarget}maj7`;
  const destination = parseChord(editDestination);
  const destinationRootName = parseChordRoot(editDestination).root.display;
  const minorDestination = destination.quality === "minor" || destination.quality === "m7" || destination.quality === "halfDim7";
  const majorDestination = ["major","major6","maj7"].includes(destination.quality);
  const stableDestination = !["dim","dim7","aug","aug7","halfDim7"].includes(destination.quality);
  const degree = (value:1|2|3|4|5|6|7,alteration=0) => spellRomanDegree(destinationRootName,value,alteration);
  const substitutionOptions = [
    {roman:"V/next", name:"Secondary dominant", chords:[`${degree(5)}7`], allowed:true},
    {roman:"vii°7/next", name:"Leading diminished", chords:[`${degree(7)}dim7`], allowed:true},
    {roman:"♭II7/next", name:"Tritone dominant", chords:[`${degree(2,-1)}7`], allowed:stableDestination},
    {roman:minorDestination?"iiø–V7alt/next":"ii–V/next", name:minorDestination?"Minor two-five":"Major two-five", chords:minorDestination?[`${degree(2)}m7♭5`,`${degree(5)}7♭9`]:[`${degree(2)}m7`,`${degree(5)}7`], allowed:stableDestination},
    {roman:"iii–VI/next", name:"Three-six approach", chords:[`${degree(3)}m7`,`${degree(6)}7`], allowed:stableDestination},
    {roman:"iv–♭VII/next", name:"Backdoor two-five", chords:[`${degree(4)}m7`,`${degree(7,-1)}7`], allowed:majorDestination},
    {roman:"♭vi–♭II/next", name:"Tritone two-five", chords:[`${degree(6,-1)}m7`,`${degree(2,-1)}7`], allowed:majorDestination},
    {roman:"IV–iv/next", name:"Major-to-minor plagal", chords:[`${degree(4)}maj7`,`${degree(4)}m7`], allowed:majorDestination},
    {roman:"♭IImaj7/next", name:"Phrygian borrowed color", chords:[`${degree(2,-1)}maj7`], allowed:majorDestination},
    {roman:"♭VImaj7/next", name:"Aeolian borrowed color", chords:[`${degree(6,-1)}maj7`], allowed:majorDestination},
    {roman:"iiø/next", name:"Half-diminished V alternative", chords:[`${degree(2)}m7♭5`], allowed:majorDestination},
    {roman:"ivm6/next", name:"Minor-six V alternative", chords:[`${degree(4)}m6`], allowed:majorDestination},
    {roman:"ivø/next", name:"Borrowed half-diminished", chords:[`${degree(4)}m7♭5`], allowed:majorDestination},
    {roman:"♭VIm6/next", name:"Flat-six minor alternative", chords:[`${degree(6,-1)}m6`], allowed:majorDestination},
  ];
  const blockedOptions = substitutionOptions.filter(option=>!option.allowed);
  const activeCircleApproach = CIRCLE_APPROACH_OPTIONS.find(option=>option.id===circleApproach) ?? CIRCLE_APPROACH_OPTIONS[2];
  const circleDirectionLabel = circleDirection === "fourths" ? "fourths" : "fifths";
  const circleEvents = generatorMode === "circle" ? buildCircleWarmup({startNote:key as CircleNote,direction:circleDirection,approach:circleApproach}) : [];
  const sectionStep = isStandardMode
    ? `01 · ${activeStandard.bars.length} BARS · ${standardMeterText}`
    : generatorMode === "circle" ? `01 · 12 KEYS · CIRCLE OF ${circleDirectionLabel.toUpperCase()}`
    : generatorMode === "custom" ? `01 · BUILD YOUR OWN · ${key} ${customMode.toUpperCase()}`
    : "01";
  const sectionTitle = isStandardMode ? activeStandard.name
    : generatorMode === "circle" ? `Circle of ${circleDirectionLabel} warm-up`
    : generatorMode === "custom" ? "Your custom progression"
    : "Your progression";
  const sectionDescription = isStandardMode
    ? `${standardKey === "original" ? activeStandard.key : standardKey} · ${activeStandard.style}${activeStandard.matchStatus==="reduction"?" · Reduced harmonic study":""} · Select each chord to hear its voice-led piano shape.`
    : generatorMode === "circle"
      ? `${activeCircleApproach.roman} before every destination. Play through all 12 keys and return to ${key}; every route and arrival is re-voiced together.`
      : generatorMode === "custom"
        ? "Choose chords from the floating chord bar below. Preview each chord, build your sequence, then hear and study the full progression."
      : "Select a chord to explore it, or add a turnaround before the next chord.";

  if (adminRoute) return <main className="admin-site">
    <header className="topbar admin-topbar">
      <a className="brand" href="./" aria-label="Return to Faithful Keys"><span className="brandmark" aria-hidden="true">FK</span> Faithful Keys</a>
      <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><b>{theme === "dark" ? "Light" : "Dark"}</b></button><a className="ghost admin-public-link" href="./">Public site</a></div>
    </header>
    <section className="admin-workspace"><Suspense fallback={<div className="admin-loading" role="status">Opening the administrator workspace…</div>}><SongAnalyzer /></Suspense></section>
  </main>;

  if (earTrainingOpen) return <main className="ear-training-site">
    <Suspense fallback={<div className="ear-training-loading" role="status">Opening Ear Training…</div>}>
      <EarTraining playNotes={playEarTrainingNotes} stopAudio={stopEarTrainingAudio} onExit={() => setEarTrainingOpen(false)}/>
    </Suspense>
  </main>;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#studio" aria-label="Faithful Keys home"><span className="brandmark" aria-hidden="true">FK</span> Faithful Keys</a>
        <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><b>{theme === "dark" ? "Light" : "Dark"}</b></button><button className="theme-toggle" type="button" onClick={toggleFullscreen} aria-label={isFullscreen?"Exit full screen":"Enter full screen"} aria-pressed={isFullscreen}><span aria-hidden="true">{isFullscreen?"↙":"↗"}</span><b>{isFullscreen?"Exit full screen":"Full screen"}</b></button><button className="ghost" onClick={reset}>Start over</button></div>
      </header>

      <section className="hero" id="studio">
        <div className="eyebrow">Psalm 150:3–5</div>
        <h1>Praise Him with <em>every instrument.</em></h1>
        <p>Build faithful harmony, hear every voice, and make each progression your own.</p>
        <div className={`generator-card mode-${generatorMode} ${controlsOpen?"controls-open":""}`}>
          <div className="mode-picker"><span>LEARNING MODE</span><div className="mode-options" role="group" aria-label="Choose a learning mode">
            {([['common','Common progressions'],['custom','Build your own'],['resolve','Resolution lab'],['circle','Circle warm-up'],['standards','Jazz standards'],['gospel','Gospel standards']] as const).map(([mode,label])=><button type="button" key={mode} className={generatorMode===mode?"active":""} aria-pressed={generatorMode===mode} onClick={()=>chooseGeneratorMode(mode)}>{label}</button>)}
            <button type="button" className="ear-training-entry" aria-pressed="false" onClick={() => { playbackTimers.current.forEach(clearTimeout); playbackTimers.current = []; stopEarTrainingAudio(); setIsPlaying(false); setEarTrainingOpen(true); }}>Ear Training</button>
          </div></div>
          <button type="button" className="controls-toggle" onClick={()=>setControlsOpen(open=>!open)} aria-expanded={controlsOpen} aria-controls="generator-controls">{controlsOpen?"Hide controls":"Adjust controls"}<span aria-hidden="true">{controlsOpen?"−":"+"}</span></button>
          <div className="generator-fields" id="generator-controls">
          {generatorMode!=="resolve"&&!isStandardMode&&<label>{generatorMode==="circle"?"START NOTE":generatorMode==="custom"?"CHORD BANK KEY":"TONIC NOTE"}<select value={key} onChange={(e) => {const nextKey=e.target.value;setKey(nextKey);if(generatorMode==="circle")loadCircleSequence(circleDirection,circleApproach,nextKey as CircleNote);if(generatorMode==="custom")setCustomFileNotice(`Chord bank changed to ${nextKey}. Your progression was kept.`)}}>{["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"].map(k => <option key={k}>{k}</option>)}</select></label>}
          {generatorMode==="custom"&&<label>CHORD BANK QUALITY<select value={customMode} onChange={e=>{const nextMode=e.target.value as "major"|"minor";setCustomMode(nextMode);setCustomFileNotice(`Chord bank changed to ${key} ${nextMode}. Your progression was kept.`)}}><option value="major">Major</option><option value="minor">Minor</option></select></label>}
          {generatorMode==="custom"&&<label>STYLE<select value={customStyle} onChange={e=>setCustomStyle(e.target.value as CustomProgressionStyle)}><option value="gospel">Gospel</option><option value="jazz">Jazz</option><option value="ccm">CCM</option><option value="worship">Contemporary worship</option></select></label>}
          {generatorMode==="common"&&<label>KEYBOARD ESSENTIAL<select value={preset} onChange={(e) => choosePreset(+e.target.value)}>{PROGRESSIONS.map((p,i) => <option value={i} key={p.name}>{p.name}</option>)}</select></label>}
          {isStandardMode&&<><label>STANDARD · {activeStandards.length} SONGS<select value={standardIndex} onChange={e=>chooseStandard(+e.target.value)}>{activeStandards.map((standard,i)=><option value={i} key={standard.name}>{standard.name} · {standard.key}{standard.matchStatus==="reduction"?" · REDUCED STUDY":""}</option>)}</select></label><label>KEY<select value={standardKey} onChange={e=>chooseStandardKey(e.target.value)}><option value="original">ORIGINAL · {activeStandard.key}</option>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label></>}
          {!isStandardMode&&<label>METER<select value={practiceMeter} onChange={e=>setPracticeMeter(e.target.value)}>{["2/4","3/4","4/4","5/4","6/8","7/8"].map(meter=><option value={meter} key={meter}>{meter}</option>)}</select></label>}
          {generatorMode==="resolve"&&<><label>SOURCE NOTE<select value={sourceNote} onChange={e=>chooseSource(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="source-quality">SOURCE QUALITY<select value={sourceQuality} onChange={e=>chooseSource(sourceNote,e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode==="resolve"&&<><label>TARGET NOTE<select value={globalTarget} onChange={(e)=>chooseGlobalTarget(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="target-quality">TARGET QUALITY<select value={targetQuality} onChange={e=>chooseTargetQuality(e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode==="circle"&&<><label className="circle-direction">DIRECTION<select value={circleDirection} onChange={e=>chooseCircleDirection(e.target.value as CircleDirection)}><option value="fourths">Circle of fourths</option><option value="fifths">Circle of fifths</option></select></label><label className="circle-approach">BETWEEN EACH CHORD<select value={circleApproach} onChange={e=>chooseCircleApproach(e.target.value as CircleApproach)}>{CIRCLE_APPROACH_OPTIONS.map(option=><option value={option.id} key={option.id}>{option.roman} · {option.label}</option>)}</select></label></>}
          {isStandardMode?<div className="standards-spelling"><span>CHORD SPELLING</span><div>{standardKey === "original" ? "AS WRITTEN" : `IN ${standardKey}`}</div></div>:generatorMode!=="custom"&&<label>EXTENSIONS<div className="complexity-control"><input aria-label="Use tasteful chord extensions" type="checkbox" checked={extensionsEnabled} onChange={e=>chooseComplexity(e.target.checked)}/><span>{extensionsEnabled?"ON":"OFF"}</span><select aria-label="Choose the highest available chord extension" value={extensionLevel} disabled={!extensionsEnabled} onChange={e=>chooseComplexity(true,e.target.value as "7"|"9"|"11"|"13")}><option value="7">Up to 7th</option><option value="9">Up to 9th</option><option value="11">Up to 11th</option><option value="13">Up to 13th</option></select></div></label>}
          <label>TEMPO<div className="tempo"><input aria-label="Playback tempo" type="number" inputMode="numeric" min="10" max="250" step="1" value={tempo} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))setTempo(Math.max(10,Math.min(250,Math.round(value))))}}/><b>BPM</b></div></label>
          <label>SWING<div className="tempo swing"><input aria-label="Swing percentage" type="number" inputMode="numeric" min="50" max="75" step="1" value={swingPercent} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))setSwingPercent(normalizeSwingPercent(value))}}/><b>%</b></div><small className="tempo-suggestion">50 STRAIGHT · 67 TRIPLET</small></label>
          {generatorMode==="custom"?<><div className="custom-generate-actions"><button type="button" className="primary" onClick={generateCustomIdea}>✦ Generate Progression</button><button type="button" className="custom-undo" disabled={!customUndoSnapshot} onClick={undoCustomGeneration}>↶ Undo</button></div><div className="custom-file-actions"><button type="button" onClick={()=>void downloadCustomProgression()}>↓ Download</button><button type="button" onClick={()=>customImportRef.current?.click()}>↑ Import</button><button type="button" onClick={clearCustomProgression}>↻ Clear</button><input ref={customImportRef} type="file" accept="application/json,.json" onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void importCustomProgression(file)}} aria-label="Import a Faithful Keys progression file"/></div></>:<button className={`primary ${isStandardMode?"restart-standard":""}`} title={isStandardMode?`Restart ${activeStandard.name}`:undefined} onClick={generate}>{generatorMode!=="common"&&<span aria-hidden="true">↻</span>}{generatorMode==="common"?"Generate Chords":isStandardMode?`Restart ${activeStandard.name}`:generatorMode==="circle"?`Build circle from ${key}`:generatorMode==="resolve"?"Build resolution":"Refresh progression"}</button>}
          </div>
          {generatorMode==="custom"&&customFileNotice&&<div className="custom-file-notice" role="status">{customFileNotice}</div>}
        </div>
      </section>

      <section className={`workspace ${generatorMode==="custom"?"custom-workspace":""}`} id="learn">
        <div className="section-head"><div><span className="step">{sectionStep}</span><h2>{sectionTitle}</h2><p>{sectionDescription}</p></div><div className="progression-controls"><label className="metronome-toggle" title="Woodblock: high on beat one, low on every other beat"><input type="checkbox" checked={metronomeEnabled} onChange={e=>setMetronomeEnabled(e.target.checked)}/><span/> METRONOME</label><button className="reharm-trigger" onClick={reharmProgression}>✦ Reharm</button>{substitutionHistory.length>0&&<button className="undo-sub" onClick={undoSubstitution}>↶ Switch back</button>}<button aria-pressed={isPlaying} className={`playall ${isPlaying?"playing":""}`} onClick={playProgression}>{isPlaying?"■ Stop progression":"▶ Play whole progression"}</button></div></div>
        <div className={`progression-row mode-${generatorMode}`} ref={progressionRowRef}>
          {progression.map((c, i) => <div className="chord-card" key={`${c}-${i}`} ref={(node)=>{chordCardRefs.current[i]=node}}>
            <button aria-pressed={selected===i} className={`chord-tile ${selected===i?"active":""} ${editTarget===i?"editing":""} ${durations[i]===.5?"eighth":""} ${isStandardMode?"standard-bar":""}`} onClick={()=>{const event=voicedProgression[i];setSelected(i);if(event)playNotes(audibleNotes(event,includeBass),generatorMode==="custom"?(durations[i]??1)*60000/tempo/1000*.94:isStandardMode?(durations[i]??standardBarBeats)*60000/tempo/1000*.94:1.15,includeBass?event.bass:undefined,soundPatch)}}><small>{isStandardMode?standardTimingLabel(durations,i,standardBarBeats):generatorMode==="custom"?`${String(i+1).padStart(2,"0")} · ${durationLabel(durations[i]??1)}`:generatorMode==="circle"?`${String((circleEvents[i]?.legIndex??0)+1).padStart(2,"0")} · ${durations[i]===.5?"♪ EIGHTH":"♩ QUARTER"}`:`${String(i+1).padStart(2,"0")} · ${durations[i]===.5?"♪ EIGHTH":"♩ QUARTER"}`}</small><strong>{c}</strong><span>{isStandardMode?(durations[i]??standardBarBeats)>=standardBarBeats?"HELD":"SHARED BAR":generatorMode==="circle"?circleEvents[i]?.role==="approach"?"APPROACH":circleEvents[i]?.legIndex===0?"START":circleEvents[i]?.legIndex===12?"HOME":"DESTINATION":durations[i]===.5?"APPROACH":i===progression.length-1?"HOME":i===0?"TONIC":"COLOR"}</span></button>
            {generatorMode!=="circle"&&generatorMode!=="custom"&&<button className={`substitute-trigger ${editTarget===i?"open":""}`} onClick={()=>{setSelected(i);setSubstitutionTarget("next");setShowBlockedInfo(false);setEditTarget(editTarget===i?null:i)}}>{editTarget===i?"× Close":"↗ Substitute"}</button>}
            {generatorMode==="custom"&&<div className="custom-chord-controls"><label>NOTE LENGTH<select value={NOTE_LENGTHS.some(option=>option.beats===(durations[i]??1))?durations[i]??1:"custom"} onChange={event=>{if(event.currentTarget.value!=="custom")setCustomChordDuration(i,Number(event.currentTarget.value))}} aria-label={`${c} note length`}>{NOTE_LENGTHS.map(option=><option value={option.beats} key={option.beats}>{option.label}</option>)}{!NOTE_LENGTHS.some(option=>option.beats===(durations[i]??1))&&<option value="custom">Custom</option>}</select></label><label className="custom-beats">BEATS<input type="number" inputMode="decimal" min="0.25" max="64" step="0.25" value={durations[i]??1} onChange={event=>setCustomChordDuration(i,event.currentTarget.valueAsNumber)} aria-label={`${c} custom duration in beats`}/></label><button disabled={progression.length<=1} onClick={()=>removeCustomChord(i)} aria-label={`Remove ${c} from progression`}>− Remove</button></div>}
          </div>)}
          {!isStandardMode&&generatorMode!=="circle"&&generatorMode!=="custom"&&<button className="add-tile" onClick={generate}>＋<span>New idea</span></button>}
        </div>

        {generatorMode==="custom"&&<div className="manual-chord-bank ready public-chord-bank" aria-label="Floating chord bar">
          <div className="manual-chord-bank-heading"><div><span>CHORD BAR · {key} {customMode}</span><b>Choose the next chord in your progression</b></div><small>Use ▶ to hear a chord first, then select the chord to add it. Your piano voicings update automatically.</small></div>
          {(["Core","Color"] as const).map(group=><div className="manual-chord-bank-group" key={group}><span>{group}</span><div>{customChordBank.filter(choice=>choice.group===group).map(choice=><div className="manual-chord-bank-choice" key={`${choice.roman}-${choice.chord}`}><button className="manual-chord-bank-place" onClick={()=>addCustomChord(choice.chord)}><small>{choice.roman}</small><b>{choice.chord}</b></button><button className="manual-chord-bank-preview" type="button" onClick={()=>window.dispatchEvent(new CustomEvent("faithful-keys-preview-chord",{detail:{chordSymbol:choice.chord}}))} aria-label={`Preview ${choice.chord}`} title={`Hear ${choice.chord}`}>▶</button></div>)}</div></div>)}
        </div>}

        {editTarget!==null&&<div className="substitution-compact">
          <label className="target-picker"><span>Target note</span><select value={substitutionTarget} onChange={e=>setSubstitutionTarget(e.target.value)} aria-label="Choose substitution target note"><option value="next">Next chord · {nextDestination}</option>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label>
          <label className="route-picker"><span>Replace <b>{progression[editTarget]}</b> → {substitutionTarget==="next"?nextDestination:substitutionTarget}</span>
            <select value="" aria-label={`Choose a substitution for ${progression[editTarget]}`} onChange={(e)=>{const option=substitutionOptions[+e.target.value];if(option?.allowed)applySubstitution(option.chords)}}>
              <option value="" disabled>Choose a substitution…</option>
              {substitutionOptions.map((option,i)=><option value={i} disabled={!option.allowed} key={`${option.roman}-${i}`}>{option.allowed?"":"BLOCKED · "}{option.roman} · {option.name} · {option.chords.join(" → ")}</option>)}
            </select>
          </label>
          {blockedOptions.length>0&&<button className="blocked-info-trigger" aria-label="Why are some substitutions blocked?" onClick={()=>setShowBlockedInfo(value=>!value)}>i</button>}
          <button aria-label="Close substitution menu" onClick={()=>setEditTarget(null)}>×</button>
          {showBlockedInfo&&blockedOptions.length>0&&<div className="blocked-info"><b>Why some routes are blocked</b><p>{minorDestination?"Backdoor, modal-mixture, and V-alternative colors here are taught as major-tonic resolutions. For this minor destination, use the available iiø–V7♭9 route for clear guide-tone motion.":"This destination is unstable or altered, so Cadence keeps only direct dominant and leading-diminished approaches whose tendency tones resolve clearly."}</p></div>}
        </div>}

        <div className="teacher" id="library">
          <div className="teacher-top compact"><div><span className="step">02 · VOICING TEACHER</span><p>{compMode?"Left-hand comp voicing with a separate right-hand melody":"Three comfortable right-hand positions plus a separate bass"}</p></div><label className="toggle">SHOW FINGERS <input type="checkbox" checked={fingers} onChange={e=>setFingers(e.target.checked)}/><span/></label></div>
          <div className="piano-wrap">
            <div className="chord-label"><span>{chord}</span><small>{includeBass?`BASS ${chordNoteName(bassMidi,chord)}`:compMode?"LH COMP":"BASS OFF"} &nbsp;·&nbsp; {compMode?isStandardMode&&chartMelodyAnchors[selected]===undefined?"LH COMP · CHART LEAD UNAVAILABLE":"LH COMP + RH MELODY":"RH VOICING"} &nbsp;·&nbsp; {chordMidis.map(midi=>chordNoteName(midi,chord)).join("  ·  ")} &nbsp;·&nbsp; PHRASE ARC {selected%4+1}/4</small><div className="voicing-tabs" role="group" aria-label="Voicing position"><b>VOICING</b>{([["Lower","Lower position"],["Middle","Voice-led middle"],["Upper","Upper position"]] as const).map(([label,name],i)=><button type="button" aria-label={name} aria-pressed={voicing===i} className={voicing===i?"active":""} key={name} onClick={()=>setVoicing(i)}>{label}</button>)}</div><label className="sound-picker">SOUND<select value={soundPatch} onChange={e=>changeSoundPatch(e.target.value as SoundPatch)} aria-label="Choose instrument sound"><option value="cadence">Cadence soft EP</option><option value="grand">Grand piano</option><option value="strings">String ensemble</option><option value="horns">French horn ensemble</option></select></label><label className="bass-toggle"><input type="checkbox" checked={includeBass} disabled={compMode} onChange={e=>{setIncludeBass(e.target.checked);if(e.target.checked)setCompMode(false)}}/><span/> ADD BASS</label><label className="bass-toggle"><input type="checkbox" checked={compMode} onChange={e=>{setCompMode(e.target.checked);if(e.target.checked)setIncludeBass(false)}}/><span/> COMP MODE</label></div>
            <div className="piano-shell"><div className="piano">
              {whites.map((midi) => {const cutLeft=blacks.includes(midi-1);const cutRight=blacks.includes(midi+1);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} aria-pressed={activeMidi===midi} className={`white ${cutLeft?"cut-left":""} ${cutRight?"cut-right":""} ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} key={midi} onKeyDown={event=>{if(!event.repeat&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setActiveMidi(midi);playNotes([midi],1.15,undefined,soundPatch)}}} onKeyUp={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setActiveMidi(null)}}} onBlur={()=>setActiveMidi(null)} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi],1.15,undefined,soundPatch)}} onPointerUp={()=>setActiveMidi(null)} onPointerCancel={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>
                <small>{keyboardNotes.includes(midi)?chordNoteName(midi,chord):noteName(midi)}</small>{keyboardFinger(midi)}
              </div>})}
              {blacks.map((midi)=>{const nextWhiteIndex=whites.findIndex(white=>white>midi);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} aria-pressed={activeMidi===midi} key={midi} style={{left:`${nextWhiteIndex/whites.length*100}%`}} className={`black black-key ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} onKeyDown={event=>{if(!event.repeat&&(event.key==="Enter"||event.key===" ")){event.preventDefault();setActiveMidi(midi);playNotes([midi],1.15,undefined,soundPatch)}}} onKeyUp={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setActiveMidi(null)}}} onBlur={()=>setActiveMidi(null)} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi],1.15,undefined,soundPatch)}} onPointerUp={()=>setActiveMidi(null)} onPointerCancel={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>{keyboardFinger(midi)}</div>})}
            </div></div>
            <button className="listen" onClick={()=>voicedChord&&playNotes(audibleNotes(voicedChord,includeBass),1.15,includeBass?voicedChord.bass:undefined,soundPatch)}>▶ &nbsp; Hear {includeBass?"voicing + bass":"voicing"}</button>
          </div>
        </div>
      </section>
      <footer><span>Faithful Keys</span><p>Praise Him with every instrument.</p><small>Built for faithful ears. · <a href="https://github.com/peastman/sso" target="_blank" rel="noreferrer">SSO orchestral samples</a></small></footer>
    </main>
  );
}
