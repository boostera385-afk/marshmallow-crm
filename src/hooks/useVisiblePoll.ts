import { useEffect } from "react";

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Run `refresh` once on mount, then every `intervalMs` while the tab is visible,
 * and again when the user returns to the tab. A return within `minGapMs` of the
 * last run is skipped, so rapid tab switching does not fire extra reads.
 * With `immediate: false` the caller has already loaded; the gap counts from mount.
 */
export function useVisiblePoll(
  refresh: () => unknown,
  intervalMs: number,
  { enabled = true, minGapMs = 5000, immediate = true }: { enabled?: boolean; minGapMs?: number; immediate?: boolean } = {},
) {
  useEffect(() => {
    if (!enabled) return;
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      void refresh();
    };
    if (immediate) run();
    else lastRun = Date.now();
    const id = setInterval(() => { if (isVisible()) run(); }, intervalMs);
    const onVisibility = () => {
      if (isVisible() && Date.now() - lastRun >= minGapMs) run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, intervalMs, enabled, minGapMs, immediate]);
}
