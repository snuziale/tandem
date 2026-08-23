import { API_PATHS } from "../shared/api-paths";
import type {
  ChatActionState,
  ChatEvent,
  ChatSession,
} from "../shared/chat-types";
import type { PrId } from "../shared/review-types";
import { apiRequest } from "./http";

/** Session ids carry `/`, `@` and `#` — always encode them into one segment. */
function path(id: string, rest = ""): string {
  return `${API_PATHS.CHATS}/${encodeURIComponent(id)}${rest}`;
}

export function fetchChatSession(
  id: string,
): Promise<{ session: ChatSession | null }> {
  return apiRequest(path(id));
}

export function fetchChatSessions(
  prId: PrId,
): Promise<{ sessions: ChatSession[] }> {
  return apiRequest(`${API_PATHS.CHATS}?prId=${encodeURIComponent(prId)}`);
}

export function sendChatTurn(input: {
  prId: PrId;
  headSha: string;
  findingId?: string;
  message: string;
  agentId?: string;
}): Promise<{ session: ChatSession }> {
  return apiRequest(`${API_PATHS.CHATS}/turn`, {
    method: "POST",
    body: input,
  });
}

export function cancelChatTurn(id: string): Promise<{ ok: boolean }> {
  return apiRequest(path(id, "/cancel"), { method: "POST" });
}

export function setChatActionState(
  id: string,
  actionId: string,
  state: Extract<ChatActionState, "applied" | "rejected">,
): Promise<{ session: ChatSession; runId?: string }> {
  return apiRequest(path(id, `/actions/${encodeURIComponent(actionId)}`), {
    method: "POST",
    body: { state },
  });
}

export function deleteChat(id: string): Promise<{ ok: boolean }> {
  return apiRequest(path(id), { method: "DELETE" });
}

/** Live turn stream (deltas, then turn-end). Returns the EventSource; caller closes it. */
export function openChatStream(
  id: string,
  onEvent: (event: ChatEvent) => void,
): EventSource {
  const source = new EventSource(path(id, "/stream"));
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ChatEvent);
    } catch {
      // malformed frame — skip
    }
  };
  return source;
}
