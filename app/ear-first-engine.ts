/**
 * Faithful Keys — Ear-First Chord Teacher.
 * Pure note-accurate harmony and matching helpers; no legacy Harmonic Mirror logic.
 * All notes are absolute MIDI pitches, never pitch-class-only guesses.
 */
export type ResolutionMode = 'fixed' | 'varied';
export type Resolution = { chords: number[][]; count: number; mode: ResolutionMode };
export type VoicingRange = { min:number; max:number; maxHandSpan:number };
export const MAX_VOICES = 10;
const NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const mod = (n:number) => (n%12+12)%12;
export const pitchLabel = (midi:number) => NAMES[mod(midi)] + (Math.floor(midi/12)-1);

export function exactNotes(notes: readonly number[]): number[] {
  return [...new Set(notes.filter(n=>Number.isInteger(n) && n>=0 && n<=127))].sort((a,b)=>a-b);
}
export function exactMatch(played: readonly number[], expected: readonly number[]): boolean {
  const a=exactNotes(played), b=exactNotes(expected);
  return a.length===b.length && a.every((note,i)=>note===b[i]);
}
export function stationaryVoices(before: readonly number[], after: readonly number[]): number[] {
  const next=new Set(after);
  return exactNotes(before).filter(note=>next.has(note));
}
export function movedVoices(before: readonly number[], after: readonly number[]): {from:number;to:number;semitones:number}[] {
  const first=exactNotes(before), second=exactNotes(after);
  return first.slice(0,Math.min(first.length,second.length)).map((from,i)=>({from,to:second[i],semitones:second[i]-from}))
    .filter(item=>item.semitones!==0);
}

const PALETTES = {
  major: [0,2,4,7,11],
  minor: [0,2,3,7,10],
  dominant: [0,2,4,7,10],
  suspended: [0,2,5,7,10],
  sixnine: [0,2,4,7,9],
  altered: [0,1,4,6,10],
} as const;
type Palette = keyof typeof PALETTES;

/** Bass destinations are measured from the Home Chord bass, not from the last step. */
const PATHS: Record<number, number[][]> = {
  1: [[5],[7],[-5],[-2],[2],[1],[-7]],
  2: [[2,7],[-2,5],[7,5],[5,-2],[1,5],[-5,2],[7,-2]],
  3: [[2,7,5],[-2,2,7],[5,2,-2],[7,2,5],[1,5,7],[-5,-2,5]],
  4: [[2,5,7,5],[-2,2,7,5],[5,2,-2,7],[1,5,7,-2],[7,5,2,5],[-5,2,7,5]],
};

function makeVoicing(previous: number[], bass: number, palette: Palette, range?:VoicingRange): number[] {
  const allowed=new Set<number>(PALETTES[palette].map(interval=>mod(bass+interval)));
  if(range){
    const pitches=Array.from({length:range.max-range.min+1},(_,i)=>range.min+i).filter(note=>allowed.has(mod(note)));
    const split=Math.floor(previous.length/2);
    const maxHandSpan=range.maxHandSpan;
    type Choice={notes:number[];cost:number};
    const memo=new Map<string,Choice|null>();
    // Choose the smoothest complete voicing that both hands can reach. Looking
    // ahead keeps a close early voice from leaving no room for the later ones.
    function choose(index:number,last:number,handStart:number):Choice|null{
      if(index===previous.length)return {notes:[],cost:0};
      const key=[index,last,handStart].join(':');
      if(memo.has(key))return memo.get(key)!;
      let best:Choice|null=null;
      for(const note of pitches){
        if(note<=last)continue;
        const start=index===split?note:handStart;
        if(note-start>maxHandSpan)continue;
        const rest=choose(index+1,note,start);
        if(!rest)continue;
        const cost=rest.cost+Math.abs(note-previous[index])*2+(note===previous[index]?-3:0);
        if(!best||cost<best.cost)best={notes:[note,...rest.notes],cost};
      }
      memo.set(key,best);return best;
    }
    const upper=choose(1,bass,bass);
    if(!upper)throw new Error('This voicing does not fit the lesson’s playing range.');
    return [bass,...upper.notes];
  }
  const result=[bass];
  for(let i=1;i<previous.length;i++){
    const from=previous[i], lower=result[result.length-1]+1;
    const candidates:number[]=[];
    for(let n=21;n<=108;n++)if(n>=lower && allowed.has(mod(n)))candidates.push(n);
    // If an unusually high bass leaves fewer than ten available pitches, retain
    // all requested voices rather than silently dropping them.
    if(!candidates.length){ result.push(Math.min(127,Math.max(lower,from)));continue; }
    candidates.sort((a,b)=>{
      const cost=(n:number)=>Math.abs(n-from)*2+Math.abs(n-previous[Math.max(0,i-1)])*.04+(n===from?-3:0);
      return cost(a)-cost(b) || a-b;
    });
    result.push(candidates[0]);
  }
  return result;
}

export function generateResolution(homeInput:readonly number[], maxChords:1|2|3|4, mode:ResolutionMode, turn=0, range?:VoicingRange):Resolution {
  const home=exactNotes(homeInput);
  if(home.length<2 || home.length>MAX_VOICES)throw new Error('Play a Home Chord containing 2–10 different keys.');
  const count=mode==='fixed'?maxChords:1+(Math.abs(home.reduce((a,n)=>a*3+n,0)+turn)%maxChords);
  const options=PATHS[count];
  const seed=home.reduce((a,n)=>a+n*13,0)+turn*19;
  const offsets=options[mod(seed)%options.length];
  const choices:Palette[]=['minor','dominant','suspended','altered','major','sixnine'];
  let previous=home;
  const chords=[home];
  for(let i=0;i<count;i++){
    const isFinal=i===count-1;
    const palette:Palette=isFinal
      ? (turn%3===1?'minor':turn%3===2?'sixnine':'major')
      : choices[mod(seed+i*3)%4];
    // Generated listening lessons keep bass movement in a comfortable octave.
    // Supplied Home Chords retain their original pitches when no range is set.
    const fitBass=(note:number)=>range?range.min+mod(note-range.min):Math.max(21,Math.min(94,note));
    const bass=fitBass(home[0]+offsets[i]);
    let next=exactNotes(makeVoicing(previous,bass,palette,range));
    // Ensure every step genuinely changes, even from an exceptionally dense chord.
    if(exactMatch(next,previous)){
      next=exactNotes(makeVoicing(previous,range?fitBass(bass+1):bass+1,palette,range));
    }
    chords.push(next);
    previous=next;
  }
  return {chords,count,mode};
}
