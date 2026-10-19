import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessorJobViewport } from "./ProcessorJobViewport";

let resized: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
let extraHeight = 0;
function jobs(count = 6) {
  return Array.from({ length: count }, (_, index) => <div key={index} className="processor-row" data-bottom={(index + 1) * 100 + 10}>Job {index + 1}</div>);
}
beforeEach(() => {
  extraHeight = 0; vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const bottom = Number(this.dataset.bottom || 10) + (this.dataset.bottom ? extraHeight : 0);
    return { x: 0, y: 10, top: 10, left: 0, right: 600, bottom, width: 600, height: bottom - 10, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Processor job scroll viewport", () => {
  it("fits five rows without removing later jobs, and expands/reset-scrolls when the limit changes", () => {
    const view = render(<ProcessorJobViewport rowLimit={5} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    const viewport = screen.getByRole("region", { name: "Scrollable jobs" });
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport.style.getPropertyValue("--processor-viewport-height")).toBe("500px");
    expect(screen.getByText("Job 6")).toBeInTheDocument();
    viewport.scrollTop = 250;
    view.rerender(<ProcessorJobViewport rowLimit={10} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    expect(viewport.style.getPropertyValue("--processor-viewport-height")).toBe("600px");
    expect(viewport.scrollTop).toBe(0);
  });
  it("remeasures wrapped/updated content without losing scroll or adding observers on refresh", () => {
    const view = render(<ProcessorJobViewport rowLimit={5} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    const viewport = screen.getByRole("region");
    const writes = vi.spyOn(viewport.style, "setProperty");
    view.rerender(<ProcessorJobViewport rowLimit={5} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    expect(writes).not.toHaveBeenCalled();
    viewport.scrollTop = 150; extraHeight = 40;
    view.rerender(<ProcessorJobViewport rowLimit={5} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    expect(viewport.style.getPropertyValue("--processor-viewport-height")).toBe("540px");
    expect(viewport.scrollTop).toBe(150);
    extraHeight = 80; resized([], {} as ResizeObserver);
    expect(viewport.style.getPropertyValue("--processor-viewport-height")).toBe("580px");
    expect(observe).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
    view.rerender(<ProcessorJobViewport rowLimit={5} resetKey="setup">{jobs(1)}</ProcessorJobViewport>);
    expect(viewport.scrollTop).toBe(0);
    view.rerender(<ProcessorJobViewport rowLimit={5} resetKey="empty">{jobs(0)}</ProcessorJobViewport>);
    expect(viewport.style.getPropertyValue("--processor-viewport-height")).toBe("");
    view.unmount(); expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it("keeps a cleaned-up resize fallback when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<ProcessorJobViewport rowLimit={5} resetKey="page1">{jobs()}</ProcessorJobViewport>);
    const listener = add.mock.calls.find(([event]) => event === "resize")?.[1];
    extraHeight = 20; window.dispatchEvent(new Event("resize"));
    expect(screen.getByRole("region").style.getPropertyValue("--processor-viewport-height")).toBe("520px");
    view.unmount(); expect(remove).toHaveBeenCalledWith("resize", listener);
  });
});
