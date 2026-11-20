// The bass owns the root. Upper structures are chosen together with their
// register and voice leading, rather than choosing a random color first.
const mod=n=>((n%12)+12)%12;
const same=(a,b)=>a?.pc===b?.pc&&a?.type===b?.type;
const sort=a=>[...a].sort((a,b)=>a-b);
export const VOICING_STYLES={auto:'Musical mix','drop-2':'Drop 2','drop-2-4':'Drop 2 & 4',gospel:'Gospel spread',rootless:'Rootless colors'};

export function dropVoicing(closed,drops=[2]){
 const voices=sort(closed);
 return sort(voices.map((note,i)=>drops.includes(voices.length-i)?note-12:note));
}

const LIBRARY={
 major:[
  {id:'major-six',tones:[0,4,7,9],suffix:'6',weight:0},
  {id:'major-seven',tones:[0,4,7,11],suffix:'maj7',weight:.5},
  {id:'major-add-nine',tones:[0,4,7,14],suffix:'add9',weight:.4},
  {id:'major-nine',tones:[4,7,11,14],suffix:'maj9',weight:.15,rootless:true},
  {id:'major-six-nine',tones:[4,7,9,14],suffix:'6/9',weight:0,rootless:true},
  {id:'major-quartal',tones:[4,9,14,19],suffix:'6/9',weight:0,rootless:true,spread:true}
 ],
 minor:[
  {id:'minor-seven',tones:[0,3,7,10],suffix:'m7',weight:.15},
  {id:'minor-nine',tones:[3,7,10,14],suffix:'m9',weight:0,rootless:true},
  {id:'minor-eleven',tones:[3,10,14,17],suffix:'m11',weight:.3,rootless:true,spread:true},
  {id:'minor-six',tones:[0,3,7,9],suffix:'m6',weight:1.25},
  {id:'minor-six-nine',tones:[3,7,9,14],suffix:'m6/9',weight:1.4,rootless:true}
 ],
 dominant:[
  {id:'dominant-seven',tones:[0,4,7,10],suffix:'7',weight:1},
  {id:'dominant-nine',tones:[4,7,10,14],suffix:'9',weight:0,rootless:true},
  {id:'dominant-thirteen',tones:[4,9,10,14],suffix:'13',weight:.05,rootless:true},
  {id:'dominant-spread',tones:[4,10,14,21],suffix:'13',weight:0,rootless:true,spread:true},
  {id:'dominant-flat-nine',tones:[4,7,10,13],suffix:'7(♭9)',weight:1.3,rootless:true},
  {id:'dominant-thirteen-flat-nine',tones:[4,9,10,13],suffix:'13(♭9)',weight:1.6,rootless:true},
  {id:'dominant-altered',tones:[4,10,13,20],suffix:'7(♭9,♭13)',weight:2.1,rootless:true,spread:true}
 ],
 diminished:[{id:'diminished-seven',tones:[0,3,6,9],suffix:'°7',weight:0}]
};

function closePositions(pcs){
 const positions=[];
 for(const bottomPc of pcs)for(let bottom=48+mod(bottomPc);bottom<=76;bottom+=12){
  const notes=pcs.map(pc=>bottom+mod(pc-mod(bottom))).sort((a,b)=>a-b);
  if(notes.length===new Set(notes).size&&notes.at(-1)<=88)positions.push(notes);
 }
 return positions;
}

export function voiceAssignment(previous,next){
 // Monotone sequence alignment handles changing voice counts without allowing
 // inner voices to cross. Births/deaths cost enough to prefer real continuity.
 const a=sort(previous),b=sort(next),gap=11;
 const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(null));dp[0][0]={cost:0,pairs:[]};
 const put=(i,j,candidate)=>{if(!dp[i][j]||candidate.cost<dp[i][j].cost)dp[i][j]=candidate;};
 for(let i=0;i<=a.length;i++)for(let j=0;j<=b.length;j++){
  const state=dp[i][j];if(!state)continue;
  if(i<a.length&&j<b.length){const move=Math.abs(b[j]-a[i]);put(i+1,j+1,{cost:state.cost+move+(move>5?(move-5)*1.9:0)+(move>12?25:0)-(move===0?2.1:0),pairs:[...state.pairs,{from:a[i],to:b[j]}]});}
  if(i<a.length)put(i+1,j,{cost:state.cost+gap,pairs:[...state.pairs,{from:a[i],to:null}]});
  if(j<b.length)put(i,j+1,{cost:state.cost+gap,pairs:[...state.pairs,{from:null,to:b[j]}]});
 }
 return dp[a.length][b.length];
}

function contextCost(template,node,previous){
 const from=previous?.chord;if(!from)return 0;
 let score=0;
 if(node.type==='dominant'){
  const minorDoor=from.type==='major'&&node.pc===mod(from.pc+4);
  const fromDiminished=from.type==='diminished';
  if(template.suffix.includes('♭9'))score+=(minorDoor||fromDiminished)?-1.25:1.5;
  if(template.suffix.includes('♭13'))score+=minorDoor?-.8:1;
 }
 if(node.type==='major'&&from.type==='dominant'&&node.pc===mod(from.pc+5)){
  if(template.suffix==='6/9'||template.suffix==='6')score-=.5;
 }
 if(node.type==='minor'&&from.type==='dominant'&&node.pc===mod(from.pc+5)){
  if(template.suffix==='m9'||template.suffix==='m11')score-=.5;
 }
 return score;
}

function tendencyCost(node,previous,upper,assignment){
 const from=previous?.chord;if(!from)return 0;
 if(from.pc===node.pc){
  const suspension=from.type==='suspended'||from.type==='dominant-suspended';
  const interval=suspension?(from.qualityId==='sus2'?2:5):from.type==='augmented'?8:from.qualityId==='mMaj7'?11:null;
  const move=from.qualityId==='sus2'?2:-1;
  if(interval!==null)return assignment.pairs.reduce((score,p)=>score+(p.from!==null&&p.to!==null&&mod(p.from)===mod(from.pc+interval)&&p.to===p.from+move?-3:0),0);
 }
 if(from.type!=='dominant'||node.pc!==mod(from.pc+5)||!['major','minor'].includes(node.type))return 0;
 const third=mod(from.pc+4),seventh=mod(from.pc+10),targetThird=mod(node.pc+(node.type==='minor'?3:4));
 let score=0;
 for(const p of assignment.pairs){
  if(p.from===null)continue;
  if(mod(p.from)===third){
   if(p.to===p.from+1)score-=3;
   else if(upper.includes(p.from+1))score-=1;
   else if(p.to!==null&&Math.abs(p.to-p.from)>4)score+=2;
  }
  if(mod(p.from)===seventh&&p.to!==null){
   if(mod(p.to)===targetThird&&p.to<p.from&&p.from-p.to<=2)score-=2.5;
  }
 }
 return score;
}

const MAX_HAND_SPAN=12;
const MAX_HAND_NOTES=5;

function splitHands(notes){
 // Keep the bass on its own whenever the chord fits in the right hand.
 for(let split=Math.max(1,notes.length-MAX_HAND_NOTES);split<=Math.min(MAX_HAND_NOTES,notes.length-1);split++){
  if(notes[split-1]-notes[0]>MAX_HAND_SPAN)break;
  if(notes.at(-1)-notes[split]<=MAX_HAND_SPAN){
   return {leftHand:notes.slice(0,split),rightHand:notes.slice(split)};
  }
 }
 return null;
}

export function voicingCandidates(node,previous=null,mode='lush',context={}){
 const prior=Array.isArray(previous)?{notes:previous}:previous;
 const previousUpper=prior?.notes?.slice(1)||[],previousBass=prior?.notes?.[0];
 const style=mode==='pure'?'auto':context.style||'auto';
 const fixed=node.exact&&Array.isArray(node.intervals);
 // The left hand supplies the root, so larger chords need no duplicate root.
 const fixedTones=fixed?(node.intervals.length<6&&(mode==='pure'||(node.intervals.length<5&&style!=='rootless'))?node.intervals:node.intervals.filter(x=>mod(x)!==0)):null;
 const templates=fixed?[{id:'selected-'+node.qualityId,tones:fixedTones,suffix:node.label.slice(node.rootLabel.length),weight:0,rootless:!fixedTones.includes(0),spread:true}]:mode==='pure'?[{id:'pure',tones:{major:[0,4,7],minor:[0,3,7],dominant:[0,4,7,10],diminished:[0,3,6,9]}[node.type],suffix:{major:'',minor:'m',dominant:'7',diminished:'°7'}[node.type],weight:0}]:LIBRARY[node.type];
 const candidates=[],seen=new Set();
 const basses=[];for(let bass=33;bass<=48;bass++)if(mod(bass)===node.pc)basses.push(bass);
 function add(template,upper,family,closed=null){
  upper=sort(upper);
  if(upper[0]<48||upper.at(-1)>86||new Set(upper).size!==upper.length)return;
  if(upper.some((n,i)=>i>0&&upper[i-1]<55&&n-upper[i-1]<3))return;
  if(style!=='auto'&&family!==style&&!(style==='rootless'&&template.rootless))return;
  for(const bass of basses){
   if(upper[0]-bass<7)continue;
   const notes=[bass,...upper],hands=splitHands(notes);
   if(!hands)continue;
   const key=notes.join(',')+':'+family+':'+template.id;
   if(seen.has(key))continue;
   seen.add(key);
   const assignment=voiceAssignment(previousUpper,upper);
   let score=previousUpper.length?assignment.cost:Math.abs(upper.reduce((s,x)=>s+x,0)/upper.length-64)*.65;
   score+=Math.abs(upper.at(-1)-72)*.16+Math.abs(bass-40)*.10;
   score+=Math.max(0,upper.at(-1)-81)*.6+Math.max(0,55-upper[0])*.12;
   score+=template.weight+contextCost(template,node,prior);
   score+=(hands.leftHand.length-1)*.65;
   for(const hand of [hands.leftHand,hands.rightHand])score+=Math.max(0,hand.at(-1)-hand[0]-10)*.7;
   if(previousUpper.length){
    const topMove=Math.abs(upper.at(-1)-previousUpper.at(-1));score+=topMove*.75+Math.max(0,topMove-5)*1.7;
    score+=upper.reduce((s,x)=>s+(previousUpper.includes(x)?-1.1:0),0);
    score+=Math.abs(bass-previousBass)*.30;
    score+=tendencyCost(node,prior,upper,assignment);
   }
   if(family==='drop-2')score-=.65;
   if(family==='gospel')score-=.5;
   if(family==='drop-2-4')score+=.15;
   const fingerprint=notes.join(',');
   const recent=prior?.recent||[];
   if(context.revoice)score+=recent.filter(x=>x.fingerprint===fingerprint).length*3;
   score+=recent.slice(-4).filter(x=>x.family===family).length*.2;
   candidates.push({notes,...hands,upper,bass,family,closed,template:template.id,suffix:template.suffix,score,assignment,fingerprint});
  }
 }
 for(const template of templates){
  const pcs=[...new Set(template.tones.map(x=>mod(node.pc+x)))];
  for(const position of closePositions(pcs)){
   // A doubled octave supplies four real voices for explicitly selected triads.
   const closed=fixed&&mode!=='pure'&&pcs.length===3?[...position,position[0]+12]:position;
   if(mode==='pure'){
    add(template,closed,'basic',closed);
    if(closed.length===3)add(template,sort([closed[0]-12,...closed.slice(1)]),'basic',closed);
   }else{
    add(template,position,'close',position);
    if(closed.length>=4){
     add(template,dropVoicing(closed,[2]),'drop-2',closed);
     add(template,dropVoicing(closed,[2,4]),'drop-2-4',closed);
    }
    if(template.rootless)add(template,closed,'rootless',closed);
    // An open four-note grip over a separate bass, with a larger middle gap.
    if(closed.length>=4)add(template,sort([closed[0]-12,closed[1]-12,...closed.slice(2)]),'gospel',closed);
   }
  }
  if(mode!=='pure'&&template.spread)for(let root=36+node.pc;root<=72;root+=12)add(template,template.tones.map(x=>root+x),'gospel');
 }
 return candidates.sort((a,b)=>a.score-b.score);
}

export function makeVoicing(node,previous=[],mode='lush',random=Math.random,context={}){
 const prior=Array.isArray(previous)?{notes:previous}:previous;
 let candidates=voicingCandidates(node,prior,mode,context);
 if(!candidates.length)candidates=voicingCandidates(node,prior,mode,{...context,style:'auto'});
 const repeatedHarmony=same(prior?.chord,node)||(!prior?.chord&&mod(prior?.notes?.[0])===node.pc);
 if(context.revoice||repeatedHarmony){
  const alternatives=candidates.filter(c=>c.fingerprint!==(prior?.notes||[]).join(','));if(alternatives.length)candidates=alternatives;
 }
 const best=candidates[0].score;
 const pool=candidates.filter(c=>c.score<=best+(context.revoice?3.5:1.6));
 const weights=pool.map(c=>Math.exp(-(c.score-best)/1.4)),total=weights.reduce((a,b)=>a+b,0);
 let cursor=random()*total,index=0;while(index<pool.length-1&&cursor>weights[index])cursor-=weights[index++];
 const chosen=pool[index],baseVelocity=66+Math.round(random()*6);
 const velocities=chosen.notes.map((_,j)=>Math.max(44,Math.min(88,baseVelocity+(j===0?-7:j===chosen.notes.length-1?5:-2)+Math.round(random()*6-3))));
 const topFirst=random()<.2;
 const offsets=chosen.notes.map((_,j)=>j===0?0:(j===chosen.notes.length-1&&topFirst ? .008 : .012+j*.005+random()*.008));
 const root=node.rootLabel||node.label.replace(/m$|7$|°$/g,'');
 return {notes:chosen.notes,leftHand:chosen.leftHand,rightHand:chosen.rightHand,velocities,offsets,label:node.exact?node.label:root+chosen.suffix,family:chosen.family,template:chosen.template,closed:chosen.closed,chord:{id:node.id,pc:node.pc,type:node.type,qualityId:node.qualityId},voiceMap:chosen.assignment.pairs,kept:chosen.upper.filter(n=>(prior?.notes?.slice(1)||[]).includes(n)),score:chosen.score,rearticulate:!!context.revoice,recent:[...(prior?.recent||[]),{fingerprint:chosen.fingerprint,family:chosen.family}].slice(-8)};
}
