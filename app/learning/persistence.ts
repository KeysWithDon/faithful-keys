import { DAILY_GOALS, emptySkill, freshProfile, type DailyGoalMinutes, type Profile, dayKey } from './model.ts';
import { GOALS, SKILL_MAP } from './registry.ts';
export const LEARNING_KEY = 'faithful-keys-learning-v1';
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function loadLearning(storage: StoragePort): { profile: Profile; error: string; writable: boolean } {
  try {
    const raw = storage.getItem(LEARNING_KEY);
    if (!raw) return { profile: freshProfile(), error: '', writable: true };
    const data = JSON.parse(raw);
    if (data.version !== 1) return { profile: freshProfile(), error: 'This progress uses a different schema. It has been preserved; this version will not overwrite it.', writable: false };
    if (!data.skills || typeof data.skills !== 'object' || Array.isArray(data.skills) || !Array.isArray(data.history)) throw new Error('Invalid profile');
    const profile = freshProfile();
    profile.id = typeof data.id === 'string' ? data.id : profile.id;
    profile.mode = data.mode === 'guided' ? 'guided' : 'explore';
    profile.goal = GOALS.includes(data.goal) ? data.goal : GOALS[0];
    profile.placementDone = data.placementDone === true;
    profile.dailyGoalMinutes = DAILY_GOALS.includes(data.dailyGoalMinutes) ? data.dailyGoalMinutes as DailyGoalMinutes : 15;
    profile.dailyPracticeDay = typeof data.dailyPracticeDay === 'string' ? data.dailyPracticeDay : dayKey();
    profile.dailyPracticeMs = Number.isFinite(data.dailyPracticeMs) && data.dailyPracticeMs >= 0 ? data.dailyPracticeMs : 0;
    if (profile.dailyPracticeDay !== dayKey()) { profile.dailyPracticeDay = dayKey(); profile.dailyPracticeMs = 0; }
    for (const [id,value] of Object.entries(data.skills)) {
      if (!SKILL_MAP[id] || !value || typeof value !== 'object') continue;
      const r = { ...emptySkill(), ...value } as ReturnType<typeof emptySkill>;
      for (const field of ['attempts','correct','sessions','strongSessions','streak','exposures','hints','responseMs','lastPracticed','lastStrong','reviewAt','retention','weakReviews','mastery'] as const) {
        if (typeof r[field] !== 'number' || !Number.isFinite(r[field]) || r[field] < 0) throw new Error('Invalid skill');
      }
      if (!Array.isArray(r.recent) || !r.mistakes || typeof r.mistakes !== 'object') throw new Error('Invalid history');
      r.recent = r.recent.slice(-40); r.unlocked = r.unlocked === true; r.provisional = r.provisional === true;
      profile.skills[id] = r;
    }
    profile.history = data.history.filter((s: any) => s && typeof s.id === 'string' && Array.isArray(s.attempts)).slice(-100);
    // Interrupted sessions keep their recorded attempts, but are resumed as new sessions.
    profile.lastSession = data.lastSession && Array.isArray(data.lastSession.attempts) ? data.lastSession : null;
    profile.updatedAt = Number.isFinite(data.updatedAt) ? data.updatedAt : 0;
    return { profile, error: '', writable: true };
  } catch { return { profile: freshProfile(), error: 'Local progress could not be read. The original data is preserved. Reset Guided Progress to start a new profile.', writable: false }; }
}
export function saveLearning(storage: StoragePort, p: Profile): boolean {
  try { storage.setItem(LEARNING_KEY,JSON.stringify(p)); return true; } catch { return false; }
}
export function resetLearning(storage: StoragePort) { storage.removeItem(LEARNING_KEY); }
