'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { midiManager } from './manager';
import './midi-setup.css';

const initial = midiManager.getSnapshot();
export function useMidi() {
  return useSyncExternalStore(midiManager.subscribe, midiManager.getSnapshot, () => initial);
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
      <p className="midi-notes">Pressed notes: {midi.active.join(', ') || 'None'}</p>
      <div className="midi-actions">
        {midi.enabled && <button type="button" onClick={() => midiManager.disable()}>Disconnect MIDI</button>}
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </section>, document.body)}
  </div>;
}
