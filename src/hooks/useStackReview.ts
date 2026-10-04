// SPIKE: review a whole PR stack as one combined diff. Every comment is stored
// in its OWNING PR's draft, in that PR's coordinates (shared/gh/stack.ts maps
// both ways), so collapsing back to one PR loses nothing.
import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import { useState } from "react";
import { fetchPrFiles, fetchPrStack, submitPr } from "../api/prs";
import { fetchReview, putReview } from "../api/reviews";
import { unstageFinding } from "../actions/finding";
import {
  openFindings,
  type AgentRun,
  type Finding,
} from "../shared/agent-types";
import {
  historyMarks,
  routeComment,
  toCombined,
  type HistoryMark,
  type StackPr,
} from "../shared/gh/stack";
import type {
  DiffSide,
  FileChange,
  PendingComment,
  PendingReview,
  PrId,
  ReviewVerdict,
} from "../shared/review-types";
import { hasOpenBlocker, runFor, type RunsIndex } from "./useAgentRuns";
import { emptyReview } from "./usePendingReview";

export type StackSubmitResult = { pr: StackPr; error?: string };

export function useStackReview(
  prId: PrId,
  headSha: string | undefined,
  runsIndex: RunsIndex | undefined,
  /** Stack mode is on: only then load every layer's files and draft. */
  active: boolean,
) {
  const queryClient = useQueryClient();
  const stack = useQuery({
    queryKey: ["pr", "stack", prId, headSha],
    queryFn: ({ signal }) => fetchPrStack(prId, signal),
    enabled: !!headSha,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const prs = stack.data && stack.data.prs.length > 1 ? stack.data.prs : NO_PRS;

  // Same keys as usePrFiles / usePendingReview, so this shares their cache.
  const layerQueries = useQueries({
    queries: prs.map((pr) => ({
      queryKey: ["pr", "files", pr.prId, pr.headSha],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchPrFiles(pr.prId, signal),
      enabled: active,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    })),
    // `combine` keeps ONE array identity until a result changes, so every
    // projection below (and DiffPane's annotation memo) holds still.
    combine: combineLayers,
  });
  const draftQueries = useQueries({
    queries: prs.map((pr) => ({
      queryKey: ["review", pr.prId],
      queryFn: () => fetchReview(pr.prId),
      enabled: active,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    })),
    combine: combineDrafts,
  });
  // Ready only once every layer's files AND draft are in: writing to a draft
  // that has not loaded would replace its saved comments with the new one.
  const ready = layerQueries !== null && draftQueries !== null;
  const layers = ready ? layerQueries : null;
  const drafts = draftQueries ?? NO_DRAFTS;

  // Each PR's run at its own head, and its open findings moved onto the
  // combined diff. Accepting one stages it in THAT PR's draft (addComment).
  const runs = prs.map((pr) => runFor(runsIndex, pr.prId, pr.headSha));
  const agent = projectFindings(layers, runs);
  const history = historyByPath(layers, stack.data?.combined);

  const { projected, ownerByLocalId, hidden } = project(layers, drafts);

  const [viewed, setViewed] = useState<string[]>([]);
  const toggleViewed = (path: string) =>
    setViewed((v) =>
      v.includes(path) ? v.filter((p) => p !== path) : [...v, path],
    );

  const writeDraft = (
    layer: number,
    edit: (d: PendingReview) => PendingReview,
  ) => saveDraft(queryClient, prs[layer], edit);

  /** Where a combined-diff comment lands: its owner layer and anchor there. */
  const targetOf = (
    comment: Omit<PendingComment, "localId">,
  ):
    | {
        layer: number;
        path: string;
        side: DiffSide;
        line: number;
        startLine?: number;
      }
    | { error: string } => {
    const found = comment.findingId
      ? agent.owner.get(comment.findingId)
      : undefined;
    if (found) {
      const { path, side, endLine, startLine } = found.finding;
      return { layer: found.layer, path, side, line: endLine, startLine };
    }
    const routed = layers
      ? routeComment(
          layers,
          comment.path,
          comment.side,
          comment.line,
          comment.startLine,
        )
      : null;
    if (!routed)
      return { error: "No PR in the stack can take a comment there" };
    // A suggestion replaces exactly its lines; one whose range the routing cut
    // short would replace fewer lines than it was written for.
    if (
      comment.suggestion !== undefined &&
      spanLength(routed.startLine, routed.line) !==
        spanLength(comment.startLine, comment.line)
    )
      return {
        error:
          "That range spans more than one PR — select lines from one PR to suggest a change",
      };
    return { ...routed, path: comment.path, side: comment.side };
  };

  /**
   * Route a combined-diff comment to its owner. An accepted finding skips the
   * routing: it goes to its own run's PR, at the lines that run anchored it to.
   */
  const addComment = (
    comment: Omit<PendingComment, "localId">,
  ): { pr: StackPr } | { error: string } => {
    const target = targetOf(comment);
    if ("error" in target) return target;
    const { layer, ...anchor } = target;
    void writeDraft(layer, (d) => ({
      ...d,
      comments: [
        ...d.comments,
        { ...comment, ...anchor, localId: crypto.randomUUID() },
      ],
    }));
    return { pr: prs[layer] };
  };

  const updateComment = (localId: string, patch: Partial<PendingComment>) => {
    const layer = ownerByLocalId.get(localId);
    if (layer === undefined) return;
    // Position edits would be in combined coordinates; only content crosses.
    const { body, suggestion } = patch;
    void writeDraft(layer, (d) => ({
      ...d,
      comments: d.comments.map((c) =>
        c.localId === localId
          ? {
              ...c,
              ...(body !== undefined ? { body } : {}),
              ...("suggestion" in patch ? { suggestion } : {}),
            }
          : c,
      ),
    }));
  };

  const removeComment = (localId: string) => {
    const layer = ownerByLocalId.get(localId);
    if (layer === undefined) return;
    // An agent-staged comment returns its finding to triage, as on one PR.
    const findingId = drafts[layer]?.comments.find(
      (c) => c.localId === localId,
    )?.findingId;
    const run = runs[layer];
    if (findingId && run) void unstageFinding(queryClient, run.id, findingId);
    void writeDraft(layer, (d) => ({
      ...d,
      comments: d.comments.filter((c) => c.localId !== localId),
    }));
  };

  /**
   * One GitHub review PER PR — a review belongs to one PR. Sequential, and a
   * failure doesn't stop the rest; each PR's draft clears only on its own
   * success (server-side). A PR with nothing to say is skipped.
   */
  const submitAll = async (
    verdicts: Record<PrId, ReviewVerdict>,
    summaryBody: string,
  ): Promise<StackSubmitResult[]> => {
    const results: StackSubmitResult[] = [];
    for (const [layer, pr] of prs.entries()) {
      const verdict = verdicts[pr.prId] ?? "COMMENT";
      const staged = drafts[layer]?.comments.length ?? 0;
      if (verdict === "COMMENT" && staged === 0 && !summaryBody.trim())
        continue;
      try {
        await submitPr(pr.prId, { verdict, summaryBody });
        results.push({ pr });
      } catch (e) {
        results.push({ pr, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["review"] });
    await queryClient.invalidateQueries({ queryKey: ["pr"] });
    return results;
  };

  return {
    prs,
    isPending: stack.isPending,
    /** The combined diff, once every layer's files are in (ownership needs them). */
    combined: ready ? (stack.data?.combined ?? null) : null,
    /** PR numbers not rebased on the PR below — the combined view is refused. */
    unrebased: stack.data?.unrebased ?? NO_NUMBERS,
    top: prs.length > 0 ? prs[prs.length - 1] : null,
    comments: projected,
    hiddenComments: hidden,
    stagedByPr: prs.map((pr, i) => ({
      pr,
      staged: drafts[i]?.comments.length ?? 0,
      hasBlocker: hasOpenBlocker(runs[i]),
    })),
    runs: prs.map((pr, i) => ({ pr, run: runs[i] })),
    findings: agent.findings,
    hiddenFindings: agent.hidden,
    findingOwnerOf: (findingId: string) => {
      const found = agent.owner.get(findingId);
      return found ? prs[found.layer] : undefined;
    },
    history,
    ownerOf: (localId: string) => {
      const layer = ownerByLocalId.get(localId);
      return layer === undefined ? undefined : prs[layer];
    },
    viewed,
    toggleViewed,
    addComment,
    updateComment,
    removeComment,
    submitAll,
  };
}

export type StackReview = ReturnType<typeof useStackReview>;

const NO_PRS: StackPr[] = [];
const NO_DRAFTS: Array<PendingReview | null> = [];
const NO_NUMBERS: number[] = [];

/** Every layer's files, or null until all have loaded (ownership needs all). */
function combineLayers(
  results: Array<{ data?: FileChange[] }>,
): FileChange[][] | null {
  if (results.length === 0 || results.some((r) => !r.data)) return null;
  return results.map((r) => r.data ?? []);
}

/** Every layer's draft (null = none saved), or null until all have loaded. */
function combineDrafts(
  results: Array<{ data?: PendingReview | null; isSuccess: boolean }>,
): Array<PendingReview | null> | null {
  if (results.length === 0 || results.some((r) => !r.isSuccess)) return null;
  return results.map((r) => r.data ?? null);
}

function spanLength(startLine: number | undefined, line: number): number {
  return line - (startLine ?? line) + 1;
}

// Per-PR save queue. Writes are serialized, and only the newest write's echo
// reaches the cache: an older PUT answering late would otherwise replace the
// optimistic draft and the next write would persist it, dropping a comment.
const saveTail = new Map<PrId, Promise<void>>();
const saveSeq = new Map<PrId, number>();

function saveDraft(
  queryClient: QueryClient,
  pr: StackPr,
  edit: (d: PendingReview) => PendingReview,
): Promise<void> {
  const key = ["review", pr.prId];
  const next = edit(
    queryClient.getQueryData<PendingReview | null>(key) ??
      emptyReview(pr.prId, pr.headSha),
  );
  queryClient.setQueryData(key, next);
  const seq = (saveSeq.get(pr.prId) ?? 0) + 1;
  saveSeq.set(pr.prId, seq);
  const run = (saveTail.get(pr.prId) ?? Promise.resolve())
    .then(() => putReview(next))
    .then((saved) => {
      if (saveSeq.get(pr.prId) === seq) queryClient.setQueryData(key, saved);
    })
    .catch((e: unknown) => {
      toast.error("Draft could not be saved", {
        description: e instanceof Error ? e.message : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: key });
    });
  saveTail.set(pr.prId, run);
  return run;
}

/** Open findings from every layer's run, in combined coordinates. */
function projectFindings(
  layers: FileChange[][] | null,
  runs: Array<AgentRun | undefined>,
) {
  const findings: Finding[] = [];
  const owner = new Map<string, { layer: number; finding: Finding }>();
  let hidden = 0;
  if (!layers) return { findings, owner, hidden };
  for (const [layer, run] of runs.entries()) {
    for (const f of openFindings(run)) {
      const endLine = toCombined(layers, layer, f.path, f.side, f.endLine);
      if (endLine === null) {
        hidden++;
        continue;
      }
      const startLine =
        f.startLine !== undefined
          ? toCombined(layers, layer, f.path, f.side, f.startLine)
          : null;
      findings.push({ ...f, endLine, startLine: startLine ?? undefined });
      owner.set(f.id, { layer, finding: f });
    }
  }
  return { findings, owner, hidden };
}

/** Blocks two or more PRs edited in turn, per combined file. */
function historyByPath(
  layers: FileChange[][] | null,
  combined: FileChange[] | undefined,
) {
  const out = new Map<string, HistoryMark[]>();
  if (!layers || !combined) return out;
  for (const file of combined) {
    const marks = historyMarks(layers, file);
    if (marks.length > 0) out.set(file.path, marks);
  }
  return out;
}

/**
 * Each layer's staged comments, moved into combined coordinates. A comment a
 * later layer rewrote has no place here and is only counted. Module level: the
 * React Compiler refuses a counter mutated inside a closure.
 */
function project(
  layers: FileChange[][] | null,
  drafts: Array<PendingReview | null>,
) {
  const projected: PendingComment[] = [];
  const ownerByLocalId = new Map<string, number>();
  let hidden = 0;
  if (!layers) return { projected, ownerByLocalId, hidden };
  for (const [layer, draft] of drafts.entries()) {
    for (const c of draft?.comments ?? []) {
      const line = toCombined(layers, layer, c.path, c.side, c.line);
      if (line === null) {
        hidden++;
        continue;
      }
      const start =
        c.startLine !== undefined
          ? toCombined(layers, layer, c.path, c.side, c.startLine)
          : null;
      projected.push({ ...c, line, startLine: start ?? undefined });
      ownerByLocalId.set(c.localId, layer);
    }
  }
  return { projected, ownerByLocalId, hidden };
}
