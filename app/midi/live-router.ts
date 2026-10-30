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
  private sustain = false;

  constructor(private onError: (message: string) => void = () => {}) {}

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

  /** Accept channel-voice note-on/off, sustain, and panic. Never pass patch changes. */
  forward(data: ArrayLike<number> | null) {
    if (!this.port || this.port.state !== 'connected' || !data || data.length < 3) return;
    const status = data[0], note = data[1], value = data[2];
    if (![status, note, value].every(value => Number.isInteger(value)) ||
        status < 0x80 || status > 0xef || note < 0 || note > 127 || value < 0 || value > 127) return;
    const command = status & 0xf0;
    const ch = this.channel - 1;
    if (command === 0x90 && value > 0) {
      const key = (status & 0x0f) + ':' + note;
      if (!this.held.has(key)) {
        this.held.add(key);
        this.noteCounts.set(note, (this.noteCounts.get(note) ?? 0) + 1);
      }
      this.send([0x90 | ch, note, value]);
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
      if (note === 64) {
        this.sustain = value >= 64;
        this.send([0xb0 | ch, 64, value]);
      } else if (note === 120 || note === 121 || note === 123) {
        this.stop();
      }
    }
  }

  /** Release notes/pedal when either device or routing selection changes. */
  stop() {
    const hadNotes = this.noteCounts.size > 0 || this.sustain;
    if (hadNotes && this.port?.state === 'connected') {
      try { this.port.clear?.(); } catch { /* Some drivers cannot clear scheduled events. */ }
      const ch = this.channel - 1;
      this.send([0xb0 | ch, 64, 0]);
      for (const note of this.noteCounts.keys()) this.send([0x80 | ch, note, 0]);
      this.send([0xb0 | ch, 123, 0]);
    }
    this.held.clear();
    this.noteCounts.clear();
    this.sustain = false;
  }
}
