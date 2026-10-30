'use client';
import {useEffect,useRef,type CSSProperties} from 'react';
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
export function Keyboard88({pressed,sustained,stationary,target}:{
  pressed:readonly number[];sustained:readonly number[];stationary:readonly number[];target:readonly number[];
}){
  const viewport=useRef<HTMLDivElement>(null);
  const down=new Set(pressed),held=new Set(sustained),common=new Set(stationary),next=new Set(target);
  const focus=exactNotes(pressed.length?pressed:target);
  const focusSig=focus.join(',');
  useEffect(()=>{
    const el=viewport.current;if(!el||!focus.length)return;
    const center=focus[Math.floor(focus.length/2)];
    const index=WHITE.filter(n=>n<center).length;
    const left=index/WHITE.length*el.scrollWidth;
    if(el.scrollWidth<=el.clientWidth+1)return;
    const visibleLeft=el.scrollLeft,visibleRight=visibleLeft+el.clientWidth;
    if(left<visibleLeft+50||left>visibleRight-50)
      el.scrollTo({left:Math.max(0,left-el.clientWidth/2),behavior:'smooth'});
  },[focusSig]);
  return <div className="ef-keyboard-shell">
    <div className="ef-keyboard-scroller" ref={viewport} tabIndex={0}
      role="img"
      aria-label={'88-key piano, A0 through C8. Pressed: '+(pressed.map(pitchLabel).join(', ')||'none')+
      '. Target notes: '+(target.map(pitchLabel).join(', ')||'none')+
      '. Unchanged voices: '+(stationary.map(pitchLabel).join(', ')||'none')+'.'}>
      <div className="ef-keys">
        {WHITE.map((note,index)=><div key={note}
          className={'ef-white '+keyClass(note,down,held,common,next)}
          title={pitchLabel(note)}
          style={{left:index/WHITE.length*100+'%',width:100/WHITE.length+'%'}}>
          {[24,36,48,60,72,84,96,108].includes(note)&&
            <span className="ef-octave-mark">{pitchLabel(note)}</span>}
        </div>)}
        {BLACK.map(note=>{
          const before=WHITE.filter(w=>w<note).length;
          return <div key={note}
            className={'ef-black '+keyClass(note,down,held,common,next)}
            title={pitchLabel(note)}
            style={{left:(before-.34)/WHITE.length*100+'%',width:.68/WHITE.length*100+'%'}}/>;
        })}
      </div>
    </div>
    <div className="ef-keyboard-legend">
      <span><i className="ef-legend-down"/>pressed</span>
      <span><i className="ef-legend-common"/>unchanged</span>
      <span><i className="ef-legend-next"/>next</span>
      <span>88 keys · A0–C8<span className="ef-scroll-hint"> · scroll to explore</span></span>
    </div>
  </div>;
}
