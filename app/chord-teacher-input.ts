import {exactMatch,exactNotes} from './ear-first-engine.ts';
import type {NoteEvent} from './midi/parser.ts';

const TOUCH_WINDOW_MS = 200;

/** One physical chord change can confirm one prompt, once. */
export class ChordPromptInput {
  private observed = '';
  private confirmed: string | null = null;
  private touchPrompt: string | null = null;
  private touches = new Map<number,number>();
  private lastTouch = -Infinity;

  reset(pressed: readonly number[]) {
    this.observed = exactNotes(pressed).join(',');
    this.confirmed = null;
    this.touchPrompt = null;this.touches.clear();this.lastTouch = -Infinity;
  }

  observe(prompt: string, expected: readonly number[], pressed: readonly number[], eligible = true, event?: NoteEvent) {
    // Do not consume input before the prompt is ready.
    if (!eligible) return {changed: false, accepted: false};
    if (this.touchPrompt !== prompt) {this.touchPrompt = prompt;this.touches.clear();this.lastTouch = -Infinity;}
    const at = event?.at ?? performance.now();
    if (at < this.lastTouch) this.touches.clear();
    for (const [note,time] of this.touches) if (at-time > TOUCH_WINDOW_MS) this.touches.delete(note);
    if (event?.type === 'on' && event.velocity > 0) {
      if (!expected.includes(event.note)) this.touches.clear();
      else this.touches.set(event.note,at);
      this.lastTouch = at;
    }
    const notes = exactNotes(pressed), signature = notes.join(',');
    if (signature === this.observed) return {changed: false, accepted: false};
    this.observed = signature;
    // Brief rolled touches are a chord response, even if a softly tapped key
    // releases before the last voice arrives. This never changes the live display.
    const touchedChord = event?.type === 'on' && event.velocity > 0 &&
      exactMatch([...notes,...this.touches.keys()],expected);
    if (this.confirmed === prompt || !notes.length || (!exactMatch(notes, expected) && !touchedChord))
      return {changed: true, accepted: false};
    this.confirmed = prompt;
    this.touches.clear();
    return {changed: true, accepted: true};
  }
}
