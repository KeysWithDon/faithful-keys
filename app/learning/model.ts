import { FEATURES, GOALS, SKILLS, SKILL_MAP, type LearningGoal } from './registry.ts';
export type SkillState = 'NOT STARTED' | 'LOCKED' | 'AVAILABLE' | 'INTRODUCED' | 'LEARNING' | 'IMPROVING' | 'NEAR MASTERY' | 'MASTERED' | 'REVIEW DUE' | 'NEEDS REVIEW';
export type Attempt = { skillId: string; correct: boolean; at: number; responseMs: number; hint: boolean; expected: string; answer: string; input: 'screen' | 'midi'; difficulty: number };
export type Session = { id: string; started: number; ended?: number; kind: 'practice' | 'placement' | 'test-out' | 'review'; target: string; attempts: Attempt[] };
export type SkillRecord = { attempts: number; correct: number; recent: Attempt[]; sessions: number; strongSessions: number; streak: number; exposures: number; hints: number; responseMs: number; lastPracticed: number; lastStrong: number; unlocked: boolean; provisional: boolean; reviewAt: number; retention: number; weakReviews: number; mastery: number; mistakes: Record<string, number> };
export type Profile = { version: 1; id: string; mode: 'explore' | 'guided'; goal: LearningGoal; placementDone: boolean; skills: Record<string, SkillRecord>; history: Session[]; lastSession: Session | null; updatedAt: number };
export const DAY = 86400000;
export function freshProfile(now = Date.now()): Profile { return { version: 1, id: `local-${now}`, mode: 'explore', goal: GOALS[0], placementDone: false, skills: {}, history: [], lastSession: null, updatedAt: now }; }
export function emptySkill(): SkillRecord { return { attempts: 0, correct: 0, recent: [], sessions: 0, strongSessions: 0, streak: 0, exposures: 0, hints: 0, responseMs: 0, lastPracticed: 0, lastStrong: 0, unlocked: false, provisional: false, reviewAt: 0, retention: 0, weakReviews: 0, mastery: 0, mistakes: {} }; }
export function prerequisitesMet(p: Profile, id: string): boolean { return !!SKILL_MAP[id] && SKILL_MAP[id].prerequisites.every(parent => p.skills[parent]?.unlocked); }
export function featureAllowed(p: Profile, feature: string): boolean { return p.mode === 'explore' || (feature in FEATURES && FEATURES[feature].requires.every(id => p.skills[id]?.unlocked)); }
export function guardedDestination(p: Profile, feature: string): string { return featureAllowed(p, feature) ? feature : 'guided'; }
export function skillState(p: Profile, id: string, now = Date.now()): SkillState {
  const r = p.skills[id];
  if (!prerequisitesMet(p,id) && !r?.unlocked) return 'LOCKED';
  if (!r?.attempts) return r ? 'INTRODUCED' : 'AVAILABLE';
  if (r.unlocked) return r.weakReviews ? 'NEEDS REVIEW' : now >= r.reviewAt ? 'REVIEW DUE' : 'MASTERED';
  return r.mastery >= 80 ? 'NEAR MASTERY' : r.mastery >= 65 ? 'IMPROVING' : 'LEARNING';
}
export function masteryScore(r: SkillRecord): number {
  if (!r.attempts) return 0;
  const recent = r.recent.reduce((sum,a) => sum + Number(a.correct),0) / Math.max(1,r.recent.length);
  const accuracy = r.correct / r.attempts;
  const efficiency = Math.min(1,15000 / Math.max(1000,r.responseMs / r.attempts));
  const hints = r.hints / r.attempts;
  const repeated = Math.min(1,Math.max(0,...Object.values(r.mistakes)) / 10);
  return Math.round(Math.max(0,Math.min(100, 40 * recent + 30 * accuracy + 15 * Math.min(1,r.streak / 3) + 10 * r.retention + 5 * efficiency - 15 * hints - 5 * repeated)));
}
export function recordAttempt(p: Profile, session: Session, attempt: Attempt): Profile {
  if (!SKILL_MAP[attempt.skillId] || !Number.isFinite(attempt.responseMs)) return p;
  const r = { ...(p.skills[attempt.skillId] ?? emptySkill()) };
  r.attempts++; r.correct += Number(attempt.correct); r.hints += Number(attempt.hint); r.responseMs += Math.max(0,attempt.responseMs); r.lastPracticed = attempt.at;
  r.recent = [...r.recent,attempt].slice(-40);
  r.mistakes = { ...r.mistakes };
  if (!attempt.correct) { const key = `${attempt.expected} → ${attempt.answer}`; r.mistakes[key] = (r.mistakes[key] ?? 0) + 1; }
  // Bound raw mistake strings while retaining the most frequent confusions.
  r.mistakes = Object.fromEntries(Object.entries(r.mistakes).sort((a,b) => b[1]-a[1]).slice(0,40));
  r.mastery = masteryScore(r);
  return { ...p, skills: { ...p.skills, [attempt.skillId]: r }, lastSession: { ...session, attempts: [...session.attempts, attempt] }, updatedAt: attempt.at };
}
export function completeSession(p: Profile, session: Session, now = Date.now()): Profile {
  if (p.history.some(s => s.id === session.id)) return p;
  const skills = { ...p.skills };
  for (const id of new Set(session.attempts.map(a => a.skillId))) {
    const a = session.attempts.filter(a => a.skillId === id);
    const r = { ...(skills[id] ?? emptySkill()) };
    const accuracy = a.filter(a => a.correct).length / a.length;
    const strong = accuracy >= .9 && a.filter(a => a.correct).length >= 4 && !a.some(a => a.hint);
    const separated = !r.lastStrong || now - r.lastStrong >= DAY;
    const due = r.unlocked && now >= r.reviewAt;
    r.sessions++;
    // Callers may complete a session directly (placement/test-out) without
    // streaming attempts through recordAttempt; fold those attempts in here.
    if (r.attempts < a.length) {
      const delta = a.length - r.attempts;
      r.attempts += delta;
      r.correct += a.slice(-delta).filter(attempt => attempt.correct).length;
      r.exposures += delta;
      r.responseMs += a.slice(-delta).reduce((sum, attempt) => sum + Math.max(0, attempt.responseMs), 0);
    }
    r.exposures += a.length;
    r.lastPracticed = Math.max(r.lastPracticed, ...a.map(attempt => attempt.at));
    if (strong && separated) { r.strongSessions++; r.streak++; r.lastStrong = now; }
    else if (accuracy < .7) r.streak = 0;
    if (due && a.length >= 3) { r.retention = accuracy; r.weakReviews = accuracy < .75 ? r.weakReviews + 1 : 0; }
    const testedOut = (session.kind === 'test-out' || session.kind === 'placement') && strong;
    // Test-out is provisional. Ordinary mastery needs spaced sessions, not button grinding.
    if (testedOut || (r.strongSessions >= 3 && r.exposures >= 12 && accuracy >= .9)) {
      r.unlocked = true; r.provisional = testedOut && r.strongSessions < 3;
    }
    if (r.unlocked && (strong || due)) r.reviewAt = now + (r.weakReviews || r.provisional ? DAY : Math.min(30,2 ** Math.min(5,r.strongSessions)) * DAY);
    r.mastery = masteryScore(r); skills[id] = r;
  }
  return { ...p, skills, history: [...p.history,{ ...session, ended: now }].slice(-100), lastSession: null, updatedAt: now };
}
export function recommendations(p: Profile, now = Date.now(), midi = false) {
  const tag = /Gospel/.test(p.goal) ? 'gospel' : /Worship/.test(p.goal) ? 'worship' : /Jazz/.test(p.goal) ? 'jazz' : /Ear|ear/.test(p.goal) ? 'ear' : '';
  return SKILLS.filter(s => prerequisitesMet(p,s.id) || p.skills[s.id]?.unlocked).map(s => {
    const r = p.skills[s.id]; const state = skillState(p,s.id,now);
    const due = state === 'REVIEW DUE' || state === 'NEEDS REVIEW';
    const weak = !!r?.attempts && !r.unlocked && r.mastery < 65;
    const score = 100 - s.stage * 8 + (due ? 55 : 0) + (weak ? 20 : 0) + (state === 'NEAR MASTERY' ? 18 : 0) + (s.tags.includes(tag) ? 16 : 0) + (midi && !s.kind.startsWith('ear') ? 3 : 0) - (r?.unlocked && !due ? 100 : 0) - (p.history.slice(-2).some(h => h.target === s.id) ? 12 : 0);
    return { skill: s, score, reason: due ? 'A retention check will keep this skill dependable.' : weak ? 'Focused practice will strengthen a concept you have already started.' : r?.attempts ? 'Build consistency across separate days to demonstrate lasting mastery.' : 'Your prerequisites are ready. This is the next practical step.' };
  }).sort((a,b) => b.score-a.score);
}
export const SESSION_MIX = { target: .6, weakness: .2, previous: .15, retention: .05 };
export function generateSession(p: Profile, target: string, count = 20, rng = Math.random): string[] {
  const eligible = SKILLS.filter(s => prerequisitesMet(p,s.id) || p.skills[s.id]?.unlocked).map(s => s.id);
  if (!eligible.includes(target)) return [];
  const weak = eligible.filter(id => id !== target && p.skills[id]?.attempts && !p.skills[id].unlocked);
  const previous = eligible.filter(id => id !== target && p.skills[id]?.unlocked);
  const review = previous.filter(id => p.skills[id].reviewAt <= Date.now());
  const pick = (pool: string[]) => pool.length ? pool[Math.floor(rng()*pool.length)] : target;
  const result = Array.from({length:count},(_,i) => i < count * SESSION_MIX.target ? target : i < count * (SESSION_MIX.target + SESSION_MIX.weakness) ? pick(weak) : i < count * (1-SESSION_MIX.retention) ? pick(previous) : pick(review));
  for (let i = result.length-1; i>0; i--) { const j = Math.floor(rng()*(i+1)); [result[i],result[j]] = [result[j],result[i]]; }
  return result;
}
