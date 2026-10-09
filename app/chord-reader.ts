export const READER_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// Match every sounding pitch class: never silently discard an extra note.
// Optional fifths allow common jazz/gospel voicings without assuming a missing root.
const shapes: {suffix:string; intervals:number[]; optional?:number[]}[] = [
  {suffix:'',intervals:[0,4,7]}, {suffix:'m',intervals:[0,3,7]},
  {suffix:'dim',intervals:[0,3,6]}, {suffix:'aug',intervals:[0,4,8]},
  {suffix:'sus2',intervals:[0,2,7]}, {suffix:'sus4',intervals:[0,5,7]},
  {suffix:'5',intervals:[0,7]},
  {suffix:'7',intervals:[0,4,7,10],optional:[7]},
  {suffix:'maj7',intervals:[0,4,7,11],optional:[7]},
  {suffix:'m7',intervals:[0,3,7,10],optional:[7]},
  {suffix:'m(maj7)',intervals:[0,3,7,11],optional:[7]},
  {suffix:'dim7',intervals:[0,3,6,9]}, {suffix:'m7b5',intervals:[0,3,6,10]},
  {suffix:'6',intervals:[0,4,7,9],optional:[7]},
  {suffix:'m6',intervals:[0,3,7,9],optional:[7]},
  {suffix:'add9',intervals:[0,2,4,7],optional:[7]},
  {suffix:'m(add9)',intervals:[0,2,3,7],optional:[7]},
  {suffix:'6/9',intervals:[0,2,4,7,9],optional:[7]},
  {suffix:'m6/9',intervals:[0,2,3,7,9],optional:[7]},
  {suffix:'9',intervals:[0,2,4,7,10],optional:[7]},
  {suffix:'maj9',intervals:[0,2,4,7,11],optional:[7]},
  {suffix:'m9',intervals:[0,2,3,7,10],optional:[7]},
  {suffix:'11',intervals:[0,2,4,5,7,10],optional:[2,7]},
  {suffix:'m11',intervals:[0,2,3,5,7,10],optional:[2,7]},
  {suffix:'13',intervals:[0,2,4,7,9,10],optional:[2,7]},
  {suffix:'maj13',intervals:[0,2,4,7,9,11],optional:[2,7]},
  {suffix:'m13',intervals:[0,2,3,7,9,10],optional:[2,7]},
  {suffix:'7sus4',intervals:[0,5,7,10],optional:[7]},
  {suffix:'9sus4',intervals:[0,2,5,7,10],optional:[7]},
  {suffix:'7b5',intervals:[0,4,6,10]}, {suffix:'7#5',intervals:[0,4,8,10]},
  {suffix:'7b9',intervals:[0,1,4,7,10],optional:[7]},
  {suffix:'7#9',intervals:[0,3,4,7,10],optional:[7]},
  {suffix:'9#11',intervals:[0,2,4,6,7,10],optional:[7]},
  {suffix:'maj7#11',intervals:[0,4,6,7,11],optional:[7]},
  {suffix:'maj9#11',intervals:[0,2,4,6,7,11],optional:[7]},
  {suffix:'7b13',intervals:[0,4,7,8,10],optional:[7]},
];

export function identifyChord(notes: readonly number[]) {
  const sorted = [...new Set(notes.filter(n=>Number.isInteger(n)&&n>=0&&n<=127))].sort((a,b)=>a-b);
  const pitches = [...new Set(sorted.map(n=>n%12))];
  if(pitches.length<2)return {notes:sorted, matches:[] as string[]};
  const bass = sorted[0]%12;
  const matches: {name:string; rank:number}[] = [];
  for(const root of pitches){
    const intervals=pitches.map(pc=>(pc-root+12)%12);
    shapes.forEach((shape,index)=>{
      if(!intervals.every(i=>shape.intervals.includes(i)))return;
      const missing=shape.intervals.filter(i=>!intervals.includes(i));
      if(!missing.every(i=>shape.optional?.includes(i)))return;
      matches.push({
        name:READER_NOTES[root]+shape.suffix+(bass===root?'':'/'+READER_NOTES[bass]),
        rank:missing.length*100+(bass===root?0:300)+index,
      });
    });
  }
  matches.sort((a,b)=>a.rank-b.rank);
  return {notes:sorted,matches:[...new Set(matches.map(m=>m.name))]};
}
