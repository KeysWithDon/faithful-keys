"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MidiOutputSelector, useMidi } from "./midi/ui";
import { midiManager } from "./midi/manager";
import {
  CIRCLE_KEYS, GOSPEL_LESSONS, PHASES, REQUIRED_ROUNDS,
  acceptChord, emptyProgress, lessonVoicings, nameMidi, voiceFeedback, withMistake,
  type MasteryProgress,
} from "./progression-teacher";
import "./progression-teacher.css";

const STORAGE_KEY = "faithful-keys-gospel-progression-mastery-v1";
const blackPitch = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const pianoNotes = Array.from({length: 88}, (_, index) => index + 21);
const whiteNotes = pianoNotes.filter(note => !blackPitch(note));
const blackNotes = pianoNotes.filter(blackPitch);
const sortedKey = (values: readonly number[]) => [...values].sort((a, b) => a - b).join(",");
const phaseLabel: Record<MasteryProgress["phase"], string> = {
  guided: "Learn", repetition: "Repeat", independent: "Play independently",
  fluency: "Build fluency", retention: "Remember", "circle-review": "12-key review",
};
const phaseDescription: Record<MasteryProgress["phase"], string> = {
  guided: "Watch the highlighted voices and follow the visual notes.",
  repetition: "Play three clean complete rounds. Corrections are welcome, but only clean rounds count.",
  independent: "Play without step-by-step prompting. Every chord stays on screen.",
  fluency: "Play at a steady tempo, without prolonged gaps between chords.",
  retention: "Recall the whole progression again. The notes remain visible for reference.",
  "circle-review": "Perform the complete movement cleanly once in each key before unlocking the next lesson.",
};

function Keyboard({expected, played, chord, label}: {
  expected: readonly number[]; played: readonly number[]; chord: string; label: string;
}) {
  const expectedSet = new Set(expected), playedSet = new Set(played);
  const keyClass = (note: number) => {
    const targeted = expectedSet.has(note), pressed = playedSet.has(note);
    return "gp-key" + (blackPitch(note) ? " black" : " white") + (targeted ? " target" : "") + (pressed ? " pressed" : "") + (targeted && pressed ? " matched" : "");
  };
  return <div className="gp-piano-wrap">
    <div className="gp-piano-caption"><span>{label}</span><span>88-key visual · gold = target · blue = played · green = match</span></div>
    <div className="gp-piano" role="img" aria-label={"Full piano showing " + chord + " target notes " + expected.map(n => nameMidi(n, chord)).join(", ")}>
      {whiteNotes.map((note, i) => <span key={note} className={keyClass(note)}
        style={{left: String(i * 100 / 52) + "%", width: String(100 / 52) + "%"}}
        title={nameMidi(note, chord)}>
        {(expectedSet.has(note) || playedSet.has(note)) && <span className="gp-key-dot"/>}
      </span>)}
      {blackNotes.map(note => {
        const whitesBefore = whiteNotes.filter(n => n < note).length;
        return <span key={note} className={keyClass(note)}
          style={{left: String((whitesBefore - .34) * 100 / 52) + "%", width: String(.68 * 100 / 52) + "%"}}
          title={nameMidi(note, chord)}>
          {(expectedSet.has(note) || playedSet.has(note)) && <span className="gp-key-dot"/>}
        </span>;
      })}
    </div>
  </div>;
}

export default function GospelProgressionTeacher() {
  const midi = useMidi();
  const [progress, setProgress] = useState<MasteryProgress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [includeBass, setIncludeBass] = useState(false);
  const [tempo, setTempo] = useState(72);
  const [liveHint, setLiveHint] = useState("Play the highlighted notes on your MIDI keyboard.");
  const [pressCount, setPressCount] = useState(0);
  const [demoIndex, setDemoIndex] = useState(-1);
  const audioRef = useRef<AudioContext | null>(null);
  const demoTimers = useRef<number[]>([]);
  const lastAcceptedStamp = useRef("");
  const lastSuccessTime = useRef(0);
  const lesson = GOSPEL_LESSONS[progress.lesson];
  const key = CIRCLE_KEYS[progress.key] || "C";
  const voicings = useMemo(() => lesson ? lessonVoicings(lesson, key) : [], [lesson, key]);
  const current = voicings[progress.step] || voicings[0];
  const expected = useMemo(() => current ? (includeBass ? current.notes : current.upperVoices) : [], [current, includeBass]);
  const played = midi.pressed.length ? midi.pressed : midi.sustain && midi.sustainChord.length ? midi.sustainChord : [];
  const playedId = sortedKey(played);
  const stamp = String(pressCount) + ":" + String(midi.sustainPress);
  const feedback = current ? voiceFeedback(expected, played, current.symbol) : null;
  const mastered = progress.completed.filter(id => id.startsWith(String(progress.lesson) + ":")).length;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<MasteryProgress>;
        if (typeof stored.lesson === "number" && stored.lesson >= 0 && stored.lesson <= GOSPEL_LESSONS.length &&
            typeof stored.key === "number" && stored.key >= 0 && stored.key < 12 &&
            typeof stored.step === "number" && stored.step >= 0 &&
            typeof stored.rounds === "number" && stored.rounds >= 0 &&
            PHASES.concat("circle-review").includes(stored.phase as MasteryProgress["phase"]) &&
            Array.isArray(stored.completed)) {
          setProgress({...emptyProgress(), ...stored, completed: stored.completed.filter((x): x is string => typeof x === "string"), mistakes: 0, step: 0});
        }
      }
    } catch { /* Offline and private-mode practice remains available. */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch { /* Browser storage may be restricted. */ }
  }, [progress, loaded]);

  useEffect(() => midiManager.onNote(event => {
    if (event.type === "on") setPressCount(count => count + 1);
    if (event.type === "panic") setLiveHint("MIDI notes released. Play the displayed chord when ready.");
  }), []);

  useEffect(() => {
    lastSuccessTime.current = 0;
    lastAcceptedStamp.current = stamp;
    setLiveHint("Play " + (current?.symbol || "the highlighted chord") + ". All chord notes stay visible.");
    // Changing keys or stages should not count already-held notes as a new answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.lesson, progress.key, progress.phase, includeBass]);

  useEffect(() => {
    if (!loaded || !current || !played.length || midi.status !== "Connected" || demoIndex !== -1) return;
    if (stamp === lastAcceptedStamp.current) return;
    const verdict = voiceFeedback(expected, played, current.symbol);
    const timeout = window.setTimeout(() => {
      setLiveHint(verdict.message);
      if (!verdict.correct) {
        if (played.length >= expected.length)
          setProgress(previous => previous.mistakes ? previous : withMistake(previous));
        return;
      }
      if (stamp === lastAcceptedStamp.current) return;
      lastAcceptedStamp.current = stamp;
      const now = performance.now();
      const gap = now - lastSuccessTime.current;
      const notFluent = progress.phase === "fluency" && progress.step > 0 && gap > Math.max(1800, 3 * 60000 / tempo);
      lastSuccessTime.current = progress.step === voicings.length - 1 ? 0 : now;
      setProgress(previous => acceptChord(notFluent ? withMistake(previous) : previous, voicings.length));
      if (notFluent) setLiveHint("Correct notes. Try that transition again with a steadier flow.");
    }, verdict.correct ? 230 : 450);
    return () => window.clearTimeout(timeout);
    // Arrays are keyed by note values to avoid evaluating an unchanged MIDI frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, current?.symbol, progress.step, progress.phase, playedId, stamp, includeBass, tempo, demoIndex, midi.status]);

  useEffect(() => () => {
    demoTimers.current.forEach(window.clearTimeout);
    if (audioRef.current) void audioRef.current.close().catch(() => undefined);
  }, []);

  function demo(full: boolean) {
    if (!voicings.length) return;
    demoTimers.current.forEach(window.clearTimeout);
    demoTimers.current = [];
    const chords = full ? voicings : [current];
    const duration = Math.round(60000 / tempo * 1.7);
    const validChords = chords.filter((item): item is NonNullable<typeof item> => Boolean(item));
    setDemoIndex(full ? 0 : progress.step);
    const notesFor = (i: number) => includeBass ? validChords[i].notes : validChords[i].upperVoices;
    if (midi.selectedOutput) {
      void (async () => {
        try {
          for (let i = 0; i < validChords.length; i += 1) {
            setDemoIndex(full ? i : progress.step);
            await midiManager.playOutputChord(notesFor(i), Math.max(300, duration - 70));
          }
          setLiveHint("Playback finished. Now play the movement on your own keyboard.");
        } catch (error) {
          setLiveHint(error instanceof Error ? error.message : "MIDI output could not play the demonstration.");
        } finally { setDemoIndex(-1); }
      })();
      return;
    }
    try {
      const Context = window.AudioContext;
      const ctx = audioRef.current && audioRef.current.state !== "closed" ? audioRef.current : new Context();
      audioRef.current = ctx;
      void ctx.resume();
      const start = ctx.currentTime + .045;
      validChords.forEach((_voice, index) => {
        const time = start + index * duration / 1000;
        notesFor(index).forEach(note => {
          const oscillator = ctx.createOscillator();
          const envelope = ctx.createGain();
          oscillator.type = "triangle";
          oscillator.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
          envelope.gain.setValueAtTime(.0001, time);
          envelope.gain.exponentialRampToValueAtTime(.07 / Math.sqrt(notesFor(index).length), time + .035);
          envelope.gain.exponentialRampToValueAtTime(.0001, time + Math.max(.20, duration / 1000 - .06));
          oscillator.connect(envelope).connect(ctx.destination);
          oscillator.start(time);
          oscillator.stop(time + duration / 1000);
        });
        demoTimers.current.push(window.setTimeout(() => setDemoIndex(full ? index : progress.step), index * duration));
      });
      demoTimers.current.push(window.setTimeout(() => {
        setDemoIndex(-1);
        setLiveHint("Playback finished. Try playing the displayed chord movement.");
      }, validChords.length * duration + 90));
    } catch {
      setDemoIndex(-1);
      setLiveHint("Browser audio is unavailable. You can still practice with your MIDI keyboard.");
    }
  }

  function restartKey() {
    lastSuccessTime.current = 0;
    lastAcceptedStamp.current = stamp;
    setProgress(p => ({...p, step: 0, rounds: 0, mistakes: 0, notice: "Restarted this stage in the current key."}));
  }

  if (!loaded) return <section className="gp-app" aria-label="Progression Teacher"><p>Loading your gospel progression practice…</p></section>;

  if (!lesson) return <section className="gp-app gp-finished">
    <div className="gp-eyebrow">FAITHFUL KEYS · GOSPEL PROGRESSION TEACHER</div>
    <h1>Course mastered</h1>
    <p>You completed every lesson and all 12 keys, including full circle reviews. Keep playing these movements in real music.</p>
    <button type="button" onClick={() => { if (window.confirm("Restart the complete progression course?")) setProgress(emptyProgress()); }}>Start the full course again</button>
  </section>;

  return <section className="gp-app" aria-label="Visual Gospel Progression Teacher">
    <header className="gp-intro">
      <div><p className="gp-eyebrow">FAITHFUL KEYS / PROGRESSION TEACHER</p>
        <h1>Learn the movement. <em>Master the sound.</em></h1>
        <p>Every chord stays visible. Practice each movement in all 12 keys before advancing.</p>
      </div>
      <div className="gp-lesson-stat"><span>LEVEL {lesson.level} / 7</span><strong>{progress.lesson + 1} <small>/ {GOSPEL_LESSONS.length}</small></strong><span>GOSPEL MOVEMENTS</span></div>
    </header>

    <div className="gp-layout">
      <div className="gp-main">
        <div className="gp-lesson">
          <div className="gp-section-label">CURRENT LESSON <span>{lesson.movement}</span></div>
          <h2>{lesson.title}</h2>
          <p>{lesson.explanation}</p>
          <div className="gp-keyhead"><div><span>KEY</span><strong>{key}</strong></div><div><span>STAGE</span><strong>{phaseLabel[progress.phase]}</strong></div><div><span>CLEAN ROUNDS</span><strong>{progress.rounds} / {REQUIRED_ROUNDS[progress.phase]}</strong></div></div>
          <p className="gp-stage-description">{phaseDescription[progress.phase]}</p>
        </div>

        <div className="gp-sequence" aria-label="Chord movement and exact note visualization">
          {voicings.map((voice, index) => <div className={"gp-chord-card" + (index === progress.step ? " current" : "") + (index < progress.step ? " passed" : "") + (index === demoIndex ? " demo" : "")} key={index}>
            <small>CHORD {index + 1}</small><strong>{voice.symbol}</strong>
            <div className="gp-note-list">{voice.upperVoices.map((note, j) => <span key={j}>{nameMidi(note, voice.symbol)}</span>)}</div>
            <small className="gp-bass-label">Bass {nameMidi(voice.bass, voice.symbol)}{includeBass ? " · required" : " · optional"}</small>
          </div>)}
        </div>

        <div className="gp-focus">
          <div className="gp-section-label">PLAY THIS CHORD <span>{progress.step + 1} OF {voicings.length}</span></div>
          <div className="gp-focus-main"><strong>{current.symbol}</strong><span>{current.diagnostics.summary}</span></div>
          <div className="gp-voices" aria-label="Exact notes to play">
            {expected.map((note, index) => <span key={index} className={"gp-voice" + (played.includes(note) ? " matched" : "")}>{nameMidi(note, current.symbol)}{played.includes(note) && <b> ✓</b>}</span>)}
          </div>
          <div className="gp-feedback" role="status" aria-live="polite"><span className={"gp-feedback-light" + (feedback?.correct && played.length ? " good" : "")}/><p>{liveHint}</p></div>
        </div>

        <Keyboard chord={current.symbol} expected={expected} played={played} label="TARGET + LIVE MIDI VOICES"/>

        <div className="gp-actions">
          <button type="button" onClick={() => demo(false)}>Hear this chord</button>
          <button type="button" onClick={() => demo(true)}>Hear whole progression</button>
          <button type="button" onClick={restartKey}>Retry this stage</button>
        </div>
        <div className="gp-preferences">
          <label><input type="checkbox" checked={includeBass} onChange={event => setIncludeBass(event.target.checked)}/> Require the bass note</label>
          <label>Comfortable tempo <input type="range" min="45" max="120" step="5" value={tempo} onChange={event => setTempo(Number(event.target.value))}/> <strong>{tempo} BPM</strong></label>
          <MidiOutputSelector/>
        </div>
        <p className="gp-midi-status">MIDI input: {midi.status}. {midi.status !== "Connected" ? "Connect a USB or Bluetooth MIDI instrument using MIDI Setup above." : "Notes and pedal state are read directly from your connected keyboard."}</p>
      </div>

      <aside className="gp-sidebar">
        <section><div className="gp-section-label">CIRCLE OF FOURTHS <span>{progress.phase === "circle-review" ? "FINAL REVIEW" : mastered + " / 12 MASTERED"}</span></div>
          <div className="gp-circle" aria-label="Twelve required keys in circle of fourths order">
            {CIRCLE_KEYS.map((item, index) => {
              const done = progress.completed.includes(String(progress.lesson) + ":" + String(index));
              return <div key={item} className={"gp-circle-key" + (index === progress.key ? " active" : "") + (done ? " mastered" : "")}>
                <span>{index + 1}</span><strong>{item}</strong><small>{index === progress.key ? "NOW" : done ? "MASTERED" : "NEXT"}</small>
              </div>;
            })}
          </div>
          <p className="gp-help">Next key unlocks only after guided learning, repeated clean performances, independent playing, fluency, and retention. Complete a final review in all 12 keys to unlock the next lesson.</p>
        </section>
        <section><div className="gp-section-label">MASTERY CHECKPOINTS</div>
          <div className="gp-stages">
            {PHASES.map((phase, index) => <div key={phase} className={"gp-stage" + (progress.phase === phase ? " active" : "") + (progress.phase !== "circle-review" && PHASES.indexOf(progress.phase) > index ? " passed" : "")}>
              <span>{index + 1}</span><div><strong>{phaseLabel[phase]}</strong><small>{REQUIRED_ROUNDS[phase]} clean {REQUIRED_ROUNDS[phase] === 1 ? "round" : "rounds"}</small></div>
            </div>)}
            <div className={"gp-stage" + (progress.phase === "circle-review" ? " active" : "")}><span>6</span><div><strong>Full circle review</strong><small>One more round per key</small></div></div>
          </div>
          <p className="gp-notice" role="status">{progress.notice}</p>
        </section>
      </aside>
    </div>
  </section>;
}
