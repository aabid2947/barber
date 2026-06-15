import { useEffect, useState } from 'react';

/** Re-renders the calling component every `intervalMs` so live countdowns stay current. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Minutes remaining until `expiresAt` (epoch ms), clamped at 0. */
export function minutesLeft(expiresAt: number | null, now: number): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt - now) / 60000));
}

/** "4 min ago", "just now" — relative age of an epoch-ms timestamp. */
export function timeAgo(ts: number, now: number): string {
  const mins = Math.floor((now - ts) / 60000);
  if (mins <= 0) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hr ago' : `${hrs} hr ago`;
}
