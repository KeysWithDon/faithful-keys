/**
 * Explicit, low-latency MIDI Thru: forward live keyboard notes to a different
 * instrument (for example USB Longeye input -> macOS Bluetooth MIDI -> iPhone).
 * This sends MIDI messages, not an audio stream; the destination creates sound.
 */
export type LiveMidiPort = {
  id: string;
  state: 'connected' | 'disconnected';
  send(data: number[]): void | Promise<void>;
  clear?: () => void;
};

export class LiveMidiRouter {
  private port: LiveMidiPort | null = null;
  private channel = 1;
  private held = new Set<string>();
  private noteCounts = new Map<number, number>();

  private onError: (message: string) => void;

  constructor(onError: (message: string) => void = () => {}) { this.onError = onError; }

  configure(port: LiveMidiPort | null, channel: number) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 16)
      throw new Error('MIDI output channel must be between 1 and 16.');
    if (this.port === port && this.channel === channel) return;
    this.stop();
    this.port = port?.state === 'connected' ? port : null;
    this.channel = channel;
  }

  private send(data: number[]) {
    const port = this.port;
    if (!port || port.state !== 'connected') return;
    try {
      const result = port.send(data);
      if (result && typeof result.then === 'function')
        void result.catch(() => {
          if (this.port === port) this.onError('MIDI forwarding failed. Check the output connection and receive channel.');
        });
    } catch {
      if (this.port === port) this.onError('MIDI forwarding failed. Check the output connection and receive channel.');
    }
  }

  /** Forward physical note events. Sustain is an app-only chord-lock button, never MIDI sustain on the receiver. */
  forward(data: ArrayLike<number> | null) {
    if (!this.port || this.port.state !== 'connected' || !data || data.length < 3) return;
    const status = data[0], note = data[1], value = data[2];
    if (![status, note, value].every(value => Number.isInteger(value)) ||
        status < 0x80 || status > 0xef || note < 0 || note > 127 || value < 0 || value > 127) return;
    const command = status & 0xf0;
    const ch = this.channel - 1;
    if (command === 0x90 && value > 0) {
      const key = (status & 0x0f) + ':' + note;
      // Output channels collapse to one chosen receive channel: only trigger
      // the pitch once, even if several input channels report the same note.
      // That guarantees one matching note-off and avoids stuck voices.
      if (this.held.has(key)) return;
      this.held.add(key);
      const count = this.noteCounts.get(note) ?? 0;
      this.noteCounts.set(note, count + 1);
      if (count === 0) this.send([0x90 | ch, note, value]);
    } else if (command === 0x80 || (command === 0x90 && value === 0)) {
      const key = (status & 0x0f) + ':' + note;
      if (!this.held.delete(key)) return;
      const remaining = (this.noteCounts.get(note) ?? 1) - 1;
      if (remaining > 0) this.noteCounts.set(note, remaining);
      else {
        this.noteCounts.delete(note);
        this.send([0x80 | ch, note, 0]);
      }
    } else if (command === 0xb0) {
      // CC64 is reserved for chord capture in Faithful Keys.
      // Do not send pedal-down to Pocket Gospel: it would hold notes after key release.
      if (note === 120 || note === 121 || note === 123) {
        this.stop();
      }
    }
  }

  /** Release notes/pedal when either device or routing selection changes. */
  stop() {
    const hadNotes = this.noteCounts.size > 0;
    if (hadNotes && this.port?.state === 'connected') {
      try { this.port.clear?.(); } catch { /* Some drivers cannot clear scheduled events. */ }
      const ch = this.channel - 1;
      this.send([0xb0 | ch, 64, 0]);
      for (const note of this.noteCounts.keys()) this.send([0x80 | ch, note, 0]);
      this.send([0xb0 | ch, 123, 0]);
    }
    this.held.clear();
    this.noteCounts.clear();
  }
}
