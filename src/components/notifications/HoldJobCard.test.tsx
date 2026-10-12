import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HoldAlert } from "@/lib/operator-workflow";
import HoldJobCard from "./HoldJobCard";
vi.mock("@/components/leads/CompleteLeadCopyButton", () => ({ default: () => <button>Copy Complete Details</button> }));
afterEach(cleanup);
export const alertFixture: HoldAlert = {
  id: "00000000-0000-4000-8000-000000000001", lead_id: "00000000-0000-4000-8000-000000000002",
  revision: "00000000-0000-4000-8000-000000000003", reason: "scheduled", read: false,
  created_at: "2026-10-12T05:00:00Z",
  snapshot: {
    job_id: "MM-123", customer_name: "Test Customer", customer_phone: "5550100000", customer_landline: null,
    service_type: "Plumbing", service_details: "Fix sink", address: "10 Main St Apt 2", city: "Miami", state: "FL", zip_code: "33101",
    customer_schedule_requirements: "Friday afternoon", scheduled_date: "2026-10-16", scheduled_time_start: "13:00:00",
    scheduled_time_end: "15:00:00", tech_name: "Test Tech", tech_number: "5550100001", status: "scheduled", cs_tag: null, quote: null,
  },
};
describe("grey read-only hold card", () => {
  it("expands complete saved details without allowing job edits or leaking hidden quote", () => {
    render(<HoldJobCard alert={alertFixture} onAcknowledge={vi.fn()} />);
    expect(screen.queryByText("10 Main St Apt 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete card" }));
    expect(screen.getByText("10 Main St Apt 2")).toBeInTheDocument();
    expect(screen.getByText("Friday afternoon")).toBeInTheDocument();
    expect(screen.queryByText("Quote")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit Lead|Save|Approve/i })).toBeNull();
  });
  it("passes the actual event revision to acknowledgement", () => {
    const acknowledge = vi.fn();
    render(<HoldJobCard alert={alertFixture} onAcknowledge={acknowledge} />);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(acknowledge).toHaveBeenCalledWith(alertFixture);
  });
  it("does not offer acknowledgement for already-read history", () => {
    render(<HoldJobCard alert={{ ...alertFixture, read: true }} onAcknowledge={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
  });
});
