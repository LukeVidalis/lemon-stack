export type Tone = 'ok' | 'warn' | 'bad' | 'info';
export type ErrorKind = 'none' | 'timeout' | 'connectionRefused' | 'httpError' | 'malformed' | 'circuitOpen';

export interface SummaryItem {
  label: string;
  sub?: string;
  tone?: Tone;
}

export interface SummaryMetric {
  label: string;
  value: string | number;
  tone?: Tone;
}

export interface SummaryPayload {
  uid: string;
  title?: string | null;
  primary?: string | null;
  items?: SummaryItem[];
  metrics?: SummaryMetric[];
  deepLink?: string | null;
}

export type SourceStatus = 'ok' | 'empty' | 'timeout' | 'error';

export interface SourceResult {
  slug: string;
  name: string;
  icon?: string | null;
  deepLink?: string | null;
  status: SourceStatus;
  data?: SummaryPayload | null;
  error?: string | null;
  errorKind?: ErrorKind;
  latencyMs: number;
}

export interface AggregateResponse {
  uid: string;
  sources: SourceResult[];
}

export interface Me {
  uid: string;
  username: string;
  email?: string;
  groups: string[];
}

export interface ServiceEntry {
  slug: string;
  name: string;
  url: string;
  icon?: string | null;
  category: string;
}

export interface CardPref {
  slug: string;
  hidden: boolean;
  sortOrder: number;
  pinned: boolean;
}

export interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  refreshIntervalSec: number;
  cards: CardPref[];
}

export interface BuildInfo {
  sha: string;
  builtAt: string;
  version: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'include', ...init });
  if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
  return r.json();
}

export async function fetchMe(): Promise<Me> {
  return fetchJson<Me>('/api/me');
}

export async function fetchAggregate(): Promise<AggregateResponse> {
  return fetchJson<AggregateResponse>('/api/aggregate');
}

export async function fetchRefreshSource(slug: string): Promise<SourceResult> {
  return fetchJson<SourceResult>(`/api/aggregate/source/${encodeURIComponent(slug)}`);
}

export async function fetchPrefs(): Promise<Prefs> {
  return fetchJson<Prefs>('/api/prefs');
}

export async function putPrefs(prefs: Prefs): Promise<void> {
  const r = await fetch('/api/prefs', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!r.ok) throw new Error(`/api/prefs failed: ${r.status}`);
}

export async function fetchBuildInfo(): Promise<BuildInfo> {
  return fetchJson<BuildInfo>('/api/buildinfo');
}

export async function fetchServices(): Promise<ServiceEntry[]> {
  return fetchJson<ServiceEntry[]>('/api/services');
}
