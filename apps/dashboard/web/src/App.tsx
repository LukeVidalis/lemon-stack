import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { Settings } from 'lucide-react';
import { fetchMe, fetchServices, type CardPref, type Me, type ServiceEntry, type Tone } from './api';
import { useAggregateStream, type EnrichedSourceResult } from './hooks/useAggregateStream';
import { usePrefs } from './hooks/usePrefs';
import { useTheme } from './hooks/useTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { SortableSourceCard } from './components/SourceCard';
import { SourceCardSkeleton } from './components/SourceCardSkeleton';
import { ServiceGrid } from './components/ServiceGrid';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SearchBox } from './components/SearchBox';
import { ThemeToggle } from './components/Settings/ThemeToggle';
import { SettingsDrawer } from './components/Settings/SettingsDrawer';

function scoreSource(s: EnrichedSourceResult): number {
  if (s.status === 'error' || s.status === 'timeout') return 4;
  const toneScore = (t?: Tone) => t === 'bad' ? 3 : t === 'warn' ? 2 : t === 'ok' ? 1 : 0;
  const scores = [
    ...(s.data?.items?.map(i => toneScore(i.tone)) ?? []),
    ...(s.data?.metrics?.map(m => toneScore(m.tone)) ?? []),
  ];
  return scores.length > 0 ? Math.max(...scores) : 0;
}

function sortSources(sources: EnrichedSourceResult[], cards: CardPref[]): EnrichedSourceResult[] {
  const getPref = (slug: string) => cards.find(c => c.slug === slug);
  return [...sources].sort((a, b) => {
    const pa = getPref(a.slug);
    const pb = getPref(b.slug);
    const aPinned = pa?.pinned ?? false;
    const bPinned = pb?.pinned ?? false;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aOrder = pa?.sortOrder ?? 0;
    const bOrder = pb?.sortOrder ?? 0;
    if (aOrder !== 0 || bOrder !== 0) {
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    const diff = scoreSource(b) - scoreSource(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
}

export default function App() {
  const { prefs, setPrefs, ready } = usePrefs();
  const { sources, uid, status, lastUpdatedAt, freshSlugs, refresh, refreshSource } = useAggregateStream();
  const [me, setMe] = useState<Me | null>(null);
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const servicesRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<HTMLElement[]>([]);
  const focusedCardRef = useRef<number>(-1);

  useTheme(prefs.theme);

  useEffect(() => {
    Promise.all([fetchMe(), fetchServices()])
      .then(([u, svcs]) => { setMe(u); setServices(svcs); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, prefs.refreshIntervalSec * 1000);
    return () => clearInterval(id);
  }, [prefs.refreshIntervalSec, refresh]);

  const displaySources = useMemo(() => {
    const hidden = new Set(prefs.cards.filter(c => c.hidden).map(c => c.slug));
    const filtered = sources.filter(s => {
      if (hidden.has(s.slug)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
    return sortSources(filtered, prefs.cards);
  }, [sources, search, prefs.cards]);

  useEffect(() => {
    cardRefs.current = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-card-slug]') ?? []);
  }, [displaySources]);

  const focusCard = useCallback((index: number) => {
    if (cardRefs.current.length === 0) return;
    const bounded = Math.min(Math.max(index, 0), cardRefs.current.length - 1);
    focusedCardRef.current = bounded;
    cardRefs.current[bounded]?.focus();
  }, []);

  useKeyboardShortcuts({
    onRefresh: refresh,
    onFocusSearch: () => searchRef.current?.focus(),
    onNextCard: () => focusCard(focusedCardRef.current + 1),
    onPrevCard: () => focusCard(focusedCardRef.current <= 0 ? 0 : focusedCardRef.current - 1),
    onScrollToServices: () => servicesRef.current?.scrollIntoView({ behavior: 'smooth' }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const slugs = displaySources.map(s => s.slug);
    const oldIdx = slugs.indexOf(active.id as string);
    const newIdx = slugs.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(slugs, oldIdx, newIdx);
    const updatedCards = newOrder.map((slug, i) => {
      const existing = prefs.cards.find(c => c.slug === slug);
      return { slug, hidden: existing?.hidden ?? false, sortOrder: i + 1, pinned: existing?.pinned ?? false };
    });
    const hiddenCards = prefs.cards.filter(c => c.hidden && !newOrder.includes(c.slug));
    setPrefs({ cards: [...updatedCards, ...hiddenCards] });
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-border px-6 py-4 flex justify-between items-center gap-4">
        <div className="flex-shrink-0">
          <h1 className="text-xl font-semibold text-fg">Dashboard</h1>
          <p className="text-xs text-muted">
            {me ? `${me.username}${me.email ? ` · ${me.email}` : ''}` : 'loading…'}
            {uid && <span> · {uid}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-1 justify-end">
          <SearchBox ref={searchRef} value={search} onChange={setSearch} />
          <ThemeToggle theme={prefs.theme} onChange={t => setPrefs({ theme: t })} />
          <button onClick={() => setSettingsOpen(true)} className="text-muted hover:text-fg p-1.5" title="Settings">
            <Settings size={16} />
          </button>
          <button onClick={refresh} className="text-xs text-muted hover:text-fg border border-border px-2.5 py-1 rounded" title="Refresh (r)">
            {status === 'streaming' ? '…' : 'Refresh'}
          </button>
          <a href="/outpost.goauthentik.io/sign_out" className="text-xs text-muted hover:text-fg border border-border px-2.5 py-1 rounded">
            Log out
          </a>
        </div>
      </header>

      <main className="px-6 py-6 max-w-7xl mx-auto">
        {status === 'error' && sources.length === 0 && (
          <div className="rounded-lg border border-bad bg-bad/10 px-4 py-3 mb-6 text-bad text-sm">
            Failed to load data. Retrying…
          </div>
        )}

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={displaySources.map(s => s.slug)} strategy={rectSortingStrategy}>
            <div ref={gridRef} className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(status === 'loading' && sources.length === 0)
                ? Array.from({ length: 4 }).map((_, i) => <SourceCardSkeleton key={i} />)
                : displaySources.map(s => (
                    <ErrorBoundary key={s.slug}>
                      <SortableSourceCard
                        source={s}
                        isStale={!freshSlugs.has(s.slug)}
                        onRefresh={() => refreshSource(s.slug)}
                      />
                    </ErrorBoundary>
                  ))
              }
            </div>
          </SortableContext>
        </DndContext>

        {sources.length === 0 && status === 'idle' && (
          <p className="text-muted text-sm mt-8">No data sources registered.</p>
        )}

        {lastUpdatedAt && (
          <p className="text-muted text-xs mt-4">Last updated {lastUpdatedAt.toLocaleString()} {ready ? '' : '· loading preferences…'}</p>
        )}

        {services.length > 0 && (
          <ServiceGrid ref={servicesRef} services={services} search={search} />
        )}
      </main>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sources={sources}
        prefs={prefs}
        setPrefs={setPrefs}
      />
    </div>
  );
}
