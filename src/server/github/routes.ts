// Dispatch for /api/prs/:owner/:repo/:number[/action]. Detail and files land
// in later milestones; approve is here from the start because the queue's
// quick action needs it.
import { API_PATHS } from "../../shared/api-paths";
import { prIdOf, type PrRef } from "../../shared/gh/prKey";
import { isPlainObject } from "../../shared/is-plain-object";
import type { PendingComment } from "../../shared/review-types";
import { deleteReview, loadReview } from "../reviews/store";
import { loadConfig } from "../config/store";
import { parseJsonBody } from "../requestJson";
import { GitHubError } from "./client";
import { fetchPrFiles } from "./files";
import { fetchPrDetail } from "./pr";
import { quickApprove, submitReview } from "./submit";

export async function handlePrs(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = parsePrPath(url.pathname);
  if (!parsed) return new Response("Not Found", { status: 404 });
  const { ref, action } = parsed;

  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });

  try {
    if (action === "" && req.method === "GET") {
      const detail = await fetchPrDetail(cfg, ref, req.signal);
      if (!detail)
        return Response.json(
          { error: "pull request not found" },
          { status: 404 },
        );
      return Response.json(detail);
    }
    if (action === "/files" && req.method === "GET") {
      return Response.json({ files: await fetchPrFiles(cfg, ref, req.signal) });
    }
    if (action === "/approve" && req.method === "POST") {
      const result = await quickApprove(cfg.github, ref);
      return Response.json({ ok: true, ...result });
    }
    if (action === "/submit" && req.method === "POST") {
      return await handleSubmit(req, ref);
    }
    return new Response("Not Found", { status: 404 });
  } catch (e) {
    if (e instanceof GitHubError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

// Submitting posts the SERVER-SIDE draft (the reviews store is the single
// source of truth for staged comments); the body carries only the verdict and
// summary. On success the draft is cleared — it now lives on GitHub.
async function handleSubmit(req: Request, ref: PrRef): Promise<Response> {
  const cfg = await loadConfig();
  if (!cfg) return Response.json({ error: "unconfigured" }, { status: 503 });

  const body = await parseJsonBody(req);
  if (
    !isPlainObject(body) ||
    (body.verdict !== "APPROVE" &&
      body.verdict !== "REQUEST_CHANGES" &&
      body.verdict !== "COMMENT")
  ) {
    return Response.json(
      {
        error:
          "expected { verdict: APPROVE|REQUEST_CHANGES|COMMENT, summaryBody? }",
      },
      { status: 400 },
    );
  }
  const verdict = body.verdict;
  const summaryBody =
    typeof body.summaryBody === "string" ? body.summaryBody : "";

  const prId = prIdOf(ref.owner, ref.repo, ref.number);
  const draft = await loadReview(prId);
  const comments = draft?.comments ?? [];
  if (comments.length === 0 && verdict === "COMMENT" && !summaryBody.trim()) {
    return Response.json(
      { error: "nothing to submit — stage a comment or write a summary" },
      { status: 400 },
    );
  }
  const moved = comments.filter((c) => c.anchorMoved);
  if (moved.length > 0) {
    return Response.json(
      {
        error: `${moved.length} staged comment(s) lost their anchor after new commits — re-anchor or remove them first`,
      },
      { status: 409 },
    );
  }

  const result = await submitReview(cfg.github, ref, {
    verdict,
    body: summaryBody,
    commitId: draft?.headSha || undefined,
    comments: comments.map(restCommentOf),
  });
  await deleteReview(prId);
  return Response.json({ ok: true, ...result });
}

function restCommentOf(c: PendingComment) {
  const body =
    c.suggestion !== undefined
      ? `${c.body}${c.body.trim() ? "\n\n" : ""}\`\`\`suggestion\n${c.suggestion}\n\`\`\``
      : c.body;
  return {
    path: c.path,
    line: c.line,
    side: c.side,
    ...(c.startLine !== undefined && c.startLine !== c.line
      ? { start_line: c.startLine, start_side: c.side }
      : {}),
    body,
  };
}

/** `/api/prs/<owner>/<repo>/<number>[/action]` → ref + action ('' or '/x'). */
export function parsePrPath(
  pathname: string,
): { ref: PrRef; action: string } | null {
  const prefix = `${API_PATHS.PRS}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split("/");
  if (segments.length < 3) return null;
  const [owner, repo, numberRaw, ...rest] = segments;
  const number = Number(numberRaw);
  if (!owner || !repo || !Number.isInteger(number) || number <= 0) return null;
  return {
    ref: {
      owner: decodeURIComponent(owner),
      repo: decodeURIComponent(repo),
      number,
    },
    action: rest.length ? `/${rest.join("/")}` : "",
  };
}
