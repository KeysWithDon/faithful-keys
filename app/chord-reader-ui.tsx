'use client';
import { useState } from 'react';
import { useMidi } from './midi/ui';
import { identifyChord, READER_NOTES } from './chord-reader';
import './chord-reader.css';

export default function ChordReader({playNotes}:{playNotes:(notes:number[])=>void}) {
  const midi=useMidi();
  const [screenNotes,setScreenNotes]=useState<number[]>([]);
  const input=midi.inputMode==='screen'?screenNotes:midi.inputMode==='midi'?midi.active:[...midi.active,...screenNotes];
  const result=identifyChord(input);
  const label=result.matches[0]??(result.notes.length===0?'Play a chord':new Set(result.notes.map(n=>n%12)).size===1?'Add more notes':'Unrecognized cluster');
  function toggle(note:number){
    setScreenNotes(notes=>notes.includes(note)?notes.filter(n=>n!==note):[...notes,note]);
    if(!screenNotes.includes(note))playNotes([note]);
  }
  return <section className="chord-reader" aria-labelledby="chord-reader-title">
    <header className="reader-heading"><p>LIVE MIDI TOOL</p><h1 id="chord-reader-title">Chord Reader</h1><p>Play a group of notes on your connected keyboard to identify the chord. No lessons or exercises required.</p></header>
    <div className="reader-result" role="status" aria-live="polite" aria-atomic="true">
      <small>{result.matches.length?'CHORD DETECTED':'LISTENING'}</small><h2>{label}</h2>
      <p>{result.notes.length?result.notes.map(n=>`${READER_NOTES[n%12]}${Math.floor(n/12)-1}`).join(' · '):'Waiting for notes…'}</p>
      {result.matches.length>1&&<p className="reader-alternatives">Also possible: {result.matches.slice(1,4).join(' · ')}</p>}
      {result.notes.length>1&&!result.matches.length&&<p>This combination does not match a supported chord yet.</p>}
    </div>
    <p className="reader-status">MIDI: {midi.status} · {result.notes.length} active {result.notes.length===1?'note':'notes'}. Use MIDI Setup above to connect your keyboard.</p>
    <div className="reader-screen"><div className="reader-screen-heading"><h2>On-screen keyboard</h2><button type="button" onClick={()=>setScreenNotes([])}>Clear selected notes</button></div>
      <p>Tap notes to build a chord; tap again to release. MIDI chords follow the keys you hold. A slash shows the bass note of an inversion.</p>
      {midi.inputMode==='midi'&&<p>Choose Auto or Screen in MIDI Setup to use this keyboard.</p>}
      <div className="reader-keyboard" role="group" aria-label="Select notes for chord identification">
        {Array.from({length:36},(_,i)=>i+48).map(note=><button type="button" key={note} disabled={midi.inputMode==='midi'} className={`${[1,3,6,8,10].includes(note%12)?'reader-black':'reader-white'} ${result.notes.includes(note)?'reader-key-active':''}`} aria-label={`${READER_NOTES[note%12]}${Math.floor(note/12)-1}`} aria-pressed={result.notes.includes(note)} onClick={()=>toggle(note)}><span>{READER_NOTES[note%12]}<small>{Math.floor(note/12)-1}</small></span></button>)}
      </div>
    </div>
  </section>;
}
