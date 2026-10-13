export const READER_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// Match every sounding pitch class: never silently discard an extra note.
// Optional fifths allow common jazz/gospel voicings without assuming a missing root.
export const CHORD_TYPES: {suffix:string; intervals:number[]; optional?:number[]}[] = [
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
  {suffix:'add11',intervals:[0,4,5,7],optional:[7]},
  {suffix:'m(add11)',intervals:[0,3,5,7],optional:[7]},
  {suffix:'maj11',intervals:[0,2,4,5,7,11],optional:[2,7]},
  {suffix:'m(maj9)',intervals:[0,2,3,7,11],optional:[7]},
  {suffix:'m(maj11)',intervals:[0,2,3,5,7,11],optional:[2,7]},
  {suffix:'m(maj13)',intervals:[0,2,3,7,9,11],optional:[2,7]},
  {suffix:'maj7#5',intervals:[0,4,8,11]},
  {suffix:'maj9#5',intervals:[0,2,4,8,11]},
  {suffix:'m9b5',intervals:[0,2,3,6,10]},
  {suffix:'m11b5',intervals:[0,2,3,5,6,10],optional:[2]},
  {suffix:'7sus2',intervals:[0,2,7,10],optional:[7]},
  {suffix:'maj7sus2',intervals:[0,2,7,11],optional:[7]},
  {suffix:'maj7sus4',intervals:[0,5,7,11],optional:[7]},
  {suffix:'13sus4',intervals:[0,2,5,7,9,10],optional:[2,7]},
  {suffix:'7#11',intervals:[0,4,6,7,10],optional:[7]},
  {suffix:'9b5',intervals:[0,2,4,6,10]},
  {suffix:'9#5',intervals:[0,2,4,8,10]},
  {suffix:'9b13',intervals:[0,2,4,7,8,10],optional:[7]},
  {suffix:'13b9',intervals:[0,1,4,7,9,10],optional:[7]},
  {suffix:'13#9',intervals:[0,3,4,7,9,10],optional:[7]},
  {suffix:'13#11',intervals:[0,2,4,6,7,9,10],optional:[2,7]},
  {suffix:'maj13#11',intervals:[0,2,4,6,7,9,11],optional:[2,7]},
  {suffix:'7b9#9',intervals:[0,1,3,4,7,10],optional:[7]},
  {suffix:'7b9#11',intervals:[0,1,4,6,7,10],optional:[7]},
  {suffix:'7#9#11',intervals:[0,3,4,6,7,10],optional:[7]},
  {suffix:'7b9b13',intervals:[0,1,4,7,8,10],optional:[7]},
  {suffix:'7#9b13',intervals:[0,3,4,7,8,10],optional:[7]},
  {suffix:'7b5b9',intervals:[0,1,4,6,10]},
  {suffix:'7b5#9',intervals:[0,3,4,6,10]},
  {suffix:'7#5b9',intervals:[0,1,4,8,10]},
  {suffix:'7#5#9',intervals:[0,3,4,8,10]},
];

export function identifyChord(notes: readonly number[]) {
  const sorted = [...new Set(notes.filter(n=>Number.isInteger(n)&&n>=0&&n<=127))].sort((a,b)=>a-b);
  const pitches = [...new Set(sorted.map(n=>n%12))];
  if(pitches.length<2)return {notes:sorted, matches:[] as string[], inferredRoots:[] as string[]};
  const bass = sorted[0]%12;
  const matches: {name:string; rank:number; rootOmitted:boolean}[] = [];
  for(let root=0;root<12;root++){
    const intervals=pitches.map(pc=>(pc-root+12)%12);
    CHORD_TYPES.forEach((shape,index)=>{
      if(!intervals.every(i=>shape.intervals.includes(i)))return;
      const missing=shape.intervals.filter(i=>!intervals.includes(i));
      const rootOmitted=!pitches.includes(root);
      // Infer roots only with a third + seventh and at least four distinct tones.
      // Keep every played tone; allow only the root and documented optional tones to be absent.
      if(rootOmitted && (pitches.length<4 || !intervals.some(i=>i===3||i===4) || !intervals.some(i=>i===10||i===11) || shape.intervals.length<5))return;
      if(!missing.every(i=>shape.optional?.includes(i)||(rootOmitted&&i===0)))return;
      matches.push({
        name:READER_NOTES[root]+shape.suffix+(bass===root?'':'/'+READER_NOTES[bass]),
        rank:(rootOmitted?1000:0)+missing.length*100+(bass===root?0:300)+index,
        rootOmitted,
      });
    });
  }
  matches.sort((a,b)=>a.rank-b.rank);
  return {notes:sorted,matches:[...new Set(matches.map(m=>m.name))], inferredRoots:matches.filter(m=>m.rootOmitted).map(m=>m.name)};
}
