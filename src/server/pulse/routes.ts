// /api/pulse — the ambient surface.
//
// Three shapes over the same computation:
//   GET /api/pulse            JSON, for the app's header pill and anything else
//   GET /api/pulse.xbar       xbar/SwiftBar plugin text, for the menu bar
//   GET /api/pulse/history    the daily rollup series, for the sparkline
//
// The xbar form is the point. A menu-bar PR plugin needs a token, a team list,
// a staleness rule and a definition of "needs me"; Tandem owns all four, so
// serving the menu text replaces a standalone script — and its own .env, its
// own copy of the team list, and its own drifting idea of what matters — with
// one curl. See shared/xbar.ts.
import { API_PATHS } from "../../shared/api-paths";
import {
  dedupePrs,
  isGroupDim,
  pulseCounts,
  pulseStateOf,
  type GroupDim,
  type PulseOptions,
} from "../../shared/pulse";
import { defaultTeamQuery } from "../../shared/gh/team";
import type { SavedView } from "../../shared/review-types";
import { renderPulseMenu } from "../../shared/xbar";
import { resolveLogin } from "../config/routes";
import { loadConfig } from "../config/store";
import { fetchQueueViews, type QueueViewInput } from "../github/queue";
import { loadTeams } from "../teams/store";
import type { Team } from "../../shared/team-types";
import { loadSettings } from "../settings/store";
import { loadViews } from "../views/store";
import { historyFor } from "./journal";

/** Mirrors MAX_VIEWS in github/queue.ts — see resolveViews. */
const MAX_PULSE_VIEWS = 10;

const HISTORY_PATH = `${API_PATHS.PULSE}/history`;
const XBAR_PATH = `${API_PATHS.PULSE}.xbar`;

export async function handlePulse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET")
    return new Response("Method Not Allowed", { status: 405 });

  if (url.pathname === HISTORY_PATH) return handleHistory(url);
  if (url.pathname !== API_PATHS.PULSE && url.pathname !== XBAR_PATH)
    return new Response("Not Found", { status: 404 });

  const wantsXbar =
    url.pathname === XBAR_PATH || url.searchParams.get("format") === "xbar";

  const cfg = await loadConfig();
  if (!cfg) {
    // The menu bar has nowhere to show an HTTP status, so an unconfigured
    // Tandem has to say so IN the menu rather than return a bare 503.
    return wantsXbar
      ? xbarResponse(
          "⚠️ Tandem\n---\nNot configured — open Tandem and add a token\n",
        )
      : Response.json({ error: "unconfigured" }, { status: 503 });
  }

  // Nothing here depends on anything else, and teams.json is read ONCE and
  // used twice — to resolve `?team=` and as the shard index.
  const [settings, viewer, teams, views] = await Promise.all([
    loadSettings(),
    resolveLogin(),
    loadTeams(),
    loadViews(),
  ]);
  const selection = resolveViews(url, settings.pulse.menuViewId, teams, views);
  if ("error" in selection) {
    return wantsXbar
      ? xbarResponse(`⚠️ Tandem\n---\n${selection.error}\n`)
      : Response.json({ error: selection.error }, { status: 404 });
  }

  const result = await fetchQueueViews(
    cfg,
    selection.views,
    req.signal,
    new Map(teams.map((t) => [t.id, t])),
  );

  // One deduped list across every selected view: the menu bar is a single
  // glance, and the same PR matching two views is one PR.
  const rows = dedupePrs(Object.values(result.views).flat());

  // Sections are a MENU-BAR concern — the queue table is flat. `pulse` is the
  // only default worth having here: a pulldown with no columns needs headings,
  // and "whose court" is the heading that makes the list scannable.
  const groupParam = url.searchParams.get("group");
  const groupBy: GroupDim = isGroupDim(groupParam) ? groupParam : "pulse";
  const opts: PulseOptions = {
    now: Date.now(),
    viewerLogin: viewer,
    rottingDays: settings.pulse.rottingDays,
  };

  const errors = Object.values(result.errors);
  if (wantsXbar) {
    return xbarResponse(
      renderPulseMenu(rows, {
        ...opts,
        groupBy,
        appUrl: url.origin,
        sourceLabel: errors.length
          ? `${selection.label} · ⚠️ ${errors[0]}`
          : selection.label,
      }),
    );
  }

  return Response.json({
    viewer,
    rottingDays: opts.rottingDays,
    groupBy,
    label: selection.label,
    counts: pulseCounts(rows, opts),
    errors: result.errors,
    fetchedAt: result.fetchedAt,
    prs: rows.map((pr) => ({
      prId: pr.prId,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      repo: `${pr.owner}/${pr.repo}`,
      number: pr.number,
      state: pulseStateOf(pr, opts),
      approvals: pr.approvalCount,
      changesRequested: pr.changesRequestedCount,
      comments: pr.commentCount + pr.threadCount,
      autoMergeBy: pr.autoMergeBy,
      isDraft: pr.isDraft,
      updatedAt: pr.updatedAt,
    })),
  });
}

type Selection = { views: QueueViewInput[]; label: string } | { error: string };

/**
 * What the feed reads: a named view, a team on its own, the configured
 * default, or everything.
 *
 * `?team=` builds a throwaway view rather than requiring one to be saved —
 * "show me what my team has open" should not force a tab into the app.
 */
function resolveViews(
  url: URL,
  defaultViewId: string | null,
  teams: Team[],
  views: SavedView[],
): Selection {
  const teamParam = url.searchParams.get("team");
  if (teamParam) {
    const team =
      teams.find((t) => t.id === teamParam) ??
      teams.find((t) => t.name.toLowerCase() === teamParam.toLowerCase());
    if (!team) return { error: `no team named "${teamParam}"` };
    return {
      label: `team: ${team.name}`,
      views: [
        {
          id: `team:${team.id}`,
          query: defaultTeamQuery(),
          teamId: team.id,
        },
      ],
    };
  }

  if (views.length === 0) return { error: "no saved views" };
  const wanted = url.searchParams.get("view") ?? defaultViewId;
  if (wanted) {
    const view =
      views.find((v) => v.id === wanted) ??
      views.find((v) => v.name.toLowerCase() === wanted.toLowerCase());
    if (!view) return { error: `no view named "${wanted}"` };
    return { label: view.name, views: [inputOf(view)] };
  }
  // Same ceiling the queue route applies before fetching. A glanceable menu
  // bar must never be able to out-spend the app it is a summary of.
  return {
    label: "all views",
    views: views.slice(0, MAX_PULSE_VIEWS).map(inputOf),
  };
}

function inputOf(view: SavedView): QueueViewInput {
  return { id: view.id, query: view.query, teamId: view.teamId };
}

async function handleHistory(url: URL): Promise<Response> {
  const viewId = url.searchParams.get("view");
  if (!viewId)
    return Response.json({ error: "expected ?view=<id>" }, { status: 400 });
  const raw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(365, raw) : undefined;
  return Response.json({ series: await historyFor(viewId, days) });
}

function xbarResponse(text: string): Response {
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // The plugin re-runs on xbar's own schedule; a cached body would freeze
      // the menu bar at whatever it said the first time.
      "Cache-Control": "no-store",
    },
  });
}
