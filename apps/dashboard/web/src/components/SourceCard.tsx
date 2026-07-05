import { forwardRef, useEffect, useMemo, useState } from 'react';
import { GripVertical, RotateCw } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Tone } from '../api';
import type { EnrichedSourceResult } from '../hooks/useAggregateStream';

const toneClasses: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-muted',
};

const statusBadge: Record<EnrichedSourceResult['status'], { label: string; className: string }> = {
  ok: { label: 'live', className: 'bg-ok/10 text-ok' },
  empty: { label: 'empty', className: 'bg-muted/10 text-muted' },
  timeout: { label: 'timeout', className: 'bg-warn/10 text-warn' },
  error: { label: 'error', className: 'bg-bad/10 text-bad' },
};

const errorMessages: Record<string, string> = {
  circuitOpen: 'Source is rate-limiting itself',
  timeout: 'Request timed out',
  connectionRefused: 'Connection refused',
  httpError: 'HTTP error from source',
  malformed: 'Malformed response',
};

interface SourceCardProps {
  source: EnrichedSourceResult;
  isStale?: boolean;
  onRefresh?: () => Promise<void>;
  receivedAt?: Date;
}

function formatAgo(date?: Date, tick = 0): string | null {
  void tick;
  if (!date) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export const SourceCard = forwardRef<HTMLElement, SourceCardProps>(({ source, isStale, onRefresh, receivedAt }, ref) => {
  const data = source.data;
  const badge = statusBadge[source.status];
  const link = data?.deepLink ?? source.deepLink;
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const updatedAt = receivedAt ?? source.receivedAt;
  const updatedAgo = useMemo(() => formatAgo(updatedAt, tick), [updatedAt, tick]);
  const canRetry = source.status === 'error' || source.status === 'timeout' || source.errorKind === 'circuitOpen';
  const errorMessage = source.errorKind ? errorMessages[source.errorKind] : undefined;

  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <article
      ref={ref}
      tabIndex={0}
      data-card-slug={source.slug}
      className={`rounded-xl border border-border bg-panel p-5 flex flex-col gap-4 min-h-[16rem] focus-visible:ring-2 focus-visible:ring-accent/50 outline-none ${isStale ? 'opacity-70' : ''}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-fg truncate">
            {data?.title ?? source.name}
          </h2>
          {data?.primary && (
            <p className="text-sm text-muted mt-1">{data.primary}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isStale && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warn/10 text-warn">stale</span>}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefresh}
              className="p-1 rounded text-muted hover:text-fg border border-border/70"
              title="Refresh source"
              disabled={refreshing}
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
          <span
            className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${badge.className}`}
            title={`${source.latencyMs}ms${source.error ? ` — ${source.error}` : ''}`}
          >
            {badge.label}
          </span>
        </div>
      </header>

      {source.status === 'ok' && data && (
        <>
          {data.metrics && data.metrics.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {data.metrics.map((m, i) => (
                <div key={i} className="bg-ink/40 rounded-lg p-2 text-center">
                  <div className={`text-xl font-bold ${toneClasses[m.tone ?? 'info']}`}>
                    {m.value}
                  </div>
                  <div className="text-[10px] uppercase text-muted tracking-wide">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.items && data.items.length > 0 && (
            <ul className="space-y-1.5 flex-1">
              {data.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 text-sm">
                  <span className={toneClasses[item.tone ?? 'info']}>{item.label}</span>
                  {item.sub && <span className="text-muted text-xs text-right">{item.sub}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {source.status === 'empty' && (
        <p className="text-sm text-muted flex-1">Nothing here yet.</p>
      )}

      {canRetry && (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 flex-1">
          <p className="text-sm text-bad mb-3">{errorMessage ?? source.error ?? 'Source unavailable'}</p>
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 text-xs text-fg border border-bad/50 bg-bad/10 hover:bg-bad/20 rounded px-3 py-1.5"
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Retry
            </button>
          )}
        </div>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="text-xs text-accent hover:underline self-start"
        >
          Open {source.name} →
        </a>
      )}

      {updatedAgo && <p className="text-muted text-xs mt-auto">updated {updatedAgo}</p>}
    </article>
  );
});

SourceCard.displayName = 'SourceCard';

export function SortableSourceCard({ source, isStale, onRefresh }: Omit<SourceCardProps, 'receivedAt'>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: source.slug });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`relative ${isDragging ? 'z-10 opacity-80' : ''}`}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="absolute right-20 top-5 z-10 text-muted hover:text-fg cursor-grab active:cursor-grabbing p-1"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <SourceCard source={source} isStale={isStale} onRefresh={onRefresh} />
    </div>
  );
}
