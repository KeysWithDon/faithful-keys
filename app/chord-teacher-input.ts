import {exactMatch,exactNotes} from './ear-first-engine.ts';

/** One physical chord change can confirm one prompt, once. */
export class ChordPromptInput {
  private observed = '';
  private confirmed: string | null = null;

  reset(pressed: readonly number[]) {
    this.observed = exactNotes(pressed).join(',');
    this.confirmed = null;
  }

  observe(prompt: string, expected: readonly number[], pressed: readonly number[], eligible = true) {
    // Do not consume a person's first answer while a demonstration finishes.
    if (!eligible) return {changed: false, accepted: false};
    const notes = exactNotes(pressed), signature = notes.join(',');
    if (signature === this.observed) return {changed: false, accepted: false};
    this.observed = signature;
    if (this.confirmed === prompt || !notes.length || !exactMatch(notes, expected))
      return {changed: true, accepted: false};
    this.confirmed = prompt;
    return {changed: true, accepted: true};
  }
}
