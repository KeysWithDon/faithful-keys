'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useMidi} from './midi/ui';
import {identifyChord} from './chord-reader';
import {ReaderAudio} from './reader-audio';
import {Keyboard88,NoteLine} from './ear-first-visuals';
import {
  MAX_VOICES,exactMatch,exactNotes,generateResolution,movedVoices,
  pitchLabel,stationaryVoices,type ResolutionMode,
} from './ear-first-engine';
import './ear-first-chord-teacher.css';

type Phase='capture'|'chunk'|'ready'|'full'|'explain';
type Session={phase:Phase;chords:number[][];chunk:number;step:number;turn:number};
const DEMO=[40,47,55,59,64]; // Five-note example, not a ten-note requirement
const INITIAL:Session={phase:'capture',chords:[],chunk:0,step:0,turn:0};
const format=(notes:readonly number[])=>notes.map(pitchLabel).join(' · ');
const chordLabel=(notes:readonly number[])=>identifyChord(notes).matches[0]??'Open voicing';

function Notes({notes,stationary=[],from=[],active=[],dim=false}:{
  notes:readonly number[];stationary?:readonly number[];from?:readonly number[];active?:readonly number[];dim?:boolean;
}){
  return <NoteLine notes={notes} stationary={stationary} from={from} active={active} className={dim?'ef-dim':''}/>;
}

export default function EarFirstChordTeacher(){
  const midi=useMidi();
  const [demoMode,setDemoMode]=useState(false);
  const [demoNotes,setDemoNotes]=useState<number[]>([]);
  const [captured,setCaptured]=useState<number[]>([]);
  const [showKeyboard,setShowKeyboard]=useState(false);
  const [maxChords,setMaxChords]=useState<1|2|3|4>(3);
  const [mode,setMode]=useState<ResolutionMode>('varied');
  const [session,setSession]=useState<Session>(INITIAL);
  const [needsRelease,setNeedsRelease]=useState(false);
  const [notice,setNotice]=useState('');
  const audio=useRef<ReaderAudio|null>(null);
  const lastPedalPress=useRef(midi.sustainPress);
  const played=exactNotes(demoMode?demoNotes:midi.pressed);
  const sounding=exactNotes(demoMode?demoNotes:midi.active);
  const playedSignature=played.join(',');
  const usesPedal=!demoMode&&midi.sustainPress>0;
  const locked=!demoMode&&midi.sustain&&midi.sustainChord.length>0;
  const route=session.chords;
  const chunkA=route[session.chunk]??[];
  const chunkB=route[session.chunk+1]??[];
  const inExercise=session.phase==='chunk'||session.phase==='full';
  const fullPosition=route.length?session.step%route.length:0;
  const target=inExercise
    ? session.phase==='chunk'?(session.step%2===0?chunkA:chunkB):(route[fullPosition]??[])
    : [];
  const origin=session.phase==='chunk'?(session.step===0?[]:session.step%2===0?chunkB:chunkA)
    :session.phase==='full'&&fullPosition>0?route[fullPosition-1]:[];
  const shared=stationaryVoices(origin,target);
  const completed=session.phase==='chunk'?Math.max(0,Math.floor((session.step-1)/2)):session.phase==='full'?Math.floor(session.step/route.length):0;
  const status=demoMode?'Demo input':midi.status==='Connected'?'MIDI connected':'Connect MIDI in the top bar or try the demo';

  useEffect(()=>()=>{audio.current?.dispose();},[]);
  useEffect(()=>{
    try{setShowKeyboard(localStorage.getItem('faithful-keys-show-88-keys')==='yes');}catch{/* Optional preference */}
  },[]);
  function toggleKeyboard(){
    setShowKeyboard(current=>{
      const next=!current;
      try{localStorage.setItem('faithful-keys-show-88-keys',next?'yes':'no');}catch{/* Browser storage optional */}
      return next;
    });
  }

  // Store a complete, settled Home Chord so both hands may leave the keyboard
  // before clicking Lock. The candidate remains visible after key release.
  useEffect(()=>{
    if(session.phase!=='capture'||locked||played.length<2||played.length>MAX_VOICES)return;
    const timer=window.setTimeout(()=>setCaptured([...played]),120);
    return ()=>window.clearTimeout(timer);
  },[playedSignature,session.phase,locked]);

  // A pedal press commits one exact voicing. It also starts the lesson hands-free.
  // The manager snapshots the chord synchronously, so quick key/pedal releases
  // and notes held over from the preceding chord cannot change the attempt.
  useEffect(()=>{
    if(midi.sustainPress===lastPedalPress.current)return;
    lastPedalPress.current=midi.sustainPress;
    if(demoMode||!midi.sustainPress)return;
    const notes=exactNotes(midi.sustainChord);
    if(notes.length<2||notes.length>MAX_VOICES){
      setNotice('Play 2–10 keys, then press sustain again to lock the chord.');
      return;
    }
    if(session.phase==='capture'){
      setCaptured(notes);
      startResolution(notes,0,true);
    }else if(inExercise&&!needsRelease){
      if(exactMatch(notes,target)){
        advancePractice();
        setNotice('Chord locked. Lift the pedal, play the next chord, then press sustain again.');
      }else setNotice('Chord locked. Match the target notes and octaves, then lift and press sustain to try again.');
    }
  },[midi.sustainPress,demoMode]);

  // Score the EXACT physically depressed MIDI keys after chord-roll settling.
  // Sustain-only notes remain visible but cannot falsely score a new voicing.
  useEffect(()=>{
    if(!inExercise)return;
    if(needsRelease){
      if(!playedSignature)setNeedsRelease(false);
      return;
    }
    if(usesPedal||(!demoMode&&midi.sustain))return;
    if(played.length>MAX_VOICES || !exactMatch(played,target))return;
    const timer=window.setTimeout(()=>{
      advancePractice();
    },145);
    return ()=>window.clearTimeout(timer);
  },[inExercise,playedSignature,session.phase,session.chunk,session.step,needsRelease,target.join(','),usesPedal,midi.sustain,demoMode]);

  function advancePractice(){
    setSession(current=>{
        if(current.phase==='chunk'){
          if(current.step<6)return {...current,step:current.step+1};
          if(current.chunk<current.chords.length-2)return {...current,chunk:current.chunk+1,step:0};
          return {...current,phase:'ready',step:0};
        }
        if(current.phase==='full'){
          const last=current.chords.length*3-1;
          if(current.step<last)return {...current,step:current.step+1};
          return {...current,phase:'explain',step:0};
        }
        return current;
    });
  }

  function startResolution(home:number[],turn=0,pedalAccepted=false){
    try{
      const result=generateResolution(home,maxChords,mode,turn);
      setSession({phase:'chunk',chords:result.chords,chunk:0,step:pedalAccepted?1:0,turn});
      setNeedsRelease(false);
      setNotice(pedalAccepted?'Home Chord locked. Lift the pedal, play the next chord, then press sustain to lock it.':`${result.count} resolving chord${result.count===1?'':'s'} generated. Learn the first movement.`);
    }catch(error){setNotice(error instanceof Error?error.message:'Could not use this Home Chord.');}
  }
  function startDemo(){
    setDemoMode(true);setDemoNotes([...DEMO]);setCaptured([...DEMO]);setSession(INITIAL);
    setNotice('Five-note example ready. You can use any voicing from 2 to 10 notes.');
  }
  function exitDemo(){setDemoMode(false);setDemoNotes([]);setCaptured([]);setSession(INITIAL);setNotice('Live MIDI input selected.');}
  function resetToNewHome(){
    setSession(INITIAL);setDemoNotes([]);setCaptured([]);setNeedsRelease(false);
    setNotice('Play your new Home Chord (2–10 notes).');
  }
  function startFull(){
    setSession(current=>({...current,phase:'full',step:0}));
    setNeedsRelease(true);
    if(demoMode)setDemoNotes([]);
    setNotice('Release your keys, then play the complete progression forward three times.');
  }
  function playTarget(){
    if(!target.length)return;
    if(!audio.current)audio.current=new ReaderAudio();
    const player=audio.current;
    void player.unlock().then(ready=>{
      if(!ready)return;
      player.stop('preview:');
      target.forEach(n=>player.on('preview:'+n,n,.55));
      window.setTimeout(()=>player.stop('preview:'),950);
    });
  }
  const home=route[0]??[];
  const currentChord=locked?exactNotes(midi.sustainChord):played;
  const progressItems=useMemo(()=>session.phase==='explain'?route.slice(1).map((notes,i)=>{
    const before=route[i];
    return {notes,before,common:stationaryVoices(before,notes),moved:movedVoices(before,notes)};
  }):[],[session.phase,route]);

  return <main className={'ef ef-phase-'+session.phase+(showKeyboard?' ef-with-keys':'')}>
    <div className="ef-wrap">
      <header className="ef-heading">
        <div>
          <p className="ef-eyebrow">FAITHFUL KEYS / EAR-FIRST TRAINING</p>
          <h1>Chord Teacher</h1>
          <p>Hear it. Play it. Repeat it. Master it. Then understand it.</p>
        </div>
        <div className="ef-connection"><span className={'ef-indicator'+(demoMode||midi.status==='Connected'?' ef-online':'')}/>{status}</div>
      </header>

      <section className="ef-live" aria-label="Live MIDI input">
        <div className="ef-section-head">
          <div><p className="ef-eyebrow">live midi</p><h2>What you're playing</h2></div>
          <div className="ef-quick-controls"><span className="ef-count">{currentChord.length?currentChord.length+' notes':'2–10 voices'}</span>
            <button className={'ef-mini-toggle'+(showKeyboard?' selected':'')} type="button" aria-pressed={showKeyboard} onClick={toggleKeyboard}>
              {showKeyboard?'Hide 88 keys':'Show 88 keys'}
            </button></div>
        </div>
        <Notes notes={currentChord} active={locked?currentChord:played} stationary={shared}/>
        <div className="ef-live-meta">
          <span>{currentChord.length?'Bass: '+pitchLabel(currentChord[0]):'Waiting for notes'}</span>
          <span className={locked?'ef-lock-status':''}>{locked?'● chord locked · lift pedal to unlock':demoMode?'Demo input':usesPedal?'Press sustain to lock this chord':'Sustain pedal · press to lock chord'}</span>
          {!demoMode && sounding.length>played.length&&<span>{sounding.length} sounding including sustain</span>}
        </div>
        {played.length>MAX_VOICES&&<p className="ef-warning" role="alert">Detected {played.length} notes. Practice can use up to 10 at once; all MIDI input remains visible.</p>}
        {showKeyboard&&<Keyboard88 pressed={played} sustained={demoMode?[]:midi.sustained} stationary={shared} target={target}/>}
      </section>

      {session.phase==='capture'&&<section className="ef-panel" aria-label="Choose home chord">
        <div className="ef-capture-intro">
        <p className="ef-eyebrow">01 / FIND YOUR HOME CHORD</p>
        <h2>Start with any chord.</h2>
        <p>Play 2–10 notes. Press sustain to lock your Home Chord and begin.</p>
        </div>
        <div className="ef-captured"><p className="ef-eyebrow">HOME CHORD · PRESS SUSTAIN OR LOCK BELOW TO BEGIN</p><Notes notes={captured}/></div>
        <div className="ef-form">
          <fieldset><legend>Maximum resolving chords</legend><div className="ef-choice">
            {([1,2,3,4] as const).map(value=><button type="button" key={value} className={maxChords===value?'selected':''}
              aria-pressed={maxChords===value} onClick={()=>setMaxChords(value)}>{value}</button>)}
          </div></fieldset>
          <fieldset><legend>Number of chords</legend><div className="ef-choice">
            {(['fixed','varied'] as const).map(value=><button type="button" key={value}
              className={mode===value?'selected':''} aria-pressed={mode===value} onClick={()=>setMode(value)}>
              {value==='fixed'?'Fixed':'Varied up to maximum'}</button>)}
          </div></fieldset>
        </div>
        <div className="ef-actions">
          <button className="ef-primary" type="button" disabled={captured.length<2||captured.length>MAX_VOICES} onClick={()=>startResolution(captured)}>Lock Home Chord &amp; begin</button>
          {!demoMode?<button type="button" className="ef-secondary" onClick={startDemo}>Try a demo</button>
            :<button type="button" className="ef-secondary" onClick={exitDemo}>Switch to live MIDI</button>}
        </div>
      </section>}

      {session.phase==='chunk'&&<section className="ef-panel" aria-label="Learn one chord movement">
        <div className="ef-section-head">
          <div><p className="ef-eyebrow">02 / LEARN IN CHUNKS</p>
            <h2>Chord {session.chunk+1} ↔ Chord {session.chunk+2}</h2>
            <p>Move back and forth correctly three times. No tempo pressure.</p>
          </div>
          <div className="ef-counter"><strong>{Math.min(3,completed)}</strong><span>/ 3</span></div>
        </div>
        <div className="ef-steps">{Array.from({length:route.length-1},(_,i)=><span key={i} className={i<=session.chunk?'passed':''}/>)}</div>
        <p className="ef-move">Next: <strong>{session.step===0?'Play the starting chord':session.step%2===0?'Return to the starting chord':'Move to the next chord'}</strong></p>
        <TargetPanel notes={target} shared={shared} from={origin} pressed={played} onHear={playTarget}/>
        {demoMode&&<button type="button" className="ef-demo-action" onClick={()=>setDemoNotes([...target])}>Play these notes (demo)</button>}
        <p className="ef-help">Green notes stay in place. {usesPedal?'Lift the pedal, play the next chord, then press sustain to lock it.':'Only the other voices need to move. Press sustain to lock a chord.'}</p>
      </section>}

      {session.phase==='ready'&&<section className="ef-panel ef-ready">
        <p className="ef-eyebrow">03 / CONNECT EVERYTHING</p>
        <h2>Every movement learned.</h2>
        <p>Now play the entire progression only from the Home Chord toward the final chord. Three forward passes—never backward.</p>
        <button type="button" className="ef-primary" onClick={startFull}>Start full progression</button>
        <div className="ef-sequence">{route.map((notes,i)=><div key={i}><span>{i===0?'Home':'Chord '+(i+1)}</span><strong>{format(notes)}</strong></div>)}</div>
      </section>}

      {session.phase==='full'&&<section className="ef-panel">
        <div className="ef-section-head">
          <div><p className="ef-eyebrow">03 / FORWARD ONLY</p><h2>Play the complete movement.</h2>
            <p>Home → final chord. Start at Home again after every pass.</p></div>
          <div className="ef-counter"><strong>{completed}</strong><span>/ 3</span></div>
        </div>
        <div className="ef-steps">{Array.from({length:3},(_,i)=><span key={i} className={i<completed?'passed':''}/>)}</div>
        <p className="ef-move">{needsRelease?'Release all keys to begin':'Play '+(fullPosition===0?'Home Chord':'Chord '+(fullPosition+1))}</p>
        <TargetPanel notes={target} shared={shared} from={origin} pressed={played} onHear={playTarget}/>
        {usesPedal&&<p className="ef-help">Lift the pedal, play the target chord, then press sustain to lock it.</p>}
        {demoMode&&<button type="button" className="ef-demo-action" onClick={()=>setDemoNotes(needsRelease?[]:[...target])}>
          {needsRelease?'Release keys (demo)':'Play these notes (demo)'}</button>}
      </section>}

      {session.phase==='explain'&&<section className="ef-panel" aria-label="Why this resolution works">
        <p className="ef-eyebrow">04 / NOW UNDERSTAND IT</p>
        <h2>Three forward passes completed.</h2>
        <p>Here is what your hands just learned. These are possible harmonic connections, not the only correct resolutions.</p>
        <div className="ef-actions">
          <button type="button" className="ef-primary" onClick={resetToNewHome}>Choose a new Home Chord</button>
          <button type="button" className="ef-secondary" onClick={()=>startResolution(home,session.turn+1)}>Another resolution from this Home Chord</button>
        </div>
        <div className="ef-analysis">
          {progressItems.map((item,i)=><article key={i}>
            <p className="ef-eyebrow">MOVEMENT {i+1}</p>
            <h3>{chordLabel(item.before)} → {chordLabel(item.notes)}</h3>
            <Notes notes={item.notes} stationary={item.common} from={item.before}/>
            <p><strong>Bass:</strong> {pitchLabel(item.before[0])} → {pitchLabel(item.notes[0])}</p>
            <p><strong>Unmoving notes:</strong> {item.common.length?format(item.common):'None — every voice changes its key.'}</p>
            <p><strong>Voice movement:</strong> {item.moved.length
              ?item.moved.map(v=>`${pitchLabel(v.from)} → ${pitchLabel(v.to)} (${v.semitones>0?'+':''}${v.semitones})`).join(' · ')
              :'No voices moved.'}</p>
          </article>)}
        </div>
      </section>}

      {notice&&<p className="ef-notice" role="status">{notice}</p>}
      <footer className="ef-footer">Exact pitches and octaves · Up to 10 simultaneous keys · Sustain pedal locks chords · Forward-only final practice</footer>
    </div>
  </main>;
}

function TargetPanel({notes,shared,from,pressed,onHear}:{notes:number[];shared:number[];from:number[];pressed:number[];onHear:()=>void}){
  return <div className="ef-target">
    <div className="ef-section-head"><div><p className="ef-eyebrow">PLAY THESE EXACT KEYS</p><h3>Target chord</h3></div>
      <button type="button" className="ef-hear" onClick={onHear} aria-label="Hear target chord">▶ Hear it</button></div>
    {from.length>0&&<div className="ef-from"><p className="ef-eyebrow">FROM THIS CHORD</p><Notes notes={from} stationary={shared}/></div>}
    <p className="ef-eyebrow ef-to">MOVE TO THIS CHORD</p>
    <Notes notes={notes} stationary={shared} from={from} active={pressed}/>
    <div className="ef-target-meta"><span>{notes.length} notes</span><span>{shared.length} stationary</span>
      {from.length>0&&<span>Bass {pitchLabel(from[0])} → {pitchLabel(notes[0])}</span>}</div>
  </div>;
}
