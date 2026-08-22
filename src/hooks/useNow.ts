import { useEffect, useState } from 'react';

/** A clock that ticks on an interval — for relative ages that must not call
 * Date.now() during render (react-hooks/purity). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
