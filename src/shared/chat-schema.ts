// zod contract for the OPTIONAL trailing JSON fence of a chat turn. A chat
// reply is prose first — unlike the pipeline passes, strict JSON is not the
// product here, so an unparseable tail degrades to "prose only" instead of
// failing the turn (see chat/prose.ts).
//
// Everything here is still untrusted model output: chat/actions.ts re-checks
// every id, state transition and line anchor before an action is ever offered.
import { z } from "zod";
import { FindingJsonSchema } from "./finding-schema";

const SEVERITY = z.enum(["blocker", "risk", "nit", "question", "praise"]);

export const ChatActionJsonSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("revise-finding"),
    findingId: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(2000).optional(),
    severity: SEVERITY.optional(),
    // null = drop the existing suggestion.
    suggestion: z.string().max(8000).nullable().optional(),
    why: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal("dismiss-finding"),
    findingId: z.string().min(1),
    why: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal("new-finding"),
    finding: FindingJsonSchema,
    why: z.string().min(1).max(300),
  }),
  z.object({
    kind: z.literal("revise-comment"),
    localId: z.string().min(1),
    body: z.string().min(1).max(8000),
    why: z.string().min(1).max(300),
  }),
]);

export type ChatActionJson = z.infer<typeof ChatActionJsonSchema>;

/** The trailing fence: proposed actions and/or a request for more context. */
export const ChatTailSchema = z.object({
  actions: z.array(ChatActionJsonSchema).max(6).optional(),
  needContext: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        why: z.string().max(300).optional(),
      }),
    )
    .max(5)
    .optional(),
});

export type ChatTail = z.infer<typeof ChatTailSchema>;
