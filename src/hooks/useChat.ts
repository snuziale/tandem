// One conversation, keyed by scope (PR at a sha, optionally one finding).
//
// Turns are server-owned like runs: the transcript comes from the server, and
// a turn already in flight is picked up by REPLAYING its stream — so closing
// the pane, switching PRs, or reloading loses nothing but the live cursor.
//
// Per-turn streaming state is NOT reset on a scope change: the owning panel is
// keyed by scope, so a different conversation is a different component. Keeps
// the hook free of the reset-state-in-an-effect the React Compiler forbids.
import { useCallback, useEffect, useRef, useState } from "react";
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
  type ChatAnchor,
  type ChatScope,
  type ChatSession,
} from "../shared/chat-types";

/** One `needContext` round trip, kept visible. The turn re-asks from scratch
 * after a hop, so the prose written before it is not part of the answer — but
 * DELETING it mid-stream is what made the panel feel unreliable: text appeared
 * and then vanished with nothing said. It is kept here, dimmed, under the
 * files it asked for. */
export type ChatHop = { paths: string[]; prose: string };

export type ChatState = {
  session: ChatSession | null;
  /** Prose streamed so far for the turn in flight. */
  streaming: string;
  /** Context hops this turn has taken, oldest first. */
  hops: ChatHop[];
  /** Coarse label while the server is reading the PR / re-reading with new files. */
  statusLabel: string | null;
  thinking: boolean;
  send: (message: string, opts?: SendOptions) => void;
  sending: boolean;
  cancel: () => void;
  apply: (actionId: string) => void;
  /** Apply several proposals from one answer, IN ORDER. */
  applyAll: (actionIds: string[]) => void;
  reject: (actionId: string) => void;
  applyingId: string | null;
  clear: () => void;
};

export type SendOptions = { anchor?: ChatAnchor; contextPaths?: string[] };

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
  const [hops, setHops] = useState<ChatHop[]>([]);
  // The streamed prose, readable synchronously: a context frame has to move
  // whatever arrived so far into a hop, and reading it out of a setState
  // updater would make that updater impure.
  const streamingRef = useRef("");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // The stream is opened for whatever id is thinking; a scope change tears it down.
  const thinking = session?.status === "thinking";

  useEffect(() => {
    if (!id || !thinking) return;
    const source = openChatStream(id, (event) => {
      switch (event.type) {
        case "delta":
          streamingRef.current += event.text;
          setStreaming(streamingRef.current);
          return;
        case "status":
          setStatusLabel(event.label);
          return;
        case "context":
          // A context hop re-asks from scratch, so the prose so far is not the
          // answer — but it is not nothing either. Move it into a hop record
          // instead of deleting it out from under the reader.
          setHops((prev) => [
            ...prev,
            { paths: event.paths, prose: streamingRef.current },
          ]);
          streamingRef.current = "";
          setStreaming("");
          setStatusLabel(`reading ${event.paths.join(", ")}`);
          return;
        case "error":
          setStatusLabel(null);
          return;
        case "turn-end":
          streamingRef.current = "";
          setStreaming("");
          setHops([]);
          setStatusLabel(null);
          queryClient.setQueryData(["chat", id], { session: event.session });
          // Deliberately NOT invalidating the PR's thread list here: a turn
          // that just ended makes this conversation non-empty, which is
          // exactly when that list is neither fetched nor rendered. It is
          // gated on emptiness, so the next empty scope fetches it fresh.
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
    mutationFn: ({
      message,
      opts,
    }: {
      message: string;
      opts?: SendOptions;
    }) => {
      if (!scope) throw new Error("no conversation open");
      return sendChatTurn({ ...scope, message, ...opts });
    },
    onSuccess: ({ session: next }) => {
      streamingRef.current = "";
      setStreaming("");
      setHops([]);
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
    const prId = scope?.prId;
    void deleteChat(id).then(() => {
      queryClient.setQueryData(["chat", id], { session: null });
      if (prId)
        void queryClient.invalidateQueries({ queryKey: ["chats", prId] });
    });
  }, [id, scope?.prId, queryClient]);

  return {
    session,
    streaming,
    hops,
    statusLabel,
    thinking: !!thinking,
    send: (message: string, opts?: SendOptions) =>
      turn.mutate({ message, opts }),
    sending: turn.isPending,
    cancel: () => {
      if (id) void cancelChatTurn(id);
    },
    apply: (actionId: string) => {
      setApplyingId(actionId);
      action.mutate({ actionId, state: "applied" });
    },
    // Strictly sequential, and that is not a nicety: `stage-comment` reads the
    // draft, pushes a comment and writes it back, so two applies in flight at
    // once would both read the draft before either wrote — and one comment
    // would vanish. Each still re-validates server-side, so a stale proposal
    // in the batch fails on its own chip without stopping the rest.
    applyAll: (actionIds: string[]) => {
      void (async () => {
        for (const actionId of actionIds) {
          setApplyingId(actionId);
          try {
            await action.mutateAsync({ actionId, state: "applied" });
          } catch {
            // The chip carries the message (markActionError on the server).
          }
        }
      })();
    },
    reject: (actionId: string) =>
      action.mutate({ actionId, state: "rejected" }),
    applyingId,
    clear,
  };
}
