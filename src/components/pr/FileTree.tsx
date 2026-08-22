import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree as TreesFileTree, useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import type { FileTree as FileTreeModel, GitStatusEntry } from '@pierre/trees';
import { Button, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@uipath/apollo-wind';
import { Search } from 'lucide-react';
import type { FileChange } from '../../shared/review-types';

type Props = {
  files: FileChange[];
  viewedFiles: string[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Paths with agent findings — violet dot decoration. */
  agentPaths?: ReadonlySet<string>;
  /** Hands the caller the tree model for scroll/select from keyboard + findings. */
  onModelReady?: (model: FileTreeModel) => void;
};

const GIT_STATUS: Record<FileChange['status'], GitStatusEntry['status']> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'added',
  changed: 'modified',
  unchanged: 'modified',
};

// The PR file tree on @pierre/trees: real hierarchy with flattened empty
// dirs, always-virtualized, built-in search (the header's button / filters as
// you type), git-status badges from the PR's change types, sticky folders,
// and per-file decorations (+a −d · viewed ✓ · violet agent dot).
export function FileTree({ files, viewedFiles, selectedPath, onSelect, agentPaths, onModelReady }: Props) {
  // The model is constructed ONCE (useFileTree); everything row decorations
  // need at render time is read through this ref so it never goes stale.
  const stateRef = useRef({ files, viewedFiles, agentPaths });

  const paths = useMemo(() => files.map((f) => f.path), [files]);

  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    stickyFolders: true,
    density: 'compact',
    search: true,
    fileTreeSearchMode: 'hide-non-matches',
    gitStatus: gitStatusOf(files),
    onSelectionChange: (selected) => {
      const path = selected[0];
      if (!path) return;
      const item = model.getItem(path);
      if (item && !item.isDirectory()) onSelect(path);
    },
    renderRowDecoration: ({ row }) => {
      if (row.kind !== 'file') return null;
      const { files, viewedFiles, agentPaths } = stateRef.current;
      const file = files.find((f) => f.path === row.path);
      if (!file) return null;
      const parts = [];
      if (agentPaths?.has(row.path)) parts.push({ text: '● ', color: 'var(--tandem-agent)' });
      if (file.isBinary || file.tooLarge) {
        parts.push({ text: file.isBinary ? 'bin' : 'big' });
      } else {
        parts.push({ text: `+${file.additions}`, color: 'var(--color-emerald-500, #10b981)' });
        parts.push({ text: ` −${file.deletions}`, color: 'var(--color-red-400, #f87171)' });
      }
      if (viewedFiles.includes(row.path)) parts.push({ text: ' ✓' });
      return {
        text: parts.map((p) => p.text).join(''),
        parts,
        title: `${file.path} · +${file.additions} −${file.deletions}${viewedFiles.includes(row.path) ? ' · viewed' : ''}`,
      };
    },
  });

  const search = useFileTreeSearch(model);

  useEffect(() => {
    onModelReady?.(model);
  }, [model, onModelReady]);

  // Refresh decorations when viewed/agent/file state changes: update the ref,
  // then push a fresh gitStatus array — the mutation re-renders visible rows.
  useEffect(() => {
    stateRef.current = { files, viewedFiles, agentPaths };
    model.setGitStatus(gitStatusOf(files));
  }, [model, files, viewedFiles, agentPaths]);

  // External selection (keyboard [ ] / finding clicks) → tree follows.
  const lastExternal = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath || selectedPath === lastExternal.current) return;
    lastExternal.current = selectedPath;
    const item = model.getItem(selectedPath);
    if (item && !item.isSelected()) item.select();
    model.scrollToPath(selectedPath, { offset: 'nearest' });
  }, [model, selectedPath]);

  const [count] = useState(() => files.length);

  return (
    <div className="h-full min-h-0 flex flex-col" data-tandem-filetree>
      <TreesFileTree
        model={model}
        className="flex-1 min-h-0"
        header={
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background sticky top-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">files</span>
            <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
            <span className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  aria-label="Search files"
                  onClick={() => (search.isOpen ? search.close() : search.open())}
                >
                  <Search className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>Search files</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </div>
        }
      />
    </div>
  );
}

function gitStatusOf(files: FileChange[]): GitStatusEntry[] {
  return files.map((f) => ({ path: f.path, status: GIT_STATUS[f.status] }));
}
