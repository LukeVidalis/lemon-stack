import type { CardPref, Prefs, SourceResult } from '../../api';

type SetPrefs = (partial: Partial<Prefs>) => void;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  sources: SourceResult[];
  prefs: Prefs;
  setPrefs: SetPrefs;
}

const intervals = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

function upsertCard(cards: CardPref[], slug: string, patch: Partial<CardPref>): CardPref[] {
  const existing = cards.find(c => c.slug === slug);
  if (!existing) return [...cards, { slug, hidden: false, sortOrder: 0, pinned: false, ...patch }];
  return cards.map(c => (c.slug === slug ? { ...c, ...patch } : c));
}

export function SettingsDrawer({ open, onClose, sources, prefs, setPrefs }: SettingsDrawerProps) {
  return (
    <>
      {open && <button type="button" aria-label="Close settings" className="fixed inset-0 bg-ink/70 z-40" onClick={onClose} />}
      <aside
        className={`fixed right-0 top-0 h-full w-full max-w-sm bg-panel border-l border-border z-50 shadow-2xl transform transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Settings</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg text-sm">Close</button>
        </div>

        <div className="p-5 space-y-6 overflow-y-auto h-[calc(100%-4rem)]">
          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted mb-3">Refresh interval</h3>
            <div className="flex flex-wrap gap-2">
              {intervals.map(interval => (
                <button
                  key={interval.value}
                  type="button"
                  onClick={() => setPrefs({ refreshIntervalSec: interval.value })}
                  className={`text-xs px-3 py-1.5 rounded border ${prefs.refreshIntervalSec === interval.value ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg'}`}
                >
                  {interval.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-widest text-muted mb-3">Cards</h3>
            <div className="space-y-2">
              {sources.map(source => {
                const pref = prefs.cards.find(c => c.slug === source.slug);
                const hidden = pref?.hidden ?? false;
                const pinned = pref?.pinned ?? false;
                return (
                  <div key={source.slug} className="rounded-lg border border-border bg-ink/40 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-fg truncate">{source.name}</p>
                      <p className="text-xs text-muted truncate">{source.slug}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPrefs({ cards: upsertCard(prefs.cards, source.slug, { hidden: !hidden }) })}
                        className="text-xs text-muted hover:text-fg border border-border rounded px-2 py-1"
                      >
                        {hidden ? 'Show' : 'Hide'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrefs({ cards: upsertCard(prefs.cards, source.slug, { pinned: !pinned }) })}
                        className="text-xs text-muted hover:text-fg border border-border rounded px-2 py-1"
                      >
                        {pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
