'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaderContextDetector, readerContextShortcut } from './reader-context';

export default function ReaderKeyContext({ notes, paused }: { notes: number[]; paused: boolean }) {
  const detector = useRef(new ReaderContextDetector());
  const panel = useRef<HTMLElement>(null);
  const input = useRef(notes); input.current = notes;
  const playback = useRef(paused); playback.current = paused;
  const [listening, setListening] = useState(false);
  const [context, setContext] = useState(detector.current.result);
  const toggle = useCallback(() => {
    const engine = detector.current;
    setContext(engine.running ? engine.stop(performance.now()) : engine.start(playback.current ? [] : input.current, performance.now()));
    setListening(engine.running);
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const interactive = Boolean(target?.closest('input, textarea, select, button, a[href], [role="button"], [role="textbox"], [role="slider"], [contenteditable]:not([contenteditable="false"]), audio, video'));
      if (!readerContextShortcut(event, interactive, Boolean(document.querySelector('dialog[open]'))) || document.hidden) return;
      event.preventDefault(); toggle();
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [toggle]);
  useEffect(() => {
    if (listening) setContext(detector.current.update(paused ? [] : notes, performance.now()));
  }, [notes, paused, listening]);
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setContext(detector.current.tick(performance.now())), 40);
    return () => clearInterval(timer);
  }, [listening]);
  useEffect(() => {
    const engine = detector.current;
    panel.current?.focus({ preventScroll: true });
    return () => { engine.stop(performance.now()); };
  }, []);

  const current = context.current;
  const status = listening ? paused ? 'Paused during playback' : 'Listening' : context.observations ? 'Stopped · results held' : 'Ready';
  return <section ref={panel} tabIndex={-1} className={`reader-context ${listening ? 'is-listening' : ''}`} aria-labelledby="reader-context-title">
    <div className="reader-context-heading">
      <h2 id="reader-context-title">Key &amp; context <span className="reader-context-status">{status}</span></h2>
      <button type="button" aria-pressed={listening} aria-keyshortcuts="Space" onClick={toggle}>{listening ? '■ Stop analysis' : '▶ Start analysis'} <kbd>Space</kbd></button>
    </div>
    <div className="reader-context-body" role="status" aria-live="polite" aria-atomic="true">
      <div className="reader-context-key"><strong>{context.key?.name ?? (listening ? 'Finding the key…' : 'Key detection')}</strong><small>{context.key ? context.confidence + (context.confidence === 'Tentative' ? ` · also possible: ${context.alternative}` : '') : listening ? 'Play a few chords or a melody.' : 'Press Space to start; press again to stop.'}</small></div>
      <div className="reader-context-function">{current ? <><strong>{current.chord} <span>{current.roman} · {current.number} chord{current.bass !== current.number ? ` · bass ${current.bass}` : ''}</span></strong><small>{current.role}</small></> : <><strong>{context.observations ? 'Melody / partial chord' : 'Your harmony, in context'}</strong><small>{context.observations ? 'Keep playing to clarify the harmony.' : 'Chord numbers, functions and movement appear here.'}</small></>}</div>
    </div>
    {context.progression.length > 0 && <ol className="reader-context-progression" aria-label="Recent chord movement">{context.progression.map((step, index) => <li key={index} title={`${step.chord}: ${step.roman}, ${step.role}`}><span>{step.chord}</span> <strong>{step.roman}</strong></li>)}</ol>}
  </section>;
}
