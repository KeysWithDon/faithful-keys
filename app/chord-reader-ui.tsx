'use client';
import { useState } from 'react';
import { useMidi } from './midi/ui';
import { identifyChord } from './chord-reader';
import { parseChordRoot } from './music-theory';
import { readerKeyboardRange, readerWrittenNote } from './chord-reader-notation';
import './chord-reader.css';

function ChordStaff({notes,chord}:{notes:number[];chord?:string}) {
  const written=notes.map(note=>readerWrittenNote(note,chord));
  const top=Math.min(20,...written.map(note=>note.y-24));
  const bottom=Math.max(190,...written.map(note=>note.y+24));
  return <svg className="reader-staff" viewBox={`0 ${top} 480 ${bottom-top}`} role="img" aria-label={written.length?`Chord staff: ${written.map(n=>n.name+n.octave).join(', ')}`:'Empty treble and bass staff. Listening for notes.'}>
    <title>Chord staff</title>
    {[48,60,72,84,96,120,132,144,156,168].map(y=><line className="reader-staff-line" key={y} x1="38" x2="450" y1={y} y2={y}/>)}
    <path className="reader-staff-line" d="M38 48V168 M450 48V168"/>
    <text className="reader-clef" x="48" y="89">𝄞</text><text className="reader-clef reader-bass-clef" x="48" y="157">𝄢</text>
    {written.map((note,index)=>{
      // Adjacent staff positions share a column only when noteheads do not collide.
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
  </svg>;
}

export default function ChordReader({playNotes}:{playNotes:(notes:number[])=>void}) {
  const midi=useMidi();
  const [screenNotes,setScreenNotes]=useState<number[]>([]);
  const input=midi.inputMode==='screen'?screenNotes:midi.inputMode==='midi'?midi.active:[...midi.active,...screenNotes];
  const result=identifyChord(input);
  const chord=result.matches[0];
  const label=chord??(result.notes.length===0?'Listening for notes':new Set(result.notes.map(n=>n%12)).size===1?'Single note':'Unrecognized cluster');
  const written=result.notes.map(n=>readerWrittenNote(n,chord));
  const root=chord?parseChordRoot(chord).root.pitchClass:result.notes[0]%12;
  const spelling=[...new Map(written.map(n=>[n.midi%12,n])).values()].sort((a,b)=>(a.midi-root+120)%12-(b.midi-root+120)%12);
  const keys=readerKeyboardRange(result.notes);
  const whites=keys.filter(n=>![1,3,6,8,10].includes(n%12));
  const blacks=keys.filter(n=>[1,3,6,8,10].includes(n%12));
  function toggle(note:number){
    setScreenNotes(notes=>notes.includes(note)?notes.filter(n=>n!==note):[...notes,note]);
    if(!screenNotes.includes(note))playNotes([note]);
  }
  function pianoKey(note:number,black=false){
    const active=result.notes.includes(note);
    const name=readerWrittenNote(note,active?chord:undefined);
    const nextWhite=whites.findIndex(n=>n>note);
    return <button type="button" key={note} disabled={midi.inputMode==='midi'} className={`${black?'reader-black':'reader-white'} ${active?'reader-key-active':''}`} style={black?{left:`${nextWhite/whites.length*100}%`,width:`${66/whites.length}%`}:undefined} aria-label={`${name.name}${name.octave}`} aria-pressed={active} onClick={()=>toggle(note)}><span>{name.name}<small>{name.octave}</small></span></button>;
  }
  return <section className="chord-reader" aria-labelledby="chord-reader-title">
    <header className="reader-heading"><p>LIVE MIDI TOOL</p><h1 id="chord-reader-title">Chord Reader</h1></header>
    <div className="reader-result" role="status" aria-live="polite" aria-atomic="true">
      <small>{chord?'CHORD DETECTED':'LIVE INPUT'}</small><h2 className={!result.notes.length?'reader-idle':undefined}>{label}</h2>
      {result.matches.length>1&&<p className="reader-alternatives">Also possible: {result.matches.slice(1,4).join(' · ')}</p>}
    </div>
    <div className="reader-views">
      <section className="reader-view"><h2>Chord staff</h2><ChordStaff notes={result.notes} chord={chord}/></section>
      <section className="reader-view reader-spelling"><h2>Chord spelling</h2><div className="reader-spelling-notes" aria-live="polite">{spelling.length?spelling.map(n=><span key={n.midi%12}>{n.name}</span>):<p>—</p>}</div><h3>Notes played</h3><p>{written.length?written.map(n=>n.name+n.octave).join(' · '):'—'}</p>{written.length>0&&<p className="reader-bass-note">Bass: {written[0].name}{written[0].octave}</p>}</section>
    </div>
    <section className="reader-screen"><div className="reader-screen-heading"><h2>Keyboard view</h2><button type="button" onClick={()=>setScreenNotes([])}>Clear selected notes</button></div>
      <div className="reader-keyboard-scroll"><div className="reader-keyboard" style={{minWidth:Math.max(540,whites.length*26)}} role="group" aria-label="Piano keyboard for chord identification">
        <div className="reader-white-keys">{whites.map(note=>pianoKey(note))}</div>{blacks.map(note=>pianoKey(note,true))}
      </div></div>
      <p>Connected MIDI notes highlight automatically. Tap on-screen keys to select or release notes.</p>
      {midi.inputMode==='midi'&&<p>Choose Auto or Screen in MIDI Setup to use the on-screen keys.</p>}
    </section>
    <p className="reader-status">MIDI: {midi.status} · {result.notes.length} active {result.notes.length===1?'note':'notes'}. Connect your keyboard using MIDI Setup above.</p>
  </section>;
}
