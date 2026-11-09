import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";

const state = vi.hoisted(() => ({ role: "opr" as AppRole, jobId: "JOB-123" as string | null, reads: [] as string[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role }) }));
vi.mock("@/pages/LeadDetailPage", () => ({ default: () => <div>Full lead page</div> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        state.reads.push(columns);
        return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.jobId ? { job_id: state.jobId } : null, error: null }) }) };
      },
    }),
  },
}));
import LeadRoute from "./LeadRoute";

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}
const open = (path = "/leads/lead-1") => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/leads/:id" element={<LeadRoute />} />
      <Route path="/leads" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

afterEach(() => { cleanup(); state.role = "opr"; state.jobId = "JOB-123"; state.reads = []; });

describe("lead page access", () => {
  it.each(["opr", "opr_admin"] as AppRole[])("%s never gets the full lead page; it opens their Leads view for that job", async (role) => {
    state.role = role;
    open();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/leads?search=JOB-123"));
    expect(screen.queryByText("Full lead page")).not.toBeInTheDocument();
    expect(state.reads).toEqual(["job_id"]); // Only the job ID is read, never the full lead.
  });

  it("sends an Operator to the Leads list when the lead is not found", async () => {
    state.jobId = null;
    open();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/leads$/));
  });

  it.each(["admin", "processor", "cs_admin", "customer_service"] as AppRole[])("%s still gets the full lead page", (role) => {
    state.role = role;
    open();
    expect(screen.getByText("Full lead page")).toBeInTheDocument();
    expect(state.reads).toEqual([]);
  });
});
