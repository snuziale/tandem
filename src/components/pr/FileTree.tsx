import { Checkbox, cn, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@uipath/apollo-wind';
import type { FileChange } from '../../shared/review-types';

type Props = {
  files: FileChange[];
  viewedFiles: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
  /** Paths with agent findings — violet dot (M4 wires this up). */
  agentPaths?: ReadonlySet<string>;
};

// Flat-ish tree: files grouped by directory, directories in path order.
export function FileTree({ files, viewedFiles, selectedPath, onSelect, onToggleViewed, agentPaths }: Props) {
  const groups = groupByDir(files);
  return (
    <div className="h-full overflow-y-auto py-1">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono flex justify-between">
        <span>files</span>
        <span>{files.length}</span>
      </div>
      {groups.map(([dir, dirFiles]) => (
        <div key={dir || '(root)'}>
          <div className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono truncate" title={dir || 'root'}>
            {dir || 'root'}
          </div>
          {dirFiles.map((f) => {
            const selected = f.path === selectedPath;
            const viewed = viewedFiles.includes(f.path);
            const name = f.path.slice(f.path.lastIndexOf('/') + 1);
            return (
              // A div, not a <button>: the row contains the viewed Checkbox,
              // and buttons cannot nest.
              <div
                key={f.path}
                role="button"
                tabIndex={0}
                data-file-row={f.path}
                onClick={() => onSelect(f.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(f.path);
                }}
                className={cn(
                  'w-full flex items-center gap-1.5 px-3 py-1 text-left text-xs font-mono cursor-pointer',
                  selected ? 'bg-accent text-foreground' : 'hover:bg-accent/40 text-muted-foreground',
                  viewed && 'opacity-55'
                )}
              >
                {agentPaths?.has(f.path) ? (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--tandem-agent)' }} />
                ) : (
                  <span className="w-1.5 shrink-0" />
                )}
                <span className="truncate flex-1" title={f.path}>
                  {name}
                </span>
                {f.isBinary || f.tooLarge ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[9px] uppercase border border-border rounded px-0.5">{f.isBinary ? 'bin' : 'big'}</span>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent>{f.isBinary ? 'Binary file — no diff' : 'Too large to render — open on GitHub'}</TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
                ) : (
                  <span className="text-[10px] whitespace-nowrap">
                    <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span>
                  </span>
                )}
                <Checkbox
                  checked={viewed}
                  onCheckedChange={() => onToggleViewed(f.path)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Mark ${name} viewed`}
                  className="size-3"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function groupByDir(files: FileChange[]): Array<[string, FileChange[]]> {
  const map = new Map<string, FileChange[]>();
  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const dir = slash === -1 ? '' : f.path.slice(0, slash);
    const list = map.get(dir) ?? [];
    list.push(f);
    map.set(dir, list);
  }
  return [...map.entries()];
}
