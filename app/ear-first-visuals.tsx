'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {exactNotes,pitchLabel} from './ear-first-engine';

type NoteLineProps={
  notes:readonly number[];
  stationary?:readonly number[];
  from?:readonly number[];
  active?:readonly number[];
  className?:string;
  labelNote?:(note:number)=>string;
};
type Match={from:number|null;index:number};
function mapVoices(source:readonly number[], destination:readonly number[]):Match[]{
  const available=exactNotes(source).map((note,index)=>({note,index}));
  const output:Match[]=destination.map(()=>({from:null,index:-1}));
  // Common pitches get matched before anything moves; they do not animate.
  destination.forEach((note,i)=>{
    const found=available.findIndex(entry=>entry.note===note);
    if(found>=0){const [entry]=available.splice(found,1);output[i]={from:entry.note,index:entry.index};}
  });
  destination.forEach((note,i)=>{
    if(output[i].from!==null||!available.length)return;
    let closest=0;
    for(let j=1;j<available.length;j++)
      if(Math.abs(available[j].note-note)<Math.abs(available[closest].note-note))closest=j;
    const [entry]=available.splice(closest,1);
    output[i]={from:entry.note,index:entry.index};
  });
  return output;
}

/** One uninterrupted, legible line of 1–10 actual MIDI notes on desktop. */
export function NoteLine({notes,stationary=[],from=[],active=[],className='',labelNote=pitchLabel}:NoteLineProps){
  const normalized=exactNotes(notes);
  const shared=new Set(stationary);
  const down=new Set(active);
  const mapping=mapVoices(from,normalized);
  return <div className={'ef-notes '+className+(normalized.length>6?' ef-dense':'')+(!normalized.length?' ef-no-notes':'')}
    style={{'--ef-voice-count':Math.max(1,normalized.length)} as CSSProperties}
    role="list" aria-label={normalized.length?normalized.map(labelNote).join(', '):'No keys played'}>
    {normalized.length?normalized.map((note,i)=>{
      const match=mapping[i];
      const isStationary=shared.has(note);
      const moving=match.from!==null && match.from!==note;
      const dx=match.index>=0?(match.index-i)*94:0;
      const dy=match.from!==null?Math.max(-25,Math.min(25,(note-match.from)*3)):0;
      const motionStyle={
        '--ef-travel-x':dx+'%', '--ef-travel-y':dy+'px'
      } as CSSProperties;
      return <span role="listitem" key={note}
        className={'ef-note'+(isStationary?' ef-common':'')+(down.has(note)?' ef-held':'')+(moving?' ef-animated':'')}
        style={motionStyle} title={labelNote(note)+(isStationary?' — unchanged voice':'')}>
        <span key={note+':'+(match.from??'new')+':'+(moving?'moving':'still')} className="ef-note-text">{labelNote(note)}</span>
      </span>;
    }):<span className="ef-empty">Play any chord to begin</span>}
  </div>;
}

const LOW=21,HIGH=108;
const WHITE_PCS=new Set([0,2,4,5,7,9,11]);
const WHITE=Array.from({length:HIGH-LOW+1},(_,i)=>i+LOW).filter(n=>WHITE_PCS.has(n%12));
const BLACK=Array.from({length:HIGH-LOW+1},(_,i)=>i+LOW).filter(n=>!WHITE_PCS.has(n%12));
const keyClass=(note:number,down:Set<number>,held:Set<number>,common:Set<number>,next:Set<number>)=>
  'ef-key'+(common.has(note)?' is-common':'')+(down.has(note)?' is-down':'')+
  (!down.has(note)&&held.has(note)?' is-sustain':'')+(next.has(note)?' is-target':'');
export function Keyboard88({pressed,sustained,stationary,target,labelNote=pitchLabel,showOctaves=true,onPlay,range}:{
  pressed:readonly number[];sustained:readonly number[];stationary:readonly number[];target:readonly number[];
  labelNote?:(note:number)=>string;showOctaves?:boolean;
  onPlay?:(note:number)=>void;range?:readonly [number,number];
}){
  const viewport=useRef<HTMLDivElement>(null);
  const [tabNote,setTabNote]=useState(60);
  const [low,high]=range??[LOW,HIGH];
  const whites=WHITE.filter(note=>note>=low&&note<=high);
  const blacks=BLACK.filter(note=>note>=low&&note<=high);
  const down=new Set(pressed),held=new Set(sustained),common=new Set(stationary),next=new Set(target);
  const focus=exactNotes(pressed.length?pressed:target);
  const focusSig=focus.join(',');
  useEffect(()=>{
    const el=viewport.current;if(!el||!focus.length)return;
    const center=focus[Math.floor(focus.length/2)];
    const index=whites.filter(n=>n<center).length;
    const left=index/whites.length*el.scrollWidth;
    if(el.scrollWidth<=el.clientWidth+1)return;
    const visibleLeft=el.scrollLeft,visibleRight=visibleLeft+el.clientWidth;
    if(left<visibleLeft+50||left>visibleRight-50)
      el.scrollTo({left:Math.max(0,left-el.clientWidth/2),behavior:'smooth'});
  },[focusSig]);
  function renderKey(note:number,index:number,black:boolean){
    const className=(black?'ef-black ':'ef-white ')+keyClass(note,down,held,common,next);
    const offset=black ? .34 : 0;
    const width=black ? .68 : 1;
    const style={left:(index-offset)/whites.length*100+'%',width:width/whites.length*100+'%'};
    const label=!black&&note%12===0?<span className="ef-octave-mark">{showOctaves?pitchLabel(note):labelNote(note)}</span>:null;
    if(!onPlay)return <div key={note} className={className} title={labelNote(note)} style={style}>{label}</div>;
    return <button key={note} type="button" className={className} title={labelNote(note)} style={style}
      data-piano-note={note} aria-label={'Play '+labelNote(note)} tabIndex={tabNote===note?0:-1}
      onFocus={()=>setTabNote(note)} onClick={()=>onPlay(note)}
      onKeyDown={event=>{
        const step=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
        if(!step)return;
        event.preventDefault();
        viewport.current?.querySelector<HTMLButtonElement>(`[data-piano-note="${note+step}"]`)?.focus();
      }}>{label}</button>;
  }
  const rangeLabel=range?`${pitchLabel(low)}–${pitchLabel(high)}`:'88 keys · A0–C8';
  return <div className="ef-keyboard-shell">
    <div className="ef-keyboard-scroller" ref={viewport} tabIndex={onPlay?undefined:0}
      role={onPlay?'group':'img'}
      aria-label={rangeLabel+' piano. '+(onPlay?'Play a note, or use the arrow keys to move. ':'')+
      'Sounded notes: '+(pressed.map(labelNote).join(', ')||'none')+
      '. Target notes: '+(target.map(labelNote).join(', ')||'none')+
      '. Unchanged voices: '+(stationary.map(labelNote).join(', ')||'none')+'.'}>
      <div className="ef-keys">
        {whites.map((note,index)=>renderKey(note,index,false))}
        {blacks.map(note=>renderKey(note,whites.filter(w=>w<note).length,true))}
      </div>
    </div>
    <div className="ef-keyboard-legend">
      <span><i className="ef-legend-down"/>{onPlay?'voicing':'pressed'}</span>
      <span><i className="ef-legend-common"/>unchanged</span>
      {!onPlay&&<span><i className="ef-legend-next"/>next</span>}
      <span>{showOctaves?rangeLabel:'88 keys'}<span className="ef-scroll-hint"> · scroll to explore</span></span>
    </div>
  </div>;
}
