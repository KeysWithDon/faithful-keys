'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {MidiOutputSelector,useMidi} from './midi/ui';
import {midiManager} from './midi/manager';
import {identifyChord} from './chord-reader';
import {ChordPlayback} from './chord-playback';
import {Keyboard88,NoteLine} from './ear-first-visuals';
import {exactNotes,movedVoices,pitchLabel,stationaryVoices,type ResolutionMode} from './ear-first-engine';
import {
  IDLE_SESSION,checkListeningAnswer,createListeningSession,listeningOrigin,listeningTarget,nextListeningStep,
  type ListeningSession,
} from './ear-first-practice';
import './ear-first-chord-teacher.css';

type Stage='idle'|'pedal'|'playing'|'answer'|'correct'|'error';
const format=(notes:readonly number[])=>notes.map(pitchLabel).join(' · ');
const chordLabel=(notes:readonly number[])=>identifyChord(notes).matches[0]??'Open voicing';

export default function EarFirstChordTeacher(){
  const midi=useMidi();
  const [voices,setVoices]=useState(4);
  const [maxChords,setMaxChords]=useState<1|2|3|4>(3);
  const [mode,setMode]=useState<ResolutionMode>('varied');
  const [session,setSession]=useState<ListeningSession>(IDLE_SESSION);
  const [stage,setStage]=useState<Stage>('idle');
  const [feedback,setFeedback]=useState<'none'|'incorrect'|'correct'>('none');
  const [hint,setHint]=useState(false);
  const [notice,setNotice]=useState('');
  const [demoMode,setDemoMode]=useState(false);
  const [demoNotes,setDemoNotes]=useState<number[]>([]);
  const [showKeyboard,setShowKeyboard]=useState(false);
  const [attemptSerial,setAttemptSerial]=useState(0);
  const [freshAnswer,setFreshAnswer]=useState(false);
  const player=useRef<ChordPlayback|null>(null);
  const generation=useRef(0);
  const feedbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const lastPedalPress=useRef(midi.sustainPress);
  const lastAttempt=useRef('');
  const stageRef=useRef(stage);stageRef.current=stage;
  const demoRef=useRef(demoMode);demoRef.current=demoMode;
  const fresh=useRef(false);
  const inExercise=session.phase==='chunk'||session.phase==='full';
  const target=listeningTarget(session),origin=listeningOrigin(session);
  const cueKey=[session.phase,session.turn,session.chunk,session.step].join(':');
  const currentKey=useRef(cueKey);currentKey.current=cueKey;
  const played=exactNotes(demoMode?demoNotes:midi.pressed);
  const playedSig=played.join(',');
  const usesPedal=!demoMode&&midi.sustainPress>0;
  const locked=!demoMode&&midi.sustain&&midi.sustainChord.length>0;
  const reveal=hint||stage==='correct'||session.phase==='complete';
  const shared=stationaryVoices(origin,target);
  const visibleShared=reveal?shared:[];
  const liveNotes=inExercise&&(stage==='playing'||stage==='pedal'||!freshAnswer)?[]
    :locked?exactNotes(midi.sustainChord):played;
  const completed=session.phase==='chunk'?Math.floor((session.step-1+(stage==='correct'?1:0))/2)
    :session.phase==='full'?Math.floor((session.step+(stage==='correct'?1:0))/session.chords.length):0;
  const fullPosition=session.chords.length?session.step%session.chords.length:0;
  const outputName=midi.selectedOutput?midi.outputs.find(port=>port.id===midi.selectedOutput)?.name??'Keyboard disconnected':'Browser audio';

  function playback(){if(!player.current)player.current=new ChordPlayback();return player.current;}
  function stopPlayback(){generation.current++;player.current?.stop();}
  function stopTransition(){if(feedbackTimer.current!==null)clearTimeout(feedbackTimer.current);feedbackTimer.current=null;}
  useEffect(()=>()=>{stopTransition();generation.current++;player.current?.dispose();},[]);
  useEffect(()=>{
    try{setShowKeyboard(localStorage.getItem('faithful-keys-show-88-keys')==='yes');}catch{/* Optional preference. */}
    return midiManager.onNote(event=>{
      if(event.type==='on'&&!demoRef.current&&stageRef.current==='answer'&&!midiManager.getSnapshot().outputPlaying){
        fresh.current=true;lastAttempt.current='';setFreshAnswer(true);setAttemptSerial(value=>value+1);
      }
    });
  },[]);
  function toggleKeyboard(){
    setShowKeyboard(current=>{const next=!current;try{localStorage.setItem('faithful-keys-show-88-keys',next?'yes':'no');}catch{/* Optional. */}return next;});
  }
  async function playCue(){
    if(!inExercise)return;
    stopPlayback();const token=generation.current;
    setHint(false);setFeedback('none');setFreshAnswer(false);fresh.current=false;lastAttempt.current='';setDemoNotes([]);
    stageRef.current='playing';setStage('playing');setNotice(session.phase==='chunk'?'Listen to the starting chord, then the next chord.':'Listen, then play the chord you hear.');
    try{
      const sequence=session.phase==='chunk'?[origin,target]:[target];
      const finished=await playback().play(sequence);
      if(token!==generation.current)return;
      if(!finished){setStage('error');setNotice('Playback stopped. Tap Hear again when you are ready.');return;}
      setStage('answer');setNotice(usesPedal?'Your turn. Play the chord, then press sustain to check it.':'Your turn. Play the chord you heard.');
    }catch(error){
      if(token!==generation.current)return;
      player.current?.stop();setStage('error');setNotice(error instanceof Error?error.message:'Sound could not play. Tap Hear again.');
    }
  }
  useEffect(()=>{
    stopTransition();setFeedback('none');setHint(false);setFreshAnswer(false);fresh.current=false;
    if(!inExercise){stopPlayback();setStage('idle');return;}
    if(!demoMode&&midiManager.getSnapshot().sustain){setStage('pedal');setNotice('Lift the pedal to hear the next movement.');}
    else void playCue();
    return()=>{stopPlayback();};
  },[cueKey]);
  useEffect(()=>{if(stage==='pedal'&&(!midi.sustain||demoMode))void playCue();},[stage,midi.sustain,demoMode]);

  function submit(notes:readonly number[],explicit=false){
    if(stageRef.current!=='answer'||midiManager.getSnapshot().outputPlaying)return;
    if(!explicit&&!fresh.current)return;
    const answer=exactNotes(notes);
    const outcome=checkListeningAnswer(true,answer,target);
    if(outcome==='empty'){setNotice('Play a chord first, then check your answer.');return;}
    fresh.current=true;setFreshAnswer(true);lastAttempt.current=answer.join(',');
    if(outcome==='incorrect'){
      setFeedback('incorrect');setNotice('Not quite. Hear it again, or adjust your notes and try again.');return;
    }
    setFeedback('correct');stageRef.current='correct';setStage('correct');setNotice('Correct — exact notes and octaves.');
    const acceptedKey=cueKey;
    feedbackTimer.current=setTimeout(()=>{
      if(currentKey.current===acceptedKey)setSession(current=>nextListeningStep(current));
    },850);
  }
  useEffect(()=>{
    if(midi.sustainPress===lastPedalPress.current)return;
    lastPedalPress.current=midi.sustainPress;
    if(!demoMode&&stage==='answer')submit(midi.sustainChord,true);
  },[midi.sustainPress]);
  useEffect(()=>{
    if(!inExercise||stage!=='answer'||usesPedal||!fresh.current||played.length<target.length||lastAttempt.current===playedSig)return;
    const timer=setTimeout(()=>submit(played),260);
    return()=>clearTimeout(timer);
  },[attemptSerial,playedSig,stage,cueKey,usesPedal]);

  function begin(demo=demoMode){
    stopTransition();stopPlayback();setDemoMode(demo);setDemoNotes([]);
    // Unlock browser audio in the click; later cues can then start automatically.
    void playback().unlock();
    const turn=session.phase==='idle'?0:session.turn+1;
    setSession(createListeningSession(voices,maxChords,mode,turn));
  }
  function beginFull(){
    stopTransition();stopPlayback();void playback().unlock();setDemoNotes([]);
    setSession(current=>({...current,phase:'full',step:0}));
  }
  function openSettings(){stopTransition();stopPlayback();setDemoNotes([]);setSession(IDLE_SESSION);setNotice('Choose your lesson, then hear a movement.');}
  function demoAnswer(){
    fresh.current=true;setFreshAnswer(true);lastAttempt.current='';setDemoNotes([...target]);setAttemptSerial(value=>value+1);
  }
  const analyses=useMemo(()=>session.phase==='complete'?session.chords.slice(1).map((notes,i)=>({
    notes,before:session.chords[i],common:stationaryVoices(session.chords[i],notes),moved:movedVoices(session.chords[i],notes),
  })):[],[session.phase,session.chords]);

  return <main className={'ef ef-phase-'+session.phase+(showKeyboard?' ef-with-keys':'')}>
    <div className="ef-wrap">
      <header className="ef-heading">
        <div><p className="ef-eyebrow">FAITHFUL KEYS / EAR-FIRST TRAINING</p><h1>Chord Teacher</h1><p>Hear a movement. Find it by ear. Play it back.</p></div>
        <div className="ef-audio-tools"><MidiOutputSelector/><span className="ef-connection"><span className={'ef-indicator'+(demoMode||midi.status==='Connected'?' ef-online':'')}/>{demoMode?'Demo input':midi.status==='Connected'?'MIDI connected':'Connect MIDI in the top bar'}</span>{session.phase!=='idle'&&<button type="button" className="ef-mini-toggle" onClick={openSettings}>Lesson settings</button>}</div>
      </header>

      <section className="ef-live" aria-label="Live MIDI input">
        <div className="ef-section-head"><div><p className="ef-eyebrow">live midi</p><h2>What you're playing</h2></div>
          <div className="ef-quick-controls"><span className="ef-count">{liveNotes.length?liveNotes.length+' notes':'up to 10 voices'}</span><button className={'ef-mini-toggle'+(showKeyboard?' selected':'')} type="button" aria-pressed={showKeyboard} onClick={toggleKeyboard}>{showKeyboard?'Hide 88 keys':'Show 88 keys'}</button></div>
        </div>
        {liveNotes.length?<NoteLine notes={liveNotes} active={liveNotes} stationary={visibleShared}/>:<div className="ef-input-placeholder">{stage==='playing'?'Listen to the movement…':session.phase==='idle'?'The teacher will give you a movement.':stage==='pedal'?'Lift the pedal to listen.':'Your turn — find the chord by ear.'}</div>}
        <div className="ef-live-meta"><span>{liveNotes.length?'Bass: '+pitchLabel(liveNotes[0]):stage==='playing'?'Listen first · answers open after playback':'Exact notes and octaves'}</span><span className={locked?'ef-lock-status':''}>{locked?'● chord locked':usesPedal?'Press sustain to check your chord':'Play your answer or use Check answer'}</span></div>
        {showKeyboard&&<Keyboard88 pressed={stage==='playing'||!freshAnswer&&inExercise?[]:played} sustained={stage==='playing'||demoMode||!freshAnswer&&inExercise?[]:midi.sustained} stationary={visibleShared} target={reveal?target:[]}/>}
      </section>

      {session.phase==='idle'&&<section className="ef-panel ef-start" aria-label="Start a listening lesson">
        <div><p className="ef-eyebrow">01 / LISTEN FIRST</p><h2>The teacher gives you the movement.</h2><p>Hear two chords. Find the second chord by ear. Correct answers move the lesson forward. Chords stay in C3–C6, with each hand within an octave.</p></div>
        <div className="ef-form">
          <label className="ef-select">Voices<select aria-label="Voices" value={voices} onChange={event=>setVoices(Number(event.target.value))}>{Array.from({length:9},(_,i)=><option key={i+2} value={i+2}>{i+2} notes</option>)}</select></label>
          <label className="ef-select">Maximum resolving chords<select aria-label="Maximum resolving chords" value={maxChords} onChange={event=>setMaxChords(Number(event.target.value) as 1|2|3|4)}>{[1,2,3,4].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
          <label className="ef-select">Number of chords<select aria-label="Number of chords" value={mode} onChange={event=>setMode(event.target.value as ResolutionMode)}><option value="varied">Varied up to maximum</option><option value="fixed">Fixed</option></select></label>
        </div>
        <div className="ef-actions"><button type="button" className="ef-primary" onClick={()=>begin(false)}>▶ Hear a movement</button><button type="button" className="ef-secondary" onClick={()=>begin(true)}>Try a demo</button></div>
        {!midi.outputs.length&&<p className="ef-help">To use your piano’s sounds, open MIDI Setup, find your keyboard, then select its output and receive channel. Browser audio is ready without a MIDI output.</p>}
      </section>}

      {inExercise&&<section className="ef-panel ef-listening" aria-label="Listen and play by ear">
        <div className="ef-section-head"><div><p className="ef-eyebrow">{session.phase==='chunk'?'02 / HEAR THE MOVEMENT':'03 / FORWARD ONLY'}</p><h2>{session.phase==='chunk'?`Movement ${session.chunk+1} · find the next chord`:`Forward pass ${Math.min(3,Math.floor(session.step/session.chords.length)+1)} · ${fullPosition===0?'Home':`chord ${fullPosition+1}`}`}</h2></div><div className="ef-counter"><strong>{Math.min(3,completed)}</strong><span>/ 3</span></div></div>
        <div className="ef-steps">{Array.from({length:session.phase==='chunk'?session.chords.length-1:3},(_,i)=><span key={i} className={i<(session.phase==='chunk'?session.chunk:completed)?'passed':''}/>)}</div>
        <div className="ef-listen-target">
          {session.phase==='chunk'&&<div className="ef-reference"><p className="ef-eyebrow">STARTING CHORD / REFERENCE</p><NoteLine notes={origin} stationary={visibleShared}/></div>}
          <div className="ef-ear-answer"><p className="ef-eyebrow">{stage==='correct'?'CORRECT CHORD':hint?'HINT · EXACT NOTES':'NEXT CHORD / FIND IT BY EAR'}</p>
            {reveal?<NoteLine notes={target} stationary={shared} from={origin}/>:<p className="ef-hidden-answer">{stage==='playing'?'♫ Listen…':stage==='pedal'?'Release the pedal':'Hear it. Then find it.'}</p>}
          </div>
        </div>
        <div className="ef-listening-actions"><button type="button" className="ef-primary" disabled={stage==='playing'||stage==='correct'||stage==='pedal'} onClick={()=>void playCue()}>▶ Hear again</button>
          <button type="button" className="ef-secondary" disabled={stage!=='answer'} onClick={()=>submit(demoMode?demoNotes:locked?midi.sustainChord:played,true)}>Check answer</button>
          <button type="button" className="ef-secondary" disabled={stage==='playing'||stage==='correct'||stage==='pedal'} onClick={()=>setHint(current=>!current)}>{hint?'Hide hint':'Show hint'}</button>
          {stage==='playing'&&<button type="button" className="ef-secondary" onClick={()=>{stopPlayback();setStage('error');setNotice('Playback stopped. Tap Hear again to listen.');}}>Stop playback</button>}
          <button type="button" className="ef-secondary" onClick={()=>begin()}>New movement</button>
          {demoMode&&<button type="button" className="ef-demo-action" disabled={stage!=='answer'} onClick={demoAnswer}>Play answer (demo)</button>}
        </div>
        <p className={'ef-feedback ef-feedback-'+feedback} role="status">{feedback==='correct'?'✓ Correct — moving on.':feedback==='incorrect'?'Not quite — try this chord again.':stage==='playing'?`Playing through ${outputName}.`:stage==='pedal'?'Lift the pedal to hear the next movement.':usesPedal?'Play what you heard, then press sustain to confirm.':'Play what you heard. A settled full chord is checked automatically.'}</p>
      </section>}

      {session.phase==='ready'&&<section className="ef-panel ef-ready"><p className="ef-eyebrow">03 / CONNECT EVERYTHING</p><h2>Every movement learned.</h2><p>Now hear and play the complete progression in its original direction. Three forward passes.</p><button type="button" className="ef-primary" onClick={beginFull}>▶ Start forward practice</button><button type="button" className="ef-secondary" onClick={()=>begin()}>New movement</button></section>}

      {session.phase==='complete'&&<section className="ef-panel" aria-label="Why this resolution works"><p className="ef-eyebrow">04 / NOW UNDERSTAND IT</p><h2>Three forward passes completed.</h2><div className="ef-actions"><button type="button" className="ef-primary" onClick={()=>begin()}>Hear a new movement</button><button type="button" className="ef-secondary" onClick={beginFull}>Repeat this progression</button></div>
        <div className="ef-analysis">{analyses.map((item,i)=><article key={i}><p className="ef-eyebrow">MOVEMENT {i+1}</p><h3>{chordLabel(item.before)} → {chordLabel(item.notes)}</h3><NoteLine notes={item.notes} stationary={item.common} from={item.before}/><p><strong>Unchanged notes:</strong> {item.common.length?format(item.common):'Every voice moves.'}</p><p><strong>Voice movement:</strong> {item.moved.map(voice=>`${pitchLabel(voice.from)} → ${pitchLabel(voice.to)}`).join(' · ')}</p></article>)}</div>
      </section>}
      {notice&&<p className="ef-notice" role="status">{notice}</p>}
      <footer className="ef-footer">Listen first · Exact pitches and octaves · Up to 10 voices · Sustain confirms · Keyboard MIDI output</footer>
    </div>
  </main>;
}
