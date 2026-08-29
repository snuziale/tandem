// Every conversation on a PR, across all of its commits.
//
// The server has always listed these (`GET /api/chats?prId=`) and nothing ever
// asked: the pane could only ever open the ONE session matching its current
// scope, so every new commit read as amnesia — the thread you had about this
// PR yesterday existed on disk with no way back to it.
//
// A session carries its whole transcript, so this is the same shape of payload
// as `/api/runs` — which is why it is never polled and is gated on the one
// moment it can be rendered (see the `enabled` note below).
import { useQuery } from "@tanstack/react-query";
import { fetchChatSessions } from "../api/chats";
import type { ChatSession } from "../shared/chat-types";
import type { PrId } from "../shared/review-types";

/**
 * Module level, NOT an inline arrow: query-core compares `options.select` by
 * IDENTITY to decide whether it can reuse the last result, so a fresh closure
 * per render re-runs the filter and sort on every render of the panel — which
 * is every keystroke, since the composer draft is local state there.
 */
const selectSessions = (data: { sessions: ChatSession[] }): ChatSession[] =>
  // Newest first, and only conversations that actually happened — a session
  // created and abandoned is not history worth offering.
  data.sessions
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function useChatSessions(prId: PrId, enabled: boolean) {
  return useQuery({
    queryKey: ["chats", prId],
    queryFn: () => fetchChatSessions(prId),
    // GATED, because the only consumer renders while the current conversation
    // is EMPTY — and every session in this response carries its whole
    // transcript. Ungated it fetched on every PR open and again after every
    // completed turn, at which point the panel is guaranteed not to show it.
    enabled,
    // No staleTime: it is only ever fetched at the one moment it is about to
    // be rendered, and a thread that finished 20 seconds ago must be in it.
    refetchOnWindowFocus: false,
    select: selectSessions,
  });
}
