import { useState } from "react";

/**
 * A write fired from a card, whose state stays ON that card: `posting` while
 * it is in flight, and on failure an `error` shown beside the text that did
 * not land — a toast would leave the reader hunting for which box it meant.
 * `run` resolves true once the post has landed, false when it failed, and
 * ignores a second call while one is in flight.
 */
export function usePostInPlace<A extends unknown[]>(
  post: (...args: A) => Promise<unknown>,
) {
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (...args: A): Promise<boolean> => {
    if (posting) return Promise.resolve(false);
    setPosting(true);
    setError(null);
    return post(...args).then(
      () => {
        setPosting(false);
        return true;
      },
      (e: unknown) => {
        setPosting(false);
        setError(e instanceof Error ? e.message : "Posting failed");
        return false;
      },
    );
  };
  return { posting, error, run, clearError: () => setError(null) };
}
