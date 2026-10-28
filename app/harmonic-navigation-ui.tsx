'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMidi } from './midi/ui';
import { ReaderAudio } from './reader-audio';
import { identifyChord } from './chord-reader';
import { voiceLeadProgression } from './voice-leading';
import {
  NAV_KEYS, NAV_VOICINGS, degrees, detectChord, navigationOptions, notePc, noteLabel, spelledNavigationNote,
  transposeNavigation, type NavDirection, type NavAxis, type NavPalette,
  type NavVoicing, type NavTexture, type NavigationRequest, type NavigationOption,
} from './harmonic-navigation';
import './harmonic-navigation.css';

const NAV_STORAGE='faithful-keys-harmonic-navigation-v1';
const MASTERY_STORAGE='faithful-keys-harmonic-navigation-mastery-v1';
const PATCHES: {id:NavTexture;label:string}[]=[
  {id:'warm',label:'Warm & lush'},{id:'bright',label:'Bright & open'},{id:'dark',label:'Dark & tense'},
  {id:'modern-gospel',label:'Modern gospel'},{id:'neo-soul',label:'Neo-soul'},
  {id:'worship',label:'Worship'},{id:'jazz',label:'Jazz'},
];
const NAV_PALETTES: {id:NavPalette;label:string}[]=[
  {id:'diatonic',label:'Within the key'}, {id:'gospel',label:'Gospel color'},
  {id:'jazz',label:'Jazz substitutions'}, {id:'chromatic',label:'Chromatic'},
  {id:'all',label:'All movement'},
];
type Save={id:string;createdAt:string;key:string;current:string;voicing:NavVoicing;option:NavigationOption};
const demo=[50,57,62,65,72];
const uniq=(xs:number[])=>[...new Set(xs)].sort((a,b)=>a-b);
const noteList=(xs:number[],chord?:string,key='C',mode:'major'|'minor'='major',direction:NavDirection='either')=>xs.map(n=>chord?spelledNavigationNote(n,chord,key,mode,direction):noteLabel(n)).join(' · ');
/** Complete concert-grand range, MIDI 21–108 (A0–C8), with a usable
 * horizontally scrollable touch viewport rather than 88 tiny keys. */
export const NAV_PIANO_RANGE={low:21,high:108} as const;
function Piano({active=[],suggested=[],onKey}:{active?:number[];suggested?:number[];onKey?:(n:number)=>void}){
  const whites=useMemo(()=>Array.from({length:NAV_PIANO_RANGE.high-NAV_PIANO_RANGE.low+1},(_,i)=>i+NAV_PIANO_RANGE.low)
    .filter(n=>![1,3,6,8,10].includes(n%12)),[]);
  const viewport=useRef<HTMLDivElement>(null);
  const [keyWidth,setKeyWidth]=useState(36);
  const focus=(midiNote:number,smooth=true)=>{
    const element=viewport.current;if(!element)return;
    const index=whites.findIndex(n=>n>=midiNote);
    const whiteIndex=index<0?whites.length-1:index;
    element.scrollTo({left:Math.max(0,(whiteIndex+.5)*keyWidth-element.clientWidth/2),behavior:smooth?'smooth':'instant'});
  };
  useEffect(()=>{focus(60,false);},[]);
  const jump=(offset:number)=>{viewport.current?.scrollBy({left:offset*7*keyWidth,behavior:'smooth'});};
  const focusNotes=()=>{const notes=suggested.length?suggested:active;focus(notes.length?notes[Math.floor(notes.length/2)]:60);};
  return <div className="hn-piano-container">
    <div className="hn-piano-toolbar" role="group" aria-label="Full piano navigation">
      <span>88-key keyboard · A0–C8</span>
      <div>
        <button type="button" aria-label="Scroll keyboard down one octave" onClick={()=>jump(-1)}>← Octave</button>
        <button type="button" onClick={()=>focus(60)}>Middle C</button>
        <button type="button" onClick={focusNotes}>Find notes</button>
        <button type="button" aria-label="Scroll keyboard up one octave" onClick={()=>jump(1)}>Octave →</button>
        <label>Key size <select aria-label="On-screen piano key size" value={keyWidth} onChange={e=>setKeyWidth(Number(e.target.value))}>
          <option value={28}>Compact</option><option value={36}>Standard</option><option value={46}>Large</option>
        </select></label>
      </div>
    </div>
    <div className="hn-keys" role="group" aria-label="Scrollable 88-key piano. Gold notes are held; teal notes are suggested. Swipe horizontally to explore all octaves." ref={viewport}>
      <div className="hn-keys-track" style={{'--hn-key-width':keyWidth+'px'} as CSSProperties}>
        {whites.map((note,i)=>{
          const isC=note%12===0;
          return <div key={note} className="hn-white-slot">
            <button type="button" aria-label={'Play '+noteLabel(note)} className={'hn-white'+(active.includes(note)?' held':'')+(suggested.includes(note)?' target':'')} onClick={()=>onKey?.(note)}>
              {(isC||note===21)&&<small>{noteLabel(note)}</small>}
            </button>
            {i<whites.length-1&&[1,3,6,8,10].includes((note+1)%12)&&
              <button type="button" aria-label={'Play '+noteLabel(note+1)} className={'hn-black'+(active.includes(note+1)?' held':'')+(suggested.includes(note+1)?' target':'')} onClick={()=>onKey?.(note+1)}/>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
function Field<T extends string>({label,value,onChange,items}:{label:string;value:T;onChange:(v:T)=>void;items:{id:T;label:string}[]}){
  return <label className="hn-field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value as T)}>{items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
}
const attr=(d:number)=>d>0?'+'+d:String(d);
function splitHands(bass:number,upper:number[]){
  const left=[bass],right=[...upper].sort((a,b)=>a-b);
  // Wider-than-octave spreads belong to two hands, not an impossible single-hand reach.
  while(right.length>2&&right.at(-1)!-right[0]>12)left.push(right.shift()!);
  return {left,right};
}
function OptionCard({option,selected,hidden,keyName,mode,direction,onSelect,onPlay,onSave,onPractice}:{option:NavigationOption;selected:boolean;hidden:boolean;keyName:string;mode:'major'|'minor';direction:NavDirection;onSelect:()=>void;onPlay:()=>void;onSave:()=>void;onPractice:()=>void}){
  return <article className={'hn-option'+(selected?' chosen':'')}>
    <button type="button" className="hn-option-head" onClick={onSelect} aria-pressed={selected}>
      <span><strong>{option.title}</strong><small>{option.family} · {option.classification}</small></span>
      <span className="hn-option-symbol">{hidden?'?':option.symbol}</span>
    </button>
    {!hidden && <><p>{option.explanation}</p><div className="hn-path">{option.path.map((step,i)=><span key={i}>{i>0&&<i>→</i>}{step}</span>)}</div>
    <div className="hn-option-notes"><span>LH {noteList(splitHands(option.bass,option.upper).left,option.symbol,keyName,mode,direction)}</span><span>RH {noteList(splitHands(option.bass,option.upper).right,option.symbol,keyName,mode,direction)}</span></div>
    <p className="hn-movement">Voice movement {option.movedVoices.map(attr).join(' / ')} semitones · {option.commonTones} common pitch classes</p></>}
    <div className="hn-card-actions">
      <button type="button" onClick={onPlay}>▶ Hear</button>
      <button type="button" onClick={onPractice}>Practice</button>
      <button type="button" onClick={onSave}>☆ Save</button>
    </div>
  </article>;
}
function asFile(name:string,data:unknown){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
}
export default function HarmonicNavigation(){
  const midi=useMidi();
  const [key,setKey]=useState<string>('C');
  const [mode,setMode]=useState<'major'|'minor'>('major');
  const [voicing,setVoicing]=useState<NavVoicing>('gospel');
  const [direction,setDirection]=useState<NavDirection>('up');
  const [axis,setAxis]=useState<NavAxis>('top');
  const [palette,setPalette]=useState<NavPalette>('all');
  const [texture,setTexture]=useState<NavTexture>('modern-gospel');
  const [tension,setTension]=useState(56);
  const [density,setDensity]=useState(6);
  const [lock,setLock]=useState<NavigationRequest['lock']>('none');
  const [destination,setDestination]=useState<number|null>(null);
  const [modulationKey,setModulationKey]=useState('');
  const [range,setRange]=useState<'low'|'middle'|'high'>('middle');
  const [playing,setPlaying]=useState(false);
  const [modeLearn,setModeLearn]=useState<'explore'|'guided'|'ear'>('explore');
  const [revealed,setRevealed]=useState(false);
  const [screenNotes,setScreenNotes]=useState<number[]>([]);
  const [manual,setManual]=useState('Dm9');
  const [manualMode,setManualMode]=useState(false);
  const [lastPlayed,setLastPlayed]=useState<number[]>(demo);
  const [alternative,setAlternative]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const [practiceId,setPracticeId]=useState('');
  const [correctCount,setCorrectCount]=useState(0);
  const [mastery,setMastery]=useState<Record<string,{attempts:number;successes:number;lastAt:string}>>({});
  const [saved,setSaved]=useState<Save[]>([]);
  const [status,setStatus]=useState('Play a chord on your MIDI keyboard, select notes on screen, or use the example.');
  const [showLibrary,setShowLibrary]=useState(false);
  const audio=useRef(new ReaderAudio());
  const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const pressed=midi.inputMode==='screen'?[]:midi.active;
  const input=uniq([...pressed,...screenNotes]);
  const live=useMemo(()=>detectChord(input,key,mode),[input.join(','),key,mode]);
  const last=useMemo(()=>detectChord(lastPlayed,key,mode),[lastPlayed.join(','),key,mode]);
  const lastInput=useMemo(()=>input.length>=3?input:lastPlayed,[input.join(','),lastPlayed.join(',')]);
  const interpretations=input.length>=3?live.matches:last.matches;
  const current=manualMode?manual:alternative&&interpretations.includes(alternative)?alternative:interpretations[0]||manual;
  const request=useMemo<NavigationRequest>(()=>({key,mode,current,held:manualMode?[]:lastInput,direction,axis,palette,voicing,texture,tension,density,lock,destination,modulationKey,range}),[key,mode,current,lastInput,direction,axis,palette,voicing,texture,tension,density,lock,destination,modulationKey,range,manualMode]);
  const options=useMemo(()=>navigationOptions(request),[request]);
  const selected=options.find(o=>o.id===selectedId)??options[0];
  const practice=options.find(o=>o.id===practiceId)??null;
  const visualNotes=input.length?input:lastInput;
  const destinationDegrees=useMemo(()=>degrees(key,mode),[key,mode]);
  const readyToReveal=modeLearn!=='ear'||revealed;
  const correct=practice&&input.length>0&&uniq(input.map(n=>n%12)).join(',')===uniq(practice.voicedPath.at(-1)!.map(n=>n%12)).join(',');
  useEffect(()=>{if(input.length<3)return;const identified=identifyChord(input);if(identified.matches.length){setLastPlayed(input);setAlternative('');setManualMode(false)}},[input.join(',')]);
  useEffect(()=>{if(correct&&practice){
    setCorrectCount(n=>n+1);
    const id=key+'|'+voicing+'|'+practice.symbol;
    setMastery(all=>({...all,[id]:{attempts:all[id]?.attempts??1,successes:(all[id]?.successes??0)+1,lastAt:new Date().toISOString()}}));
    setStatus('Correct! You found the target harmony. Choose another destination.');setPracticeId('');
  }},[correct]);
  useEffect(()=>{try{const storage=localStorage.getItem(NAV_STORAGE);if(storage){const values=JSON.parse(storage);if(Array.isArray(values))setSaved(values.slice(0,100));}}catch{setStatus('Saved movements unavailable on this device. You can still explore and export.')}
    try{const stored=JSON.parse(localStorage.getItem(MASTERY_STORAGE)||'{}');
      if(stored&&typeof stored==='object'&&!Array.isArray(stored))setMastery(stored);
    }catch{/* storage optional */}
    const engine=audio.current;return()=>{timers.current.forEach(clearTimeout);engine.dispose();};},[]);
  useEffect(()=>{try{localStorage.setItem(NAV_STORAGE,JSON.stringify(saved));}catch{/* private browsing */}},[saved]);
  useEffect(()=>{try{localStorage.setItem(MASTERY_STORAGE,JSON.stringify(mastery));}catch{/* private browsing */}},[mastery]);
  useEffect(()=>{setSelectedId('');setPracticeId('');setRevealed(false)},[key,mode,direction,axis,palette,voicing,texture,destination,range,current]);
  const stop=()=>{timers.current.forEach(clearTimeout);timers.current=[];audio.current.stop('nav:');setPlaying(false);};
  const play=async(notes:number[][],tempo=620)=>{
    stop();const can=await audio.current.unlock();if(!can){setStatus('Audio cannot play in this browser. Try tapping Hear again.');return;}
    setPlaying(true);const engine=audio.current;
    notes.forEach((chord,i)=>{
      const start=setTimeout(()=>{engine.stop('nav:');uniq(chord).forEach(n=>engine.on('nav:'+n,n,.72));},i*tempo);
      timers.current.push(start);
    });
    timers.current.push(setTimeout(()=>{engine.stop('nav:');setPlaying(false);},notes.length*tempo+350));
  };
  const playOption=(option:NavigationOption)=>{
    const inputChord=manualMode?voiceLeadProgression([current],{style:'gospel',layout:'close'})[0].notes:visualNotes.length>=3?visualNotes:demo;
    void play([inputChord,...option.voicedPath]);
  };
  const save=(option:NavigationOption)=>{
    const entry:Save={id:crypto.randomUUID?.()||String(Date.now()),createdAt:new Date().toISOString(),key,current,voicing,option};
    setSaved(list=>[entry,...list].slice(0,100));setStatus('Saved '+option.title+' to your movement library.');
  };
  const beginPractice=(option:NavigationOption)=>{
    setPracticeId(option.id);setSelectedId(option.id);setRevealed(modeLearn!=='ear');
    const id=key+'|'+voicing+'|'+option.symbol;
    setMastery(all=>({...all,[id]:{attempts:(all[id]?.attempts??0)+1,successes:all[id]?.successes??0,lastAt:new Date().toISOString()}}));
    setStatus('Play the destination notes on your keyboard. Correct pitch classes count, regardless of octave.');playOption(option);
  };
  const transposeSaved=(entry:Save,newKey:string)=>{
    const steps=(notePc(newKey)-notePc(entry.key)+12)%12;
    const transposed=entry.option.path.map(chord=>transposeNavigation(chord,steps,newKey,entry.key));
    setKey(newKey);setManual(transposeNavigation(entry.current,steps,newKey,entry.key));setManualMode(true);
    setStatus('Transposed movement: '+transposed.join(' → ')+'. Listen to the new key and try the notes.');
    void play(entry.option.voicedPath.map(chord=>chord.map(note=>note+steps)));
  };
  const toggleNote=(note:number)=>{
    if(midi.inputMode==='midi')return;
    setScreenNotes(notes=>notes.includes(note)?notes.filter(n=>n!==note):uniq([...notes,note]));
    void audio.current.unlock().then(ok=>{if(ok){audio.current.on('nav:tap',note,.7);timers.current.push(setTimeout(()=>audio.current.off('nav:tap'),270));}});
  };
  return <section className="hn-root" aria-label="Harmonic Navigation Teacher">
    <header className="hn-heading">
      <div><div className="hn-overline">Faithful Keys · Advanced Harmony</div><h1>Harmonic Navigation <em>Teacher</em></h1><p>Hear the possibilities. Find the movement. Learn to flow.</p></div>
      <div className="hn-heading-actions">
        <span className="hn-midi-tag">{midi.status==='Connected'?'● MIDI connected':'○ On-screen piano ready'}</span>
        <button type="button" onClick={()=>{setManualMode(false);setScreenNotes([]);setLastPlayed(demo);setAlternative('');setKey('C');setStatus('Loaded a Dm7 Drop 2 starting example in C.');}}>Load Dm7 example</button>
        <button type="button" onClick={()=>setShowLibrary(x=>!x)}>{showLibrary?'Hide':'View'} library ({saved.length})</button>
      </div>
    </header>
    <div className="hn-layout">
      <aside className="hn-controls">
        <h2>Shape the movement</h2>
        <div className="hn-control-pair">
          <Field label="Home key" value={key} onChange={setKey} items={NAV_KEYS.map(n=>({id:n,label:n}))}/>
          <Field label="Scale" value={mode} onChange={setMode} items={[{id:'major',label:'Major'},{id:'minor',label:'Minor'}]}/>
        </div>
        <div className="hn-control-pair">
          <Field label="Direction" value={direction} onChange={setDirection} items={[{id:'up',label:'↑ Up'},{id:'down',label:'↓ Down'},{id:'either',label:'↕ Either'}]}/>
          <Field label="Direction refers to" value={axis} onChange={setAxis} items={[{id:'root',label:'Chord root'},{id:'bass',label:'Bass motion'},{id:'top',label:'Melody / top note'},{id:'center',label:'Voicing center'}]}/>
        </div>
        <Field label="Voicing technique" value={voicing} onChange={setVoicing} items={NAV_VOICINGS.map(x=>({id:x.id,label:x.label}))}/>
        <p className="hn-hint">{NAV_VOICINGS.find(x=>x.id===voicing)?.description}. Upper-structure and suspended colors may imply extensions beyond the literal chord label.</p>
        <Field label="Harmonic language" value={palette} onChange={setPalette} items={NAV_PALETTES}/>
        <Field label="Sonic texture" value={texture} onChange={setTexture} items={PATCHES}/>
        <div className="hn-control-pair">
          <Field label="Register" value={range} onChange={setRange} items={[{id:'low',label:'Low'},{id:'middle',label:'Middle'},{id:'high',label:'High'}]}/>
          <Field label="Lock a voice" value={lock} onChange={setLock} items={[{id:'none',label:'Free voices'},{id:'top',label:'Top melody pitch'},{id:'bass',label:'Bass pitch'},{id:'common',label:'Inner common tone'}]}/>
        </div>
        <label className="hn-slider">Tension <strong>{tension}%</strong><input type="range" min="0" max="100" value={tension} onChange={e=>setTension(+e.target.value)}/></label>
        <label className="hn-slider">Density <strong>{density}/10</strong><input type="range" min="1" max="10" value={density} onChange={e=>setDensity(+e.target.value)}/></label>
        <Field label="Target destination" value={destination===null?'any':String(destination)} onChange={v=>setDestination(v==='any'?null:Number(v))} items={[{id:'any',label:'Any scale degree'},...destinationDegrees.map(d=>({id:String(d.degree),label:d.roman+' · '+d.name}))]}/>
        <Field label="Optional modulation" value={modulationKey} onChange={setModulationKey} items={[{id:'',label:'Stay in home key'},...NAV_KEYS.filter(n=>n!==key).map(n=>({id:n,label:'Pivot toward '+n}))]}/>
      </aside>
      <div className="hn-workspace">
        <section className="hn-live">
          <div className="hn-live-top">
            <div><span className="hn-caption">CURRENT HARMONY · {key} {mode}</span><div className="hn-current">{current}<span>{destinationDegrees.find(x=>notePc(x.name)===notePc(current.match(/^[A-G](?:#|b)?/)?.[0]??'C'))?.roman??'Chromatic'}</span></div></div>
            <div className="hn-live-actions"><button type="button" onClick={()=>setManualMode(!manualMode)}>{manualMode?'Use live notes':'Enter chord manually'}</button><button type="button" onClick={()=>{setScreenNotes([]);setAlternative('')}}>Clear keys</button></div>
          </div>
          {manualMode?<label className="hn-manual">Chord symbol <input value={manual} onChange={e=>setManual(e.target.value)} placeholder="e.g. Dm9, G7b9, Cmaj9#11" /></label>:
            <div className="hn-identify">{interpretations.length>1?<label>Interpretation <select value={interpretations.includes(alternative)?alternative:interpretations[0]} onChange={e=>setAlternative(e.target.value)}>{interpretations.slice(0,12).map(x=><option key={x} value={x}>{x}{last.inferred.includes(x)?' (rootless)':''}</option>)}</select></label>:<span>{input.length?'Analyzing '+input.length+' sounding notes':'Last recognized chord retained after note-off'}</span>}</div>}
          <Piano active={visualNotes} suggested={readyToReveal?selected?.voicedPath.at(-1):[]} onKey={toggleNote}/>
          <div className="hn-piano-footer"><span><b>Held:</b> {noteList(visualNotes,current,key,mode,direction)}</span><span><b>Target:</b> {selected&&readyToReveal?noteList(selected.voicedPath.at(-1)!,selected.symbol,key,mode,direction):'Hidden for ear training'}</span></div>
          <div className="hn-degree-map" aria-label="Harmonic destination map">{destinationDegrees.map(d=><button key={d.degree} className={destination===d.degree?'on':''} onClick={()=>setDestination(n=>n===d.degree?null:d.degree)} title={'Find routes to '+d.roman+' in '+key}><span>{d.roman}</span><b>{d.name}</b></button>)}</div>
        </section>
        <div className="hn-results-heading">
          <div><h2>Where can this chord go?</h2><p>{options.length} context-aware options · {NAV_VOICINGS.find(x=>x.id===voicing)?.label}</p></div>
          <div className="hn-mode-tabs" role="group" aria-label="Learning mode">{(['explore','guided','ear'] as const).map(m=><button key={m} aria-pressed={m===modeLearn} onClick={()=>{setModeLearn(m);setRevealed(false)}}>{m==='ear'?'Ear first':m==='guided'?'Guided':'Explore'}</button>)}</div>
        </div>
        {modeLearn==='ear'&&<div className="hn-ear-banner">Ear-first: listen and reproduce the sound before revealing the harmony. <button onClick={()=>setRevealed(v=>!v)}>{revealed?'Hide notes':'Reveal notes'}</button></div>}
        {practice&&<div className="hn-practice"><div><b>Practice: {practice.title}</b><p>{modeLearn==='ear'&&!revealed?'Listen and find the chord by ear.':noteList(practice.voicedPath.at(-1)!,practice.symbol,key,mode,direction)} · {input.length?input.length+' MIDI/on-screen notes active':'Play your answer'}</p></div><button type="button" onClick={()=>{setPracticeId('');setStatus('Practice cancelled.')}}>Exit practice</button></div>}
        {options.length===0?<div className="hn-empty">No movement fits all current filters. Try Either direction, unlock a voice, or use a middle register.</div>:
          <div className="hn-option-grid">{options.slice(0,12).map(option=><OptionCard key={option.id} option={option} keyName={key} mode={mode} direction={direction} selected={selected?.id===option.id} hidden={!readyToReveal} onSelect={()=>setSelectedId(option.id)} onPlay={()=>playOption(option)} onSave={()=>save(option)} onPractice={()=>beginPractice(option)}/>)}</div>}
        {selected&&readyToReveal&&<section className="hn-inspector"><div className="hn-inspector-head"><div><span className="hn-caption">VOICE-LEADING DETAIL</span><h3>{selected.title}</h3></div><button onClick={()=>playOption(selected)} disabled={playing}>{playing?'Playing…':'▶ Play entire movement'}</button></div><div className="hn-steps">{selected.path.map((step,i)=><div key={i}><span>STEP {i+1}</span><b>{step}</b><small>{noteList(selected.voicedPath[i],step,key,mode,direction)}</small></div>)}</div><p>Chord spelling follows the selected key and the functional role of each tension. An upward chromatic neighbor is normally raised (♯); a downward neighbor is lowered (♭). Actual chord tones retain their interval spelling regardless of direction.</p></section>}
        <div className="hn-footnote">Suggestions are generated from harmonic rules and playable MIDI note layouts. Voice-leading and tension rankings are heuristic, not a trained musician or audio-analysis model. Some contemporary colors imply chord substitutions; listen and choose what fits your musical moment.</div>
      </div>
    </div>
    {showLibrary&&<section className="hn-library"><div className="hn-library-heading"><div><h2>Saved movement library</h2><p>{saved.length} saved examples · {correctCount} correct this session · {Object.values(mastery).reduce((sum,x)=>sum+x.successes,0)} total resolutions</p></div><button onClick={()=>asFile('faithful-keys-harmonic-movements.json',saved)} disabled={!saved.length}>Export JSON</button></div>
      {!saved.length?<p>No saved movements yet. Select ☆ Save on a suggestion.</p>:saved.map(entry=><article key={entry.id} className="hn-saved"><div><b>{entry.option.title}</b><small>{entry.key} · {entry.current} → {entry.option.path.join(' → ')} · {entry.voicing}</small></div><div><button onClick={()=>{setKey(entry.key);setManual(entry.current);setManualMode(true);setVoicing(entry.voicing);setStatus('Opened saved movement: '+entry.option.title);}}>Open</button><button onClick={()=>transposeSaved(entry,key)}>Transpose to {key}</button><button onClick={()=>void play(entry.option.voicedPath)}>▶</button><button onClick={()=>setSaved(list=>list.filter(x=>x.id!==entry.id))}>Delete</button></div></article>)}
    </section>}
    <div className="hn-status" role="status">{status}</div>
  </section>;
}
