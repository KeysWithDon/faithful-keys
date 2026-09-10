'use client';
import { useEffect, useRef, useState } from 'react';
import { EarKeyboard } from '../ear-training-ui';
import { useMidi } from '../midi/ui';
import { midiManager } from '../midi/manager';
import { matchChord, voiceMovement } from '../midi/parser';
import { type Exercise } from './exercises';
export type ExerciseResult = { correct: boolean; expected: string; answer: string; hint: boolean; responseMs: number; input: 'screen'|'midi' };
export function LearningExercise({question:q,playNotes,stopAudio,onAttempt,onNext}:{question:Exercise;playNotes:(n:number[],seconds:number,level:number)=>void;stopAudio:()=>void;onAttempt:(a:ExerciseResult)=>void;onNext:()=>void}) {
  const midi=useMidi(); const [step,setStep]=useState(0),[selected,setSelected]=useState<number[]>([]),[feedback,setFeedback]=useState(''),[hint,setHint]=useState(false),[done,setDone]=useState(false),[playing,setPlaying]=useState(false);
  const started=useRef(Date.now()), lock=useRef(false), timers=useRef<ReturnType<typeof setTimeout>[]>([]), held=useRef<number[]>([]), capture=useRef<ReturnType<typeof setTimeout>|null>(null), rhythm=useRef<number[]>([]);
  const latest=useRef({step,hint,done,playing}); latest.current={step,hint,done,playing};
  const attemptHandler=useRef<(notes:number[],input:'screen'|'midi')=>void>(()=>{});
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);if(capture.current)clearTimeout(capture.current);stopAudio();},[stopAudio]);
  function report(correct:boolean,answer:string,input:'screen'|'midi',expected=q.labels[step]??q.prompt) {
    onAttempt({correct,answer,expected,input,hint,responseMs:Date.now()-started.current});
    started.current=Date.now();
    setFeedback(correct?'Correct.':q.sequence?'Not quite. Try this note again, or restart the sequence.':'Not quite. Try again.');
  }
  function finish() { lock.current=true;setDone(true);setFeedback('Correct — well done.');timers.current.push(setTimeout(onNext,800)); }
  function submit(notes:number[],input:'screen'|'midi') {
    if(lock.current||done||playing||!notes.length)return;
    const expected=q.expected[step]; if(!expected)return;
    const shift=q.sequence && step>0 ? (selected[0]??q.expected[0][0])-q.expected[0][0] : 0;
    const correct=q.chordSequence ? matchChord(notes,expected) : q.sequence ? (step===0 ? notes[0]%12===expected[0]%12 : notes[0]===expected[0]+shift)
      : q.octaveExact ? notes.length===1&&notes[0]===expected[0]
      : matchChord(notes,expected,q.bass) && (!q.previous || voiceMovement(q.previous,notes)<=voiceMovement(q.previous,expected)+2);
    if(!correct){report(false,notes.join(','),input);return;}
    if(q.sequence && step===0)setSelected([notes[0]]);
    if(step+1<q.expected.length){setStep(step+1);setFeedback(`Good · ${step+1} of ${q.expected.length}`);if(!q.sequence)setSelected([]);return;}
    report(true,notes.join(','),input);finish();
  }
  attemptHandler.current=submit;
  useEffect(()=>midiManager.onNote(event=>{
    if(event.type==='panic'){held.current=[];if(capture.current)clearTimeout(capture.current);capture.current=null;setSelected([]);return;}
    if(event.type!=='on'||midiManager.getSnapshot().inputMode==='screen'||latest.current.done||latest.current.playing)return;
    playNotes([event.note],.5,event.velocity*.72);
    if(q.sequence || q.expected[0]?.length===1){attemptHandler.current([event.note],'midi');return;}
    held.current.push(event.note);
    if(!capture.current) capture.current=setTimeout(()=>{const notes=[...new Set([...held.current,...midiManager.getSnapshot().active])];held.current=[];capture.current=null;attemptHandler.current(notes,'midi');},200);
  }),[q,playNotes]);
  function listen() {
    timers.current.forEach(clearTimeout);stopAudio();setPlaying(true);
    const frames=q.previous?[q.previous,...q.expected]:q.expected;
    frames.forEach((notes,i)=>timers.current.push(setTimeout(()=>playNotes(notes,q.sequence?.45:.9,.72),i*(q.sequence?500:1100))));
    timers.current.push(setTimeout(()=>{setPlaying(false);started.current=Date.now();},frames.length*(q.sequence?500:1100)));
  }
  function keyPlay(note:number) {
    if(done||playing)return;playNotes([note],.5,.72);
    if(q.sequence||q.expected[0]?.length===1)submit([note],'screen');
    else setSelected(current=>current.includes(note)?current.filter(n=>n!==note):[...current,note]);
  }
  function tap() {
    if(done)return;rhythm.current.push(Date.now());
    setFeedback(`${rhythm.current.length} of 4 beats`);
    if(rhythm.current.length===4){const spans=rhythm.current.slice(1).map((n,i)=>n-rhythm.current[i]),mean=spans.reduce((a,b)=>a+b,0)/3;const correct=mean>=200&&mean<=3000&&spans.every(n=>Math.abs(n-mean)/mean<=.25);report(correct,spans.join(','),'screen','Four even beats');rhythm.current=[];if(correct)finish();}
  }
  return <section className="learning-exercise" aria-label="Guided exercise">
    <h2>{q.prompt}</h2>
    {!q.playback && !q.choices && !q.rhythm && <p>{q.sequence?`${step} of ${q.expected.length} notes`:`Chord ${step+1} of ${q.expected.length}`} · {q.labels[step]}</p>}
    <div className="learning-actions"><button onClick={()=>{setHint(true);}} disabled={done}>Show teaching hint</button>{q.expected.length>0 && <button onClick={()=>{if(!q.playback)setHint(true);listen();}} disabled={done||playing}>{q.playback?'Hear It':'Hear example (hint)'}</button>}{(q.sequence||q.expected.length>1)&&<button disabled={done} onClick={()=>{setStep(0);setSelected([]);report(false,'Restart','screen');}}>Restart exercise</button>}</div>
    {hint&&<p className="learning-hint">{q.hint}</p>}
    <p role="status" aria-live="polite">{playing?'Listen…':feedback||'Take your time. Accuracy comes before speed.'}</p>
    {q.choices?<div className="learning-answers">{q.choices.map(choice=><button key={choice} disabled={done} onClick={()=>{const correct=choice===q.answer;report(correct,choice,'screen',q.answer);if(correct)finish();}}>{choice}</button>)}</div>:q.rhythm?<button className="learning-primary" onClick={tap} disabled={done}>Tap beat</button>:<>
      <EarKeyboard highlighted={[...midi.active,...(!q.sequence?selected:[])]} onPlay={keyPlay} octaves={4}/>
      {!q.sequence&&q.expected[0]?.length>1&&<div className="learning-actions"><button className="learning-primary" onClick={()=>submit(selected,'screen')} disabled={!selected.length||done||playing}>Check chord</button><button onClick={()=>setSelected([])}>Clear selected keys</button></div>}
      <p className="learning-small">{q.sequence?'Play one note at a time. Any starting octave is accepted; then stay in sequence.':q.chordSequence?'Play each chord in order. MIDI notes are captured over 200 ms.':'Tap keys to select a chord, then Check chord. MIDI chords are captured over 200 ms.'} Onscreen input always remains available.</p>
    </>}
  </section>;
}
