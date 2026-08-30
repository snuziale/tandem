import { describe, expect, it } from "vitest";
import {
  buildChecksQuery,
  chunkChecksRefs,
  CHECKS_CHUNK,
  MAX_CHECKS_CHUNKS,
} from "./checksQuery";
import type { ChecksRef } from "./checksQuery";
import type { PrId } from "../review-types";

const ref = (n: number, owner = "acme", repo = "web"): ChecksRef => ({
  prId: `${owner}/${repo}#${n}` as PrId,
  owner,
  repo,
  number: n,
});

describe("chunkChecksRefs", () => {
  it("chunks at the measured size", () => {
    const chunks = chunkChecksRefs(
      Array.from({ length: 50 }, (_, i) => ref(i + 1)),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(CHECKS_CHUNK);
    expect(chunks[1]).toHaveLength(50 - CHECKS_CHUNK);
  });

  // A queue can only be 50 rows today, but the cap is what keeps a future
  // paging change from turning one refresh into unbounded fan-out.
  it("caps the fan-out", () => {
    const chunks = chunkChecksRefs(
      Array.from({ length: 500 }, (_, i) => ref(i + 1)),
    );
    expect(chunks).toHaveLength(MAX_CHECKS_CHUNKS);
  });

  it("returns nothing for no refs", () => {
    expect(chunkChecksRefs([])).toEqual([]);
  });
});

describe("buildChecksQuery", () => {
  it("aliases one repository field per PR and maps it back", () => {
    const { gql, aliasToPrId } = buildChecksQuery([
      ref(1),
      ref(2, "acme", "cli"),
    ]);
    expect(aliasToPrId).toEqual({ p0: "acme/web#1", p1: "acme/cli#2" });
    expect(gql).toContain('p0: repository(owner: "acme", name: "web")');
    expect(gql).toContain("pullRequest(number: 1)");
    expect(gql).toContain('p1: repository(owner: "acme", name: "cli")');
  });

  // Owner and repo come from GitHub's own response, but they are still
  // interpolated into a query — JSON.stringify is what keeps a quote in a name
  // from becoming syntax.
  it("quotes names rather than pasting them", () => {
    const { gql } = buildChecksQuery([ref(1, 'ac"me', "web")]);
    expect(gql).toContain('owner: "ac\\"me"');
  });

  // The dedupe needs both the window and the timestamps; without them the
  // refinement would collapse re-runs by list order alone.
  it("asks for the whole window and the timestamps the dedupe needs", () => {
    const { gql } = buildChecksQuery([ref(1)]);
    expect(gql).toContain("contexts(first: 100)");
    expect(gql).toContain("totalCount");
    expect(gql).toContain("completedAt");
    expect(gql).toContain("createdAt");
  });
});
