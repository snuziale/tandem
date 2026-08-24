// Durable chat sessions, ~/.tandem/chats.json: one session per
// (prId, headSha[, findingId]) — the same key the client builds with
// chatKeyOf, so opening a finding's thread is a plain GET with no create call.
//
// Turns are server-owned like runs: the transcript survives closing the pane,
// reloading, and the browser/native split.
import {
  newChatSession,
  type ChatScope,
  type ChatSession,
} from "../../../shared/chat-types";
import { isPlainObject } from "../../../shared/is-plain-object";
import {
  enqueueMutation,
  readTextFile,
  storagePath,
  writeTextFile,
} from "../../storage/jsonFile";

const FILE = "chats.json";
/** Transcripts are cheap but unbounded — evict the least recently used. */
const MAX_SESSIONS = 100;

function file(): string {
  return storagePath(FILE);
}

type ChatsFile = { sessions: Record<string, ChatSession> };

async function readAll(): Promise<ChatsFile> {
  const text = await readTextFile(file());
  if (text !== null) {
    try {
      const raw = JSON.parse(text) as unknown;
      if (isPlainObject(raw) && isPlainObject(raw.sessions))
        return { sessions: raw.sessions as Record<string, ChatSession> };
    } catch {
      console.error(
        `[chat] ${file()} is malformed; starting empty (file preserved until next write)`,
      );
    }
  }
  return { sessions: {} };
}

async function writeAll(all: ChatsFile): Promise<void> {
  await writeTextFile(file(), JSON.stringify(all, null, 2));
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const all = await readAll();
  return all.sessions[id] ?? null;
}

/** Every session for a PR, newest first — the pane lists a PR's threads. */
export async function listSessionsForPr(prId: string): Promise<ChatSession[]> {
  const all = await readAll();
  return Object.values(all.sessions)
    .filter((s) => s.prId === prId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Read-modify-write a session under the file's mutation queue, so a turn
 * appending its answer can never interleave with an apply flipping an action.
 * `mutate` receives the existing session or a fresh one for `scope`.
 */
export async function updateSession(
  scope: ChatScope,
  mutate: (session: ChatSession) => void,
): Promise<ChatSession> {
  return enqueueMutation(file(), async () => {
    const all = await readAll();
    const id = newChatSession(scope).id;
    const session = all.sessions[id] ?? newChatSession(scope);
    mutate(session);
    session.updatedAt = new Date().toISOString();
    all.sessions[id] = session;
    evict(all);
    await writeAll(all);
    return session;
  });
}

/** Same, addressed by id — used by apply/reject, which have no scope in hand. */
export async function updateSessionById(
  id: string,
  mutate: (session: ChatSession) => void,
): Promise<ChatSession> {
  return enqueueMutation(file(), async () => {
    const all = await readAll();
    const session = all.sessions[id];
    if (!session) throw new Error(`no chat session ${id}`);
    mutate(session);
    session.updatedAt = new Date().toISOString();
    all.sessions[id] = session;
    await writeAll(all);
    return session;
  });
}

export async function deleteSession(id: string): Promise<void> {
  await enqueueMutation(file(), async () => {
    const all = await readAll();
    if (!all.sessions[id]) return;
    delete all.sessions[id];
    await writeAll(all);
  });
}

/**
 * A crashed process can leave a session marked `thinking` forever — the UI
 * would open a stream for a turn nobody is driving. Called at startup of every
 * new turn for that session, and by the route that serves a session.
 */
export async function clearStuckStatus(id: string): Promise<void> {
  const session = await getSession(id);
  if (!session || session.status !== "thinking") return;
  await updateSessionById(id, (s) => {
    s.status = "idle";
  });
}

function evict(all: ChatsFile): void {
  const ids = Object.keys(all.sessions);
  if (ids.length <= MAX_SESSIONS) return;
  const oldest = ids
    .map((id) => all.sessions[id])
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, ids.length - MAX_SESSIONS);
  for (const session of oldest) delete all.sessions[session.id];
}
