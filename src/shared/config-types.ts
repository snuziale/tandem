// Wire types for `/api/config/*`. Imported by:
// - the Bun server (src/server/config/*) which serves them
// - the SPA client (src/api/configApi.ts, src/components/setup/*) which consumes them
// Single source of truth — do not redeclare these per side.

// One field of the credential form (shape comes from shared/github-schema.ts
// and is echoed by /api/config/status).
export type CredentialField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
};

// Result of POST /api/config/test. `login` is the authenticated GitHub user —
// the identity reviews will be submitted as.
export type CredentialTestResult = { ok: true; login: string } | { ok: false; message: string };

// Response of GET /api/config/status.
export type ConfigStatus = {
  configured: boolean;
  // Authenticated GitHub login when configured (resolved lazily; may be null
  // briefly after configuration until the first /user probe completes).
  login: string | null;
  fields: ReadonlyArray<CredentialField>;
  configPath: string;
  // Non-secret field values from the currently-stored config (secrets are
  // always empty). Absent when `configured` is false.
  currentValues?: Record<string, string>;
};
