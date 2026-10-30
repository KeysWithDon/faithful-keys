'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {MidiOutputSelector,useMidi} from './midi/ui';
import {midiManager} from './midi/manager';
import {ChordPlayback} from './chord-playback';
import {Keyboard88,NoteLine} from './ear-first-visuals';
import {exactNotes,stationaryVoices} from './ear-first-engine';
import {ChordPromptInput} from './chord-teacher-input';
import {
  CIRCLE_KEYS,GOSPEL_LESSONS,PHASES,REQUIRED_ROUNDS,
  acceptChord,emptyProgress,lessonVoicings,noteName,voiceFeedback,
  type MasteryPhase,type MasteryProgress,
} from './progression-teacher';
import './ear-first-chord-teacher.css';

// Reuse the progression update's saved course when opening Chord Teacher.
const STORAGE_KEY='faithful-keys-gospel-progression-mastery-v1';
const phaseLabel:Record<MasteryPhase,string>={
  guided:'Learn',repetition:'Repeat',independent:'Play independently',
  fluency:'Build fluency',retention:'Remember','circle-review':'12-key review',
};
const phaseDescription:Record<MasteryPhase,string>={
  guided:'Follow the notes and feel how each voice moves.',
  repetition:'Complete three forward rounds. Each prompt counts after one correct play.',
  independent:'Connect the movement yourself. The notes remain visible for reference.',
  fluency:'Keep a steady flow between chords, without long pauses.',
  retention:'Recall the full movement again, using the visible notes when needed.',
  'circle-review':'Play one forward round in every key to unlock the next movement.',
};

export default function EarFirstChordTeacher(){
  const midi=useMidi();
  const [progress,setProgress]=useState<MasteryProgress>(emptyProgress);
  const [loaded,setLoaded]=useState(false);
  const [tempo,setTempo]=useState(72);
  const [showKeyboard,setShowKeyboard]=useState(true);
  const [previousNotes,setPreviousNotes]=useState<number[]>([]);
  const [notice,setNotice]=useState('Play the displayed bass and chord. Correct chords advance automatically.');
  const [feedback,setFeedback]=useState<'none'|'correct'|'incorrect'>('none');
  const [inputSerial,setInputSerial]=useState(0);
  const [promptNumber,setPromptNumber]=useState(1);
  const [playingIndex,setPlayingIndex]=useState(-1);
  const progressRef=useRef(progress);
  const input=useRef(new ChordPromptInput());
  const inputPrompt=useRef('');
  const processLiveChord=useRef<(notes:readonly number[])=>void>(()=>{});
  const voicingCache=useRef(new Map<string,ReturnType<typeof lessonVoicings>>());
  const player=useRef<ChordPlayback|null>(null);
  const generation=useRef(0);
  const playing=useRef(false);
  const lesson=GOSPEL_LESSONS[progress.lesson];
  const key=CIRCLE_KEYS[progress.key]??'C';
  const voicings=useMemo(()=>getVoicings(progress),[progress.lesson,progress.key]);
  const current=voicings[progress.step]??voicings[0];
  const expected=current?.notes??[];
  const displayed=voicings[playingIndex]??current;
  const displayedNotes=displayed?.notes??[];
  const displayOrigin=playingIndex>0?voicings[playingIndex-1].notes:previousNotes;
  const played=exactNotes(midi.pressed);
  const scoringNotes=played;
  const scoringId=scoringNotes.join(',');
  const prompt=promptKey(progress);
  const shared=stationaryVoices(displayOrigin,displayedNotes);
  const mastered=progress.completed.filter(id=>id.startsWith(progress.lesson+':')).length;
  const labelNote=(note:number)=>noteName(note,displayed?.symbol??'C');

  function promptKey(state:MasteryProgress){return [state.lesson,state.key,state.phase,state.rounds,state.step].join(':');}
  function getVoicings(state:MasteryProgress){
    const cacheKey=state.lesson+':'+state.key;
    let values=voicingCache.current.get(cacheKey);
    if(!values){values=GOSPEL_LESSONS[state.lesson]?lessonVoicings(GOSPEL_LESSONS[state.lesson],CIRCLE_KEYS[state.key]):[];voicingCache.current.set(cacheKey,values);}
    return values;
  }
  function updateProgress(change:(state:MasteryProgress)=>MasteryProgress){
    const next=change(progressRef.current);progressRef.current=next;setProgress(next);
  }
  function playback(){if(!player.current)player.current=new ChordPlayback();return player.current;}
  function resetAnswerGate(){input.current.reset(midiManager.getSnapshot().pressed);inputPrompt.current='';}
  function stopPlayback(){
    generation.current++;playing.current=false;player.current?.stop();setPlayingIndex(-1);
  }
  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)??'null') as Partial<MasteryProgress>|null;
      if(saved&&typeof saved.lesson==='number'&&Number.isInteger(saved.lesson)&&saved.lesson>=0&&saved.lesson<=GOSPEL_LESSONS.length&&
        typeof saved.key==='number'&&Number.isInteger(saved.key)&&saved.key>=0&&saved.key<12&&
        PHASES.concat('circle-review').includes(saved.phase as MasteryPhase)&&
        typeof saved.rounds==='number'&&Number.isInteger(saved.rounds)&&saved.rounds>=0&&Array.isArray(saved.completed)){
        const restored={...emptyProgress(),...saved,mistakes:0,
          completed:saved.completed.filter((id):id is string=>typeof id==='string')};
        if(!Number.isInteger(restored.step)||restored.step<0||restored.step>=getVoicings(restored).length)restored.step=0;
        updateProgress(()=>restored);
      }
      setShowKeyboard(localStorage.getItem('faithful-keys-show-88-keys')!=='no');
    }catch{/* Practice remains available when storage is restricted. */}
    resetAnswerGate();setLoaded(true);
    return()=>{generation.current++;player.current?.dispose();};
  },[]);
  useEffect(()=>{
    if(!loaded)return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(progress));}catch{/* Optional offline storage. */}
  },[loaded,progress]);
  useEffect(()=>midiManager.onNote(event=>{
    // Evaluate the current physical keys before frame-coalesced rendering.
    // A quick correct chord still counts if all keys are released in one frame.
    if(event.type==='on'||event.type==='off')processLiveChord.current(midiManager.getSnapshot().pressed);
    if(event.type==='panic')setNotice('MIDI notes released. Play the displayed chord when ready.');
  }),[]);
  useEffect(()=>{
    stopPlayback();setPreviousNotes([]);
  },[progress.lesson,progress.key,progress.phase]);

  processLiveChord.current=notes=>{
    const state=progressRef.current,sequence=getVoicings(state),target=sequence[state.step];
    if(!target)return;
    const id=promptKey(state);
    const result=input.current.observe(id,target.notes,notes,loaded&&!playing.current&&!midiManager.getSnapshot().outputPlaying);
    if(!result.changed)return;
    inputPrompt.current=id;setInputSerial(value=>value+1);
    if(!result.accepted)return;
    setFeedback('correct');setNotice('✓ '+target.symbol+' confirmed.');
    setPreviousNotes([...target.notes]);setPromptNumber(value=>value+1);
    // Commit the next prompt synchronously so fast MIDI events cannot use an old target.
    updateProgress(previous=>acceptChord({...previous,mistakes:0},sequence.length));
  };
  useEffect(()=>{processLiveChord.current(scoringNotes);},[loaded,scoringId,prompt,playingIndex,midi.outputPlaying]);
  useEffect(()=>{
    if(!loaded||!current||midi.status!=='Connected'||playingIndex!==-1||midi.outputPlaying)return;
    if(inputPrompt.current!==promptKey(progressRef.current))return;
    if(!scoringNotes.length)return;
    const verdict=voiceFeedback(expected,scoringNotes,current.symbol);
    if(verdict.correct)return;
    const timer=setTimeout(()=>{
      if(promptKey(progressRef.current)!==prompt)return;
      setFeedback('incorrect');setNotice(verdict.message);
    },450);
    return()=>clearTimeout(timer);
  },[loaded,prompt,scoringId,inputSerial,playingIndex,midi.status,midi.outputPlaying]);

  async function hearMovement(full:boolean){
    if(!current)return;
    stopPlayback();const token=generation.current;playing.current=true;setFeedback('none');
    const sequence=full?voicings:[current];
    setPlayingIndex(full?0:progress.step);setNotice(full?'Listen to the movement and watch the notes.':'Listen to '+current.symbol+'.');
    try{
      const duration=Math.round(60000/tempo*1.7);
      for(let index=0;index<sequence.length;index++){
        if(token!==generation.current)return;
        setPlayingIndex(full?index:progress.step);
        const notes=sequence[index].notes;
        if(!await playback().play([notes],Math.max(300,duration-180)))return;
      }
      if(token===generation.current)setNotice('Your turn. Play the bass and chord together. Correct chords advance automatically.');
    }catch(error){
      if(token===generation.current)setNotice(error instanceof Error?error.message:'Sound could not play. Try Hear again.');
    }finally{
      if(token===generation.current){
        playing.current=false;setPlayingIndex(-1);
        processLiveChord.current(midiManager.getSnapshot().pressed);
      }
    }
  }
  function retryStage(){
    stopPlayback();resetAnswerGate();setPromptNumber(value=>value+1);
    setPreviousNotes([]);setFeedback('none');setNotice('Play the first chord to begin this stage again.');
    updateProgress(previous=>({...previous,step:0,rounds:0,mistakes:0,notice:'Restarted this stage in the current key.'}));
  }
  function toggleKeyboard(){
    setShowKeyboard(value=>{const next=!value;try{localStorage.setItem('faithful-keys-show-88-keys',next?'yes':'no');}catch{/* Optional. */}return next;});
  }

  if(!loaded)return <section className="ef" aria-label="Chord Teacher"><p>Loading your chord practice…</p></section>;
  if(!lesson)return <section className="ef" aria-label="Chord Teacher"><div className="ef-wrap"><header className="ef-heading"><div><p className="ef-eyebrow">Faithful Keys / Chord Teacher</p><h1>Course mastered</h1><p>Every gospel movement, all 12 keys, and every full-circle review completed.</p></div></header><div className="ef-actions"><button className="ef-primary" type="button" onClick={()=>{if(window.confirm('Restart the complete chord course?')){resetAnswerGate();updateProgress(emptyProgress);setPromptNumber(1);setFeedback('none');setNotice('Play the displayed chord once.');}}}>Start the course again</button></div></div></section>;

  return <section className="ef ef-course" aria-label="Chord Teacher">
    <div className="ef-wrap">
      <header className="ef-heading">
        <div><p className="ef-eyebrow">Faithful Keys / gospel movements</p><h1>Chord Teacher</h1><p>See the notes. Learn the movement. Make it familiar in every key.</p></div>
        <div className="ef-audio-tools"><MidiOutputSelector/><span className="ef-connection"><span className={'ef-indicator'+(midi.status==='Connected'?' ef-online':'')}/>{midi.status==='Connected'?'MIDI connected':'Connect MIDI in the top bar'}</span></div>
      </header>

      <section className="ef-course-lesson" aria-label="Current gospel lesson">
        <div><p className="ef-eyebrow">Level {lesson.level} / 7 · movement {progress.lesson+1} / {GOSPEL_LESSONS.length} · {lesson.movement}</p><h2>{lesson.title}</h2><p>{lesson.explanation}</p></div>
        <dl className="ef-course-stats"><div><dt>key</dt><dd>{key}</dd></div><div><dt>stage</dt><dd>{phaseLabel[progress.phase]}</dd></div><div><dt>practice rounds</dt><dd>{progress.rounds} / {REQUIRED_ROUNDS[progress.phase]}</dd></div></dl>
      </section>

      <div className="ef-course-sequence" aria-label="Forward chord progression with exact notes">
        {voicings.map((voice,index)=><div key={index} className={'ef-course-chord'+(index===progress.step?' current':'')+(index===playingIndex?' demo':'')+(index<progress.step?' passed':'')} aria-current={index===progress.step?'step':undefined}>
          <span className="ef-course-chord-label">{index+1} <strong>{voice.symbol}</strong></span>
          <span>{voice.upperVoices.map(note=>noteName(note,voice.symbol)).join(' · ')}</span>
          <small>Bass {noteName(voice.bass,voice.symbol)} · included</small>
        </div>)}
      </div>

      <div className="ef-course-voices">
        <section className="ef-live" aria-label="Live MIDI input">
          <div className="ef-section-head"><div><p className="ef-eyebrow">live midi · up to 10 voices</p><h2>What you're playing</h2></div><span className="ef-count">{played.length} pressed</span></div>
          {played.length?<NoteLine notes={played} active={played} stationary={shared} labelNote={labelNote}/>:<div className="ef-input-placeholder">No keys pressed.</div>}
          <div className="ef-live-meta"><span>One correct play confirms each prompt.</span><span>Only keys currently pressed appear here.</span></div>
        </section>
        <section className="ef-course-target" aria-label="Current chord and exact notes to play">
          <div className="ef-section-head"><div><p className="ef-eyebrow">prompt {promptNumber} · chord {(playingIndex>=0?playingIndex:progress.step)+1} / {voicings.length}</p><h2>{playingIndex>=0?'Hear':'Play'} {displayed.symbol}</h2></div><button className={'ef-mini-toggle'+(showKeyboard?' selected':'')} type="button" aria-pressed={showKeyboard} onClick={toggleKeyboard}>{showKeyboard?'Hide 88 keys':'Show 88 keys'}</button></div>
          <NoteLine notes={displayedNotes} active={played} stationary={shared} from={displayOrigin} labelNote={labelNote}/>
          <div className="ef-target-meta"><span>{shared.length?'Keep '+shared.map(labelNote).join(', ')+' steady.':'Follow the displayed voices.'}</span><span>Chord notes stay visible in every stage.</span></div>
        </section>
      </div>

      {showKeyboard&&<Keyboard88 pressed={played} sustained={[]} stationary={shared} target={displayedNotes} labelNote={labelNote} showOctaves={false}/>}

      <div className="ef-course-controls">
        <div className="ef-listening-actions">
          <button className="ef-primary" type="button" disabled={playingIndex>=0} onClick={()=>void hearMovement(false)}>▶ Hear this chord</button>
          <button className="ef-secondary" type="button" disabled={playingIndex>=0} onClick={()=>void hearMovement(true)}>Hear whole progression</button>
          {playingIndex>=0&&<button className="ef-secondary" type="button" onClick={()=>{stopPlayback();resetAnswerGate();setNotice('Playback stopped. Play the displayed chord when ready.');}}>Stop playback</button>}
          <button className="ef-secondary" type="button" onClick={retryStage}>Retry this stage</button>
          <button className="ef-secondary" type="button" onClick={()=>void midiManager.resetNotes()}>Clear notes</button>
        </div>
        <div className="ef-course-preferences">
          <label>Tempo <input aria-label="Practice tempo" type="range" min="45" max="120" step="1" value={tempo} onChange={event=>setTempo(Number(event.target.value))}/><span>{tempo} BPM</span></label>
        </div>
      </div>
      <p className={'ef-feedback ef-feedback-'+feedback} role="status" aria-live="polite">{notice}</p>

      <section className="ef-course-mastery" aria-label="Mastery and circle of fourths">
        <div className="ef-section-head"><p className="ef-eyebrow">Circle of fourths · {mastered} / 12 mastered{progress.phase==='circle-review'?' · final review':''}</p><span className="ef-count">All 12 keys before the next movement</span></div>
        <ol className="ef-course-circle" aria-label="Twelve keys in circle of fourths order">{CIRCLE_KEYS.map((item,index)=>{
          const done=progress.completed.includes(progress.lesson+':'+index);
          return <li key={item} className={(index===progress.key?'current ':'')+(done?'passed':'')} aria-current={index===progress.key?'step':undefined}><span>{item}</span>{done&&<small aria-label="mastered">✓</small>}</li>;
        })}</ol>
        <details className="ef-course-checkpoints"><summary>Mastery checkpoints · {phaseLabel[progress.phase]}</summary><p>{phaseDescription[progress.phase]}</p><ol>{[...PHASES,'circle-review' as const].map(phase=><li key={phase} aria-current={progress.phase===phase?'step':undefined}><strong>{phaseLabel[phase]}</strong><span>{REQUIRED_ROUNDS[phase]} practice {REQUIRED_ROUNDS[phase]===1?'round':'rounds'}{phase==='circle-review'?' per key':''}</span></li>)}</ol><p>{progress.notice}</p></details>
      </section>
      <footer className="ef-footer">Bass + chord in every lesson · One correct play per prompt · Unchanged voices highlighted · Progress saved automatically</footer>
    </div>
  </section>;
}
