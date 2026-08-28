// GET /api/prs/:owner/:repo/:number/asset/:uuid — the attachment proxy.
//
// A PR attachment is addressable by the browser ONLY through here. GitHub's
// public-looking `github.com/user-attachments/assets/<uuid>` URL needs a
// session cookie, and the signed URL that doesn't expires after 300 seconds —
// too short to hand to a pane the reader leaves open. So the uuid is the
// durable name, this resolves it per request, and the signed URL never leaves
// the server. See shared/gh/attachments.ts for the full reasoning.
import {
  attachmentSourcesFromHtml,
  isAttachmentUuid,
  type AttachmentSource,
} from "../../shared/gh/attachments";
import { PR_ATTACHMENTS_QUERY } from "../../shared/gh/detailQuery";
import { prIdOf, type PrRef } from "../../shared/gh/prKey";
import type { Config } from "../config/store";
import { graphql } from "./client";

type AttachmentsResponse = {
  repository: {
    pullRequest: {
      bodyHTML?: string;
      reviewThreads: {
        nodes: Array<{ comments: { nodes: Array<{ bodyHTML?: string }> } }>;
      };
    } | null;
  } | null;
};

/** GitHub signs an asset URL for 300s. Re-resolve well inside that, so a URL
 * is never handed to fetch() moments before it dies. */
const TTL_MS = 120_000;
/** A page of images is a burst of requests against ONE PR; without this each
 * one would re-run the query. Capped because a long session visits many PRs. */
const MAX_CACHED_PRS = 50;

const cache = new Map<
  string,
  { sources: Map<string, AttachmentSource>; fetchedAt: number }
>();

/** Headers worth passing through — everything the <video> element needs to
 * seek, and nothing that would leak the signed URL. */
const PASSTHROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export async function handlePrAsset(
  cfg: Config,
  ref: PrRef,
  uuid: string,
  req: Request,
): Promise<Response> {
  if (!isAttachmentUuid(uuid))
    return Response.json({ error: "not an attachment id" }, { status: 400 });

  const source = await resolveAttachment(
    cfg,
    ref,
    uuid.toLowerCase(),
    req.signal,
  );
  if (!source)
    return Response.json(
      { error: "no such attachment on this pull request" },
      { status: 404 },
    );

  // No auth headers: the JWT in the URL is the authorization, and ours would
  // not be accepted by githubusercontent anyway.
  const range = req.headers.get("range");
  const upstream = await fetch(source.signedUrl, {
    headers: range ? { Range: range } : undefined,
    signal: req.signal,
  });
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel();
    return Response.json(
      { error: `attachment fetch failed (${upstream.status})` },
      { status: 502 },
    );
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The bytes behind a uuid never change, so the browser may keep them. It is
  // the signed URL that rotates, and that stays here.
  headers.set("cache-control", "private, max-age=3600");
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function resolveAttachment(
  cfg: Config,
  ref: PrRef,
  uuid: string,
  signal?: AbortSignal,
): Promise<AttachmentSource | null> {
  const key = prIdOf(ref.owner, ref.repo, ref.number);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    const found = hit.sources.get(uuid);
    // A miss re-resolves: the body may have gained an attachment since.
    if (found) return found;
  }

  const sources = await fetchAttachmentSources(cfg, ref, signal);
  cache.delete(key);
  cache.set(key, { sources, fetchedAt: Date.now() });
  if (cache.size > MAX_CACHED_PRS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return sources.get(uuid) ?? null;
}

async function fetchAttachmentSources(
  cfg: Config,
  ref: PrRef,
  signal?: AbortSignal,
): Promise<Map<string, AttachmentSource>> {
  const { data } = await graphql<AttachmentsResponse>(
    cfg.github,
    PR_ATTACHMENTS_QUERY,
    { owner: ref.owner, name: ref.repo, number: ref.number },
    signal,
  );
  const pr = data.repository?.pullRequest;
  if (!pr) return new Map();
  // One scan over every body that can carry an attachment — the description
  // and each review-thread comment, which is exactly what Tandem renders.
  const html = [
    pr.bodyHTML ?? "",
    ...pr.reviewThreads.nodes.flatMap((t) =>
      t.comments.nodes.map((c) => c.bodyHTML ?? ""),
    ),
  ].join("\n");
  return attachmentSourcesFromHtml(html);
}
