import { useCallback, useEffect, useState } from 'react';

/** Seconds left until a resend is allowed; `restart(n)` starts a new countdown. */
export function useCountdown(initialSeconds: number) {
  const [deadline, setDeadline] = useState(() => Date.now() + Math.max(0, initialSeconds) * 1000);
  const [now, setNow] = useState(() => Date.now());
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [seconds]);

  const restart = useCallback((next: number) => {
    const at = Date.now();
    setNow(at);
    setDeadline(at + Math.max(0, next) * 1000);
  }, []);

  return { seconds, restart };
}

/** Route params are strings; turn `resendIn` into a non-negative number. */
export function parseSeconds(value: string | string[] | undefined, fallback = 0): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
