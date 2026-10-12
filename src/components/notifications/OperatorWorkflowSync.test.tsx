import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realtimeBus } from "@/lib/realtime";
import OperatorWorkflowSync from "./OperatorWorkflowSync";
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "test-user" }, role: "opr" }) }));
vi.mock("@/lib/realtime", () => ({ realtimeBus: new EventTarget() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("shared workflow refresh", () => {
  it("invalidates refreshed rows, polls for missed events, and cleans up on unmount", () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { unmount } = render(<QueryClientProvider client={client}><OperatorWorkflowSync /></QueryClientProvider>);
    act(() => realtimeBus.dispatchEvent(new Event("lead_hold_alerts")));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    invalidate.mockClear();
    act(() => realtimeBus.dispatchEvent(new Event("lead_copy_user_permissions")));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["lead-copy-access", "test-user", "opr"] }, { cancelRefetch: false });
    invalidate.mockClear();
    act(() => vi.advanceTimersByTime(20000));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts", "test-user", "opr"] }, { cancelRefetch: false });
    unmount();
    invalidate.mockClear();
    act(() => {
      realtimeBus.dispatchEvent(new Event("lead_hold_alerts"));
      realtimeBus.dispatchEvent(new Event("lead_copy_user_permissions"));
      vi.advanceTimersByTime(40000);
    });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });
});
