import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAggregate, fetchRefreshSource, type SourceResult } from '../api';
import { loadCachedAggregate, saveCachedAggregate } from '../state/localStorageCache';

export interface EnrichedSourceResult extends SourceResult {
  receivedAt: Date;
}

export interface AggregateStreamState {
  sources: EnrichedSourceResult[];
  uid: string | null;
  status: 'loading' | 'streaming' | 'idle' | 'error';
  lastUpdatedAt: Date | null;
  freshSlugs: Set<string>;
  refresh(): void;
  refreshSource(slug: string): Promise<void>;
}

const MAX_BACKOFF_MS = 30_000;

function initialState() {
  const cached = loadCachedAggregate();
  const receivedAt = cached?.lastUpdatedAt ?? new Date(0);
  return {
    map: new Map((cached?.sources ?? []).map(s => [s.slug, { ...s, receivedAt }] as const)),
    uid: cached?.uid ?? null,
    lastUpdatedAt: cached?.lastUpdatedAt ?? null,
    status: cached?.sources.length ? 'idle' as const : 'loading' as const,
  };
}

function toSourceResults(map: Map<string, EnrichedSourceResult>): SourceResult[] {
  return Array.from(map.values()).map(({ receivedAt, ...source }) => source);
}

export function useAggregateStream(): AggregateStreamState {
  const init = useRef(initialState()).current;
  const [sourcesMap, setSourcesMap] = useState<Map<string, EnrichedSourceResult>>(init.map);
  const [uid, setUidState] = useState<string | null>(init.uid);
  const [status, setStatus] = useState<AggregateStreamState['status']>(init.status);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(init.lastUpdatedAt);
  const [freshSlugs, setFreshSlugs] = useState<Set<string>>(new Set());

  const sourcesMapRef = useRef(init.map);
  const uidRef = useRef<string | null>(init.uid);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const backoffRef = useRef(1_000);
  const generationRef = useRef(0);
  const unmountedRef = useRef(false);

  const setUid = useCallback((nextUid: string | null) => {
    uidRef.current = nextUid;
    setUidState(nextUid);
  }, []);

  const setMap = useCallback((updater: (prev: Map<string, EnrichedSourceResult>) => Map<string, EnrichedSourceResult>) => {
    setSourcesMap(prev => {
      const next = updater(prev);
      sourcesMapRef.current = next;
      return next;
    });
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const persist = useCallback((nextUid: string | null, map: Map<string, EnrichedSourceResult>, updatedAt: Date) => {
    saveCachedAggregate({ uid: nextUid, sources: toSourceResults(map), lastUpdatedAt: updatedAt });
  }, []);

  const scheduleRetry = useCallback((start: () => void) => {
    clearRetry();
    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
    retryTimerRef.current = window.setTimeout(start, delay);
  }, [clearRetry]);

  const start = useCallback((resetBackoff = false) => {
    if (unmountedRef.current || document.hidden) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearRetry();
    closeStream();
    if (resetBackoff) backoffRef.current = 1_000;
    setStatus(sourcesMapRef.current.size > 0 ? 'streaming' : 'loading');

    void (async () => {
      try {
        const aggregate = await fetchAggregate();
        if (unmountedRef.current || generationRef.current !== generation) return;
        const receivedAt = new Date();
        setUid(aggregate.uid);
        setLastUpdatedAt(receivedAt);
        setFreshSlugs(prev => {
          const next = new Set(prev);
          aggregate.sources.forEach(s => next.add(s.slug));
          return next;
        });
        setMap(prev => {
          const next = new Map(prev);
          aggregate.sources.forEach(s => next.set(s.slug, { ...s, receivedAt }));
          persist(aggregate.uid, next, receivedAt);
          return next;
        });
        setStatus('streaming');
      } catch {
        if (unmountedRef.current || generationRef.current !== generation) return;
        setStatus('error');
        scheduleRetry(() => start(false));
        return;
      }

      if (unmountedRef.current || generationRef.current !== generation || document.hidden) return;
      const es = new EventSource('/api/aggregate/stream', { withCredentials: true });
      eventSourceRef.current = es;
      setStatus('streaming');

      es.addEventListener('source', event => {
        if (unmountedRef.current || generationRef.current !== generation) return;
        try {
          const source = JSON.parse((event as MessageEvent<string>).data) as SourceResult;
          const receivedAt = new Date();
          setLastUpdatedAt(receivedAt);
          setFreshSlugs(prev => new Set(prev).add(source.slug));
          setMap(prev => {
            const next = new Map(prev);
            next.set(source.slug, { ...source, receivedAt });
            persist(uidRef.current, next, receivedAt);
            return next;
          });
        } catch {
          setStatus('error');
        }
      });

      es.addEventListener('done', event => {
        if (unmountedRef.current || generationRef.current !== generation) return;
        let nextUid = uidRef.current;
        let updatedAt = new Date();
        try {
          const data = (event as MessageEvent<string>).data;
          if (data) {
            const parsed = JSON.parse(data) as { uid?: string; lastUpdatedAt?: string };
            nextUid = parsed.uid ?? nextUid;
            updatedAt = parsed.lastUpdatedAt ? new Date(parsed.lastUpdatedAt) : updatedAt;
          }
        } catch {
          // Done payload is optional.
        }
        setUid(nextUid);
        setLastUpdatedAt(updatedAt);
        setStatus('idle');
        backoffRef.current = 1_000;
        persist(nextUid, sourcesMapRef.current, updatedAt);
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
      });

      es.onerror = () => {
        if (unmountedRef.current || generationRef.current !== generation) return;
        es.close();
        if (eventSourceRef.current === es) eventSourceRef.current = null;
        setStatus('error');
        scheduleRetry(() => start(false));
      };
    })();
  }, [clearRetry, closeStream, persist, scheduleRetry, setMap, setUid]);

  const refresh = useCallback(() => {
    backoffRef.current = 1_000;
    start(true);
  }, [start]);

  const refreshSource = useCallback(async (slug: string) => {
    const source = await fetchRefreshSource(slug);
    const receivedAt = new Date();
    setLastUpdatedAt(receivedAt);
    setFreshSlugs(prev => new Set(prev).add(slug));
    setMap(prev => {
      const next = new Map(prev);
      next.set(source.slug, { ...source, receivedAt });
      persist(uidRef.current, next, receivedAt);
      return next;
    });
  }, [persist, setMap]);

  useEffect(() => {
    start(true);
    const onVisibility = () => {
      if (document.hidden) {
        clearRetry();
        closeStream();
      } else {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unmountedRef.current = true;
      document.removeEventListener('visibilitychange', onVisibility);
      clearRetry();
      closeStream();
    };
  }, [clearRetry, closeStream, refresh, start]);

  return {
    sources: Array.from(sourcesMap.values()),
    uid,
    status,
    lastUpdatedAt,
    freshSlugs,
    refresh,
    refreshSource,
  };
}
