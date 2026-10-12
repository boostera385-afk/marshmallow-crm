import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import type { Lead } from "@/types";
import CompleteLeadCopyButton from "./CompleteLeadCopyButton";

const auth = vi.hoisted(() => ({ role: "admin" }));
const permission = vi.hoisted(() => ({ allowed: true, loading: false, error: null as Error | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useOperatorWorkflow", () => ({ useLeadCopyAccess: () => permission }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  auth.role = "admin";
  permission.allowed = true;
  permission.loading = false;
  permission.error = null;
});

describe("complete lead copy action", () => {
  it.each(["opr", "opr_admin"])("shows the enabled-by-default copy action for %s", async (role) => {
    auth.role = role;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{ service_details: "Repair", address: "10 Main St Apt 2", customer_schedule_requirements: "Friday", quote: "$150" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Service Details: Repair\nAddress: 10 Main St Apt 2\nSchedule Requirement: Friday\nQuote: $150");
  });

  it("hides the copy action when Admin denies access", () => {
    permission.allowed = false;
    render(<CompleteLeadCopyButton lead={{ quote: "private" }} />);
    expect(screen.queryByRole("button", { name: "Copy Complete Details" })).toBeNull();
  });

  it.each(["loading", "error"])("does not copy while permission is %s", (state) => {
    permission.allowed = false;
    permission.loading = state === "loading";
    permission.error = state === "error" ? new Error("Unavailable") : null;
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{ quote: "private" }} />);
    const button = screen.getByRole("button", { name: "Copy Complete Details" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(writeText).not.toHaveBeenCalled();
  });
  it("copies all four labels even on an empty lead without opening the parent card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const openLead = vi.fn();
    render(<div onClick={openLead}><CompleteLeadCopyButton lead={{} as Lead} className="w-full" /></div>);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Service Details: \nAddress: \nSchedule Requirement: \nQuote: ");
    expect(openLead).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it.each(["opr", "opr_admin"])("keeps hidden quotes out of the clipboard for %s", async (role) => {
    auth.role = role;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{ quote: "$150 private", show_quote_to_opr: false } as Lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Service Details: \nAddress: \nSchedule Requirement: \nQuote: ");
  });

  it("reports clipboard failure without showing success", async () => {
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    render(<CompleteLeadCopyButton lead={{ quote: "$150" } as Lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copy Complete Details" })).toBeTruthy();
  });
});
