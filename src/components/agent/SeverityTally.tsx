// The severity breakdown of a set of findings — a row of badges in the order
// severities are defined.
//
// One component because there were three copies of this map: the pane's header
// tally, the folded chat-mode tally, and the pre-flight card's prior review.
// Each had decided independently whether a zero renders (`SeverityBadge`
// already returns null for one, so the pre-pass some copies added was dead)
// and each read a different local spelling of the display order.
//
// It deliberately does NOT filter by state: WHICH findings count is the
// caller's question — triage-only for the live pane, unfinished-business for a
// prior review — and burying that choice here is how three surfaces end up
// showing three different tallies for one run.
import { SEVERITIES, type Finding } from "../../shared/agent-types";
import { SeverityBadge } from "./SeverityBadge";

export function SeverityTally({ findings }: { findings: readonly Finding[] }) {
  return (
    <>
      {SEVERITIES.map((severity) => (
        <SeverityBadge
          key={severity}
          severity={severity}
          count={findings.filter((f) => f.severity === severity).length}
        />
      ))}
    </>
  );
}
