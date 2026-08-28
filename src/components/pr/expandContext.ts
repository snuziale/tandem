// Context expansion for the diff pane: what @pierre/diffs' `loadDiffFiles`
// hook returns when the reader clicks an expand chevron on a hunk separator.
//
// A patch-parsed diff is `isPartial` — it holds only the lines the patch named,
// so the library renders no expand affordance at all until a loader can hand it
// the full sides (`isExpandableDiff = !fileDiff.isPartial || canHydrateContext`
// in DiffHunksRenderer). Supplying one is the whole feature; the library owns
// the chevrons, the chunking, and shift-click-for-everything.
//
// We fetch ONE side. See `reversePatch` for why the old file is reconstructed
// rather than fetched: we carry no base oid, and the base branch tip is not the
// merge base GitHub diffed against.
import type { FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs";
import type { QueryClient } from "@tanstack/react-query";
import { prBlobQuery } from "../../hooks/usePrDetail";
import { reversePatch } from "../../shared/gh/patch";
import type { PrId } from "../../shared/review-types";

type LoadDeps = {
  queryClient: QueryClient;
  prId: PrId;
  headSha: string;
  /** The patch this exact `fileDiff` was parsed from — the hide-whitespace
   * rewrite when that toggle is on, so the reconstructed old side agrees with
   * what the folded hunks show rather than re-exposing the whitespace on the
   * left. Undefined means the pane has moved on from this object; reversing
   * some OTHER patch would silently render the wrong old side, so refuse. */
  patch: string | undefined;
};

export async function loadDiffFileSides(
  fileDiff: FileDiffMetadata,
  { queryClient, prId, headSha, patch }: LoadDeps,
): Promise<FileDiffLoadedFiles> {
  const path = fileDiff.name;
  // A pure rename has no hunks, so there is no patch to reverse and the library
  // wants the old side omitted.
  const pureRename = fileDiff.type === "rename-pure";
  if (patch === undefined && !pureRename)
    throw new Error(`no patch on screen for ${path} — cannot expand context`);

  const contents = await queryClient.fetchQuery(
    prBlobQuery(prId, headSha, path),
  );
  // No cacheKey on either side: hydratePartialDiff derives one from
  // fileDiff.cacheKey, which parsePatchFiles already set.
  const newFile = { name: path, contents };
  if (pureRename) return { oldFile: null, newFile };
  return {
    oldFile: {
      name: fileDiff.prevName ?? path,
      contents: reversePatch(contents, patch ?? ""),
    },
    newFile,
  };
}
