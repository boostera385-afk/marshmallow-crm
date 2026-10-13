import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapFilterControls from "./MapFilterControls";

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});
describe("paired map dropdowns", () => {
  it("selects a service and closes its menu before opening the state menu", () => {
    const serviceChange = vi.fn();
    const stateChange = vi.fn();
    const opened = vi.fn();
    render(<MapFilterControls services={["Long specialist repair"]} states={[{ code: "FL", name: "Florida" }]}
      service="all" state="all" onServiceChange={serviceChange} onStateChange={stateChange} onMenuOpen={opened} />);
    const service = screen.getByRole("combobox", { name: "Filter map by service" });
    const state = screen.getByRole("combobox", { name: "Filter map by state" });
    fireEvent.keyDown(service, { key: "ArrowDown" });
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Long specialist repair" }));
    expect(serviceChange).toHaveBeenCalledWith("Long specialist repair");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(state, { key: "ArrowDown" });
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "Long specialist repair" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "FL · Florida" }));
    expect(stateChange).toHaveBeenCalledWith("FL");
    expect(opened).toHaveBeenCalledTimes(2);
  });
});
