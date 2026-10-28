import { identifyChord } from './chord-reader';
import { parseChordSymbol, voiceLeadProgression } from './voice-leading';

export const NAV_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'] as const;
export const NAV_KEYS = ['C','F','Bb','Eb','Ab','Db','Gb','B','E','A','D','G'] as const;
export type NavDirection = 'up' | 'down' | 'either';
export type NavAxis = 'root' | 'bass' | 'top' | 'center';
export type NavPalette = 'diatonic' | 'gospel' | 'jazz' | 'chromatic' | 'all';
export type NavVoicing = 'drop2' | 'drop3' | 'drop24' | 'closed' | 'open' | 'rootless' | 'quartal' | 'upper' | 'gospel' | 'shell';
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
const roots: Record<string,number>={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
export const notePc=(s:string)=>roots[s.replace('♯','#').replace('♭','b')]??0;
export const noteLabel=(n:number)=>NAV_NOTES[mod(n)]+(Math.floor(n/12)-1);
export function nameForPc(pc:number,key='C'){
  const preferred: Record<string,string[]>={C:['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],F:['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],G:['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'],D:['C','C#','D','D#','E','F','F#','G','G#','A','Bb','B'],A:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],E:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],B:['B#','C#','D','D#','E','E#','F#','G','G#','A','A#','B']};
  return (preferred[key]||NAV_NOTES)[mod(pc)];
}
const MAJOR=[0,2,4,5,7,9,11], MINOR=[0,2,3,5,7,8,10];
const romanMajor=['I','ii','iii','IV','V','vi','vii°'];
const romanMinor=['i','ii°','III','iv','V','VI','VII'];
const majorSuffix=['maj9','m9','m7','maj9','13','m9','m7b5'];
const minorSuffix=['m9','m7b5','maj9','m9','7b9','maj9','9'];
export function degrees(key:string,mode:'major'|'minor'='major'){
  const scale=mode==='major'?MAJOR:MINOR;
  const root=notePc(key);
  return scale.map((step,i)=>({degree:i+1,pc:mod(root+step),name:nameForPc(root+step,key),roman:(mode==='major'?romanMajor:romanMinor)[i],suffix:(mode==='major'?majorSuffix:minorSuffix)[i]}));
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
  if(pcLocked!==undefined){const options=Array.from({length:4},(_,i)=>pcLocked+36-mod(pcLocked)+12*i).filter(n=>n>=32&&n<=62);return options.sort((a,b)=>Math.abs(a-prior)-Math.abs(b-prior))[0]??prior;}
  const choices=Array.from({length:5},(_,i)=>root+12*(2+i)).filter(n=>n>=32&&n<=60);
  const filtered=choices.filter(n=>dir==='either'||(dir==='up'?n>=prior:n<=prior));
  return (filtered.length?filtered:choices).sort((a,b)=>Math.abs(a-prior)-Math.abs(b-prior))[0]??root+36;
}
function voiceCandidates(symbol:string,style:NavVoicing,range:'low'|'middle'|'high',density:number){
  const root=chordRoot(symbol), ints=intervalsFor(symbol), core=coreTetrad(symbol);
  const result:number[][]=[], target=range==='low'?61:range==='high'?77:69;
  const selected=style==='shell'?[0,core[1],core[3]]:
    style==='rootless'?[core[1],core[3],ints.includes(14)?14:2,ints.includes(21)?21:9]:
    style==='quartal'?[0,5,10,15]:
    style==='upper'?[core[1],ints.includes(14)?14:2,core[3],ints.includes(21)?21:9]:
    style==='gospel'?[core[1],core[3],ints.includes(14)?14:2,ints.includes(17)?17:5,ints.includes(21)?21:9]:
    density>=7&&style!=='drop2'&&style!=='drop3'&&style!=='drop24'?[...core,ints.find(i=>i>11)??14]:core;
  const template=[...new Set(selected.map(n=>mod(root+n)))];
  for(let inversion=0;inversion<template.length;inversion++){
    const rotated=[...template.slice(inversion),...template.slice(0,inversion)];
    const rising:number[]=[];
    for(const pc of rotated){let n=pc+48;while(rising.length&&n<=rising[rising.length-1])n+=12;rising.push(n);}
    for(const shift of [-24,-12,0,12,24]){
      let upper=rising.map(n=>n+shift);
      if(style==='drop2'&&upper.length>=4){upper=upper.map((n,i)=>i===upper.length-2?n-12:n).sort((a,b)=>a-b);}
      else if(style==='drop3'&&upper.length>=4){upper=upper.map((n,i)=>i===upper.length-3?n-12:n).sort((a,b)=>a-b);}
      else if(style==='drop24'&&upper.length>=4){upper=upper.map((n,i)=>i===upper.length-2||i===0?n-12:n).sort((a,b)=>a-b);}
      else if(style==='open'&&upper.length>=4){upper=upper.map((n,i)=>i%2===0?n-12:n).sort((a,b)=>a-b);}
      if(upper[0]<48||upper.at(-1)!>90)continue;
      if(style!=='drop24'&&upper.at(-1)!-upper[0]>17)continue;
      const center=upper.reduce((a,b)=>a+b,0)/upper.length;
      if(Math.abs(center-target)>16)continue;
      result.push(upper);
    }
  }
  return result;
}
function measure(prev:number[],next:number[]){
  const a=[...prev].sort((x,y)=>x-y),b=[...next].sort((x,y)=>x-y);
  return b.map((n,i)=>n-(a[Math.min(i,a.length-1)]??n));
}
function bestVoicing(symbol:string,request:NavigationRequest,previous:number[],bassPrior:number){
  const root=chordRoot(symbol), prevUpper=previous.filter(n=>n>=47);
  const locked=request.lock==='top'?(prevUpper.at(-1)??null):request.lock==='common'?(prevUpper[Math.floor(prevUpper.length/2)]??null):null;
  const bassLock=request.lock==='bass'?mod(bassPrior):undefined;
  const bass=nearestBass(root,bassPrior,request.axis==='bass'?request.direction:'either',bassLock);
  let candidates=voiceCandidates(symbol,request.voicing,request.range??'middle',request.density);
  if(locked!==null) candidates=candidates.filter(upper=>upper.some(n=>mod(n)===mod(locked)));
  if(!candidates.length)return null;
  const filtered=candidates.map(upper=>{
    const moves=measure(prevUpper.length?prevUpper:[60,64,67,71],upper);
    const centerDelta=upper.reduce((a,b)=>a+b,0)/upper.length-(prevUpper.reduce((a,b)=>a+b,0)/(prevUpper.length||1));
    const topDelta=upper.at(-1)!-(prevUpper.at(-1)??upper.at(-1)!);
    const axisMove=request.axis==='bass'?bass-bassPrior:request.axis==='top'?topDelta:request.axis==='center'?centerDelta:mod(root-chordRoot(request.current)+12);
    const directed=request.direction==='either'||(request.direction==='up'?axisMove>0:axisMove<0);
    const movement=moves.reduce((sum,n)=>sum+Math.abs(n),0);
    const span=upper.at(-1)!-upper[0];
    const muddy=upper.filter(n=>n<58).length*2+(span>14?span-14:0)*.35;
    const common=upper.filter(n=>prevUpper.some(p=>mod(p)===mod(n))).length;
    const score=movement*.35 +Math.abs(centerDelta)*.3+muddy-common*1.8+(directed?0:50);
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
  const chordAt=(index:number)=>{const item=d[mod(index+7)%7];return item.name+item.suffix;};
  const degreeOptions=request.destination? [request.destination-1]:d.map((_,i)=>i).filter(i=>i!==currentDegree);
  for(const idx of degreeOptions){
    const degree=d[idx],dest=chordAt(idx),target=degree.pc;
    add('Direct to '+degree.roman,[dest],'Diatonic','diatonic','Move into '+degree.roman+' with the selected voicing shape.');
    const v=nameForPc(target+7,request.key), ii=nameForPc(target+2,request.key), sub=nameForPc(target+1,request.key);
    if(request.palette!=='diatonic'){
      add('ii–V into '+degree.roman,[ii+'m9',v+'13',dest],'Jazz cadence','secondary dominant','A targeted ii–V progression leads into '+degree.roman+'.');
      add('Altered dominant → '+degree.roman,[v+'7b9b13',dest],'Altered resolution','secondary dominant','A tense altered V resolves into the chosen destination.');
      add('Tritone substitute → '+degree.roman,[sub+'9#11',dest],'Tritone color','chromatic','Approach from the substitute dominant a semitone above the target.');
      const passing=nameForPc(target-1,request.key);
      add('Chromatic approach → '+degree.roman,[passing+'dim7',dest],'Passing diminished','chromatic','Chromatic diminished motion increases expectation before arrival.');
    }
  }
  if(!request.destination||request.destination===4){
    add('Borrowed minor IV', [nameForPc(keyRoot+5,request.key)+'m9',d[0].name+'maj9'],'Modal interchange','borrowed','Borrow minor iv from the parallel minor to color the tonic.');
    add('Backdoor arrival',[nameForPc(keyRoot+10,request.key)+'13',d[0].name+'maj9'],'Backdoor dominant','borrowed','A bVII dominant returns gently to I.');
  }
  if(request.palette!=='diatonic'){
    add('Same-root color shift',[nameForPc(currentRoot,request.key)+'m9'],'Pedal-point color','color','Keep the root while shifting the emotional color of the chord.');
    add('Suspended tension',[nameForPc(currentRoot,request.key)+'9sus4',nameForPc(currentRoot,request.key)+'13'],'Suspension release','color','Resolve the fourth to the third without changing the root.');
  }
  if(request.modulationKey&&request.modulationKey!==request.key){
    const newRoot=notePc(request.modulationKey);
    add('Modulate to '+request.modulationKey,[nameForPc(newRoot+2,request.modulationKey)+'m7',nameForPc(newRoot+7,request.modulationKey)+'7alt',request.modulationKey+'maj9'],'New key','modulation','A ii–V–I establishes the selected destination key.');
  }
  return routes.filter(route=>{
    if(request.palette==='diatonic')return route.classification==='diatonic';
    if(request.palette==='jazz')return !['borrowed','color'].includes(route.classification);
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
  if(desired==='jazz'&&/ii–V|altered|tritone/.test(route.title.toLowerCase()))cost-=9;
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
    const rootDelta=mod(rootPc-chordRoot(request.current));
    const signedRoot=request.direction==='down'?(rootDelta===0?0:rootDelta-12):rootDelta;
    // On root navigation the selected destination determines ascending or descending root travel.
    if(request.axis==='root'&&request.direction!=='either'&&signedRoot===0&&rootPc!==chordRoot(request.current))continue;
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
export function detectChord(held:number[],key:string){
  const result=identifyChord(held);
  const diatonicRoots=degrees(key).map(x=>x.pc);
  const matches=[...result.matches].sort((a,b)=>{
    const ar=chordRoot(a),br=chordRoot(b);
    return Number(diatonicRoots.includes(br))-Number(diatonicRoots.includes(ar));
  });
  return {matches,notes:result.notes,inferred:result.inferredRoots};
}
export function transposeNavigation(symbol:string,semitones:number,key:string){
  const parsed=parseChordSymbol(symbol);
  const suffix=symbol.replace(/^[A-G](?:#|b)?/,'').replace(/\/[A-G](?:#|b)?$/,'');
  const slash=symbol.match(/\/([A-G](?:#|b)?)$/)?.[1];
  return nameForPc(parsed.root+semitones,key)+suffix+(slash?'/'+nameForPc(notePc(slash)+semitones,key):'');
}
