import { useState } from 'react';
import { Button, Input, Label, cn } from '@uipath/apollo-wind';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { CredentialField, CredentialTestResult } from '../../api/configApi';
import { saveConfig, testCredentials } from '../../api/configApi';

type Props = {
  fields: ReadonlyArray<CredentialField>;
  // initial values keyed by field.key (e.g. when editing existing creds)
  initialValues?: Record<string, string>;
  submitLabel: string;
  // POST creates the config; PUT replaces an existing one. Same shape on the wire.
  mode: 'create' | 'update';
  onSaved: () => void;
  onCancel?: () => void;
};

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'result'; result: CredentialTestResult };

export function CredentialsForm({ fields, initialValues, submitLabel, mode, onSaved, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(initialValues ?? {}) }));
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In update mode the server preserves blank secret fields from the stored
  // config — so a blank secret is acceptable for save iff a value is already
  // stored. We detect that by the secret key appearing in initialValues (the
  // server emits empty strings for secrets only when one exists).
  const hasStoredSecret = (f: { key: string; secret?: boolean }) =>
    mode === 'update' && !!f.secret && initialValues !== undefined && f.key in initialValues;

  const missingRequired = fields.some((f) => f.required && !values[f.key]?.trim() && !hasStoredSecret(f));

  // "Test connection" needs the real secret. Disable until the user re-enters.
  const canTest = fields.every((f) => !f.required || !!values[f.key]?.trim());

  const runTest = async () => {
    setTest({ kind: 'testing' });
    const result = await testCredentials(values);
    setTest({ kind: 'result', result });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired) return;
    setSaving(true);
    setError(null);
    const result = await saveConfig(values, { update: mode === 'update' });
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onSaved();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields.map((f, i) => {
        const storedSecret = hasStoredSecret(f);
        const placeholder = storedSecret ? 'Leave blank to keep current' : f.placeholder;
        return (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`creds-${f.key}`} className="text-xs">
              {f.label}
              {f.required && !storedSecret ? <span className="text-destructive ml-0.5">*</span> : null}
            </Label>
            <Input
              id={`creds-${f.key}`}
              autoFocus={i === 0}
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => {
                setValues((prev) => ({ ...prev, [f.key]: e.target.value }));
                setTest({ kind: 'idle' });
              }}
              placeholder={placeholder}
              className="h-9 text-sm"
              autoComplete="off"
            />
          </div>
        );
      })}

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={runTest}
          disabled={!canTest || test.kind === 'testing'}
          title={!canTest ? 'Re-enter the token to test the connection' : undefined}
        >
          {test.kind === 'testing' ? <Loader2 className="animate-spin" /> : null}
          Test connection
        </Button>
        {test.kind === 'result' && test.result.ok ? (
          <span className="text-xs text-emerald-500 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> reviews will post as @{test.result.login}
          </span>
        ) : null}
        {test.kind === 'result' && !test.result.ok ? (
          <span className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" /> {test.result.message}
          </span>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className={cn('flex items-center gap-2 pt-2', onCancel ? 'justify-end' : 'justify-start')}>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={saving || missingRequired}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
