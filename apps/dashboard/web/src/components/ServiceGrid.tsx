import { forwardRef } from 'react';
import type { ServiceEntry } from '../api';
import { Icon } from './Icon';

const CATEGORY_ORDER = ['apps', 'automation', 'home', 'media', 'personal', 'infra'];
const CATEGORY_LABELS: Record<string, string> = {
  apps: 'Apps',
  automation: 'Automation',
  home: 'Home',
  media: 'Media',
  personal: 'Personal',
  infra: 'Infrastructure',
};

interface ServiceGridProps {
  services: ServiceEntry[];
  search?: string;
}

export const ServiceGrid = forwardRef<HTMLElement, ServiceGridProps>(({ services, search = '' }, ref) => {
  const query = search.trim().toLowerCase();
  const filteredServices = query
    ? services.filter(s => s.name.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query) || s.category.toLowerCase().includes(query))
    : services;

  const byCategory = filteredServices.reduce<Record<string, ServiceEntry[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  const categories = [
    ...CATEGORY_ORDER.filter(c => byCategory[c]),
    ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  if (filteredServices.length === 0) return null;

  return (
    <section ref={ref} className="mt-10">
      <h2 className="text-xs uppercase tracking-widest text-muted mb-4">Services</h2>
      <div className="space-y-4">
        {categories.map(cat => (
          <div key={cat}>
            <p className="text-[10px] uppercase tracking-wider text-muted/60 mb-2">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="flex flex-wrap gap-2">
              {byCategory[cat].map(s => (
                <a
                  key={s.slug}
                  href={s.url}
                  target="_blank"
                  rel="noopener"
                  className="text-sm px-3 py-1.5 rounded-lg border border-border bg-panel text-muted hover:text-fg hover:border-accent/50 transition-colors flex items-center gap-1.5"
                >
                  {s.icon && <Icon name={s.icon} size={14} />}
                  {s.name}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

ServiceGrid.displayName = 'ServiceGrid';
