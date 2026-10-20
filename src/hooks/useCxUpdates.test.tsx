import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdateCount } from "./useCxUpdates";
const state = vi.hoisted(() => ({ counts: vi.fn().mockResolvedValue({ cx: 3, tech: 4 }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "synthetic" }, role: "processor" }) }));
vi.mock("@/lib/cx-update-requests", () => ({ fetchUpdateCounts: state.counts }));
function Counts() { const cx = useUpdateCount("cx"); const tech = useUpdateCount("tech"); return <p>{cx.data} CX · {tech.data} Tech</p>; }
afterEach(cleanup);
it("deduplicates both exact sidebar counts into one request and coalesces a burst", async () => {
  const { realtimeBus } = await import("@/lib/realtime");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
  render(<QueryClientProvider client={client}><Counts /></QueryClientProvider>);
  await screen.findByText("3 CX · 4 Tech"); expect(state.counts).toHaveBeenCalledTimes(1);
  state.counts.mockClear();
  await act(async () => { for (let n = 0; n < 50; n++) realtimeBus.dispatchEvent(new Event("lead_cx_update_requests")); });
  await waitFor(() => expect(state.counts).toHaveBeenCalledTimes(1));
});
