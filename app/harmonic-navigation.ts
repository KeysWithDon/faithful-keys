import { identifyChord } from './chord-reader.ts';
import { parseChordSymbol, voiceLeadProgression } from './voice-leading.ts';
import { parseSpelledNote, spellInterval, spellChordPitch } from './music-theory.ts';

export const NAV_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'] as const;
export const NAV_KEYS = ['C','F','Bb','Eb','Ab','Db','Gb','B','E','A','D','G'] as const;
export type NavDirection = 'up' | 'down' | 'either';
export type NavAxis = 'root' | 'bass' | 'top' | 'center';
export type NavPalette = 'diatonic' | 'gospel' | 'jazz' | 'chromatic' | 'all';
export type NavVoicing = 'drop2' | 'drop3' | 'drop24' | 'closed' | 'open' | 'rootless' | 'rootless-a' | 'rootless-b' | 'quartal' | 'quintal' | 'upper' | 'gospel' | 'spread' | 'cluster' | 'block' | 'suspended' | 'hybrid' | 'pentatonic' | 'shell';
export type NavTexture = 'warm' | 'bright' | 'dark' | 'neo-soul' | 'worship' | 'modern-gospel' | 'jazz';
export type NavigationRequest = {
  key: string; mode?: 'major'|'minor'; current: string; held: number[];
  direction: NavDirection; axis: NavAxis; palette: NavPalette; voicing: NavVoicing;
  texture: NavTexture; tension: number; density: number; lock: 'none'|'top'|'bass'|'common';
  destination?: number | null; modulationKey?: string; range?: 'low'|'middle'|'high';
};
export type NavigationOption = {
  id: string; title: string; symbol: string; roman: string; family: string; texture: string;
  explanation: string; path: string[]; voicedPath: number[][]; upper: number[]; bass: number;
  score: number; semitoneMotion: number; commonTones: number; movedVoices: number[];
  classification: 'diatonic'|'borrowed'|'chromatic'|'secondary dominant'|'modulation'|'color';
};
const mod=(n:number)=>(n%12+12)%12;
const LETTER_PC:Record<string,number>={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
export const notePc=(note:string)=>{try{return parseSpelledNote(note).pitchClass}catch{return 0}};
export const noteLabel=(n:number)=>NAV_NOTES[mod(n)]+(Math.floor(n/12)-1);
const MAJOR=[0,2,4,5,7,9,11], MINOR=[0,2,3,5,7,8,10];
const romanMajor=['I','ii','iii','IV','V','vi','viiø7'];
const romanMinor=['i','iiø7','III','iv','V7','VI','VII'];
const majorSuffix=['maj9','m9','m7','maj9','13','m9','m7b5'];
const minorSuffix=['m9','m7b5','maj9','m9','7b9','maj9','9'];
export function nameForPc(pc:number,key='C',mode:'major'|'minor'='major',direction:NavDirection='either'){
  const tonic=parseSpelledNote(key).display;
  const scale=(mode==='major'?MAJOR:MINOR).map((semi,i)=>({pc:mod(notePc(key)+semi),note:spellInterval(tonic,i,semi)}));
  const exact=scale.find(x=>x.pc===mod(pc));
  if(exact)return exact.note;
  // A chromatic tone rising into a scale degree is spelled as a raised
  // lower neighbor (#); a falling neighbor is normally a lowered upper (b).
  const below=scale.find(x=>mod(pc-x.pc)===1);
  const above=scale.find(x=>mod(x.pc-pc)===1);
  if(direction==='up'&&below)return spellInterval(below.note,0,1);
  if(direction==='down'&&above)return spellInterval(above.note,0,-1);
  if(above)return spellInterval(above.note,0,-1);
  if(below)return spellInterval(below.note,0,1);
  return NAV_NOTES[mod(pc)];
}
export function degrees(key:string,mode:'major'|'minor'='major'){
  const scale=mode==='major'?MAJOR:MINOR;
  const root=parseSpelledNote(key).display;
  return scale.map((step,i)=>({degree:i+1,pc:mod(notePc(root)+step),name:spellInterval(root,i,step),
    roman:(mode==='major'?romanMajor:romanMinor)[i],suffix:(mode==='major'?majorSuffix:minorSuffix)[i]}));
}
/** The actual enharmonic notation of a sounding MIDI note, including
 * the B#3/C4 and Cb4/B3 octave boundary. */
export function spelledNavigationNote(midi:number,symbol:string,key:string,mode:'major'|'minor'='major',direction:NavDirection='either'){
  const parsed=parseChordSymbol(symbol);
  const pitch=mod(midi);
  const isChordTone=parsed.roles.some(role=>mod(parsed.root+role.interval)===pitch);
  const name=isChordTone?spellChordPitch(symbol,pitch):nameForPc(pitch,key,mode,direction);
  const normalized=parseSpelledNote(name);
  const offset=normalized.pitchClass-LETTER_PC[normalized.letter];
  // Calculate the signed accidental (E#=+1, Cb=-1) rather than the
  // wrapped pitch class, which would mislabel octave-crossing notes.
  const literal=name.replace(/[♯]/g,'#').replace(/[♭]/g,'b').replace(/𝄪/g,'##').replace(/𝄫/g,'bb');
  const accidental=literal.slice(1).split('').reduce((sum,c)=>sum+(c==='#'?1:c==='b'?-1:0),0);
  const octave=Math.floor((midi-LETTER_PC[normalized.letter]-accidental)/12)-1;
  void offset;
  return name+octave;
}
function chordRoot(symbol:string){return parseChordSymbol(symbol).root;}
function intervalsFor(symbol:string):number[] {
  const parsed=parseChordSymbol(symbol);
  const suffix=symbol.replace(/^[A-G](?:#|b)?/,'').split('/')[0].toLowerCase();
  const suspended=/sus/.test(suffix);
  const half=/m7b5|ø/.test(suffix);
  const diminished=/dim|°/.test(suffix) && !half;
  const minor=/^m(?!aj)|^min|^-/.test(suffix);
  const major7=/maj|Δ/.test(suffix) && !minor;
  const seventh=major7?11:diminished?9:10;
  const third=suspended?5:minor||half||diminished?3:4;
  const fifth=half||diminished?6:/#5|aug/.test(suffix)?8:7;
  const base=[0,third,fifth,seventh];
  if(/6\/?9/.test(suffix))return [0,third,7,9,14];
  if(/m(?!aj).*9|maj9|(?:^|[^a-z])9/.test(suffix))base.push(14);
  if(/11/.test(suffix))base.push(17);
  if(/13/.test(suffix))base.push(21);
  if(/b9/.test(suffix))base.push(13);
  if(/#9/.test(suffix))base.push(15);
  if(/#11/.test(suffix))base.push(18);
  if(/b13/.test(suffix))base.push(20);
  if(/#5/.test(suffix))base[2]=8;
  if(/b5/.test(suffix))base[2]=6;
  if(/7alt/.test(suffix))base.push(13,15,20);
  if(parsed.suspended && !base.includes(5))base.push(5);
  return [...new Set(base)];
}
function coreTetrad(symbol:string){
  const interval=intervalsFor(symbol);
  return interval.slice(0,4);
}
function nearestBass(root:number,prior:number,dir:NavDirection,pcLocked?:number):number{
  if(pcLocked!==undefined){const options=Array.from({length:4},(_,i)=>36+mod(pcLocked-36)+12*i).filter(n=>n>=32&&n<=62);return options.sort((a,b)=>Math.abs(a-prior)-Math.abs(b-prior))[0]??prior;}
  const choices=Array.from({length:5},(_,i)=>root+12*(2+i)).filter(n=>n>=32&&n<=60);
  const filtered=choices.filter(n=>dir==='either'||(dir==='up'?n>=prior:n<=prior));
  return (filtered.length?filtered:choices).sort((a,b)=>Math.abs(a-prior)-Math.abs(b-prior))[0]??root+36;
}
export const NAV_VOICINGS: {id:NavVoicing;label:string;description:string}[]=[
  {id:'gospel',label:'Modern Gospel',description:'Rich, compact 9/11/13 color tones'},
  {id:'spread',label:'Spread Gospel',description:'Wide, open contemporary gospel spacing'},
  {id:'rootless-a',label:'Rootless A',description:'Third-led 3–5/13–7–9 jazz structure'},
  {id:'rootless-b',label:'Rootless B',description:'Seventh-led 7–9–3–13 jazz structure'},
  {id:'rootless',label:'Rootless extensions',description:'Root omitted, extensions emphasized'},
  {id:'drop2',label:'Drop 2',description:'Second highest voice dropped one octave'},
  {id:'drop3',label:'Drop 3',description:'Third highest voice dropped one octave'},
  {id:'drop24',label:'Drop 2 & 4',description:'Second and fourth highest voices dropped'},
  {id:'quartal',label:'Quartal',description:'Fourth-based suspended voicing'},
  {id:'quintal',label:'Quintal',description:'Fifth-based spacious voicing'},
  {id:'upper',label:'Upper structure',description:'Upper triad colors over a bass root'},
  {id:'cluster',label:'Gospel clusters',description:'Close upper extension texture'},
  {id:'suspended',label:'Suspended',description:'Fourth and ninth, delayed resolution'},
  {id:'hybrid',label:'Hybrid / slash',description:'Contrasting upper triad over the bass'},
  {id:'pentatonic',label:'Pentatonic',description:'Open R–9–11–5–b7-like colors'},
  {id:'block',label:'Block',description:'Locked-hands compact extended structure'},
  {id:'closed',label:'Close position',description:'Inversion of a tightly stacked seventh'},
  {id:'open',label:'Open position',description:'Separated voices with open space'},
  {id:'shell',label:'Shell',description:'Essential 1–3–7 functional outline'},
];
function voiceCandidates(symbol:string,style:NavVoicing,range:'low'|'middle'|'high',density:number){
  const root=chordRoot(symbol), ints=intervalsFor(symbol), core=coreTetrad(symbol);
  const result:number[][]=[], target=range==='low'?61:range==='high'?77:69;
  const third=core[1], seventh=core[3];
  const nine=ints.includes(13)?13:ints.includes(15)?15:14;
  const eleven=ints.includes(18)?18:17;
  const thirteen=ints.includes(20)?20:21;
  // These templates are intentionally distinct; exotic voicings may imply
  // substitutions rather than contain every chord tone. The label makes that clear.
  const templates: Record<NavVoicing,number[]> = {
    closed:core,open:core,drop2:core,drop3:core,drop24:core,
    shell:[0,third,seventh],
    rootless:[third,seventh,nine,thirteen],
    'rootless-a':[third,thirteen,seventh,nine],
    'rootless-b':[seventh,nine,third,thirteen],
    quartal:[0,5,10,15],
    quintal:[0,7,14,21],
    upper:[nine,nine+4,nine+7,third],
    gospel:[third,seventh,nine,eleven,thirteen],
    spread:[third,seventh,nine,thirteen],
    cluster:[third,seventh,nine,eleven],
    block:[0,third,7,9,14],
    suspended:[0,5,7,10,14],
    hybrid:[0,nine,nine+3,nine+7],
    pentatonic:[0,2,5,7,10],
  };
  const full=templates[style];
  // Drop families retain the four voices needed to be mathematically valid.
  // Other techniques respond to density without silently relabeling Drop voicings.
  const fixed=['drop2','drop3','drop24','rootless-a','rootless-b','rootless','closed','open','quartal','quintal','upper','shell'].includes(style);
  const voices=fixed?full.length:density<=3?Math.min(3,full.length):density<=6?Math.min(4,full.length):full.length;
  const selected=full.slice(0,voices);
  const chromas=selected.map(i=>mod(root+i));
  const octaves=style==='spread'||style==='open'||style==='quintal'||style==='upper'||style==='hybrid'?[-24,-12,0,12]:[-12,0,12];
  for(let inversion=0;inversion<(style==='rootless-a'||style==='rootless-b'?1:chromas.length);inversion++){
    const rotated=[...chromas.slice(inversion),...chromas.slice(0,inversion)];
    const rising:number[]=[];
    for(const pc of rotated){let n=pc+48;while(rising.length&&n<=rising[rising.length-1])n+=12;rising.push(n);}
    for(const shift of octaves){
      let upper=rising.map(n=>n+shift);
      if(style==='drop2'&&upper.length===4){upper=[upper[0],upper[1],upper[2]-12,upper[3]].sort((a,b)=>a-b);}
      else if(style==='drop3'&&upper.length===4){upper=[upper[0],upper[1]-12,upper[2],upper[3]].sort((a,b)=>a-b);}
      else if(style==='drop24'&&upper.length===4){upper=[upper[0]-12,upper[1],upper[2]-12,upper[3]].sort((a,b)=>a-b);}
      else if(style==='open'||style==='spread'){upper=upper.map((n,i)=>i%2===0?n-12:n).sort((a,b)=>a-b);}
      else if(style==='upper'||style==='hybrid'){upper=[upper[0]-12,...upper.slice(1)].sort((a,b)=>a-b);}
      else if(style==='quintal'){upper=[upper[0],upper[1],upper[2],upper[3]].sort((a,b)=>a-b);}
      if(upper[0]<46||upper.at(-1)!>91)continue;
      if(upper.at(-1)!-upper[0]>(['drop24','spread','open','upper','hybrid','quintal'].includes(style)?26:19))continue;
      const center=upper.reduce((a,b)=>a+b,0)/upper.length;
      if(Math.abs(center-target)>19)continue;
      if(style==='cluster'&&upper.at(-1)!-upper[0]>14)continue;
      if(style==='closed'&&upper.at(-1)!-upper[0]>12)continue;
      if(style==='drop2'&&upper.length!==4)continue;
      result.push(upper);
    }
  }
  return [...new Map(result.map(x=>[x.join(','),x])).values()];
}
function measure(prev:number[],next:number[]){
  const a=[...prev].sort((x,y)=>x-y),b=[...next].sort((x,y)=>x-y);
  return b.map((n,i)=>n-(a[Math.min(i,a.length-1)]??n));
}
function bestVoicing(symbol:string,request:NavigationRequest,previous:number[],bassPrior:number){
  const root=chordRoot(symbol), prevUpper=previous.filter(n=>n>=47);
  const locked=request.lock==='top'?(prevUpper.at(-1)??null):request.lock==='common'?(prevUpper[Math.floor(prevUpper.length/2)]??null):null;
  const bassLock=request.lock==='bass'?mod(bassPrior):undefined;
  const bass=nearestBass(root,bassPrior,(request.axis==='bass'||request.axis==='root')?request.direction:'either',bassLock);
  let candidates=voiceCandidates(symbol,request.voicing,request.range??'middle',request.density);
  if(locked!==null) candidates=candidates.filter(upper=>upper.some(n=>mod(n)===mod(locked)));
  if(!candidates.length)return null;
  const filtered=candidates.map(upper=>{
    const moves=measure(prevUpper.length?prevUpper:[60,64,67,71],upper);
    const centerDelta=upper.reduce((a,b)=>a+b,0)/upper.length-(prevUpper.reduce((a,b)=>a+b,0)/(prevUpper.length||1));
    const topDelta=upper.at(-1)!-(prevUpper.at(-1)??upper.at(-1)!);
    const axisMove=request.axis==='bass'?bass-bassPrior:request.axis==='top'?topDelta:request.axis==='center'?centerDelta:bass-bassPrior;
    const directed=request.direction==='either'||(request.direction==='up'?axisMove>0:axisMove<0);
    const movement=moves.reduce((sum,n)=>sum+Math.abs(n),0);
    const span=upper.at(-1)!-upper[0];
    const muddy=upper.filter(n=>n<58).length*2+(span>14?span-14:0)*.35;
    const common=upper.filter(n=>prevUpper.some(p=>mod(p)===mod(n))).length;
    const center=upper.reduce((sum,n)=>sum+n,0)/upper.length;
    const closePairs=upper.filter((n,i)=>i>0&&n-upper[i-1]<=2).length;
    const densityScore=Math.abs(upper.length-(request.density<=3?3:request.density<=6?4:5));
    const colorCost=request.texture==='bright'? -span*.28-(center-68)*.25
      :request.texture==='dark'?-closePairs*2.2+center*.09
      :request.texture==='modern-gospel'?-closePairs*1.3-common*.9
      :request.texture==='neo-soul'?-common*2
      :request.texture==='worship'?-span*.15+closePairs*.8
      :request.texture==='jazz'?-common*1.2+Math.max(0,span-14)*.2
      :Math.max(0,span-14)*.35-closePairs*.3;
    const score=movement*.35 +Math.abs(centerDelta)*.3+muddy-common*1.8+colorCost+densityScore*.3+(directed?0:50);
    return {upper,moves,score,axisMove,common,directed};
  }).filter(candidate=>request.direction==='either'||candidate.directed);
  filtered.sort((a,b)=>a.score-b.score);
  const chosen=filtered[0];
  return chosen?{...chosen,bass}:null;
}
type Route={title:string;path:string[];family:string;classification:NavigationOption['classification'];description:string};
export function generateRoutes(request:NavigationRequest):Route[]{
  const d=degrees(request.key,request.mode),keyRoot=notePc(request.key);
  const currentRoot=chordRoot(request.current);
  const currentDegree=d.findIndex(item=>item.pc===currentRoot);
  const routes:Route[]=[];
  const add=(title:string,path:string[],family:string,classification:Route['classification'],description:string)=>{
    if(path.length&&path.every(Boolean))routes.push({title,path,family,classification,description});
  };
  const destinationSymbol=(index:number)=>{const item=d[((index%7)+7)%7];return item.name+item.suffix};
  const targetOptions=request.destination?[request.destination-1]:d.map((_,i)=>i).filter(i=>i!==currentDegree);
  for(const idx of targetOptions){
    const degree=d[idx],dest=destinationSymbol(idx),target=degree.name;
    add('Direct to '+degree.roman,[dest],'Diatonic','diatonic','Move to '+degree.roman+' using the scale tones and chord quality of '+request.key+' '+(request.mode??'major')+'.');
    if(request.palette==='diatonic')continue;
    // A secondary ii–V must reflect the ACTUAL destination: Em7b5–A7b9
    // approaches D minor, while Em7–A13 prepares D major.
    const stableMinor=degree.suffix.startsWith('m')&&!degree.suffix.startsWith('maj')&&!degree.suffix.startsWith('m7b5');
    const stableMajor=degree.suffix.startsWith('maj');
    const dominant=degree.suffix==='13'||degree.suffix==='9'||degree.suffix.startsWith('7');
    const ii=spellInterval(target,1,2),v=spellInterval(target,4,7);
    const sub=spellInterval(target,1,1);
    if(stableMajor||stableMinor||dominant){
      add('ii–V into '+degree.roman,[ii+(stableMinor?'m7b5':'m9'),v+(stableMinor?'7b9b13':'13'),dest],
        'Functional cadence','secondary dominant','Approach '+degree.roman+' with a '+(stableMinor?'minor iiø–V7b9':'major ii–V')+' resolving to the actual target quality.');
      add('Altered dominant → '+degree.roman,[v+'7b9b13',dest],'Altered resolution','secondary dominant',
        'A V7 with altered ninth and thirteenth tensions resolves by step into '+degree.roman+'.');
      add('Tritone substitute → '+degree.roman,[sub+'9#11',dest],'Tritone substitution','chromatic',
        'The substitute ♭II7 approaches the target from a semitone ABOVE, resolving downward.');
    }
    // A neighbor diminished chord is chromatic voice leading, not a false
    // claim that every neighbor is a conventional functional diminished.
    if(request.direction==='up'||request.direction==='either'){
      const leading=spellInterval(target,6,11);
      add('Ascending chromatic approach → '+degree.roman,[leading+'dim7',dest],
        'Lower-neighbor diminished','chromatic','Use the correctly spelled leading-tone diminished chord a semitone below '+target+' to move upward.');
    }
    if(request.direction==='down'||request.direction==='either'){
      add('Descending chromatic approach → '+degree.roman,[sub+'dim7',dest],
        'Upper-neighbor diminished','chromatic','Use a chromatic diminished upper neighbor one semitone ABOVE '+target+' to move downward; this is voice-leading color, not a secondary dominant.');
    }
  }
  if(request.mode!=='minor'&&(!request.destination||request.destination===1)){
    const iv=d[3].name,tonic=d[0].name;
    add('Borrowed minor iv → I',[iv+'m9',tonic+'maj9'],'Modal interchange','borrowed',
      'Borrow the minor iv from the parallel minor and resolve to the major tonic.');
    const bVII=spellInterval(tonic,6,10);
    add('Backdoor ♭VII7 → I',[bVII+'13',tonic+'maj9'],'Backdoor dominant','borrowed',
      'Borrow ♭VII7 for a softer backdoor arrival on I.');
  }
  if(request.palette!=='diatonic'){
    const chord=parseChordSymbol(request.current);
    const note=nameForPc(currentRoot,request.key,request.mode);
    const currentQuality=chord.quality.toLowerCase();
    const colorSuffix=currentQuality.includes('minor')||currentQuality.includes('m7')?'m11'
      :chord.dominant?'13sus4':'maj9#11';
    if(note+colorSuffix!==request.current)
      add('Same-root color shift',[note+colorSuffix],'Tonic pedal color','color',
        'Retain the chord root while changing the extension palette; no new harmonic destination is implied.');
    if(chord.dominant){
      add('Suspended dominant release',[note+'9sus4',note+'13'],'Suspension release','color',
        'Let the suspended fourth resolve to the third within the dominant family.');
    }
  }
  if(request.modulationKey&&request.modulationKey!==request.key){
    const tonic=request.modulationKey;
    add('Modulate to '+tonic,
      [spellInterval(tonic,1,2)+'m9',spellInterval(tonic,4,7)+'13',tonic+'maj9'],
      'New key','modulation','A correctly spelled secondary ii–V–I confirms the new tonal center.');
  }
  return routes.filter(route=>{
    if(request.palette==='diatonic')return route.classification==='diatonic';
    if(request.palette==='jazz')return !['borrowed','color'].includes(route.classification);
    if(request.palette==='chromatic')return ['chromatic','secondary dominant','borrowed','modulation'].includes(route.classification);
    if(request.palette==='gospel')return route.classification!=='modulation'||Boolean(request.modulationKey);
    return true;
  });
}
function harmonicPreference(route:Route,request:NavigationRequest){
  const tense=/altered|tritone|diminished|substitute/i.test(route.title);
  const lush=/m9|maj9|13|#11/.test(route.path.join(' '));
  const desired=request.texture;
  let cost=0;
  if(desired==='dark'&&tense)cost-=9;
  if(desired==='bright'&&/maj|#11/.test(route.path.join(' ')))cost-=5;
  if((desired==='warm'||desired==='worship')&&lush)cost-=5;
  if(desired==='modern-gospel'&&route.classification==='borrowed')cost-=9;
  if(desired==='jazz'&&/ii–v|altered|tritone/.test(route.title.toLowerCase()))cost-=9;
  if(desired==='neo-soul'&&route.classification==='color')cost-=9;
  if(tense)cost+=(50-request.tension)*.24;
  else cost+=request.tension*.06;
  return cost;
}
export function navigationOptions(request:NavigationRequest):NavigationOption[]{
  const held=[...new Set(request.held)].sort((a,b)=>a-b);
  const baseline=held.length>=2?held:voiceLeadProgression([request.current],{style:'gospel',layout:'close'})[0].notes;
  const sourceBass=baseline[0]??48, sourceUpper=baseline.filter(n=>n>=47);
  const possibilities:NavigationOption[]=[];
  for(const [index,route] of generateRoutes(request).entries()){
    let previous=sourceUpper, bassPrior=sourceBass;
    const voicedPath:number[][]=[];
    let final:ReturnType<typeof bestVoicing>=null;
    for(const symbol of route.path){
      const v=bestVoicing(symbol,request,previous,bassPrior);
      if(!v){final=null;break;}
      voicedPath.push([v.bass,...v.upper]);previous=v.upper;bassPrior=v.bass;final=v;
    }
    if(!final||!voicedPath.length)continue;
    const symbol=route.path.at(-1)!,rootPc=chordRoot(symbol),degree=degrees(request.key,request.mode).find(d=>d.pc===rootPc);
    const semitoneMotion=final.axisMove;
    const score=final.score+harmonicPreference(route,request)+route.path.length*2;
    possibilities.push({
      id:route.title+'-'+index,title:route.title,symbol,roman:degree?.roman??'chromatic',
      family:route.family,texture:request.texture,explanation:route.description,path:route.path,
      voicedPath,upper:final.upper,bass:final.bass,score,semitoneMotion,commonTones:final.common,
      movedVoices:final.moves,classification:route.classification,
    });
  }
  const unique=new Map<string,NavigationOption>();
  for(const option of possibilities.sort((a,b)=>a.score-b.score)){
    const signature=option.path.join(' → ');
    if(!unique.has(signature))unique.set(signature,option);
  }
  return [...unique.values()].sort((a,b)=>a.score-b.score).slice(0,20);
}
export function detectChord(held:number[],key:string,mode:'major'|'minor'='major'){
  const result=identifyChord(held);
  const diatonicRoots=degrees(key,mode).map(x=>x.pc);
  const respell=(symbol:string)=>{
    const match=symbol.match(/^([A-G](?:#|b)?)(.*)$/);
    if(!match)return symbol;
    const root=nameForPc(notePc(match[1]),key,mode);
    const suffix=match[2].replace(/\/([A-G](?:#|b)?)$/,(_all,bass:string)=>'/'+nameForPc(notePc(bass),key,mode));
    return root+suffix;
  };
  const matches=[...new Set(result.matches.map(respell))].sort((a,b)=>{
    const ar=chordRoot(a),br=chordRoot(b);
    return Number(diatonicRoots.includes(br))-Number(diatonicRoots.includes(ar));
  });
  return {matches,notes:result.notes,inferred:result.inferredRoots.map(respell)};
}
export function transposeNavigation(symbol:string,semitones:number,key:string,sourceKey?:string){
  const parsed=parseChordSymbol(symbol);
  const match=symbol.match(/^([A-G](?:#|b)?)(.*)$/);
  if(!match)return symbol;
  const suffix=match[2].replace(/\/[A-G](?:#|b)?$/,'');
  const slash=symbol.match(/\/([A-G](?:#|b)?)$/)?.[1];
  const transposeRoot=(rootName:string)=>{
    const pc=notePc(rootName)+semitones;
    if(!sourceKey)return nameForPc(pc,key);
    const source=parseSpelledNote(sourceKey),original=parseSpelledNote(rootName),target=parseSpelledNote(key);
    const letters=['C','D','E','F','G','A','B'];
    const steps=(letters.indexOf(original.letter)-letters.indexOf(source.letter)+7)%7;
    const chromatic=mod(original.pitchClass-source.pitchClass);
    try{return spellInterval(target.display,steps,chromatic)}catch{return nameForPc(pc,key)}
  };
  return transposeRoot(match[1])+suffix+(slash?'/'+transposeRoot(slash):'');
}
