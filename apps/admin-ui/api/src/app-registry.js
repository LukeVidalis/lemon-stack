import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'config', 'apps.json');

let registry;

function load() {
  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  registry = raw.apps.filter((app) => !app._example);
  return registry;
}

// Load on first import
load();

export function getApps() {
  return registry;
}

export function getApp(slug) {
  return registry.find((app) => app.slug === slug) || null;
}

export function reload() {
  return load();
}
