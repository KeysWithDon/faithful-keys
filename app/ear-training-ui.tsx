"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CIRCLE_PITCH_CLASSES,
  CIRCLE_NOTE_NAMES,
  INTERVALS,
  TEST_LENGTHS,
  createCircleIntervalQuestion,
  createRandomQuestion,
  formatAccuracy,
  isTestComplete,
  intervalsForDifficulty,
  type EarTrainingDifficulty,
  type CircleDirection,
  type IntervalDirection,
  type IntervalPerformance,
  type IntervalPlaybackMode,
  type IntervalQuestion,
} from "./ear-training";
import TempoInput, { MAX_TEMPO, MIN_TEMPO } from "./tempo-input";
import "./ear-training.css";

type QuizPhase = "setup" | "playing_interval" | "waiting_for_answer" | "incorrect_answer" | "correct_answer" | "transitioning" | "complete";
type TrainerMode = "hear" | "test";
type PlayNotes = (midis: number[], holdSeconds: number, volume: number) => void;
const TEST_IT_LEVEL = .72;
const HEAR_IT_LEVEL = 1.08;

const PLAY_MODES: Array<{ id: IntervalPlaybackMode; label: string; short: string }> = [
  { id: "ascending", label: "Ascending", short: "Low → high" },
  { id: "descending", label: "Descending", short: "High → low" },
  { id: "harmonic", label: "Harmonic", short: "Together" },
  { id: "ascending-harmonic", label: "Ascending + Harmonic", short: "Rise, then together" },
  { id: "descending-harmonic", label: "Descending + Harmonic", short: "Fall, then together" },
];

const STAFF_NOTES: Record<IntervalPlaybackMode, Array<{ x: number; y: number }>> = {
  ascending: [{ x: 30, y: 34 }, { x: 78, y: 16 }],
  descending: [{ x: 30, y: 16 }, { x: 78, y: 34 }],
  harmonic: [{ x: 57, y: 34 }, { x: 57, y: 16 }],
  "ascending-harmonic": [{ x: 20, y: 34 }, { x: 48, y: 16 }, { x: 94, y: 34 }, { x: 94, y: 16 }],
  "descending-harmonic": [{ x: 20, y: 16 }, { x: 48, y: 34 }, { x: 94, y: 34 }, { x: 94, y: 16 }],
};

function modeEvents(question: IntervalQuestion, mode: IntervalPlaybackMode, tempo: number) {
  const low = [question.rootMidi];
  const high = [question.targetMidi];
  const both = question.rootMidi === question.targetMidi ? low : [question.rootMidi, question.targetMidi];
  const beatMs = 60000 / tempo;
  switch (mode) {
    case "ascending": return [{ at: 0, notes: low }, { at: beatMs, notes: high }];
    case "descending": return [{ at: 0, notes: high }, { at: beatMs, notes: low }];
    case "harmonic": return [{ at: 0, notes: both }];
    case "ascending-harmonic": return [{ at: 0, notes: low }, { at: beatMs, notes: high }, { at: beatMs * 2, notes: both }];
    case "descending-harmonic": return [{ at: 0, notes: high }, { at: beatMs, notes: low }, { at: beatMs * 2, notes: both }];
  }
}

function StaffPreview({ mode }: { mode: IntervalPlaybackMode }) {
  return <svg className="staff-preview" viewBox="0 0 116 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g className="staff-lines">
      {[8, 16, 25, 34, 42].map(y => <line x1="3" x2="113" y1={y} y2={y} key={y}/>)}
      <line className="staff-bar" x1="3" x2="3" y1="8" y2="42"/>
      <line className="staff-bar" x1="113" x2="113" y1="8" y2="42"/>
    </g>
    <g className="staff-notes">
      {STAFF_NOTES[mode].map((note, index) => <g className="staff-note" transform={`translate(${note.x} ${note.y})`} key={`${note.x}-${note.y}-${index}`}>
        <ellipse rx="7" ry="5"/>
        <line x1="-4.5" x2="4.5" y1="0" y2="0"/>
      </g>)}
    </g>
  </svg>;
}

const EarKeyboard = memo(function EarKeyboard({ highlighted, onPlay, octaves = 3 }: { highlighted: number[]; onPlay: (midi: number) => void; octaves?: 3 | 4 }) {
  const range = useMemo(() => Array.from({ length: octaves * 12 + 1 }, (_, index) => 48 + index), [octaves]);
  const whites = useMemo(() => range.filter(midi => ![1, 3, 6, 8, 10].includes(midi % 12)), [range]);
  const blacks = useMemo(() => range.filter(midi => [1, 3, 6, 8, 10].includes(midi % 12)), [range]);
  const name = (midi: number) => `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
  const activate = (midi: number) => onPlay(midi);
  return <div className="ear-piano-shell" aria-label="Interactive piano keyboard">
    <div className="ear-piano">
      {whites.map(midi => <button type="button" data-midi={midi} className={`ear-white ${highlighted.includes(midi) ? "played" : ""}`} key={midi} aria-label={`Play ${name(midi)}`} aria-pressed={highlighted.includes(midi)} onClick={() => activate(midi)}><small>{midi % 12 === 0 ? name(midi) : ""}</small></button>)}
      {blacks.map(midi => {
        const nextWhiteIndex = whites.findIndex(white => white > midi);
        return <button type="button" data-midi={midi} className={`ear-black ${highlighted.includes(midi) ? "played" : ""}`} key={midi} style={{ left: `${nextWhiteIndex / whites.length * 100}%`, width: `${62 / whites.length}%` }} aria-label={`Play ${name(midi)}`} aria-pressed={highlighted.includes(midi)} onClick={() => activate(midi)}/>;
      })}
    </div>
  </div>;
});

export default function EarTraining({ playNotes, stopAudio, onExit }: { playNotes: PlayNotes; stopAudio: () => void; onExit: () => void }) {
  const [trainerMode, setTrainerMode] = useState<TrainerMode>("hear");
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [difficulty, setDifficulty] = useState<EarTrainingDifficulty>("easy");
  const [testLength, setTestLength] = useState<(typeof TEST_LENGTHS)[number]>(10);
  const [playbackMode, setPlaybackMode] = useState<IntervalPlaybackMode>("ascending");
  const [showPlayedKeys, setShowPlayedKeys] = useState(true);
  const [tempo, setTempo] = useState(90);
  const [question, setQuestion] = useState<IntervalQuestion | null>(null);
  const [correct, setCorrect] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [highlightedKeys, setHighlightedKeys] = useState<number[]>([]);
  const [circleDirection, setCircleDirection] = useState<CircleDirection>("fourths");
  const [intervalDirection, setIntervalDirection] = useState<IntervalDirection>("up");
  const [hearInterval, setHearInterval] = useState<number | "all">(1);
  const [hearIndex, setHearIndex] = useState(0);
  const [hearIntervalIndex, setHearIntervalIndex] = useState(0);
  const [hearQuestion, setHearQuestion] = useState<IntervalQuestion | null>(null);
  const [hearPlaying, setHearPlaying] = useState(false);
  const timers = useRef<number[]>([]);
  const playbackToken = useRef(0);
  const answerLocked = useRef(false);
  const performance = useRef<Record<string, IntervalPerformance>>({});
  const recentIntervals = useRef<string[]>([]);
  const recentRoots = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    playbackToken.current += 1;
  };

  useEffect(() => () => {
    clearTimers();
    stopAudio();
  }, [stopAudio]);

  function recordPresentation(next: IntervalQuestion) {
    const previous = performance.current[next.interval.id] ?? { presented: 0, wrongGuesses: 0, firstTryCorrect: 0 };
    performance.current[next.interval.id] = { ...previous, presented: previous.presented + 1 };
    recentIntervals.current = [...recentIntervals.current.slice(-3), next.interval.id];
    recentRoots.current = [...recentRoots.current.slice(-3), next.rootMidi];
  }

  function buildQuestion() {
    const next = createRandomQuestion(difficulty, performance.current, recentIntervals.current, recentRoots.current);
    recordPresentation(next);
    return next;
  }

  function playInterval(activeQuestion: IntervalQuestion, mode = playbackMode) {
    clearTimers();
    stopAudio();
    const token = playbackToken.current;
    setPhase("playing_interval");
    setHighlightedKeys([]);
    const beatMs = 60000 / tempo;
    const noteLength = Math.max(.25, Math.min(.9, beatMs / 1000 * .9));
    const events = modeEvents(activeQuestion, mode, tempo);
    events.forEach(event => {
      timers.current.push(window.setTimeout(() => {
        if (token !== playbackToken.current) return;
        playNotes(event.notes, noteLength, TEST_IT_LEVEL);
        if (showPlayedKeys) setHighlightedKeys(event.notes);
      }, event.at));
    });
    const finishAt = events.at(-1)!.at + Math.max(260, beatMs * 1.1);
    timers.current.push(window.setTimeout(() => {
      if (token !== playbackToken.current) return;
      setHighlightedKeys([]);
      setPhase(current => current === "playing_interval" ? "waiting_for_answer" : current);
    }, finishAt));
  }

  function beginTest() {
    clearTimers();
    stopAudio();
    setCorrect(0); setAttempts(0); setCompleted(0); setWrongIds(new Set()); setAcceptedId(null);
    answerLocked.current = false;
    const next = buildQuestion();
    setQuestion(next);
    playInterval(next);
  }

  function replay() {
    if (!question || phase === "correct_answer" || phase === "transitioning" || phase === "complete") return;
    playInterval(question);
  }

  function chooseAnswer(id: string) {
    if (!question || answerLocked.current || !["waiting_for_answer", "incorrect_answer"].includes(phase)) return;
    const isCorrect = id === question.interval.id;
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    const record = performance.current[question.interval.id];
    if (!isCorrect) {
      if (record) record.wrongGuesses += 1;
      setWrongIds(current => new Set(current).add(id));
      setPhase("incorrect_answer");
      return;
    }

    answerLocked.current = true;
    if (record && !wrongIds.size) record.firstTryCorrect += 1;
    const nextCorrect = correct + 1;
    const nextCompleted = completed + 1;
    setCorrect(nextCorrect);
    setCompleted(nextCompleted);
    setAcceptedId(id);
    setHighlightedKeys(question.rootMidi === question.targetMidi ? [question.rootMidi] : [question.rootMidi, question.targetMidi]);
    setPhase("correct_answer");
    clearTimers();
    const token = playbackToken.current;
    timers.current.push(window.setTimeout(() => {
      if (token !== playbackToken.current) return;
      if (isTestComplete(nextCompleted, testLength)) {
        setHighlightedKeys([]);
        setPhase("complete");
        return;
      }
      setPhase("transitioning");
      setWrongIds(new Set());
      setAcceptedId(null);
      answerLocked.current = false;
      const next = buildQuestion();
      setQuestion(next);
      playInterval(next);
    }, 800));
  }

  function returnToSetup() {
    clearTimers(); stopAudio(); setHighlightedKeys([]); setQuestion(null); setPhase("setup");
  }

  function exitTrainer() {
    clearTimers(); stopAudio(); onExit();
  }

  function playKeyboardNote(midi: number) {
    const level = trainerMode === "hear" ? HEAR_IT_LEVEL : TEST_IT_LEVEL;
    playNotes([midi], .7, level);
    setHighlightedKeys([midi]);
    timers.current.push(window.setTimeout(() => setHighlightedKeys(keys => keys.length === 1 && keys[0] === midi ? [] : keys), 500));
  }

  function changeTrainerMode(nextMode: TrainerMode) {
    clearTimers();
    stopAudio();
    setHighlightedKeys([]);
    setHearPlaying(false);
    setTrainerMode(nextMode);
  }

  function hearPool() {
    return hearInterval === "all"
      ? intervalsForDifficulty(difficulty)
      : [INTERVALS[hearInterval]];
  }

  function playHearStep(rootIndex: number, intervalIndex: number, continueCycle: boolean) {
    clearTimers();
    stopAudio();
    const token = playbackToken.current;
    const circle = CIRCLE_PITCH_CLASSES[circleDirection];
    const pool = hearPool();
    const normalizedRootIndex = (rootIndex + circle.length) % circle.length;
    const normalizedIntervalIndex = (intervalIndex + pool.length) % pool.length;
    const nextQuestion = createCircleIntervalQuestion(
      pool[normalizedIntervalIndex],
      circle[normalizedRootIndex],
      intervalDirection,
    );
    setHearIndex(normalizedRootIndex);
    setHearIntervalIndex(normalizedIntervalIndex);
    setHearQuestion(nextQuestion);
    const playback = intervalDirection === "up" ? "ascending" : "descending";
    const beatMs = 60000 / tempo;
    const noteLength = Math.max(.25, Math.min(.9, beatMs / 1000 * .9));
    const events = modeEvents(nextQuestion, playback, tempo);
    events.forEach(event => {
      timers.current.push(window.setTimeout(() => {
        if (token !== playbackToken.current) return;
        playNotes(event.notes, noteLength, HEAR_IT_LEVEL);
        if (showPlayedKeys) setHighlightedKeys(event.notes);
      }, event.at));
    });
    const finishAt = events.at(-1)!.at + Math.max(280, beatMs * 1.1);
    timers.current.push(window.setTimeout(() => {
      if (token !== playbackToken.current) return;
      setHighlightedKeys([]);
      if (!continueCycle) {
        setHearPlaying(false);
        return;
      }
      const nextRootIndex = (normalizedRootIndex + 1) % circle.length;
      const nextIntervalIndex = hearInterval === "all" && nextRootIndex === 0
        ? (normalizedIntervalIndex + 1) % pool.length
        : normalizedIntervalIndex;
      timers.current.push(window.setTimeout(() => {
        if (token !== playbackToken.current) return;
        playHearStep(nextRootIndex, nextIntervalIndex, true);
      }, Math.max(180, beatMs * .75)));
    }, finishAt));
  }

  function startHearCycle() {
    setHearPlaying(true);
    playHearStep(hearIndex, hearIntervalIndex, true);
  }

  function pauseHearCycle() {
    clearTimers();
    stopAudio();
    setHighlightedKeys([]);
    setHearPlaying(false);
  }

  function resetHearPosition() {
    pauseHearCycle();
    setHearIndex(0);
    setHearIntervalIndex(0);
    setHearQuestion(null);
  }

  function stepHear(amount: -1 | 1) {
    pauseHearCycle();
    const circleLength = CIRCLE_PITCH_CLASSES[circleDirection].length;
    const nextIndex = (hearIndex + amount + circleLength) % circleLength;
    playHearStep(nextIndex, hearIntervalIndex, false);
  }

  const choices = intervalsForDifficulty(difficulty);
  const activeMode = PLAY_MODES.find(mode => mode.id === playbackMode)!;
  const accuracy = formatAccuracy(correct, attempts);

  const ModeTabs = () => <nav className="ear-mode-tabs" aria-label="Ear training mode">
    <button type="button" className={trainerMode === "hear" ? "selected" : ""} aria-pressed={trainerMode === "hear"} onClick={() => changeTrainerMode("hear")}><span aria-hidden="true">♫</span> Hear It</button>
    <button type="button" className={trainerMode === "test" ? "selected" : ""} aria-pressed={trainerMode === "test"} onClick={() => changeTrainerMode("test")}><span aria-hidden="true">✓</span> Test It</button>
  </nav>;

  if (trainerMode === "hear") {
    const circle = CIRCLE_PITCH_CLASSES[circleDirection];
    const activeInterval = hearQuestion?.interval ?? hearPool()[hearIntervalIndex % hearPool().length];
    const circleNames = CIRCLE_NOTE_NAMES[circleDirection];
    return <section className="ear-training ear-hear" aria-labelledby="hear-title">
      <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Back to Faithful Keys</button><ModeTabs/><span>GUIDED PRACTICE</span></header>
      <div className="ear-hear-workspace">
        <div className="ear-hear-title"><div><span className="step">CIRCLE-BASED INTERVAL PRACTICE</span><h1 id="hear-title">Hear it. <em>Know it.</em></h1></div><p>Hear the same interval from every starting note, moving through the circle one key at a time.</p></div>
        <div className="ear-hear-settings" aria-label="Hear It settings">
          <div className="ear-inline-setting"><span>Circle</span><div className="ear-segmented"><button type="button" className={circleDirection === "fourths" ? "selected" : ""} onClick={() => { setCircleDirection("fourths"); resetHearPosition(); }}>4ths</button><button type="button" className={circleDirection === "fifths" ? "selected" : ""} onClick={() => { setCircleDirection("fifths"); resetHearPosition(); }}>5ths</button></div></div>
          <div className="ear-inline-setting"><span>Direction</span><div className="ear-segmented"><button type="button" className={intervalDirection === "up" ? "selected" : ""} onClick={() => { setIntervalDirection("up"); resetHearPosition(); }}>↑ Up</button><button type="button" className={intervalDirection === "down" ? "selected" : ""} onClick={() => { setIntervalDirection("down"); resetHearPosition(); }}>↓ Down</button></div></div>
          <div className="ear-inline-setting"><span>Range</span><div className="ear-segmented"><button type="button" className={difficulty === "easy" ? "selected" : ""} onClick={() => { setDifficulty("easy"); setHearInterval("all"); resetHearPosition(); }}>Easy</button><button type="button" className={difficulty === "hard" ? "selected" : ""} onClick={() => { setDifficulty("hard"); setHearInterval("all"); resetHearPosition(); }}>Hard</button></div></div>
          <label className="ear-inline-setting ear-interval-select"><span>Interval</span><select value={hearInterval} onChange={event => { const value = event.target.value; setHearInterval(value === "all" ? "all" : Number(value)); resetHearPosition(); }}><option value="all">All {difficulty === "easy" ? "easy" : "hard"} intervals</option>{intervalsForDifficulty(difficulty).map(interval => <option value={interval.semitones} key={interval.id}>{interval.name} · {interval.semitones}</option>)}</select></label>
          <label className="ear-switch compact"><span><b>Show keys</b></span><input type="checkbox" checked={showPlayedKeys} onChange={event => setShowPlayedKeys(event.target.checked)}/><i/></label>
          <label className="ear-tempo compact"><span>Tempo</span><input aria-label="Hear It tempo slider" type="range" min={MIN_TEMPO} max={MAX_TEMPO} value={tempo} onChange={event => setTempo(Number(event.target.value))}/><TempoInput aria-label="Hear It tempo" value={tempo} onCommit={value => { if (value !== null) setTempo(value); }}/><b>BPM</b></label>
        </div>
        <div className="ear-hear-focus">
          <div className="ear-hear-current"><span>NOW HEARING</span><strong>{activeInterval.name}</strong><small>{circleNames[hearIndex]} {intervalDirection === "up" ? "up" : "down"} {activeInterval.semitones} {activeInterval.semitones === 1 ? "semitone" : "semitones"}</small></div>
          <div className="ear-circle-track" aria-label={`${circleDirection === "fourths" ? "Circle of fourths" : "Circle of fifths"} position`}>{circle.map((pitchClass, index) => <button type="button" className={index === hearIndex ? "active" : ""} aria-current={index === hearIndex ? "step" : undefined} onClick={() => { pauseHearCycle(); playHearStep(index, hearIntervalIndex, false); }} key={`${pitchClass}-${index}`}><span>{circleNames[index]}</span><small>{index + 1}</small></button>)}</div>
        </div>
        <div className="ear-hear-piano"><EarKeyboard highlighted={highlightedKeys} onPlay={playKeyboardNote} octaves={4}/></div>
        <div className="ear-hear-transport"><button type="button" className="ear-skip" onClick={() => stepHear(-1)} aria-label="Previous starting note">←</button><button type="button" className="ear-play-cycle" onClick={hearPlaying ? pauseHearCycle : startHearCycle}><span aria-hidden="true">{hearPlaying ? "Ⅱ" : "▶"}</span>{hearPlaying ? "Pause" : hearQuestion ? "Continue cycle" : "Play cycle"}</button><button type="button" className="ear-skip" onClick={() => stepHear(1)} aria-label="Next starting note">→</button><button type="button" className="ear-reset-cycle" onClick={resetHearPosition}>Reset to C</button><span className="ear-cycle-status">{circleDirection === "fourths" ? "C · F · B♭ · E♭…" : "C · G · D · A…"}</span></div>
      </div>
    </section>;
  }

  if (phase === "setup") return <section className="ear-training ear-setup" aria-labelledby="ear-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Back to Faithful Keys</button><ModeTabs/><span>TEST SETUP</span></header>
    <div className="ear-setup-intro"><div><span className="step">LISTEN · IDENTIFY · GROW</span><h1 id="ear-title">Train your <em>musical ear.</em></h1><p>Hear the distance between two notes, identify it, and connect the sound to the keyboard.</p></div><div className="ear-setup-mark" aria-hidden="true">♪<b>?</b></div></div>
    <div className="ear-setup-grid">
      <fieldset><legend>1 · Difficulty</legend><div className="ear-choice-pair">
        <button type="button" className={difficulty === "easy" ? "selected" : ""} onClick={() => setDifficulty("easy")} aria-pressed={difficulty === "easy"}><b>Easy</b><span>Unison through one octave</span></button>
        <button type="button" className={difficulty === "hard" ? "selected" : ""} onClick={() => setDifficulty("hard")} aria-pressed={difficulty === "hard"}><b>Hard</b><span>Unison through two octaves</span></button>
      </div></fieldset>
      <fieldset><legend>2 · Test length</legend><div className="ear-lengths">{TEST_LENGTHS.map(length => <button type="button" className={testLength === length ? "selected" : ""} onClick={() => setTestLength(length)} aria-pressed={testLength === length} key={length}><b>{length}</b><span>intervals</span></button>)}</div></fieldset>
      <fieldset className="ear-mode-field"><legend>3 · Play mode</legend><div className="ear-mode-grid">{PLAY_MODES.map(mode => <button type="button" className={playbackMode === mode.id ? "selected" : ""} onClick={() => setPlaybackMode(mode.id)} aria-pressed={playbackMode === mode.id} key={mode.id}><StaffPreview mode={mode.id}/><span><b>{mode.label}</b><small>{mode.short}</small></span></button>)}</div></fieldset>
      <fieldset className="ear-ready"><legend>4 · Ready</legend><label className="ear-switch"><span><b>Show Played Keys</b><small>See keys illuminate during playback</small></span><input type="checkbox" checked={showPlayedKeys} onChange={event => setShowPlayedKeys(event.target.checked)}/><i/></label><label className="ear-tempo"><span>Tempo</span><input aria-label="Test It tempo slider" type="range" min={MIN_TEMPO} max={MAX_TEMPO} value={tempo} onChange={event => setTempo(Number(event.target.value))}/><TempoInput aria-label="Test It tempo" value={tempo} onCommit={value => { if (value !== null) setTempo(value); }}/><b>BPM</b></label><button className="ear-start" type="button" onClick={beginTest}>Start Test <span>→</span></button></fieldset>
    </div>
  </section>;

  if (phase === "complete") return <section className="ear-training ear-results" aria-labelledby="results-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Back to Faithful Keys</button><ModeTabs/><span>TEST COMPLETE</span></header>
    <div className="results-card"><span className="results-icon" aria-hidden="true">✓</span><span className="step">TEST COMPLETE</span><h1 id="results-title">Well heard.</h1><p>You completed every interval. Every guess—including the misses—is reflected in your final accuracy.</p>
      <div className="results-score"><strong>{accuracy}</strong><span>Final accuracy</span></div>
      <div className="results-stats"><div><span>Intervals</span><b>{completed} / {testLength}</b></div><div><span>Correct</span><b>{correct}</b></div><div><span>Attempts</span><b>{attempts}</b></div></div>
      <div className="results-settings"><span>{difficulty === "easy" ? "Easy · 1 octave" : "Hard · 2 octaves"}</span><span>{activeMode.label}</span><span>{testLength} intervals</span></div>
      <div className="results-actions"><button className="ear-start" type="button" onClick={beginTest}>Restart Same Test</button><button type="button" onClick={returnToSetup}>Start New Test</button></div>
      <div className="results-quick"><button type="button" onClick={() => { setDifficulty(difficulty === "easy" ? "hard" : "easy"); returnToSetup(); }}>Change Difficulty</button><button type="button" onClick={returnToSetup}>Change Test Length</button></div>
    </div>
  </section>;

  return <section className="ear-training ear-quiz" aria-labelledby="quiz-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Exit trainer</button><ModeTabs/><div className="ear-quiz-meta"><span>{difficulty === "easy" ? "EASY · 1 OCTAVE" : "HARD · 2 OCTAVES"}</span><b>{activeMode.label}</b></div><button type="button" className="ear-restart" onClick={beginTest}>↻ Restart</button></header>
    <div className="ear-dashboard">
      <div className="ear-prompt"><span className="step">INTERVAL {Math.min(completed + 1, testLength)} OF {testLength}</span><h1 id="quiz-title">What interval do you hear?</h1><p aria-live="polite">{phase === "incorrect_answer" ? "Not quite—listen again or choose another interval." : phase === "correct_answer" ? `Correct — ${question?.interval.name}.` : phase === "playing_interval" ? "Listen…" : "Choose the interval below."}</p></div>
      <div className="ear-stats" aria-label="Live quiz score"><div><span>Correct</span><b>{correct}</b></div><div><span>Attempts</span><b>{attempts}</b></div><div className="accuracy"><span>Accuracy</span><b>{accuracy}</b></div></div>
    </div>
    <div className="ear-listen-panel">
      <div className="ear-listen-actions"><button className="ear-replay" type="button" onClick={replay} disabled={phase === "correct_answer" || phase === "transitioning"}><span aria-hidden="true">▶</span><b>Replay interval</b><small>Same notes · no score change</small></button><label className="ear-switch compact"><span><b>Show keys</b></span><input type="checkbox" checked={showPlayedKeys} onChange={event => setShowPlayedKeys(event.target.checked)}/><i/></label><label className="ear-tempo compact"><span>Tempo</span><input aria-label="Ear Training tempo slider" type="range" min={MIN_TEMPO} max={MAX_TEMPO} value={tempo} onChange={event => setTempo(Number(event.target.value))}/><TempoInput aria-label="Ear Training tempo" value={tempo} onCommit={value => { if (value !== null) setTempo(value); }}/><b>BPM</b></label></div>
      <EarKeyboard highlighted={highlightedKeys} onPlay={playKeyboardNote} octaves={4}/>
      <p className="keyboard-caption">C3–C7 · Tap any key to explore. Played notes appear after the correct answer.</p>
    </div>
    <div className={`interval-grid ${difficulty}`} role="group" aria-label="Interval answer choices">{choices.map(interval => {
      const wrong = wrongIds.has(interval.id);
      const right = acceptedId === interval.id;
      return <button type="button" key={interval.id} className={wrong ? "wrong" : right ? "correct" : ""} onClick={() => chooseAnswer(interval.id)} disabled={phase === "correct_answer" || phase === "transitioning" || phase === "playing_interval"} aria-label={`${interval.name}${wrong ? ", incorrect" : right ? ", correct" : ""}`}><span>{interval.name}</span><b aria-hidden="true">{wrong ? "×" : right ? "✓" : interval.semitones}</b><small>{interval.semitones} {interval.semitones === 1 ? "semitone" : "semitones"}</small></button>;
    })}</div>
  </section>;
}
