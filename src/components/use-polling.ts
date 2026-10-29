import { useEffect, useRef } from "react";

/**
 * Calls `task` repeatedly, waiting `intervalMs` after each call finishes (so slow responses never
 * pile up). Pauses while the tab is hidden and refreshes immediately when it comes back.
 */
export function usePolling(task: () => Promise<void>, intervalMs: number, enabled = true) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        try {
          await taskRef.current();
        } catch {
          // transient network errors: try again on the next tick
        }
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);
}
