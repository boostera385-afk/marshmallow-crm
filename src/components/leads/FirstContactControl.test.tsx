import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FirstContact } from "@/lib/contact-direction";

const state = vi.hoisted(() => ({
  role: "customer_service" as string,
  firstContact: null as FirstContact | null,
  pending: false,
  mutate: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, role: state.role }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useLeadFirstContact", () => ({
  useLeadFirstContact: () => ({ data: state.firstContact, isPending: state.pending }),
  useLeadContactEvents: () => ({ data: [{ id: "e1", lead_id: "l1", kind: "call", direction: "in", occurred_at: "x" }], isLoading: false, isError: false }),
  useSetFirstContact: () => ({ mutate: state.mutate, isPending: false }),
}));

import { FirstContactCell, FirstContactControl } from "./FirstContactControl";

// Radix opens the menu from the keyboard as well as the pointer; Enter is reliable in jsdom.
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });

describe("FirstContactControl", () => {
  beforeEach(() => {
    state.role = "customer_service";
    state.firstContact = null;
    state.pending = false;
    state.mutate.mockReset();
  });

  it("names the first contact for screen readers and hover", () => {
    state.firstContact = { lead_id: "l1", contact: "call_in", source: "auto", occurred_at: null };
    render(<FirstContactControl leadId="l1" />);
    expect(screen.getByRole("button", { name: "First contact: Call Incoming (from Quo)" })).toBeInTheDocument();
  });

  it("shows a placeholder while loading", () => {
    state.pending = true;
    const { container } = render(<FirstContactControl leadId="l1" />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets staff set it by hand and shows the history counts", () => {
    render(<FirstContactControl leadId="l1" />);
    openMenu(screen.getByRole("button", { name: "First contact: not recorded yet" }));
    expect(screen.getByText("Set by hand")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact history")).toHaveTextContent("Call In1");
    fireEvent.click(screen.getByRole("menuitem", { name: /Msg Outgoing/ }));
    expect(state.mutate).toHaveBeenCalledWith("msg_out", expect.any(Object));
  });

  it("offers the return to automatic only for a manual value", () => {
    state.firstContact = { lead_id: "l1", contact: "msg_out", source: "manual", occurred_at: null };
    render(<FirstContactControl leadId="l1" />);
    openMenu(screen.getByRole("button", { name: /Msg Outgoing \(set by hand\)/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Use Quo automatically/ }));
    expect(state.mutate).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it("is read-only for Operator Admin", () => {
    state.role = "opr_admin";
    render(<FirstContactControl leadId="l1" />);
    openMenu(screen.getByRole("button", { name: "First contact: not recorded yet" }));
    expect(screen.queryByText("Set by hand")).toBeNull();
  });
});

describe("FirstContactCell", () => {
  it("renders a dash when nothing is recorded", () => {
    state.firstContact = null;
    render(<FirstContactCell leadId="l1" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
