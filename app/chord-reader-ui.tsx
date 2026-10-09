'use client';
import { useEffect, useRef, useState } from 'react';
import { useMidi } from './midi/ui';
import { midiManager } from './midi/manager';
import { identifyChord } from './chord-reader';
import { parseChordRoot } from './music-theory';
import { readerKeyboardRange, readerWrittenNote } from './chord-reader-notation';
import { PERFORMANCE_STORAGE_KEY, PerformanceRecorder, performanceMidi, readPerformanceTakes, type PerformanceTake } from './performance-recording';
import { ReaderAudio } from './reader-audio';
import './chord-reader.css';

const KEYS=readerKeyboardRange();
const WHITES=KEYS.filter(n=>![1,3,6,8,10].includes(n%12));
const BLACKS=KEYS.filter(n=>[1,3,6,8,10].includes(n%12));
const DRAFT_KEY=PERFORMANCE_STORAGE_KEY+'-draft';
const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function makeTake(data:Pick<PerformanceTake,'events'|'durationMs'>):PerformanceTake {
  const createdAt=new Date().toISOString();
  return {...data,id:crypto.randomUUID(),createdAt,name:`Performance ${new Date(createdAt).toLocaleString()}`};
}
function downloadTake(take:PerformanceTake){
  const url=URL.createObjectURL(new Blob([Uint8Array.from(performanceMidi(take)).buffer],{type:'audio/midi'}));
  const link=document.createElement('a');link.href=url;link.download=`${take.name.replace(/[^a-z0-9_-]/gi,'-')}.mid`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function ChordStaff({notes,chord}:{notes:number[];chord?:string}) {
  const written=notes.map(note=>readerWrittenNote(note,chord));
  return <svg className="reader-staff" viewBox="0 0 480 220" role="img" aria-label={written.length?`Chord staff: ${written.map(n=>n.name+n.octave).join(', ')}`:'Empty treble and bass staff. Listening for notes.'}>
    <title>Chord staff</title>
    {[48,60,72,84,96,120,132,144,156,168].map(y=><line className="reader-staff-line" key={y} x1="38" x2="450" y1={y} y2={y}/>)}
    <path className="reader-staff-line" d="M38 48V168 M450 48V168"/>
    <text className="reader-clef" x="48" y="89">𝄞</text><text className="reader-clef reader-bass-clef" x="48" y="157">𝄢</text>
    {written.map((note,index)=>{
      if(note.y<16||note.y>204)return null;
      const neighbor=written.slice(0,index).filter(n=>n.treble===note.treble&&Math.abs(n.position-note.position)<=1).length;
      const x=260+(neighbor%2)*15;
      const upper=note.treble?48:120;const lower=note.treble?96:168;
      const ledger:number[]=[];
      for(let y=upper-12;y>=note.y;y-=12)ledger.push(y);
      for(let y=lower+12;y<=note.y;y+=12)ledger.push(y);
      return <g key={note.midi}>
        {ledger.map(y=><line className="reader-ledger" key={y} x1={x-19} x2={x+19} y1={y} y2={y}/>)}
        {note.accidental&&<text className="reader-accidental" x={220-(index%4)*18} y={note.y+5}>{note.accidental}</text>}
        <ellipse className="reader-notehead" cx={x} cy={note.y} rx="10" ry="4.5" transform={`rotate(-15 ${x} ${note.y})`}/>
      </g>;
    })}
    {written.some(n=>n.y<16)&&<text className="reader-range-note" x="300" y="12">↑ {written.filter(n=>n.y<16).map(n=>n.name+n.octave).join(' ')}</text>}
    {written.some(n=>n.y>204)&&<text className="reader-range-note" x="300" y="218">↓ {written.filter(n=>n.y>204).map(n=>n.name+n.octave).join(' ')}</text>}
  </svg>;
}

export default function ChordReader() {
  const midi=useMidi();
  const [screenNotes,setScreenNotes]=useState<number[]>([]);
  const screenHeld=useRef(new Set<number>());
  const liveHeld=useRef(new Map<string,{note:number;velocity:number;channel:number}>());
  const mode=useRef(midi.inputMode);mode.current=midi.inputMode;
  const sound=useRef(false);
  const [monitor,setMonitor]=useState(false);
  const audio=useRef(new ReaderAudio());
  const recorder=useRef(new PerformanceRecorder());
  const [recording,setRecording]=useState(false);
  const start=useRef(0);
  const [elapsed,setElapsed]=useState(0);
  const [draft,setDraft]=useState<PerformanceTake|null>(null);
  const [takes,setTakes]=useState<PerformanceTake[]>([]);
  const [notice,setNotice]=useState('');
  const [playing,setPlaying]=useState<string|null>(null);
  const [replayNotes,setReplayNotes]=useState<number[]>([]);
  const replayTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const replayGeneration=useRef(0);
  const dialog=useRef<HTMLDialogElement>(null);

  function stopReplay(){
    replayGeneration.current++;
    if(replayTimer.current!==null)clearInterval(replayTimer.current);
    replayTimer.current=null;audio.current.stop();setPlaying(null);setReplayNotes([]);
  }
  useEffect(()=>{
    window.scrollTo(0,0);
    try{
      setTakes(readPerformanceTakes(localStorage.getItem(PERFORMANCE_STORAGE_KEY)));
      const pending=readPerformanceTakes(localStorage.getItem(DRAFT_KEY))[0];
      if(pending){setDraft(pending);setElapsed(pending.durationMs);setNotice('Unsaved take restored. Save or discard to record again.');}
    }catch{setNotice('Device storage is unavailable. Takes can still be downloaded.');}
    const engine=audio.current;
    const capture=recorder.current;
    return ()=>{
      if(replayTimer.current!==null)clearInterval(replayTimer.current);
      replayGeneration.current++;engine.dispose();
      if(capture.active){
        const pending=makeTake(capture.finish(performance.now()));
        if(pending.events.some(e=>e.type==='on'))try{localStorage.setItem(DRAFT_KEY,JSON.stringify([pending]));}catch{/* In-memory take ends on navigation when storage is unavailable. */}
      }
    };
  },[]);
  useEffect(()=>midiManager.onNote(event=>{
    const key=event.channel+':'+event.note;
    if(event.type==='on')liveHeld.current.set(key,event);
    else if(event.type==='off')liveHeld.current.delete(key);
    else liveHeld.current.clear();
    if(mode.current==='screen')return;
    recorder.current.receive(event.type,event.note,event.velocity,event.channel,performance.now());
    if(event.type==='panic')audio.current.stop('midi:');
    else if(event.type==='off')audio.current.off('midi:'+key);
    else if(sound.current)audio.current.on('midi:'+key,event.note,event.velocity);
  }),[]);
  useEffect(()=>{
    if(!recording)return;
    const timer=setInterval(()=>setElapsed(performance.now()-start.current),100);
    return()=>clearInterval(timer);
  },[recording]);


  const input=playing?replayNotes:midi.inputMode==='screen'?screenNotes:midi.inputMode==='midi'?midi.active:[...midi.active,...screenNotes];
  const result=identifyChord(input);
  const chord=result.matches[0];
  const label=chord??(result.notes.length===0?'Listening for notes':new Set(result.notes.map(n=>n%12)).size===1?'Single note':'Unrecognized cluster');
  const written=result.notes.map(n=>readerWrittenNote(n,chord));
  const root=chord?parseChordRoot(chord).root.pitchClass:0;
  const spelling=[...new Map(written.map(n=>[n.midi%12,n])).values()].sort((a,b)=>(a.midi-root+120)%12-(b.midi-root+120)%12);
  const outside=written.filter(n=>n.midi<36||n.midi>84);

  function press(note:number){
    if(mode.current==='midi'||playing||screenHeld.current.has(note))return;
    screenHeld.current.add(note);setScreenNotes([...screenHeld.current]);
    recorder.current.receive('on',note,.75,15,performance.now());
    void audio.current.unlock().then(ready=>{if(ready&&screenHeld.current.has(note))audio.current.on('screen:'+note,note);});
  }
  function release(note:number){
    if(!screenHeld.current.delete(note))return;
    setScreenNotes([...screenHeld.current]);audio.current.off('screen:'+note);
    recorder.current.receive('off',note,0,15,performance.now());
  }
  function startRecording(){
    if(draft||recorder.current.active)return;
    stopReplay();start.current=performance.now();recorder.current.begin(start.current);
    if(mode.current!=='screen')for(const held of liveHeld.current.values())recorder.current.receive('on',held.note,held.velocity,held.channel,start.current);
    if(mode.current!=='midi')for(const note of screenHeld.current)recorder.current.receive('on',note,.75,15,start.current);
    setRecording(true);setElapsed(0);setNotice('Recording notes, timing and velocity.');
    void audio.current.unlock();
  }
  function stopRecording(){
    if(!recorder.current.active)return;
    const pending=makeTake(recorder.current.finish(performance.now()));setRecording(false);setElapsed(pending.durationMs);
    if(!pending.events.some(e=>e.type==='on')){setNotice('No notes were recorded.');return;}
    setDraft(pending);setNotice('Take ready. Save it or download the MIDI file.');
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify([pending]));}catch{setNotice('Take ready. Download it; device storage is unavailable.');}
  }
  function saveTake(){
    if(!draft)return;
    const next=[draft,...takes];
    try{localStorage.setItem(PERFORMANCE_STORAGE_KEY,JSON.stringify(next));localStorage.removeItem(DRAFT_KEY);setTakes(next);setDraft(null);setNotice('Performance saved on this device.');}
    catch{setNotice('Could not save on this device. Download your MIDI file instead.');dialog.current?.showModal();}
  }
  function discardTake(){setDraft(null);setElapsed(0);setNotice('Take discarded.');try{localStorage.removeItem(DRAFT_KEY);}catch{/* Storage may be unavailable. */}}
  async function replay(take:PerformanceTake){
    stopReplay();
    const generation=replayGeneration.current;
    const ready=await audio.current.unlock();
    if(generation!==replayGeneration.current)return;
    if(!ready){setNotice('Sound could not start. Try Play again.');return;}
    setPlaying(take.id);dialog.current?.close();setNotice(`Playing ${take.name}`);
    const began=performance.now();let index=0;const active=new Map<string,number>();
    const tick=()=>{
      const ms=performance.now()-began;
      while(index<take.events.length&&take.events[index].ms<=ms){
        const event=take.events[index++];const key=event.channel+':'+event.note;
        if(event.type==='on'){active.set(key,event.note);audio.current.on('replay:'+key,event.note,event.velocity);}
        else{active.delete(key);audio.current.off('replay:'+key);}
      }
      setReplayNotes([...new Set(active.values())]);setElapsed(Math.min(ms,take.durationMs));
      if(ms>=take.durationMs){stopReplay();setNotice('Playback finished.');}
    };
    replayTimer.current=setInterval(tick,10);tick();
  }
  function pianoKey(note:number,black=false){
    const active=result.notes.includes(note);
    const name=readerWrittenNote(note);
    const nextWhite=WHITES.findIndex(n=>n>note);
    return <div role="button" tabIndex={midi.inputMode==='midi'||playing?-1:0} key={note} aria-disabled={midi.inputMode==='midi'||Boolean(playing)} className={`${black?'black black-key':`white ${BLACKS.includes(note-1)?'cut-left':''} ${BLACKS.includes(note+1)?'cut-right':''}`} ${active?'voiced key-down':''}`} style={black?{left:`${nextWhite/WHITES.length*100}%`}:undefined} aria-label={`${name.name}${name.octave}`} aria-pressed={active}
      onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);press(note);}}
      onPointerUp={()=>release(note)} onPointerCancel={()=>release(note)} onLostPointerCapture={()=>release(note)}
      onKeyDown={event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();press(note);}}}
      onKeyUp={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();release(note);}}} onBlur={()=>release(note)}><small>{name.name}{name.octave}</small></div>;
  }
  return <section className="chord-reader" aria-labelledby="chord-reader-title">
    <header className="reader-heading"><h1 id="chord-reader-title">Chord Reader</h1><div className="reader-record-controls" role="group" aria-label="Performance recording controls">
      <span className={`reader-timer ${recording?'is-recording':''}`} role="timer">{recording?'● ':''}{time(elapsed)}</span>
      <button type="button" onClick={startRecording} disabled={recording||Boolean(draft)||Boolean(playing)}>● Record</button>
      <button type="button" onClick={playing?stopReplay:stopRecording} disabled={!recording&&!playing}>■ Stop</button>
      <button type="button" onClick={saveTake} disabled={!draft||recording}>Save</button>
      <button type="button" onClick={()=>dialog.current?.showModal()}>Recordings ({takes.length})</button>
    </div></header>
    <section className="reader-instrument piano-wrap" aria-label="Live chord, staff and piano keyboard">
      <div className="reader-readout" role="status" aria-live="polite" aria-atomic="true"><h2>{label}</h2><p title={result.matches.slice(1,4).join(' · ')}>{result.matches.length>1?`Also: ${result.matches.slice(1,4).join(' · ')}`:' '}</p></div>
      <div className="reader-notation-row">
        <div className="reader-staff-panel"><h3>Chord staff</h3><ChordStaff notes={result.notes} chord={chord}/></div>
        <div className="reader-spelling"><h3>Chord spelling</h3><p className="reader-spelling-notes" title={spelling.map(n=>n.name).join(' · ')}>{spelling.length?spelling.map(n=>n.name).join(' · '):'—'}</p><h3>Notes played</h3><p className="reader-played-notes" title={written.map(n=>n.name+n.octave).join(' · ')}>{written.length?written.map(n=>n.name+n.octave).join(' · '):'—'}</p><p className="reader-bass-note">{written.length?`Bass: ${written[0].name}${written[0].octave}`:' '}</p></div>
      </div>
      <div className="reader-piano-area"><div className="reader-keyboard-heading"><span>KEYBOARD · C2–C6</span><button type="button" aria-pressed={monitor} onClick={()=>{sound.current=!monitor;setMonitor(!monitor);if(!monitor)void audio.current.unlock();else audio.current.stop('midi:');}}>MIDI sound {monitor?'on':'off'}</button></div>
        <div className="piano-shell"><div className="piano" role="group" aria-label="Faithful Keys four-octave piano keyboard">{WHITES.map(n=>pianoKey(n))}{BLACKS.map(n=>pianoKey(n,true))}</div></div>
      </div>
      <div className="reader-input-status"><span title={outside.map(n=>n.name+n.octave).join(' · ')}>{outside.length?`Outside keyboard: ${outside.map(n=>n.name+n.octave).join(' · ')}`:midi.inputMode==='midi'?'MIDI input · held notes light the keys':'Hold on-screen keys or play your MIDI keyboard'}</span><span>MIDI: {midi.status}</span></div>
    </section>
    <p className="reader-notice" role="status" title={notice}>{notice||'Record a performance, then stop and save your take.'}</p>
    <dialog ref={dialog} className="reader-takes-dialog" aria-labelledby="reader-takes-title"><div className="reader-takes-heading"><h2 id="reader-takes-title">Performance recordings</h2><button type="button" onClick={()=>dialog.current?.close()} aria-label="Close recordings">×</button></div><p>Saved on this device. Download MIDI to keep a performance file.</p>
      {draft&&<article className="reader-take"><strong>Unsaved take · {time(draft.durationMs)}</strong><div><button type="button" onClick={saveTake}>Save recording</button><button type="button" onClick={()=>downloadTake(draft)}>Download MIDI</button><button type="button" onClick={discardTake}>Discard</button></div></article>}
      {!takes.length&&!draft&&<p>No recordings saved yet.</p>}
      {takes.map(take=><article className="reader-take" key={take.id}><strong>{take.name}</strong><small>{time(take.durationMs)} · {take.events.filter(e=>e.type==='on').length} notes</small><div><button type="button" disabled={recording||Boolean(draft)} onClick={()=>void replay(take)}>▶ Play</button><button type="button" onClick={()=>downloadTake(take)}>Download MIDI</button><button type="button" onClick={()=>{const next=takes.filter(t=>t.id!==take.id);try{localStorage.setItem(PERFORMANCE_STORAGE_KEY,JSON.stringify(next));setTakes(next);}catch{setNotice('Could not update device storage.');}}}>Delete</button></div></article>)}
    </dialog>
  </section>;
}
