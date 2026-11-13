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
  it("copies CS-visible labor and optional materials even when legacy quote notes are empty", async () => {
    auth.role = "customer_service";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{ terms: "quoted", labor_amount: 200, material_amount: null, quote: "" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText.mock.calls[0][0]).toContain("Quote: Quoted · Labor $200.00");
    expect(writeText.mock.calls[0][0]).not.toMatch(/parts|materials/i);
  });
  it("shows the enabled-by-default copy action with the full quote for opr_admin", async () => {
    auth.role = "opr_admin";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{ service_details: "Repair", address: "10 Main St Apt 2", customer_schedule_requirements: "Friday", quote: "$150" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("Service Details: Repair\nAddress: 10 Main St Apt 2\nSchedule Requirement: Friday\nQuote: $150");
  });

  it("replaces the free-text quote with the terms/half-labor/materials summary for a plain opr", async () => {
    auth.role = "opr";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{
      service_details: "Repair", address: "10 Main St Apt 2", customer_schedule_requirements: "Friday",
      quote: "$150 private note", terms: "quoted", labor_amount: 100, material_amount: 40,
    } as Lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Quote: Quoted · Labor $50.00 · Materials $40.00");
    expect(copied).not.toContain("$150 private note");
  });

  it("copies Quoted for a plain opr even when no labor is recorded yet", async () => {
    auth.role = "opr";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CompleteLeadCopyButton lead={{
      service_details: "Repair", quote: "$150 private note", terms: "quoted", labor_amount: null, material_amount: null,
    } as Lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Quote: Quoted");
    expect(copied).not.toContain("$150 private note");
  });

  it("copies only City, ST ZIP for an Operator once the lead is redacted", async () => {
    const { redactLeadForOperator } = await import("@/lib/operator-privacy");
    auth.role = "opr";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const lead = redactLeadForOperator({ service_details: "Repair", address: "10 Main St Apt 2", customer_phone: "5550100000",
      tech_name: "Sam Tech", tech_number: "5550108888", location_label: "Miami, FL 33101", customer_schedule_requirements: "Friday" }, "opr");
    render(<CompleteLeadCopyButton lead={lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Complete Details" }));
    await screen.findByRole("button", { name: "Copied" });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Miami, FL 33101");
    for (const secret of ["10 Main St", "5550100000", "Sam Tech", "5550108888"]) expect(copied).not.toContain(secret);
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
