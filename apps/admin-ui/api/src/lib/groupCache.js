// Shared Authentik group cache.
//
// Provides a singleflight-protected, 30s-TTL map of group PK -> group object,
// plus a name->group view. Invalidate via groupCache.invalidate() after any
// write that changes group membership or names.

import * as authentik from '../authentik.js';
import { createCachedLoader } from '../lib/cache.js';

const TTL_MS = 30_000;

const loader = createCachedLoader(async () => {
  const data = await authentik.listGroups();
  const groups = data.results || [];
  const byPk = Object.create(null);
  const byName = Object.create(null);
  for (const g of groups) {
    byPk[g.pk] = g;
    byName[g.name] = g;
  }
  return { byPk, byName, list: groups };
}, TTL_MS);

export async function getGroupMap() {
  const { byPk } = await loader.get();
  return byPk;
}

export async function getGroupByName(name) {
  const { byName } = await loader.get();
  return byName[name] || null;
}

export async function getGroupList() {
  const { list } = await loader.get();
  return list;
}

export function invalidate() {
  loader.invalidate();
}
