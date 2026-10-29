/**
 * Faithful Keys — Ear-First Chord Teacher.
 * Pure note-accurate harmony and matching helpers; no legacy Harmonic Mirror logic.
 * All notes are absolute MIDI pitches, never pitch-class-only guesses.
 */
export type ResolutionMode = 'fixed' | 'varied';
export type Resolution = { chords: number[][]; count: number; mode: ResolutionMode };
export type VoicingRange = { min:number; max:number; bassMin:number; maxHandSpan:number };
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

function fitVoicing(previous:number[],bass:number,allowed:Set<number>,range:VoicingRange):number[]{
  // Only the bass may fall below the chord's register. Try its natural octave
  // first, raising it when a larger voicing otherwise exceeds two hands' reach.
  const pitches=Array.from({length:range.max-range.min+1},(_,i)=>range.min+i).filter(note=>allowed.has(mod(note)));
  const basses=Array.from({length:range.max-range.bassMin},(_,i)=>range.bassMin+i)
    .filter(note=>mod(note)===mod(bass)).sort((a,b)=>Math.abs(a-bass)-Math.abs(b-bass)||a-b);
  type Choice={notes:number[];cost:number};
  for(const low of basses){
    let best:Choice|null=null;
    // A low bass can use the left hand alone; larger chords may share the upper
    // voices across both hands, with at most five notes and an octave per hand.
    for(let split=Math.max(1,previous.length-5);split<=Math.min(5,previous.length-1);split++){
      const memo=new Map<string,Choice|null>();
      function choose(index:number,last:number,handStart:number):Choice|null{
        if(index===previous.length)return {notes:[],cost:0};
        const key=[index,last,handStart].join(':');
        if(memo.has(key))return memo.get(key)!;
        let choice:Choice|null=null;
        for(const note of pitches){
          if(note<=last)continue;
          const start=index===split?note:handStart;
          if(note-start>range.maxHandSpan)continue;
          const rest=choose(index+1,note,start);
          if(!rest)continue;
          const cost=rest.cost+Math.abs(note-previous[index])*2+(note===previous[index]?-3:0);
          if(!choice||cost<choice.cost)choice={notes:[note,...rest.notes],cost};
        }
        memo.set(key,choice);return choice;
      }
      const upper=choose(1,low,low);
      if(upper&&(!best||upper.cost<best.cost))best=upper;
    }
    if(best)return [low,...best.notes];
  }
  throw new Error('This voicing does not fit the lesson’s playing range.');
}

function makeVoicing(previous: number[], bass: number, palette: Palette, range?:VoicingRange): number[] {
  const allowed=new Set<number>(PALETTES[palette].map(interval=>mod(bass+interval)));
  if(range)return fitVoicing(previous,bass,allowed,range);
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
  const input=exactNotes(homeInput);
  if(input.length<2 || input.length>MAX_VOICES)throw new Error('Play a Home Chord containing 2–10 different keys.');
  const home=range?fitVoicing(input,input[0],new Set(input.map(mod)),range):input;
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
    // Bass follows its own lower register; chord tones keep their higher floor.
    // Supplied Home Chords retain their original pitches when no range is set.
    const bass=range?input[0]+offsets[i]:Math.max(21,Math.min(94,home[0]+offsets[i]));
    let next=exactNotes(makeVoicing(previous,bass,palette,range));
    // Ensure every step genuinely changes, even from an exceptionally dense chord.
    if(exactMatch(next,previous)){
      next=exactNotes(makeVoicing(previous,bass+1,palette,range));
    }
    chords.push(next);
    previous=next;
  }
  return {chords,count,mode};
}
