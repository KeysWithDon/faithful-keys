import { parseMidi, type NoteEvent } from './parser.ts';
import { requestBluetoothMidi, webBluetoothMidiSupported, type BleMidiConnection } from './bluetooth.ts';

export type MidiStatus =
  | 'Permission Required' | 'Connected' | 'No Device Found'
  | 'Device Disconnected' | 'Browser Does Not Support MIDI'
  | 'Permission Denied' | 'Disabled';
export type BluetoothStatus = 'Ready' | 'Scanning' | 'Connected' | 'Disconnected' | 'Unavailable' | 'Error';
export type MidiSnapshot = {
  status: MidiStatus;
  inputs: {id: string; name: string}[];
  selected: string;
  active: number[];
  enabled: boolean;
  inputMode: 'auto' | 'screen' | 'midi';
  bluetoothStatus: BluetoothStatus;
  bluetoothMessage: string;
};

export class MidiManager {
  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private bluetooth: BleMidiConnection | null = null;
  private held = new Map<string, NoteEvent>();
  private listeners = new Set<() => void>();
  private notes = new Set<(event: NoteEvent) => void>();
  private generation = 0;
  private bluetoothGeneration = 0;
  private snapshot: MidiSnapshot = {
    status: 'Permission Required', inputs: [], selected: '', active: [],
    enabled: false, inputMode: 'auto', bluetoothStatus: 'Ready', bluetoothMessage: '',
  };

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  onNote = (listener: (event: NoteEvent) => void) => {
    this.notes.add(listener);
    return () => { this.notes.delete(listener); };
  };
  private publish(patch: Partial<MidiSnapshot>) {
    this.snapshot = {...this.snapshot, ...patch};
    this.listeners.forEach(f => f());
  }
  private preferences() {
    try {
      localStorage.setItem('faithful-keys-midi-v1', JSON.stringify({
        selected: this.snapshot.selected,
        enabled: this.snapshot.enabled,
        inputMode: this.snapshot.inputMode,
      }));
    } catch { /* Device preferences are optional. */ }
  }
  restore() {
    try {
      const data = JSON.parse(localStorage.getItem('faithful-keys-midi-v1') ?? '{}');
      this.publish({
        selected: typeof data.selected === 'string' ? data.selected : '',
        inputMode: ['auto', 'screen', 'midi'].includes(data.inputMode) ? data.inputMode : 'auto',
      });
    } catch { /* Keep defaults. */ }
    const supportsBluetooth = webBluetoothMidiSupported();
    this.publish({
      bluetoothStatus: supportsBluetooth ? 'Ready' : 'Unavailable',
      bluetoothMessage: supportsBluetooth ? '' : 'Direct Bluetooth scanning is not available in this browser.',
    });
    if (!navigator.requestMIDIAccess && !supportsBluetooth)
      this.publish({status: 'Browser Does Not Support MIDI'});
    // Never request device permissions until a person clicks Connect or Find.
  }
  setMode(inputMode: MidiSnapshot['inputMode']) {
    this.publish({inputMode});
    this.preferences();
  }
  async connect(request = () => navigator.requestMIDIAccess({sysex: false})) {
    const generation = ++this.generation;
    try {
      const access = await request();
      if (generation !== this.generation) return;
      this.access = access;
      this.publish({enabled: true});
      access.onstatechange = () => this.refresh();
      this.refresh();
      this.preferences();
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({
        status: error instanceof Error && error.name === 'NotAllowedError'
          ? 'Permission Denied' : 'Browser Does Not Support MIDI',
        enabled: Boolean(this.bluetooth),
      });
    }
  }
  /** Opens a filtered, user-approved BLE-MIDI chooser (not a background scan). */
  async findBluetooth() {
    if (this.snapshot.bluetoothStatus === 'Scanning') return;
    if (!webBluetoothMidiSupported()) {
      this.publish({bluetoothStatus: 'Unavailable', bluetoothMessage: 'Use Chrome or Edge on a supported device for nearby Bluetooth scanning.'});
      return;
    }
    const generation = ++this.bluetoothGeneration;
    this.publish({bluetoothStatus: 'Scanning', bluetoothMessage: 'Select your BLE MIDI keyboard in the nearby device chooser.'});
    try {
      const connection = await requestBluetoothMidi(
        (data, at) => {
          // Prevent sound or scoring from a device the user did not select.
          if (this.bluetooth?.id === this.snapshot.selected) this.receive(data, at);
        },
        () => {
          if (!this.bluetooth) return;
          this.bluetooth = null;
          this.publish({bluetoothStatus: 'Disconnected', bluetoothMessage: 'Bluetooth keyboard disconnected. Turn it on and reconnect.'});
          this.refresh();
        },
      );
      if (generation !== this.bluetoothGeneration) {
        connection.disconnect();
        return;
      }
      this.bluetooth?.disconnect();
      this.bluetooth = connection;
      this.publish({
        enabled: true, bluetoothStatus: 'Connected',
        bluetoothMessage: connection.name + ' connected. Play a note to test it.',
      });
      this.refresh(connection.id);
      this.preferences();
    } catch (error) {
      if (generation !== this.bluetoothGeneration) return;
      const name = error instanceof Error ? error.name : '';
      const message = name === 'NotFoundError'
        ? 'No device selected. Make sure your keyboard is powered on and in pairing mode, then try again.'
        : name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Bluetooth permission was blocked. Allow Bluetooth access and retry.'
          : error instanceof Error
            ? error.message
            : 'Could not connect to the Bluetooth MIDI keyboard.';
      this.publish({
        bluetoothStatus: 'Error', bluetoothMessage: message,
        enabled: Boolean(this.access || this.bluetooth),
      });
    }
  }
  private clear() {
    this.held.clear();
    this.publish({active: []});
    this.notes.forEach(f => f({
      type: 'panic', note: 0, pitchClass: 0, octave: 0,
      velocity: 0, channel: 0, at: Date.now(),
    }));
  }
  select(id: string) {
    this.publish({selected: id});
    this.bind();
    this.preferences();
  }
  private refresh(preferred = '') {
    const inputs = Array.from(this.access?.inputs.values() ?? [])
      .filter(i => i.state === 'connected')
      .map(i => ({id: i.id, name: i.name ?? 'MIDI keyboard'}));
    if (this.bluetooth) inputs.push({id: this.bluetooth.id, name: this.bluetooth.name + ' (Bluetooth)'});
    const desired = preferred || this.snapshot.selected;
    const selected = inputs.some(i => i.id === desired) ? desired : (inputs[0]?.id ?? '');
    this.publish({inputs, selected});
    this.bind();
  }
  private bind() {
    if (this.bluetooth?.id === this.snapshot.selected) {
      if (this.input) this.input.onmidimessage = null;
      if (this.input) this.clear();
      this.input = null;
      this.publish({status: 'Connected'});
      return;
    }
    const next = this.access?.inputs.get(this.snapshot.selected) ?? null;
    if (this.input === next && next?.state === 'connected') return;
    if (this.input) this.input.onmidimessage = null;
    this.clear();
    this.input = next?.state === 'connected' ? next : null;
    if (this.input) {
      this.input.onmidimessage = e => this.receive(e.data, e.timeStamp);
      this.publish({status: 'Connected'});
    } else {
      this.publish({status: this.snapshot.selected ? 'Device Disconnected' : 'No Device Found'});
    }
  }
  receive(data: ArrayLike<number> | null, at: number) {
    const event = parseMidi(data, at);
    if (!event) return;
    const key = event.channel + ':' + event.note;
    if (event.type === 'panic') { this.clear(); return; }
    if (event.type === 'on') this.held.set(key, event);
    else {
      const start = this.held.get(key);
      event.duration = start ? Math.max(0, at - start.at) : 0;
      this.held.delete(key);
    }
    // Audio and evaluation listeners run before React render subscribers.
    this.notes.forEach(f => f(event));
    this.publish({active: [...new Set([...this.held.values()].map(e => e.note))]});
  }
  disable() {
    ++this.generation;
    ++this.bluetoothGeneration;
    if (this.input) this.input.onmidimessage = null;
    if (this.access) this.access.onstatechange = null;
    this.bluetooth?.disconnect();
    this.bluetooth = null;
    this.input = null;
    this.access = null;
    this.clear();
    this.publish({
      inputs: [], selected: '', enabled: false, status: 'Disabled',
      bluetoothStatus: webBluetoothMidiSupported() ? 'Ready' : 'Unavailable',
      bluetoothMessage: '',
    });
    this.preferences();
  }
}
export const midiManager = new MidiManager();
