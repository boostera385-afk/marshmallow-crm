import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Limit the viewport, never the jobs or the scope of a page-level review. */
export function ProcessorJobViewport({ children, rowLimit, resetKey, className }: {
  children: ReactNode;
  rowLimit: number;
  resetKey: string;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    if (!viewport.current || !content.current) return;
    const rows = content.current.querySelectorAll<HTMLElement>(".processor-row");
    const last = rows[Math.min(rowLimit, rows.length) - 1];
    if (!last) { viewport.current.style.removeProperty("--processor-viewport-height"); return; }
    // Two geometry reads, independent of row count. Preserve wrapped error/setup text.
    const height = Math.ceil(last.getBoundingClientRect().bottom - content.current.getBoundingClientRect().top);
    const value = `${height}px`;
    if (height > 0 && viewport.current.style.getPropertyValue("--processor-viewport-height") !== value) {
      viewport.current.style.setProperty("--processor-viewport-height", value);
    }
  }, [rowLimit]);

  // Recalculate after content changes without resetting a user's scroll on polling.
  useLayoutEffect(measure);
  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [rowLimit, resetKey]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [measure]);

  return <div ref={viewport} role="region" aria-label="Scrollable jobs" aria-describedby="processor-scroll-help" tabIndex={0}
    className={cn("processor-job-viewport focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className)}>
    <div ref={content}>{children}</div>
  </div>;
}
