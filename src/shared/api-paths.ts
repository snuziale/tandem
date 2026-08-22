// Single source of truth for HTTP routes shared between the Bun server
// (src/server/), the Vite dev proxy (vite.config.ts), and the SPA client
// (src/api/*). Every /api/* request is answered by the Bun server — in dev the
// Vite proxy forwards the whole prefix to it.
export const API_PATHS = {
  API: '/api',
  CONFIG: '/api/config',
  CONFIG_STATUS: '/api/config/status',
  CONFIG_TEST: '/api/config/test',
  QUEUE: '/api/queue',
  PRS: '/api/prs',
  REVIEWS: '/api/reviews',
  RUNS: '/api/runs',
  AGENT: '/api/agent',
  AGENT_HEALTH: '/api/agent/health',
  SETTINGS: '/api/settings',
  VIEWS: '/api/views',
  SEEN: '/api/seen',
} as const;
