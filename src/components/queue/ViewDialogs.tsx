import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
  toast,
} from '@uipath/apollo-wind';
import type { SavedView } from '../../shared/review-types';
import { parseViewsJson } from '../../utils/viewsJson';

// ---------------------------------------------------------------------------
// Create / edit one saved view.

type EditorProps = {
  /** Null = create a new view. */
  view: SavedView | null;
  open: boolean;
  onClose: () => void;
  onSave: (view: SavedView) => void;
  onDelete?: (id: string) => void;
};

export function ViewEditorDialog({ view, open, onClose, onSave, onDelete }: EditorProps) {
  const [name, setName] = useState(view?.name ?? '');
  const [query, setQuery] = useState(view?.query ?? 'is:pr is:open archived:false sort:updated-desc ');
  const [agentEnabled, setAgentEnabled] = useState(view?.agentEnabled ?? false);

  const canSave = name.trim().length > 0 && query.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    onSave({
      id: view?.id ?? crypto.randomUUID(),
      name: name.trim(),
      query: query.trim(),
      agentEnabled,
      position: view?.position ?? Number.MAX_SAFE_INTEGER,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{view ? 'Edit view' : 'New view'}</DialogTitle>
          <DialogDescription>
            A view is a raw GitHub search query shown as a queue tab — e.g.{' '}
            <code className="font-mono text-[11px]">is:pr is:open repo:UiPath/flow-workbench review-requested:@me</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="view-name" className="text-xs">
              Name
            </Label>
            <Input id="view-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="flow-workbench only" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="view-query" className="text-xs">
              GitHub search query
            </Label>
            <Textarea
              id="view-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
              className="min-h-16 text-sm font-mono"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm">Agent pre-warm eligible</div>
              <div className="text-[11px] text-muted-foreground">
                PRs in this view are analyzed automatically — only when "Run automatically" is on in Settings.
              </div>
            </div>
            <Switch checked={agentEnabled} onCheckedChange={setAgentEnabled} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {view && onDelete ? (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => {
                onDelete(view.id);
                onClose();
              }}
            >
              Delete view
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {view ? 'Save view' : 'Add view'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The whole view configuration as JSON: view, copy (export/share), paste
// (import), apply. The same shape views.json stores server-side.

type JsonProps = {
  views: SavedView[];
  open: boolean;
  onClose: () => void;
  onApply: (views: SavedView[]) => void;
};

export function ViewsJsonDialog({ views, open, onClose, onApply }: JsonProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(views, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const parsed = parseViewsJson(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    onApply(parsed.views);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Views as JSON</DialogTitle>
          <DialogDescription>
            The exact configuration stored in <code className="font-mono text-[11px]">~/.tandem/views.json</code>. Copy it to share;
            paste a teammate's to import. Applying replaces ALL views.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          className="min-h-72 text-xs font-mono"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="mr-auto"
            onClick={() => {
              void navigator.clipboard.writeText(draft).then(() => toast.success('Views JSON copied'));
            }}
          >
            Copy JSON
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

