import { Card } from '@uipath/apollo-wind';
import { Users } from 'lucide-react';
import type { ConfigStatus } from '../../api/configApi';
import { CredentialsForm } from './CredentialsForm';

type Props = {
  status: ConfigStatus;
  onDone: () => void;
};

export function FirstRunSetup({ status, onDone }: Props) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Users className="w-3.5 h-3.5" /> First-run setup
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect to GitHub</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Reviews post as <em>you</em>, so Tandem needs a personal access token with repo read and pull-request write. It stays on
            this machine — written to <code className="font-mono text-[11px]">{status.configPath}</code> and used server-side only.
          </p>
        </div>

        <Card className="p-5">
          <CredentialsForm fields={status.fields} submitLabel="Save and continue" mode="create" onSaved={onDone} />
        </Card>
      </div>
    </div>
  );
}
