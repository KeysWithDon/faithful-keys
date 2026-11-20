import {lookupChord,TYPES} from './harmony.js';
import {chordKey} from './spectrum-model.js';

const interval = (pc, tonic) => (pc-tonic+12)%12;

export const FUNCTION_LANES = [
  {label:'Prepare', description:'Lead toward the dominant', color:'#6cc8c7'},
  {label:'Create tension', description:'Pull toward an arrival', color:'#efba7e'},
  {label:'Arrive', description:'Rest or return home', color:'#badd99'},
  {label:'Change color', description:'Borrow or move to another key', color:'#ba9ee9'}
];

const CORE = [
  [[2,'m','ii'],[2,'m9','ii⁹'],[5,'M','IV'],[5,'maj7','IVmaj7'],[5,'m','iv · borrowed'],[2,'half','iiø7 · borrowed']],
  [[7,'7','V7'],[7,'13','V13'],[7,'7sus4','V7sus4'],[11,'dim','vii°'],[11,'dim7','vii°7'],[1,'7','♭II7 · tritone sub']],
  [[0,'M','I'],[0,'maj9','Imaj9'],[0,'69','I6/9'],[9,'m','vi'],[9,'m9','vi⁹'],[4,'m7','iii7']],
  [[9,'7','V7/ii'],[0,'7','V7/IV'],[2,'7','V7/V'],[4,'7','V7/vi'],[10,'7','♭VII7 · backdoor'],[8,'maj7','♭VImaj7 · borrowed']]
];
const MAJOR_DEGREES=['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];
const DIATONIC=[0,2,4,5,7,9,11];
const LETTERS='CDEFGAB';
const LETTER_DEGREES=[0,1,1,2,2,3,3,4,5,5,6,6];

export function spellInKey(chord,[tonicLabel,tonic]){
  const degree=interval(chord.pc,tonic);
  const index=(LETTERS.indexOf(tonicLabel[0])+LETTER_DEGREES[degree])%7;
  const difference=(chord.pc-DIATONIC[index]+18)%12-6;
  const accidental=difference<0?'♭'.repeat(-difference):'♯'.repeat(difference);
  const rootLabel=LETTERS[index]+accidental;
  return {...chord,rootLabel,label:rootLabel+TYPES[chord.qualityId].suffix};
}

export function coreChords(tonic){
  return CORE.flatMap((lane,column)=>lane.map(([offset,quality,role],slot)=>{
    const chord=lookupChord(tonic+offset,quality);
    return {key:chordKey(chord),column,slot,role};
  }));
}

export function chordFunction(chord,tonic,core=coreChords(tonic)){
  const known=core.find(item=>item.key===chordKey(chord));
  if(known)return known;
  const degree=interval(chord.pc,tonic);
  const dominant=chord.family==='dominant';
  const leading=chord.type==='diminished';
  const minor=chord.type==='minor'||chord.type==='half-diminished';
  const basicDegree=MAJOR_DEGREES[degree];
  const numeral=minor||leading?basicDegree.toLowerCase():basicDegree;
  const suffix=chord.qualityId==='dim7'?'°7':leading?'°':chord.type==='half-diminished'?'ø7':'';
  if(dominant){
    if(degree===7)return {column:1,role:'V · dominant'};
    if(degree===1)return {column:1,role:'♭II · tritone sub'};
    if(degree===10)return {column:3,role:'♭VII · backdoor'};
    const target=(degree+5)%12;
    const diatonicTarget=[2,4,5,7,9].includes(target);
    const destination=[2,4,9].includes(target)?MAJOR_DEGREES[target].toLowerCase():MAJOR_DEGREES[target];
    return {column:3,role:diatonicTarget?'V/'+destination:'Dominant outside key'};
  }
  if(leading&&degree===11)return {column:1,role:'vii'+suffix+' · leading tone'};
  if((degree===2&&minor)||(degree===5&&(chord.type==='major'||minor)))return {column:0,role:numeral+suffix+(degree===5&&minor?' · borrowed':'')};
  if((degree===0&&chord.type==='major')||([4,9].includes(degree)&&chord.type==='minor'))return {column:2,role:numeral+suffix};
  return {column:3,role:numeral+suffix+(DIATONIC.includes(degree)?' · color':' · outside key')};
}

export function contextualPlan(chord,tonic){
  const degree=interval(chord.pc,tonic);
  let route,kind,explanation;
  if((degree===2&&chord.type==='minor')||(degree===5&&chord.type==='major')){
    route=[lookupChord(tonic+7,'13'),lookupChord(tonic,'maj9')];
    kind='prepare-dominant';
    explanation=degree===2?'Hear the minor 2 prepare the dominant 5, then listen for the release into the major 1.':'The 4 chord prepares the dominant 5, which pulls back to the major 1.';
  }else if(degree===5&&chord.type==='minor'){
    route=[lookupChord(tonic,'maj9')];
    kind='borrowed-plagal';
    explanation='Borrow minor iv from the parallel minor. Its flat sixth can fall a half step into the fifth of the major tonic.';
  }else if(chord.type==='dominant'&&[1,10].includes(degree)){
    route=[lookupChord(tonic,'maj9')];
    kind=degree===1?'tritone-home':'backdoor-home';
    explanation=degree===1?'The substitute dominant shares the V7 tritone. Its bass falls a half step into the tonic.':'The borrowed flat VII dominant approaches I from a whole step below.';
  }else if(chord.type==='dominant'&&[0,2,4,9].includes(degree)){
    const target=(degree+5)%12;
    route=target===7
      ? [lookupChord(tonic+7,'13'),lookupChord(tonic,'maj9')]
      : [lookupChord(tonic+target,[2,9].includes(target)?'m9':'maj9')];
    kind='dominant-resolution';
    explanation='This secondary dominant resolves into the chord it is named for, giving that chord a brief sense of home.';
  }
  if(!route)return null;
  return {steps:[chord,...route],goal:route.at(-1),kind,atRest:false,explanation};
}
