const ADMIN_GROUP = 'admins';

function parseGroups(headerValue) {
  if (!headerValue) return [];
  return headerValue.split('|').map((g) => g.trim()).filter(Boolean);
}

export function requireAdmin(req, res, next) {
  const username = req.headers['x-authentik-username'];
  if (!username) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  const groups = parseGroups(req.headers['x-authentik-groups']);
  if (!groups.includes(ADMIN_GROUP)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.actor = {
    username,
    name: req.headers['x-authentik-name'] || username,
    email: req.headers['x-authentik-email'] || null,
    uid: req.headers['x-authentik-uid'] || null,
    groups,
  };
  next();
}
