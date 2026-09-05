"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  TEST_LENGTHS,
  createRandomQuestion,
  formatAccuracy,
  isTestComplete,
  intervalsForDifficulty,
  type EarTrainingDifficulty,
  type IntervalPerformance,
  type IntervalPlaybackMode,
  type IntervalQuestion,
} from "./ear-training";
import "./ear-training.css";

type QuizPhase = "setup" | "playing_interval" | "waiting_for_answer" | "incorrect_answer" | "correct_answer" | "transitioning" | "complete";
type PlayNotes = (midis: number[], holdSeconds: number, volume: number) => void;

const PLAY_MODES: Array<{ id: IntervalPlaybackMode; label: string; short: string; notes: number[] }> = [
  { id: "ascending", label: "Ascending", short: "Low → high", notes: [0, 1] },
  { id: "descending", label: "Descending", short: "High → low", notes: [1, 0] },
  { id: "harmonic", label: "Harmonic", short: "Together", notes: [0, 0] },
  { id: "ascending-harmonic", label: "Ascending + Harmonic", short: "Rise, then together", notes: [0, 1, 0] },
  { id: "descending-harmonic", label: "Descending + Harmonic", short: "Fall, then together", notes: [1, 0, 0] },
];

function modeEvents(question: IntervalQuestion, mode: IntervalPlaybackMode) {
  const low = [question.rootMidi];
  const high = [question.targetMidi];
  const both = question.rootMidi === question.targetMidi ? low : [question.rootMidi, question.targetMidi];
  switch (mode) {
    case "ascending": return [{ at: 0, notes: low }, { at: 560, notes: high }];
    case "descending": return [{ at: 0, notes: high }, { at: 560, notes: low }];
    case "harmonic": return [{ at: 0, notes: both }];
    case "ascending-harmonic": return [{ at: 0, notes: low }, { at: 520, notes: high }, { at: 1120, notes: both }];
    case "descending-harmonic": return [{ at: 0, notes: high }, { at: 520, notes: low }, { at: 1120, notes: both }];
  }
}

function StaffPreview({ notes }: { notes: number[] }) {
  return <span className="staff-preview" aria-hidden="true">
    <i/><i/><i/>{notes.map((height, index) => <b key={index} style={{ bottom: `${5 + height * 12}px`, left: `${17 + index * 15}px` }}>●</b>)}
  </span>;
}

const EarKeyboard = memo(function EarKeyboard({ highlighted, onPlay }: { highlighted: number[]; onPlay: (midi: number) => void }) {
  const range = useMemo(() => Array.from({ length: 37 }, (_, index) => 48 + index), []);
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
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [difficulty, setDifficulty] = useState<EarTrainingDifficulty>("easy");
  const [testLength, setTestLength] = useState<(typeof TEST_LENGTHS)[number]>(10);
  const [playbackMode, setPlaybackMode] = useState<IntervalPlaybackMode>("ascending");
  const [showPlayedKeys, setShowPlayedKeys] = useState(true);
  const [volume, setVolume] = useState(72);
  const [question, setQuestion] = useState<IntervalQuestion | null>(null);
  const [correct, setCorrect] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set());
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [highlightedKeys, setHighlightedKeys] = useState<number[]>([]);
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
    const events = modeEvents(activeQuestion, mode);
    events.forEach(event => {
      timers.current.push(window.setTimeout(() => {
        if (token !== playbackToken.current) return;
        playNotes(event.notes, .68, volume / 100);
        if (showPlayedKeys) setHighlightedKeys(event.notes);
      }, event.at));
    });
    const finishAt = events.at(-1)!.at + 720;
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
    playNotes([midi], .7, volume / 100);
    setHighlightedKeys([midi]);
    timers.current.push(window.setTimeout(() => setHighlightedKeys(keys => keys.length === 1 && keys[0] === midi ? [] : keys), 500));
  }

  const choices = intervalsForDifficulty(difficulty);
  const activeMode = PLAY_MODES.find(mode => mode.id === playbackMode)!;
  const accuracy = formatAccuracy(correct, attempts);

  if (phase === "setup") return <section className="ear-training ear-setup" aria-labelledby="ear-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Back to Faithful Keys</button><span>EAR TRAINING · INTERVALS</span></header>
    <div className="ear-setup-intro"><div><span className="step">LISTEN · IDENTIFY · GROW</span><h1 id="ear-title">Train your <em>musical ear.</em></h1><p>Hear the distance between two notes, identify it, and connect the sound to the keyboard.</p></div><div className="ear-setup-mark" aria-hidden="true">♪<b>?</b></div></div>
    <div className="ear-setup-grid">
      <fieldset><legend>1 · Difficulty</legend><div className="ear-choice-pair">
        <button type="button" className={difficulty === "easy" ? "selected" : ""} onClick={() => setDifficulty("easy")} aria-pressed={difficulty === "easy"}><b>Easy</b><span>Unison through one octave</span></button>
        <button type="button" className={difficulty === "hard" ? "selected" : ""} onClick={() => setDifficulty("hard")} aria-pressed={difficulty === "hard"}><b>Hard</b><span>Unison through two octaves</span></button>
      </div></fieldset>
      <fieldset><legend>2 · Test length</legend><div className="ear-lengths">{TEST_LENGTHS.map(length => <button type="button" className={testLength === length ? "selected" : ""} onClick={() => setTestLength(length)} aria-pressed={testLength === length} key={length}><b>{length}</b><span>intervals</span></button>)}</div></fieldset>
      <fieldset className="ear-mode-field"><legend>3 · Play mode</legend><div className="ear-mode-grid">{PLAY_MODES.map(mode => <button type="button" className={playbackMode === mode.id ? "selected" : ""} onClick={() => setPlaybackMode(mode.id)} aria-pressed={playbackMode === mode.id} key={mode.id}><StaffPreview notes={mode.notes}/><span><b>{mode.label}</b><small>{mode.short}</small></span></button>)}</div></fieldset>
      <fieldset className="ear-ready"><legend>4 · Ready</legend><label className="ear-switch"><span><b>Show Played Keys</b><small>See keys illuminate during playback</small></span><input type="checkbox" checked={showPlayedKeys} onChange={event => setShowPlayedKeys(event.target.checked)}/><i/></label><label className="ear-volume"><span>Volume</span><input aria-label="Ear Training volume" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))}/><b>{volume}%</b></label><button className="ear-start" type="button" onClick={beginTest}>Start Test <span>→</span></button></fieldset>
    </div>
  </section>;

  if (phase === "complete") return <section className="ear-training ear-results" aria-labelledby="results-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Back to Faithful Keys</button><span>EAR TRAINING · COMPLETE</span></header>
    <div className="results-card"><span className="results-icon" aria-hidden="true">✓</span><span className="step">TEST COMPLETE</span><h1 id="results-title">Well heard.</h1><p>You completed every interval. Every guess—including the misses—is reflected in your final accuracy.</p>
      <div className="results-score"><strong>{accuracy}</strong><span>Final accuracy</span></div>
      <div className="results-stats"><div><span>Intervals</span><b>{completed} / {testLength}</b></div><div><span>Correct</span><b>{correct}</b></div><div><span>Attempts</span><b>{attempts}</b></div></div>
      <div className="results-settings"><span>{difficulty === "easy" ? "Easy · 1 octave" : "Hard · 2 octaves"}</span><span>{activeMode.label}</span><span>{testLength} intervals</span></div>
      <div className="results-actions"><button className="ear-start" type="button" onClick={beginTest}>Restart Same Test</button><button type="button" onClick={returnToSetup}>Start New Test</button></div>
      <div className="results-quick"><button type="button" onClick={() => { setDifficulty(difficulty === "easy" ? "hard" : "easy"); returnToSetup(); }}>Change Difficulty</button><button type="button" onClick={returnToSetup}>Change Test Length</button></div>
    </div>
  </section>;

  return <section className="ear-training ear-quiz" aria-labelledby="quiz-title">
    <header className="ear-header"><button type="button" className="ear-back" onClick={exitTrainer}>← Exit trainer</button><div className="ear-quiz-meta"><span>{difficulty === "easy" ? "EASY · 1 OCTAVE" : "HARD · 2 OCTAVES"}</span><b>{activeMode.label}</b></div><button type="button" className="ear-restart" onClick={beginTest}>↻ Restart</button></header>
    <div className="ear-dashboard">
      <div className="ear-prompt"><span className="step">INTERVAL {Math.min(completed + 1, testLength)} OF {testLength}</span><h1 id="quiz-title">What interval do you hear?</h1><p aria-live="polite">{phase === "incorrect_answer" ? "Not quite—listen again or choose another interval." : phase === "correct_answer" ? `Correct — ${question?.interval.name}.` : phase === "playing_interval" ? "Listen…" : "Choose the interval below."}</p></div>
      <div className="ear-stats" aria-label="Live quiz score"><div><span>Correct</span><b>{correct}</b></div><div><span>Attempts</span><b>{attempts}</b></div><div className="accuracy"><span>Accuracy</span><b>{accuracy}</b></div></div>
    </div>
    <div className="ear-listen-panel">
      <div className="ear-listen-actions"><button className="ear-replay" type="button" onClick={replay} disabled={phase === "correct_answer" || phase === "transitioning"}><span aria-hidden="true">▶</span><b>Replay interval</b><small>Same notes · no score change</small></button><label className="ear-switch compact"><span><b>Show keys</b></span><input type="checkbox" checked={showPlayedKeys} onChange={event => setShowPlayedKeys(event.target.checked)}/><i/></label><label className="ear-volume compact"><span>Volume</span><input aria-label="Ear Training volume" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))}/><b>{volume}%</b></label></div>
      <EarKeyboard highlighted={highlightedKeys} onPlay={playKeyboardNote}/>
      <p className="keyboard-caption">C3–C6 · Tap any key to explore. Played notes appear after the correct answer.</p>
    </div>
    <div className={`interval-grid ${difficulty}`} role="group" aria-label="Interval answer choices">{choices.map(interval => {
      const wrong = wrongIds.has(interval.id);
      const right = acceptedId === interval.id;
      return <button type="button" key={interval.id} className={wrong ? "wrong" : right ? "correct" : ""} onClick={() => chooseAnswer(interval.id)} disabled={phase === "correct_answer" || phase === "transitioning" || phase === "playing_interval"} aria-label={`${interval.name}${wrong ? ", incorrect" : right ? ", correct" : ""}`}><span>{interval.name}</span><b aria-hidden="true">{wrong ? "×" : right ? "✓" : interval.semitones}</b><small>{interval.semitones} {interval.semitones === 1 ? "semitone" : "semitones"}</small></button>;
    })}</div>
  </section>;
}
