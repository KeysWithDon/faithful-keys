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
  return <label className={'midi-output-selector '+className}>MIDI output / sound destination
    <select aria-label="Playback sound" value={midi.selectedOutput} onChange={event=>midiManager.selectOutput(event.target.value)}>
      <option value="">Browser audio (no MIDI output)</option>
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
      title="Connect MIDI input and output devices"
    >
      MIDI Setup · {midi.status}
    </button>
    {open && typeof document !== 'undefined' && createPortal(<section id="faithful-keys-midi-panel" className="midi-panel" aria-label="MIDI keyboard setup">
      <div className="midi-panel-heading">
        <h2>MIDI input and output</h2>
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
        MIDI input · play from
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
        <label className="midi-thru-toggle">
          <input type="checkbox" checked={midi.liveThru}
            disabled={!midi.selected||!midi.selectedOutput||midi.selected===midi.selectedOutput}
            onChange={event=>midiManager.setLiveThru(event.target.checked)}/>
          <span>Send live keyboard notes to MIDI output</span>
        </label>
        <p className="midi-help">Route your selected input (for example Longeye via USB) to a different MIDI output (for example Mac Bluetooth MIDI connected to Pocket Gospel on iPhone). Your phone produces the sound; MIDI does not carry audio. Notes and velocity are forwarded in real time. The sustain pedal locks the current chord in Faithful Keys without sustaining sound on Pocket Gospel.</p>
        <label className="midi-field">Destination MIDI receive channel
          <select aria-label="Keyboard receive channel" value={midi.outputChannel} onChange={event=>midiManager.setOutputChannel(Number(event.target.value))}>
            {Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
          </select>
        </label>
        <p className="midi-output-route" role="status">{midi.liveThru&&midi.selectedOutput&&midi.selected
          ? `${midi.inputs.find(input=>input.id===midi.selected)?.name??'Input disconnected'} → ${midi.outputs.find(port=>port.id===midi.selectedOutput)?.name??'Output disconnected'} · channel ${midi.outputChannel} · Live MIDI forwarding enabled`
          : midi.selectedOutput
          ? `Chord previews → ${midi.outputs.find(port=>port.id===midi.selectedOutput)?.name??'disconnected device'} · channel ${midi.outputChannel}. Enable live forwarding above to hear your playing there.`
          : 'Browser audio for chord previews. Choose a MIDI output to use another instrument or phone app.'}</p>
        <p className="midi-help">Choose two different devices to avoid a MIDI loop. The destination must already be connected in macOS Audio MIDI Setup or another supported MIDI service. Select its receiving channel. If you only want lesson chord previews, leave live forwarding off.</p>
        {!midi.outputs.length&&<p className="midi-help">Connect both MIDI devices using “Find paired / USB MIDI keyboards” above, after pairing the destination with macOS.</p>}
        {midi.outputMessage&&<p className="midi-help" role="status">{midi.outputMessage}</p>}
        <div className="midi-output-actions"><button type="button" disabled={!midi.selectedOutput||midi.outputPlaying||!midi.outputs.some(port=>port.id===midi.selectedOutput)} onClick={()=>void midiManager.sendTestChord()}>Send test chord</button>
        <button type="button" disabled={!midi.selectedOutput} onClick={()=>void midiManager.silenceOutput()}>Stop all MIDI notes</button></div>
      </div>
      <p className="midi-notes">Pressed notes: {midi.pressed.join(', ') || 'None'} · Pedal: {midi.sustain?'pressed':'released'} (chord lock)</p>
      <p className="midi-notes">Last locked chord: {midi.sustainChord.join(', ') || 'None yet'} · Press the sustain pedal while holding a chord to capture its notes. The notes remain shown when the pedal is released.</p>
      <div className="midi-actions">
        {midi.enabled && <button type="button" onClick={() => midiManager.disable()}>Disconnect MIDI</button>}
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </section>, document.body)}
  </div>;
}
