'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MidiOutputSelector,useMidi } from './midi/ui';
import { midiManager } from './midi/manager';
import { identifyChord } from './chord-reader';
import { parseChordRoot } from './music-theory';
import { readerKeyboardRange, readerWrittenNote } from './chord-reader-notation';
import { PERFORMANCE_STORAGE_KEY, PerformanceRecorder, performanceMidi, readPerformanceTakes, type PerformanceTake } from './performance-recording';
import { ReaderAudio } from './reader-audio';
import {ChordPlayback} from './chord-playback';
import {ReaderVideoRecorder, loadReaderVideos, saveReaderVideo, deleteReaderVideo, readerVideoExtension, type ReaderTake, type ReaderVideoFrame} from './reader-video';
import './chord-reader.css';

const KEYS=readerKeyboardRange();
const WHITES=KEYS.filter(n=>![1,3,6,8,10].includes(n%12));
const BLACKS=KEYS.filter(n=>[1,3,6,8,10].includes(n%12));
const DRAFT_KEY=PERFORMANCE_STORAGE_KEY+'-draft';
const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function makeTake(data:Pick<PerformanceTake,'events'|'durationMs'>):PerformanceTake {
  const createdAt=new Date().toISOString();
  const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');
  return {...data,id,createdAt,name:`Performance ${new Date(createdAt).toLocaleString()}`};
}
function downloadTake(take:ReaderTake,midiOnly=false){
  const video=!midiOnly&&take.video;
  const url=URL.createObjectURL(video||new Blob([Uint8Array.from(performanceMidi(take)).buffer],{type:'audio/midi'}));
  const link=document.createElement('a');link.href=url;link.download=`${take.name.replace(/[^a-z0-9_-]/gi,'-')}.${video?readerVideoExtension(video.type):'mid'}`;
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
  const mode=useRef(midi.inputMode);mode.current=midi.inputMode;
  const sound=useRef(false);
  const [monitor,setMonitor]=useState(false);
  const audio=useRef(new ReaderAudio());
  const chordPlayback=useRef<ChordPlayback|null>(null);
  const lastChord=useRef<number[]>([]);
  const [hearingChord,setHearingChord]=useState(false);
  const recorder=useRef(new PerformanceRecorder());
  const videoRecorder=useRef(new ReaderVideoRecorder());
  const videoFrame=useRef<ReaderVideoFrame>({notes:[],label:'Listening for notes',detail:'',spelling:'',sustain:false,sustained:[]});
  const capturing=useRef(false);
  const mounted=useRef(true);
  const operation=useRef(false);
  const [busy,setBusy]=useState(false);
  const stopHandler=useRef<()=>void>(()=>{});
  const [recording,setRecording]=useState(false);
  const start=useRef(0);
  const [elapsed,setElapsed]=useState(0);
  const [draft,setDraft]=useState<ReaderTake|null>(null);
  const [takes,setTakes]=useState<ReaderTake[]>([]);
  const [videoPlayer,setVideoPlayer]=useState<{name:string;url:string}|null>(null);
  const [notice,setNotice]=useState('');
  const [playing,setPlaying]=useState<string|null>(null);
  const [replayNotes,setReplayNotes]=useState<number[]>([]);
  const replayTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const replayGeneration=useRef(0);
  const dialog=useRef<HTMLDialogElement>(null);

  function stopReplay(){
    chordPlayback.current?.stop();setHearingChord(false);
    replayGeneration.current++;
    if(replayTimer.current!==null)clearInterval(replayTimer.current);
    replayTimer.current=null;audio.current.stop();setPlaying(null);setReplayNotes([]);
  }
  useEffect(()=>{
    let cancelled=false;
    let legacyTakes:ReaderTake[]=[];
    let legacyDraft:ReaderTake|undefined;
    mounted.current=true;
    window.scrollTo(0,0);
    try{
      legacyTakes=readPerformanceTakes(localStorage.getItem(PERFORMANCE_STORAGE_KEY));setTakes(legacyTakes);
      const pending=readPerformanceTakes(localStorage.getItem(DRAFT_KEY))[0];legacyDraft=pending;
      if(pending){setDraft(pending);setElapsed(pending.durationMs);setNotice('Unsaved take restored. Save or discard to record again.');}
    }catch{setNotice('Device storage is unavailable. Takes can still be downloaded.');}
    void loadReaderVideos().then(videos=>{
      if(cancelled)return;
      const pending=legacyDraft?undefined:videos.find(take=>take.draft);
      setTakes([...videos.filter(take=>take.id!==pending?.id),...legacyTakes]);
      if(pending){setDraft(pending);setElapsed(pending.durationMs);setNotice('Unsaved reader video restored. Save or download your take.');}
    }).catch(()=>{if(!cancelled)setNotice('Video storage is unavailable. You can still record and download videos.');});
    const engine=audio.current;
    const capture=recorder.current;
    const video=videoRecorder.current;
    return ()=>{
      cancelled=true;mounted.current=false;capturing.current=false;
      chordPlayback.current?.dispose();
      if(replayTimer.current!==null)clearInterval(replayTimer.current);
      replayGeneration.current++;
      if(capture.active){
        const pending=makeTake(capture.finish(performance.now()));
        void video.finish().then(blob=>saveReaderVideo({...pending,video:blob,draft:true})).catch(()=>undefined).finally(()=>engine.dispose());
      }else if(video.active)void video.finish().catch(()=>undefined).finally(()=>engine.dispose());
      else engine.dispose();
    };
  },[]);
  useEffect(()=>()=>{if(videoPlayer)URL.revokeObjectURL(videoPlayer.url);},[videoPlayer]);
  useEffect(()=>{
    // Changing input mode must not leave voices from the previous source hanging.
    if(midi.inputMode==='screen'){
      for(const held of midiManager.getSoundingNotes())recorder.current.receive('off',held.note,0,held.channel,performance.now());
      audio.current.stop('midi:');
    }
    if(midi.inputMode==='midi'){
      for(const note of screenHeld.current)recorder.current.receive('off',note,0,15,performance.now());
      screenHeld.current.clear();setScreenNotes([]);audio.current.stop('screen:');
    }
  },[midi.inputMode]);
  useEffect(()=>midiManager.onNote(event=>{
    const key=event.channel+':'+event.note;
    if(event.type==='panic'){audio.current.stop('midi:');recorder.current.receive('panic',0,0,0,performance.now());return;}
    if(mode.current==='screen')return;
    recorder.current.receive(event.type,event.note,event.velocity,event.channel,performance.now());
    if(event.type==='off')audio.current.off('midi:'+key);
    else if(sound.current||capturing.current)audio.current.on('midi:'+key,event.note,event.velocity);
  }),[]);
  useEffect(()=>{
    if(!recording)return;
    const timer=setInterval(()=>setElapsed(performance.now()-start.current),250);
    return()=>clearInterval(timer);
  },[recording]);


  const input=useMemo(()=>playing?replayNotes:midi.inputMode==='screen'?screenNotes:midi.inputMode==='midi'?midi.active:[...midi.active,...screenNotes],[playing,replayNotes,midi.inputMode,midi.active,screenNotes]);
  const result=useMemo(()=>identifyChord(input),[input]);
  useEffect(()=>{
    if(!result.notes.length)return;
    const timer=setTimeout(()=>{lastChord.current=[...result.notes];},120);
    return()=>clearTimeout(timer);
  },[result.notes]);
  const chord=result.matches[0];
  const label=chord??(result.notes.length===0?'Listening for notes':new Set(result.notes.map(n=>n%12)).size===1?'Single note':'Unrecognized cluster');
  const written=useMemo(()=>result.notes.map(n=>readerWrittenNote(n,chord)),[result.notes,chord]);
  const root=chord?parseChordRoot(chord).root.pitchClass:0;
  const spelling=[...new Map(written.map(n=>[n.midi%12,n])).values()].sort((a,b)=>(a.midi-root+120)%12-(b.midi-root+120)%12);
  const outside=written.filter(n=>n.midi<36||n.midi>84);
  const detail=[result.inferredRoots.includes(chord??'')?'Root inferred (not played)':'',result.matches.length>1?`Also: ${result.matches.slice(1,4).map(name=>name+(result.inferredRoots.includes(name)?' (root omitted)':'')).join(' · ')}`:''].filter(Boolean).join(' · ');
  const spellingText=spelling.map(n=>n.name).join(' · ');
  const sustain=!playing&&midi.inputMode!=='screen'&&midi.sustain;
  const sustained=useMemo(()=>midi.inputMode==='screen'||playing?[]:midi.sustained.filter(note=>!screenNotes.includes(note)&&!midi.pressed.includes(note)),[midi.sustained,midi.pressed,screenNotes,midi.inputMode,playing]);
  videoFrame.current=useMemo(()=>({notes:result.notes,chord,label,detail,spelling:spellingText,sustain,sustained}),[result.notes,chord,label,detail,spellingText,sustain,sustained]);

  async function hearChord(){
    const notes=result.notes.length?result.notes:lastChord.current;
    if(!notes.length){setNotice('Play a chord first so there is a voicing to hear.');return;}
    if(!chordPlayback.current)chordPlayback.current=new ChordPlayback();
    setHearingChord(true);
    try{
      const finished=await chordPlayback.current.play([notes],1100);
      if(mounted.current)setNotice(finished?(midi.selectedOutput?'Played through your keyboard’s selected sound.':'Chord played through browser audio.'):'Chord playback stopped.');
    }catch(error){if(mounted.current)setNotice(error instanceof Error?error.message:'Chord playback failed.');}
    finally{if(mounted.current)setHearingChord(false);}
  }

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
  async function startRecording(){
    if(draft||recorder.current.active||operation.current)return;
    operation.current=true;setBusy(true);stopReplay();setVideoPlayer(null);
    try{
      // Unlock audio within the original click, including on iPhone Safari.
      const ready=await audio.current.unlock();
      if(!mounted.current)return;
      if(!ready)throw new Error('Piano audio could not start. Tap Record again.');
      videoRecorder.current.begin(()=>videoFrame.current,audio.current.recordingStream(),()=>stopHandler.current());
      start.current=performance.now();recorder.current.begin(start.current);capturing.current=true;
      if(mode.current!=='screen')for(const held of midiManager.getSoundingNotes()){
        recorder.current.receive('on',held.note,held.velocity,held.channel,start.current);
        audio.current.on(`midi:${held.channel}:${held.note}`,held.note,held.velocity);
      }
      if(mode.current!=='midi')for(const note of screenHeld.current){
        recorder.current.receive('on',note,.75,15,start.current);audio.current.on('screen:'+note,note,.75);
      }
      setRecording(true);setElapsed(0);setNotice('Recording the reader, highlighted keys, sustain and piano audio.');
    }catch(error){if(mounted.current)setNotice(error instanceof Error?error.message:'Video recording could not start.');}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  async function stopRecording(){
    if(!recorder.current.active||operation.current)return;
    operation.current=true;setBusy(true);
    const pending:ReaderTake={...makeTake(recorder.current.finish(performance.now())),draft:true};
    capturing.current=false;setRecording(false);setElapsed(pending.durationMs);
    try{
      pending.video=await videoRecorder.current.finish();
      if(mounted.current){setDraft(pending);setNotice('Reader video ready. Save it or open Recordings to download it.');}
      try{await saveReaderVideo(pending);}
      catch{if(mounted.current)setNotice('Video ready. Open Recordings to download it; device storage is unavailable.');}
    }catch(error){
      // Retain the performance if a browser encoder fails during the take.
      if(mounted.current){setDraft(pending);setNotice(`${error instanceof Error?error.message:'Video capture failed.'} The MIDI notes are available in Recordings.`);}
      try{localStorage.setItem(DRAFT_KEY,JSON.stringify([pending]));}catch{/* Keep the in-memory performance. */}
    }finally{
      operation.current=false;if(!sound.current)audio.current.stop('midi:');
      if(mounted.current)setBusy(false);
    }
  }
  stopHandler.current=()=>void stopRecording();
  async function saveTake(){
    if(!draft||operation.current)return;
    operation.current=true;setBusy(true);
    const saved={...draft,draft:false};
    try{
      if(saved.video)await saveReaderVideo(saved);
      else{
        const legacy=[saved,...takes.filter(take=>!take.video)];
        localStorage.setItem(PERFORMANCE_STORAGE_KEY,JSON.stringify(legacy));localStorage.removeItem(DRAFT_KEY);
      }
      if(mounted.current){setTakes(previous=>[saved,...previous]);setDraft(null);setNotice(saved.video?'Reader video saved on this device.':'Performance saved on this device.');}
    }catch{setNotice('Could not save on this device. Download your recording instead.');dialog.current?.showModal();}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  async function discardTake(){
    if(!draft||operation.current)return;
    try{
      if(draft.video)await deleteReaderVideo(draft.id);else localStorage.removeItem(DRAFT_KEY);
      setDraft(null);setElapsed(0);setNotice('Take discarded.');setVideoPlayer(null);
    }catch{setNotice('Could not discard the stored take. Please try again.');}
  }
  async function deleteTake(take:ReaderTake){
    try{
      if(take.video)await deleteReaderVideo(take.id);
      else localStorage.setItem(PERFORMANCE_STORAGE_KEY,JSON.stringify(takes.filter(t=>!t.video&&t.id!==take.id)));
      setTakes(previous=>previous.filter(t=>t.id!==take.id));setVideoPlayer(null);
    }catch{setNotice('Could not delete this recording from device storage.');}
  }
  function watch(take:ReaderTake){
    if(!take.video)return;
    stopReplay();setVideoPlayer({name:take.name,url:URL.createObjectURL(take.video)});
    dialog.current?.showModal();
  }
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
    return <div role="button" tabIndex={midi.inputMode==='midi'||playing?-1:0} key={note} aria-disabled={midi.inputMode==='midi'||Boolean(playing)} className={`${black?'black black-key':`white ${BLACKS.includes(note-1)?'cut-left':''} ${BLACKS.includes(note+1)?'cut-right':''}`} ${active?'voiced key-down':''} ${sustained.includes(note)?'reader-sustained':''}`} style={black?{left:`${nextWhite/WHITES.length*100}%`}:undefined} aria-label={`${name.name}${name.octave}${sustained.includes(note)?', held by sustain pedal':''}`} aria-pressed={active}
      onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);press(note);}}
      onPointerUp={()=>release(note)} onPointerCancel={()=>release(note)} onLostPointerCapture={()=>release(note)}
      onKeyDown={event=>{if(!event.repeat&&(event.key==='Enter'||event.key===' ')){event.preventDefault();press(note);}}}
      onKeyUp={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();release(note);}}} onBlur={()=>release(note)}><small>{name.name}{name.octave}</small></div>;
  }
  return <section className="chord-reader" aria-labelledby="chord-reader-title">
    <header className="reader-heading"><h1 id="chord-reader-title">Chord Reader</h1><div className="reader-record-controls" role="group" aria-label="Performance recording controls">
      <span className={`reader-timer ${recording?'is-recording':''}`} role="timer">{recording?'● ':''}{time(elapsed)}</span>
      <button type="button" onClick={()=>void startRecording()} disabled={busy||recording||Boolean(draft)||Boolean(playing)} title="Record a video of the reader with piano audio">● Record video</button>
      <button type="button" onClick={()=>playing?stopReplay():void stopRecording()} disabled={busy||(!recording&&!playing)}>■ Stop</button>
      <button type="button" onClick={()=>void saveTake()} disabled={busy||!draft||recording}>Save</button>
      <button type="button" onClick={()=>dialog.current?.showModal()}>Recordings ({takes.length})</button>
    </div></header>
    <section className="reader-instrument piano-wrap" aria-label="Live chord, staff and piano keyboard">
      <div className="reader-readout" role="status" aria-live="polite" aria-atomic="true"><h2>{label}</h2><p title={detail}>{detail||' '}</p></div>
      <div className="reader-notation-row">
        <div className="reader-staff-panel"><h3>Chord staff</h3><ChordStaff notes={result.notes} chord={chord}/></div>
        <div className="reader-spelling"><h3>Chord spelling</h3><p className="reader-spelling-notes" title={spelling.map(n=>n.name).join(' · ')}>{spelling.length?spelling.map(n=>n.name).join(' · '):'—'}</p><h3>Notes played</h3><p className="reader-played-notes" title={written.map(n=>n.name+n.octave).join(' · ')}>{written.length?written.map(n=>n.name+n.octave).join(' · '):'—'}</p><p className="reader-bass-note">{written.length?`Bass: ${written[0].name}${written[0].octave}`:' '}</p></div>
      </div>
      <div className="reader-piano-area"><div className="reader-keyboard-heading"><span>KEYBOARD · C2–C6</span><MidiOutputSelector/><button type="button" disabled={hearingChord||recording||Boolean(playing)} onClick={()=>void hearChord()}>{hearingChord?'Playing…':midi.selectedOutput?'▶ Play on my keyboard':'▶ Hear chord'}</button>{hearingChord&&<button type="button" onClick={()=>{chordPlayback.current?.stop();setHearingChord(false);}}>Stop chord</button>}<span className={`reader-pedal ${sustain?'is-down':''}`} role="status">Sustain {sustain?'on':'off'}</span><button type="button" aria-pressed={monitor} onClick={()=>{
        const enabled=!monitor;sound.current=enabled;setMonitor(enabled);audio.current.setMidiMonitor(enabled);
        if(enabled)void audio.current.unlock().then(ready=>{if(ready&&sound.current&&mode.current!=='screen')for(const held of midiManager.getSoundingNotes())audio.current.on(`midi:${held.channel}:${held.note}`,held.note,held.velocity);});
        else if(!capturing.current)audio.current.stop('midi:');
      }}>MIDI sound {monitor?'on':'off'}</button></div>
        <div className="piano-shell"><div className="piano" role="group" aria-label="Faithful Keys four-octave piano keyboard">{WHITES.map(n=>pianoKey(n))}{BLACKS.map(n=>pianoKey(n,true))}</div></div>
      </div>
      <div className="reader-input-status"><span title={outside.map(n=>n.name+n.octave).join(' · ')}>{outside.length?`Outside keyboard: ${outside.map(n=>n.name+n.octave).join(' · ')}`:sustained.length?'Gold keys · held by sustain pedal':midi.inputMode==='midi'?'MIDI input · sounding notes light the keys':'Hold on-screen keys or play your MIDI keyboard'}</span><span>MIDI: {midi.status}</span></div>
    </section>
    <p className="reader-notice" role="status" title={notice}>{busy?'Preparing your recording…':notice||'Record video captures this reader and piano audio. Stop, then save or download.'}</p>
    <dialog ref={dialog} onClose={()=>setVideoPlayer(null)} className="reader-takes-dialog" aria-labelledby="reader-takes-title"><div className="reader-takes-heading"><h2 id="reader-takes-title">Reader recordings</h2><button type="button" onClick={()=>dialog.current?.close()} aria-label="Close recordings">×</button></div><p>Videos include chord names, staff, keys, sustain and the app’s piano audio. Saved on this device. Download a video to keep or share it.</p>
      {videoPlayer&&<div className="reader-video-player"><strong>{videoPlayer.name}</strong><video key={videoPlayer.url} src={videoPlayer.url} controls autoPlay playsInline aria-label="Recorded reader video"/></div>}
      {draft&&<article className="reader-take"><strong>Unsaved {draft.video?'reader video':'MIDI take'} · {time(draft.durationMs)}</strong><div><button type="button" disabled={busy} onClick={()=>void saveTake()}>Save recording</button>{draft.video&&<button type="button" disabled={recording||busy} onClick={()=>watch(draft)}>▶ Watch</button>}<button type="button" disabled={busy} onClick={()=>downloadTake(draft)}>Download {draft.video?'video':'MIDI'}</button><button type="button" disabled={busy} onClick={()=>void discardTake()}>Discard</button></div></article>}
      {!takes.length&&!draft&&<p>No recordings saved yet.</p>}
      {takes.map(take=><article className="reader-take" key={take.id}><strong>{take.name}</strong><small>{time(take.durationMs)} · {take.video?'Reader video':'MIDI recording'} · {take.events.filter(e=>e.type==='on').length} notes</small><div><button type="button" disabled={recording||busy||Boolean(draft)} onClick={()=>take.video?watch(take):void replay(take)}>▶ {take.video?'Watch':'Play'}</button><button type="button" onClick={()=>downloadTake(take)}>Download {take.video?'video':'MIDI'}</button>{take.video&&<button type="button" onClick={()=>downloadTake(take,true)}>MIDI</button>}<button type="button" disabled={busy} onClick={()=>void deleteTake(take)}>Delete</button></div></article>)}
    </dialog>
  </section>;
}
