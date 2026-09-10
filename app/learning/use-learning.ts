'use client';
import { useEffect, useRef, useState } from 'react';
import { freshProfile, type Profile } from './model';
import { LEARNING_KEY, loadLearning, resetLearning, saveLearning } from './persistence';
export function useLearning() {
  const [profile,setProfile] = useState<Profile>(freshProfile);
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  const writable = useRef(false);
  const current = useRef(profile);
  useEffect(() => {
    try {
      const loaded = loadLearning(window.localStorage);
      writable.current = loaded.writable; current.current = loaded.profile;
      setProfile(loaded.profile); setError(loaded.error);
    } catch { setError('Browser storage is unavailable. Progress will last only for this tab.'); }
    setReady(true);
    const sync = (e: StorageEvent) => { if (e.key === LEARNING_KEY) { const loaded = loadLearning(window.localStorage); writable.current = loaded.writable; current.current = loaded.profile; setProfile(loaded.profile); setError(loaded.error); } };
    window.addEventListener('storage',sync);
    return () => window.removeEventListener('storage',sync);
  },[]);
  function update(change: (p: Profile) => Profile) {
    const next = change(current.current); current.current = next; setProfile(next);
    if (writable.current) {
      if (!saveLearning(window.localStorage,next)) setError('Progress could not be saved. Browser storage may be full or disabled. Keep this tab open.');
      else {
        setError('');
        document.cookie = `fk_learning_mode=${next.mode}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
      }
    }
  }
  function reset() {
    try { resetLearning(window.localStorage); writable.current = true; update(() => ({...freshProfile(),mode:'guided'})); }
    catch { setError('Unable to reset local progress. Browser storage is unavailable.'); }
  }
  return { profile, ready, error, update, reset };
}
