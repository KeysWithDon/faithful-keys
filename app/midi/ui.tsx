'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { midiManager } from './manager';
import './midi-setup.css';

const initial = midiManager.getSnapshot();
export function useMidi() {
  return useSyncExternalStore(midiManager.subscribe, midiManager.getSnapshot, () => initial);
}

export function MidiOutputSelector({className=''}:{className?:string}){
  const midi=useMidi();
  return <label className={'midi-output-selector '+className}>Playback sound
    <select aria-label="Playback sound" value={midi.selectedOutput} onChange={event=>midiManager.selectOutput(event.target.value)}>
      <option value="">Browser audio (computer)</option>
      {midi.selectedOutput&&!midi.outputs.some(port=>port.id===midi.selectedOutput)&&<option value={midi.selectedOutput}>Keyboard disconnected</option>}
      {midi.outputs.map(port=><option key={port.id} value={port.id}>{port.name}</option>)}
    </select>
  </label>;
}

export function MidiSetup() {
  const midi = useMidi();
  const [open, setOpen] = useState(false);
  useEffect(() => { midiManager.restore(); }, []);
  const webMidiAvailable = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  const searching = midi.bluetoothStatus === 'Scanning';

  return <div className="midi-setup">
    <button
      type="button"
      onClick={() => setOpen(value => !value)}
      aria-expanded={open}
      aria-controls="faithful-keys-midi-panel"
      title="Connect a USB or Bluetooth MIDI keyboard"
    >
      MIDI Setup · {midi.status}
    </button>
    {open && typeof document !== 'undefined' && createPortal(<section id="faithful-keys-midi-panel" className="midi-panel" aria-label="MIDI keyboard setup">
      <div className="midi-panel-heading">
        <h2>Connect a MIDI keyboard</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close MIDI setup">×</button>
      </div>
      <p className="midi-connection-status" role="status">{midi.status}</p>

      <div className="midi-connection-option">
        <strong>Bluetooth MIDI nearby</strong>
        <p>Turn on your wireless keyboard and put it in Bluetooth MIDI pairing mode. Choose it from the device list that appears.</p>
        <button
          type="button"
          onClick={() => void midiManager.findBluetooth()}
          disabled={searching || midi.bluetoothStatus === 'Unavailable'}
        >
          {searching ? 'Searching for keyboards…' : 'Find Bluetooth MIDI devices'}
        </button>
        {midi.bluetoothMessage && <p className="midi-help" role="status">{midi.bluetoothMessage}</p>}
        {midi.bluetoothCanSend&&<button type="button" onClick={()=>{
          const port=midi.outputs.find(output=>output.id.startsWith('bluetooth:'));
          if(port)midiManager.selectOutput(port.id);
        }}>Use Bluetooth for playback</button>}
        {midi.bluetoothStatus === 'Unavailable' && <p className="midi-help">
          iPhone and iPad Safari do not support direct website Bluetooth scanning.
          Try Chrome or Edge on a compatible computer or Android device instead.
        </p>}
      </div>

      <div className="midi-connection-option">
        <strong>USB or already-paired Bluetooth</strong>
        <p>See MIDI keyboards your computer already recognizes. For Bluetooth, pair your keyboard in your operating system first.</p>
        <button
          type="button"
          onClick={() => void midiManager.connect()}
          disabled={!webMidiAvailable}
        >
          Find paired / USB MIDI keyboards
        </button>
        {!webMidiAvailable && <p className="midi-help">This browser does not provide Web MIDI input access.</p>}
      </div>

      <label className="midi-field">
        Connected input
        <select value={midi.selected} onChange={e => midiManager.select(e.target.value)}>
          <option value="">Choose input</option>
          {midi.inputs.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
        </select>
      </label>
      <label className="midi-field">
        Answer with
        <select value={midi.inputMode} onChange={e => midiManager.setMode(e.target.value as typeof midi.inputMode)}>
          <option value="auto">Auto (keyboard or screen)</option>
          <option value="screen">On-screen piano</option>
          <option value="midi">MIDI keyboard</option>
        </select>
      </label>
      <div className="midi-output-settings">
        <MidiOutputSelector/>
        <label className="midi-field">Keyboard receive channel
          <select aria-label="Keyboard receive channel" value={midi.outputChannel} onChange={event=>midiManager.setOutputChannel(Number(event.target.value))}>
            {Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
          </select>
        </label>
        <p className="midi-output-route" role="status">{midi.selectedOutput?`Sending MIDI to ${midi.outputs.find(port=>port.id===midi.selectedOutput)?.name??'disconnected keyboard'} · channel ${midi.outputChannel}`:'Sound plays on this computer. Choose your keyboard or Bluetooth adapter here to trigger the piano.'}</p>
        <p className="midi-help">Choose the output connected to the piano’s MIDI IN and match its receive channel. Select the instrument sound on the piano itself. Direct Bluetooth MIDI and computer MIDI outputs are listed separately.</p>
        {!midi.outputs.length&&<p className="midi-help">Connect with “Find Bluetooth MIDI devices” or “Find paired / USB MIDI keyboards” above.</p>}
        {midi.outputMessage&&<p className="midi-help" role="status">{midi.outputMessage}</p>}
        <div className="midi-output-actions"><button type="button" disabled={!midi.selectedOutput||midi.outputPlaying||!midi.outputs.some(port=>port.id===midi.selectedOutput)} onClick={()=>void midiManager.sendTestChord()}>Send test chord</button>
        <button type="button" disabled={!midi.selectedOutput} onClick={()=>void midiManager.silenceOutput()}>Stop keyboard notes</button></div>
      </div>
      <p className="midi-notes">Pressed notes: {midi.pressed.join(', ') || 'None'} · Sustain {midi.sustain?'on':'off'}{midi.sustained.length?` · Pedal-held: ${midi.sustained.join(', ')}`:''}</p>
      <div className="midi-actions">
        {midi.enabled && <button type="button" onClick={() => midiManager.disable()}>Disconnect MIDI</button>}
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </section>, document.body)}
  </div>;
}
