import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveAlert } from "@/lib/active-alerts";
import SystemHealthPopup from "./SystemHealthPopup";
import { healthSeverity } from "@/lib/system-health-alert";

const state = vi.hoisted(() => ({
  role: "admin" as string,
  user: { id: "synthetic-admin", created_at: "2026-01-01T00:00:00Z" },
  rows: [] as unknown[],
  read: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  alarm: vi.fn(),
  listener: null as null | ((payload: { eventType: string; new: unknown }) => void),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: state.role, user: state.user, fullyAuthenticated: true }),
}));
vi.mock("@/lib/active-alerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/active-alerts")>();
  return { ...actual, readActiveAlerts: state.read };
});
vi.mock("@/lib/realtime", () => ({
  subscribeToNotifications: (_user: string, cb: (payload: { eventType: string; new: unknown }) => void) => { state.listener = cb; return () => { state.listener = null; }; },
}));
vi.mock("@/lib/notification-sound", () => ({ playSystemAlarmSound: state.alarm }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: (values: unknown) => { state.update(values); return { eq: (col: string, id: string) => { state.eq(col, id); return Promise.resolve({ error: null }); } }; } }) },
}));

const alert = (id: string, title: string, message = "What is high: memory 15% free.\nWhat to do now:"): ActiveAlert =>
  ({ id, title, message, lead_id: null, created_at: "2026-11-10T14:00:00Z", read: false, kind: "system_health" });

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
  state.rows = [alert("w1", "[Alert] Database load warning: memory 15% free (warning below 20%)")];
  state.read.mockImplementation(async () => state.rows);
});
afterEach(() => cleanup());

describe("overload alert pop-up", () => {
  it("shows the warning to an Admin in red, labelled WARNING, with its instructions and the warning siren", async () => {
    render(<SystemHealthPopup />);
    const card = await screen.findByRole("status", { name: /Database load warning/ });
    expect(card).toHaveTextContent("WARNING");
    expect(card).toHaveTextContent("What is high: memory 15% free.");
    expect(card.className).toMatch(/border-red-500/);
    expect(state.read).toHaveBeenCalledWith("synthetic-admin", "2026-01-01T00:00:00Z", "system_health");
    await waitFor(() => expect(state.alarm).toHaveBeenCalledWith("warning"));
    expect(state.alarm).toHaveBeenCalledTimes(1);
  });

  it("does not sound again for an alert it has already shown", async () => {
    render(<SystemHealthPopup />);
    await screen.findByRole("status");
    await waitFor(() => expect(state.alarm).toHaveBeenCalledTimes(1));
    state.listener?.({ eventType: "INSERT", new: { kind: "system_health", title: "x" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(state.alarm).toHaveBeenCalledTimes(1);
  });

  it("back to normal is green and silent", async () => {
    state.rows = [alert("ok1", "Database load back to normal", "All readings have been below warning levels.")];
    render(<SystemHealthPopup />);
    const card = await screen.findByRole("status", { name: "Database load back to normal" });
    expect(card).not.toHaveTextContent("WARNING");
    expect(card.className).toMatch(/border-emerald/);
    await new Promise((r) => setTimeout(r, 50));
    expect(state.alarm).not.toHaveBeenCalled();
  });

  it.each(["customer_service", "cs_admin", "processor", "opr", "opr_admin"])("is not shown to %s and reads nothing", async (role) => {
    state.role = role;
    render(<SystemHealthPopup />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("status")).toBeNull();
    expect(state.read).not.toHaveBeenCalled();
  });

  it("dismissing marks it read and removes it", async () => {
    render(<SystemHealthPopup />);
    fireEvent.click(await screen.findByRole("button", { name: /Dismiss: \[Alert\] Database load warning/ }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(state.update).toHaveBeenCalledWith({ read: true });
    expect(state.eq).toHaveBeenCalledWith("id", "w1");
  });

  it("a critical alert arriving by realtime is red, labelled CRITICAL, with the longer siren", async () => {
    render(<SystemHealthPopup />);
    await screen.findByRole("status");
    state.rows = [alert("c1", "[Alert] Database overload critical: memory 8% free (critical below 10%)")];
    state.listener?.({ eventType: "INSERT", new: { kind: "system_health", title: "x" } });
    const card = await screen.findByRole("alert", { name: /Database overload critical/ });
    expect(card).toBeVisible();
    expect(card).toHaveTextContent("CRITICAL");
    expect(card.className).toMatch(/border-red-600/);
    await waitFor(() => expect(state.alarm).toHaveBeenCalledWith("critical"));
  });

  it("ignores other notification kinds arriving by realtime", async () => {
    render(<SystemHealthPopup />);
    await screen.findByRole("status");
    const reads = state.read.mock.calls.length;
    state.listener?.({ eventType: "INSERT", new: { kind: "urgent_job", title: "[Alert] Urgent Job" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(state.read.mock.calls.length).toBe(reads);
  });

  it("reads severity from the server's titles", () => {
    expect(healthSeverity("[Alert] Database overload critical: x")).toBe("critical");
    expect(healthSeverity("[Alert] Database load still critical: x")).toBe("critical");
    expect(healthSeverity("[Alert] Database load still warning: x")).toBe("warning");
    expect(healthSeverity("Database load back to normal")).toBe("ok");
    expect(healthSeverity("[Test] Database load critical (test only, nothing is wrong)")).toBe("info");
    expect(healthSeverity("Overload alert email is not set up")).toBe("info");
  });
});
