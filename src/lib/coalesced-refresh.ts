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

/**
 * Run at most once per `delayMs` window, at the end of the window. The first
 * request of a quiet period starts the window; later requests inside it are
 * covered by that run. A request after the run starts a new window, so a change
 * arriving while the refresh is in flight still gets its own later refresh.
 */
export function createTrailingThrottle(run: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = true;
  return {
    request: () => {
      if (!active || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (active) run();
      }, delayMs);
    },
    dispose: () => {
      active = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
