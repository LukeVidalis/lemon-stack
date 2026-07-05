import * as authentik from './authentik.js';
import { getProjects } from './routes/projects.js';

const OUTPOST_PK = 'b77648a6-b472-4907-bfdd-e3ed8a92c449';
const AUTH_FLOW_PK = 'c03f32e3-1900-4a2f-965f-c43a361f2b7c';
const INVALIDATION_FLOW_PK = 'b5eccfc6-8c68-40b1-965d-a40491e0fe46';
const COOKIE_DOMAIN = '{{DOMAIN}}';
const OLD_POLICY_NAME = 'lemon-subdomain-access';

// Infrastructure apps that need Authentik providers but aren't user-managed projects.
// These use a custom hostname (not the default <slug>.{{DOMAIN}} pattern).
const STATIC_APPS = [
  { slug: 'admin-ui', externalHost: 'https://admin.{{DOMAIN}}' },
];

async function waitForAuthentik(maxAttempts = 10, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await authentik.findGroupByName('admins');
      return true;
    } catch {
      if (i < maxAttempts) {
        console.log(`[setup] Authentik not ready, retrying in ${delayMs / 1000}s (${i}/${maxAttempts})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return false;
}

export async function ensureProjectInfrastructure() {
  try {
    const ready = await waitForAuthentik();
    if (!ready) { console.error('[setup] Authentik unreachable after retries, skipping setup'); return; }

    const adminsGroup = await authentik.findGroupByName('admins');
    if (!adminsGroup) { console.error('[setup] admins group not found'); return; }
    const authentikAdminsGroup = await authentik.findGroupByName('authentik Admins');

    const outpost = await authentik.getOutpost(OUTPOST_PK);
    const providerSet = new Set(outpost.providers || []);
    let outpostDirty = false;

    const allApps = [
      ...getProjects(),
      ...STATIC_APPS,
    ];

    for (const app of allApps) {
      try {
        // Find or create proxy provider
        let provider = await authentik.findProxyProvider(`${app.slug}-forward-auth`);
        if (!provider) {
          provider = await authentik.createProxyProvider(app.slug, {
            authorizationFlow: AUTH_FLOW_PK,
            invalidationFlow: INVALIDATION_FLOW_PK,
            cookieDomain: COOKIE_DOMAIN,
            externalHost: app.externalHost,
          });
          console.log(`[setup] Created provider: ${app.slug}`);
        }

        // Find or create application
        let application;
        try { application = await authentik.getApplication(app.slug); }
        catch {
          application = await authentik.createApplication(app.slug, provider.pk);
          console.log(`[setup] Created application: ${app.slug}`);
        }

        // Add provider to outpost if needed
        if (!providerSet.has(provider.pk)) {
          providerSet.add(provider.pk);
          outpostDirty = true;
        }

        // Ensure admins group always has access
        await authentik.ensureGroupBinding(application.pk, adminsGroup.pk);
        if (authentikAdminsGroup) {
          await authentik.ensureGroupBinding(application.pk, authentikAdminsGroup.pk);
        }

      } catch (err) {
        console.error(`[setup] Failed for ${app.slug}:`, err.message);
      }
    }

    if (outpostDirty) {
      await authentik.updateOutpostProviders(OUTPOST_PK, [...providerSet]);
      console.log('[setup] Outpost providers updated');
    }

    await cleanupExpressionPolicy();

  } catch (err) {
    console.error('[setup] Infrastructure setup failed:', err.message);
  }
}

async function cleanupExpressionPolicy() {
  try {
    const policy = await authentik.findExpressionPolicy(OLD_POLICY_NAME);
    if (!policy) return;
    const bindings = await authentik.listPolicyBindings('lemoncode-services');
    for (const b of bindings.results || []) {
      if (b.policy === policy.pk) await authentik.deletePolicyBinding(b.pk);
    }
    await authentik.deleteExpressionPolicy(policy.pk);
    console.log('[setup] Cleaned up expression policy');
  } catch (err) {
    console.error('[setup] Expression policy cleanup failed:', err.message);
  }
}
