import { Router } from 'express';
import { readFileSync, statSync } from 'fs';

const router = Router();
const PORTS_FILE = process.env.PORTS_FILE || '/data/ports.json';

const EXCLUDED = new Set(['login-portal', 'admin-ui']);

let cached = null;
let cachedMtime = 0;

function readProjects() {
  try {
    const stat = statSync(PORTS_FILE);
    if (cached && stat.mtimeMs === cachedMtime) return cached;
    const raw = JSON.parse(readFileSync(PORTS_FILE, 'utf-8'));
    cached = Object.keys(raw)
      .filter((slug) => !EXCLUDED.has(slug))
      .sort()
      .map((slug) => ({ slug, name: slug }));
    cachedMtime = stat.mtimeMs;
    return cached;
  } catch {
    return cached || [];
  }
}

export function getProjects() {
  return readProjects();
}

router.get('/', (_req, res) => {
  res.json(getProjects());
});

export default router;
