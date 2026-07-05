import type { Prefs, SourceResult } from '../api';

const AGGREGATE_KEY = 'dashboard:lastAggregate';
const PREFS_KEY = 'dashboard:prefs';

export interface CachedAggregate {
  uid: string | null;
  sources: SourceResult[];
  lastUpdatedAt: Date | null;
}

interface StoredAggregate {
  uid?: string | null;
  sources?: SourceResult[];
  lastUpdatedAt?: string | null;
}

export function loadCachedAggregate(): CachedAggregate | null {
  try {
    const raw = localStorage.getItem(AGGREGATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAggregate;
    if (!Array.isArray(parsed.sources)) return null;
    return {
      uid: parsed.uid ?? null,
      sources: parsed.sources,
      lastUpdatedAt: parsed.lastUpdatedAt ? new Date(parsed.lastUpdatedAt) : null,
    };
  } catch {
    return null;
  }
}

export function saveCachedAggregate(aggregate: CachedAggregate): void {
  try {
    localStorage.setItem(
      AGGREGATE_KEY,
      JSON.stringify({
        uid: aggregate.uid,
        sources: aggregate.sources,
        lastUpdatedAt: aggregate.lastUpdatedAt?.toISOString() ?? new Date().toISOString(),
      }),
    );
  } catch {
    // localStorage may be unavailable.
  }
}

export function loadCachedPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Prefs;
  } catch {
    return null;
  }
}

export function saveCachedPrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable.
  }
}
