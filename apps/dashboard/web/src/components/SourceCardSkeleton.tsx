export function SourceCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-panel p-5 min-h-[16rem] animate-pulse">
      <div className="h-5 w-1/3 bg-ink/60 rounded mb-3" />
      <div className="h-3 w-1/2 bg-ink/60 rounded mb-6" />
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="h-12 bg-ink/40 rounded" />
        <div className="h-12 bg-ink/40 rounded" />
        <div className="h-12 bg-ink/40 rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-ink/40 rounded" />
        <div className="h-3 bg-ink/40 rounded w-5/6" />
        <div className="h-3 bg-ink/40 rounded w-4/6" />
      </div>
    </div>
  );
}
