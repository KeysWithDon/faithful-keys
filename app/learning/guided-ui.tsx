'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import EarTraining from '../ear-training-ui';
import { useMidi } from '../midi/ui';
import { FEATURES, GOALS, SKILLS, SKILL_MAP, STAGES, type LearningGoal } from './registry';
import { completeSession, DAILY_GOALS, featureAllowed, generateAssessmentPlan, generateSession, prerequisitesMet, recordPracticeTime, recommendations, recordAttempt, skillState, type Profile, type Session } from './model';
import { LearningExercise, type ExerciseResult } from './exercise-ui';
import { questionFor } from './exercises';
import './learning.css';
type Props={profile:Profile;update:(fn:(p:Profile)=>Profile)=>void;reset:()=>void;error:string;playNotes:(notes:number[],seconds:number,level:number)=>void;stopAudio:()=>void;onFeature:(id:string)=>void};
export default function GuidedLearning({profile,update,reset,error,playNotes,stopAudio,onFeature}:Props) {
  const midi=useMidi();
  const [view,setView]=useState<'home'|'progress'|'roadmap'>('home');
  const [session,setSession]=useState<Session|null>(null),[plan,setPlan]=useState<string[]>([]),[index,setIndex]=useState(0),[summary,setSummary]=useState('');
  const sessionRef=useRef<Session|null>(null), recent=useRef<string[]>([]), trackedMs=useRef(0);
  const [clock,setClock]=useState(Date.now());
  const next=recommendations(profile,Date.now(),midi.status==='Connected')[0];
  const id=plan[index]; const skill=SKILL_MAP[id];
  const question=useMemo(()=>skill&&!skill.kind.startsWith('ear')?questionFor(id,profile,recent.current):null,[id,index,session?.id]);
  const nextLocked=SKILLS.filter(s=>!profile.skills[s.id]?.unlocked&&!prerequisitesMet(profile,s.id)).sort((a,b)=>a.prerequisites.filter(p=>!profile.skills[p]?.unlocked).length-b.prerequisites.filter(p=>!profile.skills[p]?.unlocked).length||a.stage-b.stage)[0];
  useEffect(()=>{ if (!session) return; trackedMs.current=0; const timer=window.setInterval(()=>setClock(Date.now()),1000); return ()=>window.clearInterval(timer); },[session?.id]);
  useEffect(()=>{
    if (!session) return undefined;
    const timer=window.setInterval(()=>{
      const elapsed=Math.max(0,Date.now()-session.started), delta=elapsed-trackedMs.current;
      if (delta >= 5000) { trackedMs.current=elapsed; update(p=>recordPracticeTime(p,delta,Date.now())); }
    },5000);
    return ()=>window.clearInterval(timer);
  },[session?.id]);
  function start(target:string,kind:Session['kind']='practice') {
    if(!prerequisitesMet(profile,target)&&!profile.skills[target]?.unlocked)return;
    const items=kind==='test-out'||kind==='placement'?generateAssessmentPlan(target,kind):generateSession(profile,target);
    const value:Session={id:`session-${Date.now()}-${Math.random().toString(36).slice(2)}`,started:Date.now(),kind,target,attempts:[]};
    sessionRef.current=value;setSession(value);setPlan(items);setIndex(0);setSummary('');update(p=>({...p,lastSession:value}));
  }
  function answer(a:ExerciseResult) {
    const active=sessionRef.current;if(!active)return;
    const attempt={...a,skillId:id,at:Date.now(),difficulty:skill.stage};
    update(p=>recordAttempt(p,active,attempt));
    sessionRef.current={...active,attempts:[...active.attempts,attempt]};
  }
  function finish() {
    const active=sessionRef.current;if(!active)return;
    const elapsed=Math.max(0,Date.now()-active.started), remaining=Math.max(0,elapsed-trackedMs.current);
    trackedMs.current=elapsed;
    update(p=>{ const completed=completeSession(recordPracticeTime(p,remaining,Date.now()),active); return active.kind==='placement' ? {...completed,placementDone:true} : completed; });
    const correct=active.attempts.filter(a=>a.correct).length;
    setSummary(`${correct} correct / ${active.attempts.length} attempts. ${active.kind==='placement'||active.kind==='test-out'?'Strong results grant provisional credit; a later retention check confirms it.':'Lasting mastery requires strong sessions on separate days.'}`);
    setSession(null);sessionRef.current=null;stopAudio();
  }
  function advance() {if(question)recent.current=[...recent.current.slice(-5),question.id];if(index+1>=plan.length)finish();else setIndex(i=>i+1);}
  function leave() { finish(); }
  if(session&&skill) {
    // Recheck access at render, including after another tab changes progress.
    if(session.kind!=='placement'&&!prerequisitesMet(profile,id)&&!profile.skills[id]?.unlocked) return <section className="guided-shell"><p>Locked. Complete the prerequisite first.</p><button onClick={()=>{setSession(null);sessionRef.current=null;}}>Guided dashboard</button></section>;
    const record=profile.skills[id];
    const intervals=skill.id==='basic-intervals'?[7,12]:skill.id==='intervals'?(record?.exposures??0)<6?[3,4]:[1,2,3,4,5,7,9,12]:[12,13,14,15,16,17,19,21,24];
    const scales=skill.id==='mode-recognition'?['major','natural-minor','dorian','mixolydian']:['major','natural-minor'];
    const elapsedMinutes=Math.floor(Math.max(0,clock-session.started-trackedMs.current)/60000), goal=profile.dailyGoalMinutes;
    return <div className="guided-shell guided-session"><header className="learning-session-header"><button onClick={leave}>Save & exit</button><span>{skill.title} · {index+1} / {plan.length}</span></header>
      {error&&<p role="alert">{error}</p>}
      <p className="learning-small">{session.kind==='placement'?'Expanded placement assessment':session.kind==='test-out'?'Thorough test-out':'Guided practice'} · {skill.lesson}</p>
      <div className="daily-lesson-meter" aria-label="Daily lesson progress"><strong>Today: {Math.floor(profile.dailyPracticeMs/60000)+elapsedMinutes} / {goal} min</strong><progress value={Math.min(goal,Math.floor(profile.dailyPracticeMs/60000)+elapsedMinutes)} max={goal}/><span>{Math.floor(profile.dailyPracticeMs/60000)+elapsedMinutes >= goal ? 'Daily target reached — keep going if you want.' : `${goal-elapsedMinutes-Math.floor(profile.dailyPracticeMs/60000)} min remaining`}</span></div>
      {skill.kind.startsWith('ear')?<EarTraining key={`${session.id}:${index}`} playNotes={playNotes} stopAudio={stopAudio} onExit={leave} guided={{intervals:skill.kind==='ear-interval'?intervals:undefined,scales:skill.kind==='ear-scale'?scales:undefined,onAttempt:answer,onNext:advance}}/>:question&&<LearningExercise key={`${session.id}:${index}`} question={question} playNotes={playNotes} stopAudio={stopAudio} onAttempt={answer} onNext={advance}/>}
    </div>;
  }
  return <section className="guided-shell" aria-labelledby="guided-title">
    <header className="learning-session-header"><div><small>FAITHFUL KEYS · GUIDED MODE</small><h1 id="guided-title">One faithful step at a time.</h1></div></header>
    {error&&<p role="alert">{error}</p>}{summary&&<p role="status">{summary}</p>}
    <nav className="learning-actions" aria-label="Guided navigation"><button onClick={()=>setView('home')} aria-pressed={view==='home'}>Learning home</button><button onClick={()=>setView('progress')} aria-pressed={view==='progress'}>View Progress</button><button onClick={()=>setView('roadmap')} aria-pressed={view==='roadmap'}>Skill roadmap</button></nav>
    <div className="learning-scroll">
    {view==='home'&&<>
      {!profile.placementDone?<section className="learning-focus"><small>FIND YOUR STARTING POINT</small><h2>Let’s meet you where you are.</h2><p>Take a broad 40-question assessment across notes, geography, scales, chords, progressions, theory and rhythm. Each topic gets repeated evidence, so placement reflects dependable skill rather than a lucky answer.</p><button className="learning-primary" onClick={()=>start(next.skill.id,'placement')}>Start expanded placement</button><button onClick={()=>update(p=>({...p,placementDone:true}))}>Start curriculum here</button><p className="learning-small">You can save and exit. Only skills you demonstrate receive provisional credit.</p></section>:<section className="learning-focus"><small>YOUR NEXT STEP</small><h2>{next.skill.title}</h2><p>{next.reason}</p><p>Keys: {(profile.skills[next.skill.id]?.exposures??0)>=8?'All 12 tonal centers':'C, F, B♭'} · Stage {next.skill.stage}</p><button className="learning-primary" onClick={()=>start(next.skill.id)}>CONTINUE LEARNING</button><button onClick={()=>start(next.skill.id,'test-out')}>Thorough test-out · 12 questions</button></section>}
      {profile.lastSession&&<p className="learning-small">Your previous attempts are saved. Continue Learning creates a fresh session from your current progress.</p>}
      <div className="learning-actions"><button onClick={()=>{const target=recommendations(profile).find(r=>['REVIEW DUE','NEEDS REVIEW'].includes(skillState(profile,r.skill.id)));if(target)start(target.skill.id,'review');else setSummary('No reviews due. Continue Learning will introduce your next skill.');}}>Review Skills</button><button onClick={()=>{const target=recommendations(profile).find(r=>profile.skills[r.skill.id]?.attempts&&!profile.skills[r.skill.id]?.unlocked);if(target)start(target.skill.id);else setSummary('No weak skills yet. Unlearned material is not counted as a weakness.');}}>Practice Weak Areas</button></div>
      <label>Learning goal<select value={profile.goal} onChange={e=>update(p=>({...p,goal:e.target.value as LearningGoal}))}>{GOALS.map(goal=><option key={goal}>{goal}</option>)}</select></label>
      <label>Daily lesson minimum<select value={profile.dailyGoalMinutes} onChange={e=>update(p=>({...p,dailyGoalMinutes:Number(e.target.value) as Profile['dailyGoalMinutes']}))}>{DAILY_GOALS.map(minutes=><option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
      <div className="daily-lesson-meter"><strong>Today’s practice: {Math.floor(profile.dailyPracticeMs/60000)} / {profile.dailyGoalMinutes} min</strong><progress value={Math.min(profile.dailyGoalMinutes,Math.floor(profile.dailyPracticeMs/60000))} max={profile.dailyGoalMinutes}/><span>{Math.floor(profile.dailyPracticeMs/60000)>=profile.dailyGoalMinutes?'Target complete. Extra practice still counts.':'Your target is a minimum, not a cutoff.'}</span></div>
      {nextLocked&&<section className="learning-unlock"><small>NEXT UNLOCK</small><h3>{nextLocked.title}</h3>{nextLocked.prerequisites.map(id=><p key={id}>{profile.skills[id]?.unlocked?'✓':'○'} {SKILL_MAP[id].title} · {profile.skills[id]?.mastery??0}%</p>)}</section>}
      <details><summary>Learning tools · available and locked</summary><div className="learning-tools">{Object.entries(FEATURES).map(([id,f])=><div key={id}><button disabled={!featureAllowed(profile,id)} onClick={()=>onFeature(id)}>{featureAllowed(profile,id)?'Open':'LOCKED'} · {f.title}</button>{!featureAllowed(profile,id)&&<small>Requires: {f.requires.filter(id=>!profile.skills[id]?.unlocked).map(id=>SKILL_MAP[id].title).join(', ')}</small>}</div>)}</div></details>
    </>}
    {view==='progress'&&<><h2>Your progress</h2><p>Current focus: {next.skill.title}</p><div className="learning-stage-grid">{STAGES.map((title,index)=>{const group=SKILLS.filter(s=>s.stage===index+1),value=Math.round(group.reduce((n,s)=>n+(profile.skills[s.id]?.mastery??0),0)/group.length);return <section key={title}><h3>{title}</h3><progress value={value} max={100}/><span>{value}%</span></section>;})}</div><h3>Recently mastered / review due</h3>{SKILLS.filter(s=>profile.skills[s.id]?.unlocked).map(s=><p key={s.id}>{s.title} · {skillState(profile,s.id)}{profile.skills[s.id].provisional?' · Provisional':''}</p>)}<p className="learning-small">Mastery combines recent and historical accuracy, consistency across days, retention, response efficiency, hint use and repeated mistakes. One weak review does not revoke earned access.</p></>}
    {view==='roadmap'&&<><h2>Prerequisite roadmap</h2>{STAGES.map((title,i)=><details key={title} open={i===0}><summary>{i+1} · {title}</summary><div className="learning-roadmap">{SKILLS.filter(s=>s.stage===i+1).map(s=><article key={s.id}><strong>{s.title}</strong><span>{skillState(profile,s.id)}</span><small>{s.prerequisites.length?`Requires ${s.prerequisites.map(id=>SKILL_MAP[id].title).join(' + ')}`:'Start here'}</small><button disabled={!prerequisitesMet(profile,s.id)&&!profile.skills[s.id]?.unlocked} onClick={()=>start(s.id,profile.placementDone?'practice':'placement')}>Practice</button><button disabled={!prerequisitesMet(profile,s.id)} onClick={()=>start(s.id,'test-out')}>Test out</button></article>)}</div></details>)}</>}
    <details><summary>Progress settings & help</summary><p>Progress is saved on this browser, not an account. Clearing site data removes it; private browsing may not retain it. Switching to Explore preserves it. Connect MIDI only when you want to use a physical keyboard.</p><button onClick={()=>{if(window.confirm('Reset only Guided learning progress? Saved songs, custom progressions, MIDI and other preferences will be kept.')){reset();setSummary('Guided progress reset. Other Faithful Keys data was kept.');}}}>RESET GUIDED PROGRESS</button><button onClick={()=>update(p=>({...p,placementDone:false}))}>Revisit placement</button></details>
    {import.meta.env.DEV&&<details><summary>Development diagnostics</summary><pre>{JSON.stringify({recommendations:recommendations(profile),sessionMix:plan,midi,skills:profile.skills},null,2)}</pre></details>}
    </div>
  </section>;
}
