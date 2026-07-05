import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPrefs, putPrefs, type Prefs } from '../api';
import { loadCachedPrefs, saveCachedPrefs } from '../state/localStorageCache';

const DEFAULT_PREFS: Prefs = { theme: 'auto', refreshIntervalSec: 60, cards: [] };

export function usePrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(() => loadCachedPrefs() ?? DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const latestPrefsRef = useRef(prefs);

  useEffect(() => {
    latestPrefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    fetchPrefs()
      .then(next => {
        if (cancelled) return;
        setPrefsState(next);
        saveCachedPrefs(next);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const setPrefs = useCallback((partial: Partial<Prefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...partial };
      latestPrefsRef.current = next;
      saveCachedPrefs(next);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void putPrefs(latestPrefsRef.current).catch(() => {});
      }, 500);
      return next;
    });
  }, []);

  return { prefs, setPrefs, ready };
}
