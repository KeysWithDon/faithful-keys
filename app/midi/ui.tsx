'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { midiManager } from './manager';
const initial = midiManager.getSnapshot();
export function useMidi() { return useSyncExternalStore(midiManager.subscribe,midiManager.getSnapshot,()=>initial); }
export function MidiSetup() {
  const midi=useMidi(); const [open,setOpen]=useState(false);
  useEffect(()=>{midiManager.restore();},[]);
  return <div className="midi-setup"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>MIDI Setup · {midi.status}</button>{open && <section className="midi-panel" aria-label="MIDI keyboard setup">
    <h2>MIDI keyboard</h2><p role="status">{midi.status}</p>
    <p>USB keyboards and operating-system-paired Bluetooth MIDI devices appear here when your browser exposes them. No MIDI? Every lesson also works onscreen.</p>
    <button type="button" onClick={()=>void midiManager.connect()} disabled={midi.status==='Browser Does Not Support MIDI'}>Connect MIDI keyboard</button>
    {midi.enabled && <button type="button" onClick={()=>midiManager.disable()}>Disable MIDI</button>}
    <label>Device<select value={midi.selected} onChange={e=>midiManager.select(e.target.value)}><option value="">Choose input</option>{midi.inputs.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label>Answer with<select value={midi.inputMode} onChange={e=>midiManager.setMode(e.target.value as typeof midi.inputMode)}><option value="auto">Auto</option><option value="screen">Screen</option><option value="midi">MIDI</option></select></label>
    <p>Pressed notes: {midi.active.join(', ') || 'None'}. Bluetooth pairing is managed by your device, not this page.</p>
    <button type="button" onClick={()=>setOpen(false)}>Done</button>
  </section>}</div>;
}
