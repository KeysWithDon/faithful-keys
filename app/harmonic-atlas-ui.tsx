'use client';

import {useEffect,useRef,useState} from 'react';
import {Keyboard88} from './ear-first-visuals';
import './ear-first-chord-teacher.css';
import './chord-function-teacher.css';

type Voicing = {notes:number[];shared:number[];label:string};
const emptyVoicing:Voicing={notes:[],shared:[],label:''};
const sampledRange=[33,96] as const;
const voicingEvent='chord-teacher-keys';

export default function ChordSpectrumTeacher(){
  const frame=useRef<HTMLIFrameElement>(null);
  const [document,setDocument]=useState<Document|null>(null);
  const [voicing,setVoicing]=useState(emptyVoicing);

  useEffect(()=>{
    if(!document)return;
    function showVoicing(event:Event){
      setVoicing((event as CustomEvent<Voicing>).detail);
    }
    document.addEventListener(voicingEvent,showVoicing);
    return ()=>document.removeEventListener(voicingEvent,showVoicing);
  },[document]);

  function playNote(note:number){
    document?.dispatchEvent(new CustomEvent('chord-teacher-audition',{detail:note}));
  }

  return <section className="chord-function-teacher" aria-label="Chord Teacher">
    <iframe ref={frame} title="Chord functions in 12 keys" src="./chord-spectrum/index.html?v=key-functions" allow="autoplay"
      onLoad={()=>{setVoicing(emptyVoicing);setDocument(frame.current?.contentDocument??null);}} />
    <div className="chord-function-piano">
      <div className="chord-function-piano-title">
        <span>Piano</span>
        <span aria-live="polite">{voicing.label?voicing.label+' voicing':'Tap a chord or play a key'}</span>
      </div>
      <Keyboard88 pressed={voicing.notes} sustained={[]} stationary={voicing.shared} target={[]}
        onPlay={playNote} range={sampledRange} />
    </div>
  </section>;
}
