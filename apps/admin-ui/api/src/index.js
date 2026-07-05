import { createApp } from './app.js';
import * as audit from './lib/audit.js';
import { ensureProjectInfrastructure } from './setup.js';

const PORT = process.env.PORT || 8080;
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Admin UI API listening on :${PORT}`);
  audit.init().catch((err) => console.error('[audit] init failed:', err.message));
  // Setup is also triggered post-deploy by deploy.sh via `docker exec`.
  // Set RUN_SETUP_ON_BOOT=true to also run it on container boot (off by default
  // to avoid duplicate work on every restart).
  if (process.env.RUN_SETUP_ON_BOOT === 'true') {
    ensureProjectInfrastructure().catch((err) => {
      console.error('[setup] boot-time setup failed:', err.message);
    });
  }
});

// ── Graceful shutdown ──────────────────────────────────
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, draining…`);
  const hardTimeout = setTimeout(() => {
    console.error('[shutdown] drain timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
  server.close((err) => {
    clearTimeout(hardTimeout);
    if (err) {
      console.error('[shutdown] server.close error:', err.message);
      process.exit(1);
    }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
