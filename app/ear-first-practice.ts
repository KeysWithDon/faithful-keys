import {exactMatch,exactNotes,generateResolution,type ResolutionMode} from './ear-first-engine.ts';

export type ListeningPhase='idle'|'chunk'|'ready'|'full'|'complete';
export type ListeningSession={phase:ListeningPhase;chords:number[][];chunk:number;step:number;turn:number};
export const IDLE_SESSION:ListeningSession={phase:'idle',chords:[],chunk:0,step:0,turn:0};
const VOICINGS:Record<number,number[]>={
  2:[0,16],3:[0,16,23],4:[0,7,16,23],5:[0,7,16,23,26],
  6:[0,7,16,19,23,26],7:[0,7,11,16,19,23,26],8:[0,7,11,16,19,23,26,31],
  9:[0,7,11,14,16,19,23,26,31],10:[0,7,11,14,16,19,23,26,31,35],
};
const ROOTS=[0,5,10,3,8,1,6,11,4,9,2,7];
export function createListeningSession(voices:number,maxChords:1|2|3|4,mode:ResolutionMode,turn=0):ListeningSession{
  const offsets=VOICINGS[voices];if(!offsets)throw new Error('Choose 2–10 voices.');
  const root=36+ROOTS[((turn%12)+12)%12];
  const quality=((turn%3)+3)%3;
  const home=exactNotes(offsets.map(offset=>root+offset-(quality===1&&offset%12===4?1:quality!==0&&offset%12===11?1:0)));
  const result=generateResolution(home,maxChords,mode,turn);
  // The teacher supplies Home and immediately asks for the first movement.
  return {phase:'chunk',chords:result.chords,chunk:0,step:1,turn};
}
export function listeningTarget(session:ListeningSession):number[]{
  if(session.phase==='chunk')return session.chords[session.chunk+(session.step%2)]??[];
  if(session.phase==='full')return session.chords[session.step%session.chords.length]??[];
  return [];
}
export function listeningOrigin(session:ListeningSession):number[]{
  if(session.phase==='chunk')return session.chords[session.chunk+(session.step%2===0?1:0)]??[];
  if(session.phase==='full'&&session.step%session.chords.length>0)return session.chords[session.step%session.chords.length-1]??[];
  return [];
}
export function nextListeningStep(session:ListeningSession):ListeningSession{
  if(session.phase==='chunk'){
    if(session.step<6)return {...session,step:session.step+1};
    if(session.chunk<session.chords.length-2)return {...session,chunk:session.chunk+1,step:1};
    return {...session,phase:'ready',step:0};
  }
  if(session.phase==='full')return session.step<session.chords.length*3-1
    ?{...session,step:session.step+1}:{...session,phase:'complete',step:0};
  return session;
}
export function checkListeningAnswer(heard:boolean,played:readonly number[],target:readonly number[]):'listen'|'empty'|'correct'|'incorrect'{
  if(!heard)return 'listen';
  if(!exactNotes(played).length)return 'empty';
  return exactMatch(played,target)?'correct':'incorrect';
}
