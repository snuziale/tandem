// One conversation, keyed by scope (PR at a sha, optionally one finding).
//
// Turns are server-owned like runs: the transcript comes from the server, and
// a turn already in flight is picked up by REPLAYING its stream — so closing
// the pane, switching PRs, or reloading loses nothing but the live cursor.
//
// Per-turn streaming state is NOT reset on a scope change: the owning panel is
// keyed by scope, so a different conversation is a different component. Keeps
// the hook free of the reset-state-in-an-effect the React Compiler forbids.
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@uipath/apollo-wind";
import {
  cancelChatTurn,
  deleteChat,
  fetchChatSession,
  openChatStream,
  sendChatTurn,
  setChatActionState,
} from "../api/chats";
import {
  chatKeyOf,
  type ChatScope,
  type ChatSession,
} from "../shared/chat-types";

export type ChatState = {
  session: ChatSession | null;
  /** Prose streamed so far for the turn in flight. */
  streaming: string;
  /** Coarse label while the server is reading the PR / re-reading with new files. */
  statusLabel: string | null;
  thinking: boolean;
  send: (message: string) => void;
  sending: boolean;
  cancel: () => void;
  apply: (actionId: string) => void;
  reject: (actionId: string) => void;
  applyingId: string | null;
  clear: () => void;
};

export function useChat(scope: ChatScope | null): ChatState {
  const queryClient = useQueryClient();
  const id = scope
    ? chatKeyOf(scope.prId, scope.headSha, scope.findingId)
    : null;
  const key = ["chat", id];

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchChatSession(id!),
    enabled: !!id,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const session = query.data?.session ?? null;

  const [streaming, setStreaming] = useState("");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // The stream is opened for whatever id is thinking; a scope change tears it down.
  const thinking = session?.status === "thinking";

  useEffect(() => {
    if (!id || !thinking) return;
    const source = openChatStream(id, (event) => {
      switch (event.type) {
        case "delta":
          setStreaming((prev) => prev + event.text);
          return;
        case "status":
          setStatusLabel(event.label);
          return;
        case "context":
          // A context hop re-asks from scratch: the prose so far was the request.
          setStreaming("");
          setStatusLabel(`reading ${event.paths.join(", ")}`);
          return;
        case "error":
          setStatusLabel(null);
          return;
        case "turn-end":
          setStreaming("");
          setStatusLabel(null);
          queryClient.setQueryData(["chat", id], { session: event.session });
          source.close();
          return;
      }
    });
    source.onerror = () => {
      // Stream broke (server restart) — fall back to re-reading the transcript.
      queryClient.invalidateQueries({ queryKey: ["chat", id] });
    };
    return () => source.close();
  }, [id, thinking, queryClient]);

  const turn = useMutation({
    mutationFn: (message: string) => {
      if (!scope) throw new Error("no conversation open");
      return sendChatTurn({ ...scope, message });
    },
    onSuccess: ({ session: next }) => {
      setStreaming("");
      queryClient.setQueryData(["chat", next.id], { session: next });
    },
    onError: (e) =>
      toast.error("Could not ask the agent", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });

  const action = useMutation({
    mutationFn: ({
      actionId,
      state,
    }: {
      actionId: string;
      state: "applied" | "rejected";
    }) => {
      if (!id) throw new Error("no conversation open");
      return setChatActionState(id, actionId, state);
    },
    onSuccess: ({ session: next }) => {
      queryClient.setQueryData(["chat", next.id], { session: next });
      // An applied action edits a finding or the draft — both are cached elsewhere.
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      if (scope)
        queryClient.invalidateQueries({ queryKey: ["review", scope.prId] });
    },
    onError: (e) => {
      toast.error("Could not apply", {
        description: e instanceof Error ? e.message : undefined,
      });
      if (id) queryClient.invalidateQueries({ queryKey: ["chat", id] });
    },
    onSettled: () => setApplyingId(null),
  });

  const clear = useCallback(() => {
    if (!id) return;
    void deleteChat(id).then(() => {
      queryClient.setQueryData(["chat", id], { session: null });
    });
  }, [id, queryClient]);

  return {
    session,
    streaming,
    statusLabel,
    thinking: !!thinking,
    send: (message: string) => turn.mutate(message),
    sending: turn.isPending,
    cancel: () => {
      if (id) void cancelChatTurn(id);
    },
    apply: (actionId: string) => {
      setApplyingId(actionId);
      action.mutate({ actionId, state: "applied" });
    },
    reject: (actionId: string) =>
      action.mutate({ actionId, state: "rejected" }),
    applyingId,
    clear,
  };
}
