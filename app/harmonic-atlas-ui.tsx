'use client';

import {useEffect,useRef,useState} from 'react';
import {TeacherRecording} from './teacher-recording';
import {teacherPianoRange,teacherNoteName,type TeacherVideoFrame} from './teacher-video';
import {Keyboard88} from './ear-first-visuals';
import './ear-first-chord-teacher.css';
import './chord-function-teacher.css';

const emptyVoicing:TeacherVideoFrame={notes:[],shared:[],label:''};
const voicingEvent='chord-teacher-keys';

export default function ChordSpectrumTeacher(){
  const frame=useRef<HTMLIFrameElement>(null);
  const [document,setDocument]=useState<Document|null>(null);
  const [voicing,setVoicing]=useState(emptyVoicing);
  const recordedVoicing=useRef(emptyVoicing);

  useEffect(()=>{
    if(!document)return;
    function showVoicing(event:Event){
      const next=(event as CustomEvent<TeacherVideoFrame>).detail;
      recordedVoicing.current=next;
      setVoicing(next);
    }
    document.addEventListener(voicingEvent,showVoicing);
    return ()=>document.removeEventListener(voicingEvent,showVoicing);
  },[document]);

  function playNote(note:number){
    document?.dispatchEvent(new CustomEvent('chord-teacher-audition',{detail:note}));
  }

  return <section className="chord-function-teacher" aria-label="Chord Teacher">
    <iframe ref={frame} title="Chord functions in 12 keys" src="./chord-spectrum/index.html?v=octave-reach" allow="autoplay"
      onLoad={()=>{recordedVoicing.current=emptyVoicing;setVoicing(emptyVoicing);setDocument(frame.current?.contentDocument??null);}} />
    <div className="chord-function-piano">
      <div className="chord-function-piano-title">
        <span>Piano</span>
        <span aria-live="polite">{voicing.label?voicing.label+' voicing':'Tap a chord or play a key'}</span>
      </div>
      {voicing.leftHand?.length&&voicing.rightHand?.length&&<div className="teacher-hand-assignments" aria-label="Voicing by hand">
        <span>LH {voicing.leftHand.map(teacherNoteName).join(' · ')}</span>
        <span>RH {voicing.rightHand.map(teacherNoteName).join(' · ')}</span>
      </div>}
      <TeacherRecording source={document} voicing={recordedVoicing} />
      <Keyboard88 pressed={voicing.notes} sustained={[]} stationary={voicing.shared} target={[]}
        onPlay={playNote} range={teacherPianoRange} />
    </div>
  </section>;
}
