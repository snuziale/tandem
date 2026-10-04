import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@uipath/apollo-wind";
import { Check, ChevronDown, Clock, Users, X } from "lucide-react";
import type { PullRequest, ReviewerVerdict } from "../../shared/review-types";
import { relativeAge } from "../../utils/time";
import { ReviewCell } from "../queue/cells";

/** Same reserved status hues the checks popover beside it uses — a verdict is
 * the same JOB as a check result, so it must not invent a palette. */
const VERDICT: Record<
  ReviewerVerdict["state"],
  { icon: typeof Check; tone: string; heading: string }
> = {
  CHANGES_REQUESTED: {
    icon: X,
    tone: "text-red-500 dark:text-red-400",
    heading: "changes requested",
  },
  APPROVED: {
    icon: Check,
    tone: "text-emerald-600 dark:text-emerald-400",
    heading: "approved",
  },
};

/** What is wrong first, the same order the checks popover keeps. */
const GROUP_ORDER: ReviewerVerdict["state"][] = [
  "CHANGES_REQUESTED",
  "APPROVED",
];

/**
 * The PR header's review badge, plus WHO: each person's standing verdict and
 * the reviews still outstanding. The badge alone is `ReviewCell`, shared with
 * the queue row — the queue search fetches counts only, so the names exist on
 * the detail screen and nowhere else.
 *
 * A reviewer who was RE-requested after a verdict is listed under the verdict
 * (that is still their standing opinion) and tagged, rather than appearing
 * twice; GitHub's own sidebar makes the same call.
 */
export function ReviewersSummary({
  pr,
  viewerLogin,
}: {
  pr: PullRequest;
  viewerLogin?: string | null;
}) {
  const reviewers = pr.reviewers;
  // Not fetched (an older cached response), or genuinely nothing to list: a
  // popover that opens onto "nobody" is a control that answers nothing.
  if (
    !reviewers ||
    (reviewers.length === 0 && pr.requestedReviewers.length === 0)
  )
    return <ReviewCell pr={pr} showDraft={false} viewerLogin={viewerLogin} />;

  const reviewed = new Set(reviewers.map((r) => r.login));
  const requested = new Set(pr.requestedReviewers);
  const awaiting = pr.requestedReviewers.filter((r) => !reviewed.has(r));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Show reviewers"
          className="group flex shrink-0 min-w-0 rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* The chevron rides INSIDE the badge: the badge is the control. */}
          <ReviewCell
            pr={pr}
            showDraft={false}
            viewerLogin={viewerLogin}
            suffix={
              <ChevronDown className="w-3 h-3 shrink-0 opacity-60 transition-transform group-data-[state=open]:rotate-180" />
            }
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="max-h-80 overflow-y-auto py-1 text-xs">
          {GROUP_ORDER.map((state) => {
            const people = reviewers.filter((r) => r.state === state);
            if (people.length === 0) return null;
            const { icon: Icon, tone, heading } = VERDICT[state];
            return (
              <Group key={state} heading={heading} count={people.length}>
                {people.map((r) => (
                  <Row
                    key={r.login}
                    icon={<Icon className={cn("w-3.5 h-3.5", tone)} />}
                    login={r.login}
                    isViewer={r.login === viewerLogin}
                    note={
                      requested.has(r.login)
                        ? "re-requested"
                        : r.submittedAt
                          ? relativeAge(r.submittedAt)
                          : null
                    }
                  />
                ))}
              </Group>
            );
          })}
          {awaiting.length > 0 ? (
            <Group heading="awaiting" count={awaiting.length}>
              {awaiting.map((login) => {
                // Teams arrive as "org/slug" (reviewRequestOf).
                const isTeam = login.includes("/");
                return (
                  <Row
                    key={login}
                    icon={
                      isTeam ? (
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                      )
                    }
                    login={login}
                    isViewer={login === viewerLogin}
                    note={isTeam ? "team" : null}
                  />
                );
              })}
            </Group>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Group({
  heading,
  count,
  children,
}: {
  heading: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="py-1">
      <h3 className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
        {heading} · {count}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function Row({
  icon,
  login,
  isViewer,
  note,
}: {
  icon: React.ReactNode;
  login: string;
  isViewer: boolean;
  note: string | null;
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-1 min-w-0">
      <span className="shrink-0 flex">{icon}</span>
      <span className="truncate flex-1 font-medium">
        @{login}
        {isViewer ? (
          <span className="ml-1 font-normal text-muted-foreground">(you)</span>
        ) : null}
      </span>
      {note ? (
        <span className="text-muted-foreground font-mono text-[11px] shrink-0">
          {note}
        </span>
      ) : null}
    </li>
  );
}
