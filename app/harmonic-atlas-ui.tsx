'use client';
import {useEffect,useRef} from 'react';
import {midiManager} from './midi/manager';

/**
 * Embedded, isolated Live Harmonic Mirror.
 * Existing Faithful Keys MIDI devices (including its Bluetooth bridge) feed
 * the mirror without replacing or changing the other learning features.
 */
export default function HarmonicAtlas(){
  const iframe=useRef<HTMLIFrameElement>(null);
  const publish=()=>{
    const target=iframe.current?.contentWindow;
    if(!target||typeof window==='undefined')return;
    const state=midiManager.getSnapshot();
    const sounds=midiManager.getSoundingNotes();
    const pressed=new Set(state.pressed);
    const sustained=new Set(state.sustained);
    const notes=state.active.map(note=>{
      const source=sounds.find(e=>e.note===note);
      return {note,velocity:Math.max(1,Math.min(127,Math.round((source?.velocity??.7)*127))),sustained:sustained.has(note)&&!pressed.has(note)};
    });
    target.postMessage({type:'faithful-keys-midi-bridge',connected:state.status==='Connected',notes},window.location.origin);
  };
  useEffect(()=>{
    const unsubscribe=midiManager.subscribe(publish);
    publish();
    return unsubscribe;
  },[]);
  return (
    <section aria-label="Harmonic Atlas — live geometric harmony visualization" style={{width:'100%',background:'#07121b',minHeight:'calc(100dvh - 64px)'}}>
      <iframe
        ref={iframe}
        onLoad={publish}
        title="Harmonic Mirror — live notes, chords, voice movements and 88-note MIDI display"
        src="./harmonic-atlas.html"
        allow="midi; autoplay"
        style={{display:'block',width:'100%',height:'calc(100dvh - 64px)',minHeight:540,border:0,background:'#07121b'}}
      />
    </section>
  );
}
