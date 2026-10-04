import type { ReviewVerdict } from "../../shared/review-types";

export const VERDICTS: Array<{
  value: ReviewVerdict;
  label: string;
  activeClass: string;
}> = [
  {
    value: "APPROVE",
    label: "Approve",
    activeClass: "border-emerald-400/60 text-emerald-400",
  },
  {
    value: "COMMENT",
    label: "Comment",
    activeClass: "border-border text-foreground",
  },
  {
    value: "REQUEST_CHANGES",
    label: "Request changes",
    activeClass: "border-red-400/60 text-red-400",
  },
];
