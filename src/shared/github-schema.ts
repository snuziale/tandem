// Credential fields for the GitHub connection. Shared by the Bun server
// (config validation + status route) and the setup UI (renders the form
// dynamically from these fields).
import type { CredentialField } from './config-types';

export const GITHUB_CREDENTIAL_FIELDS: ReadonlyArray<CredentialField> = [
  {
    key: 'token',
    label: 'GitHub token',
    placeholder: 'ghp_… or github_pat_… (repo read + pull requests write)',
    secret: true,
    required: true,
  },
  { key: 'defaultOrg', label: 'Default org (optional)', placeholder: 'my-org', required: false },
];

export type GitHubCreds = { token: string; defaultOrg?: string };
