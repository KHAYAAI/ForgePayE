'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Poll a console proxy section (`/api/forge/:section`) and fall back to demo
 * fixtures while the service mesh is unreachable.
 *
 * Returns { data, live }:
 *   live=true  → `data` is the real service payload
 *   live=false → `data` is the provided fallback (demo mode)
 */
export function useForge<T>(section: string, fallback: T, intervalMs = 15_000): { data: T; live: boolean } {
  const [state, setState] = useState<{ data: T; live: boolean }>({ data: fallback, live: false });
  const fallbackRef = useRef(fallback);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/forge/${section}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { live: boolean; data: T | null };
        if (cancelled) return;
        if (body.live && body.data) {
          setState({ data: body.data, live: true });
        } else {
          setState({ data: fallbackRef.current, live: false });
        }
      } catch {
        if (!cancelled) setState({ data: fallbackRef.current, live: false });
      }
    };

    void poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [section, intervalMs]);

  return state;
}
