'use client';

import {useEffect,useRef,useState,type RefObject} from 'react';
import {ReaderVideoRecorder,readerVideoExtension,readerVideoSupported} from './reader-video';
import {drawTeacherVideo,type TeacherVideoFrame} from './teacher-video';

type Capture = {stream: MediaStream; ready: Promise<void>; release: () => void};
type CaptureRequest = {capture?: Capture; error?: Error};
type Take = {file: File; url: string};
type Phase = 'idle' | 'starting' | 'recording' | 'finishing';

export function TeacherRecording({source,voicing}: {source: Document|null; voicing: RefObject<TeacherVideoFrame>}) {
  const [phase,setPhase]=useState<Phase>('idle');
  const [notice,setNotice]=useState('');
  const [take,setTake]=useState<Take|null>(null);
  const [seconds,setSeconds]=useState(0);
  const active=useRef<{recorder: ReaderVideoRecorder<TeacherVideoFrame>; capture: Capture}|null>(null);
  const busy=useRef(false);
  const mounted=useRef(false);
  const [canShare,setCanShare]=useState(false);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;
      const session=active.current;
      active.current=null;
      if(session){
        if(session.recorder.active)void session.recorder.finish().catch(()=>undefined);
        session.capture.release();
      }
    };
  },[]);
  useEffect(()=>{
    if(!take)return;
    return ()=>URL.revokeObjectURL(take.url);
  },[take]);
  useEffect(()=>{
    if(phase!=='recording')return;
    const began=performance.now();
    const timer=window.setInterval(()=>setSeconds(Math.floor((performance.now()-began)/1000)),250);
    return ()=>window.clearInterval(timer);
  },[phase]);

  async function start(){
    if(!source||busy.current||active.current)return;
    if(!readerVideoSupported()){
      setNotice('Video recording is unavailable in this browser.');
      return;
    }
    busy.current=true;
    setPhase('starting');
    setNotice('');
    const request: CaptureRequest={};
    source.dispatchEvent(new CustomEvent('chord-teacher-capture-audio',{detail:request}));
    const capture=request.capture;
    const recorder=new ReaderVideoRecorder<TeacherVideoFrame>();
    const session=capture?{capture,recorder}:null;
    try{
      if(!session)throw request.error??new Error('The piano is still loading. Try again in a moment.');
      active.current=session;
      await session.capture.ready;
      if(active.current!==session)return;
      recorder.begin(()=>voicing.current,session.capture.stream,()=>{
        if(active.current!==session)return;
        active.current=null;
        session.capture.release();
        setPhase('idle');
        setNotice('Recording stopped unexpectedly. Try again.');
      },drawTeacherVideo);
      setSeconds(0);
      setPhase('recording');
    }catch(error){
      if(session&&active.current===session){
        active.current=null;
        session.capture.release();
      }
      if(mounted.current){
        setPhase('idle');
        setNotice(error instanceof Error?error.message:'Recording could not start.');
      }
    }finally{
      busy.current=false;
    }
  }

  async function stop(){
    const session=active.current;
    if(!session?.recorder.active||busy.current)return;
    busy.current=true;
    setPhase('finishing');
    try{
      const blob=await session.recorder.finish();
      if(!mounted.current||active.current!==session)return;
      const name=`faithful-keys-performance-${new Date().toISOString().replace(/[:.]/g,'-')}.${readerVideoExtension(blob.type)}`;
      const file=new File([blob],name,{type:blob.type.split(';')[0]});
      setTake({file,url:URL.createObjectURL(file)});
      setCanShare(navigator.canShare?.({files:[file]})??false);
      setNotice('Video ready to download.');
    }catch(error){
      if(mounted.current)setNotice(error instanceof Error?error.message:'The video could not be saved.');
    }finally{
      if(active.current===session){
        active.current=null;
        session.capture.release();
      }
      busy.current=false;
      if(mounted.current)setPhase('idle');
    }
  }

  async function share(){
    if(!take)return;
    try{await navigator.share({files:[take.file]});}
    catch(error){
      if(!(error instanceof DOMException&&error.name==='AbortError'))setNotice('Sharing is unavailable. Download the video to send it.');
    }
  }

  return <div className="teacher-recording">
    {phase==='recording'
      ? <button type="button" className="teacher-stop-recording" onClick={()=>void stop()}>
        Stop recording <span aria-hidden="true">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>
      </button>
      : <button type="button" disabled={!source||phase!=='idle'} onClick={()=>void start()}>
        {phase==='starting'?'Starting…':phase==='finishing'?'Preparing video…':'Record video'}
      </button>}
    {take&&phase==='idle'&&<>
      <a href={take.url} download={take.file.name}>Download video</a>
      {canShare&&<button type="button" onClick={()=>void share()}>Share video</button>}
    </>}
    <span className="teacher-recording-status" role="status">{notice}</span>
  </div>;
}
