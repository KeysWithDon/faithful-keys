export type NoteEvent = { type: 'on' | 'off' | 'panic'; note: number; pitchClass: number; octave: number; velocity: number; channel: number; at: number; duration?: number };
export function parseMidi(data: ArrayLike<number> | null, at = 0): NoteEvent | null {
  if (!data || data.length !== 3 || !Array.from(data).every(n => Number.isInteger(n) && n >= 0 && n <= 255) || data[1] > 127 || data[2] > 127) return null;
  const command = data[0] & 0xf0, channel = data[0] & 0x0f;
  if (command === 0xb0 && (data[1] === 120 || data[1] === 123)) return {type:'panic',note:0,pitchClass:0,octave:0,velocity:0,channel,at};
  if (command !== 0x80 && command !== 0x90) return null;
  const note = data[1];
  return { type: command === 0x90 && data[2] > 0 ? 'on' : 'off', note, pitchClass: note % 12, octave: Math.floor(note/12)-1, velocity: data[2]/127, channel, at };
}
export const pitchClasses = (notes: number[]) => [...new Set(notes.map(n => ((n%12)+12)%12))].sort((a,b)=>a-b);
export function matchChord(notes: number[], expected: number[], bass?: number) {
  return notes.length > 0 && JSON.stringify(pitchClasses(notes)) === JSON.stringify(pitchClasses(expected)) && (bass === undefined || Math.min(...notes)%12 === bass%12);
}
export function matchInterval(notes: number[], semitones: number, directed = false) {
  return notes.length === 2 && (directed ? notes[1]-notes[0] : Math.abs(notes[1]-notes[0])) === semitones;
}
export function sequenceStep(expected: number[], played: number[], octaveIndependent = false) {
  const same = (a: number,b: number) => octaveIndependent ? a%12 === b%12 : a===b;
  const wrong = played.findIndex((n,i)=>i>=expected.length || !same(n,expected[i]));
  return { correct: wrong === -1, complete: wrong === -1 && played.length === expected.length, index: wrong === -1 ? played.length : wrong };
}
export function voiceMovement(previous: number[], next: number[]) {
  if (previous.length !== next.length || !next.length) return Infinity;
  const a=[...previous].sort((x,y)=>x-y), b=[...next].sort((x,y)=>x-y);
  return a.reduce((sum,n,i)=>sum+Math.abs(n-b[i]),0);
}
