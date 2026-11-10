import { useEffect } from "react";
import { isBackgroundPollPaused } from "@/lib/overload-guard";

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Run `refresh` once on mount, then every `intervalMs` while the tab is visible,
 * and again when the user returns to the tab. A return within `minGapMs` of the
 * last run is skipped, so rapid tab switching does not fire extra reads.
 */
export function useVisiblePoll(
  refresh: () => unknown,
  intervalMs: number,
  { enabled = true, minGapMs = 5000 }: { enabled?: boolean; minGapMs?: number } = {},
) {
  useEffect(() => {
    if (!enabled) return;
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      void refresh();
    };
    run();
    // Timer turns skip while the server is overloaded; a return to the tab still refreshes.
    const id = setInterval(() => { if (isVisible() && !isBackgroundPollPaused()) run(); }, intervalMs);
    const onVisibility = () => {
      if (isVisible() && Date.now() - lastRun >= minGapMs) run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, intervalMs, enabled, minGapMs]);
}
