"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page every few seconds while `active` (a payment is being confirmed), so Pending turns into Paid
 * on its own. Pauses in hidden tabs and gives up after `forMs` (bank transfers can take days; the page is still right
 * the next time it is opened).
 */
export function AutoRefresh({ active, everyMs = 4000, forMs = 180_000 }: { active: boolean; everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > forMs) return clearInterval(timer);
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, forMs, router]);
  return null;
}
