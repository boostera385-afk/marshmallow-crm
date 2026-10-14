/**
 * Start without a timer delay; merge same-turn requests and serialize later ones.
 * An event arriving during a read always gets a trailing read (including after failure).
 */
export function createCoalescedRefresh(
  refresh: (isCurrent: () => boolean) => Promise<void>,
  onError: () => void,
) {
  let active = true;
  let pending = false;
  let running: Promise<void> | null = null;

  const request = (): Promise<void> => {
    if (!active) return Promise.resolve();
    pending = true;
    if (!running) {
      running = Promise.resolve().then(async () => {
        try {
          while (active && pending) {
            pending = false;
            try {
              await refresh(() => active);
            } catch {
              if (active) onError();
            }
          }
        } finally {
          running = null;
        }
      });
    }
    return running;
  };

  return {
    request,
    dispose: () => { active = false; pending = false; },
  };
}
