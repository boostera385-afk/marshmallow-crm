import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/types";
import ReminderButton from "./ReminderButton";

const copyTextToClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/lead-copy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lead-copy")>()),
  copyTextToClipboard: (text: string) => copyTextToClipboard(text),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => { cleanup(); copyTextToClipboard.mockClear(); });

const lead = {
  id: "lead-1", tech_name: "Synthetic Tech", customer_name: "Synthetic Customer", customer_phone: "5550100000",
  address: "1 Test St", city: "Victoria", state: "TX", zip_code: "77904",
  scheduled_date: "2026-11-14", scheduled_time_start: "15:00:00", scheduled_time_end: "17:00:00",
} as unknown as Lead;

describe("technician reminder", () => {
  it("adds the hand-typed Customer # under the opening line and copies it with 12-hour times", async () => {
    render(<ReminderButton lead={lead} />);
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    const preview = screen.getByLabelText("Preview message") as HTMLTextAreaElement;
    expect(preview.value).toContain("head over\n\nCustomer #\nCustomer Name: Synthetic Customer");

    fireEvent.change(screen.getByLabelText("Customer # (manual)"), { target: { value: "1" } });
    await waitFor(() => expect(preview.value).toContain("head over\n\nCustomer #1\nCustomer Name: Synthetic Customer"));
    expect(preview.value).toContain("between 3:00 PM - 5:00 PM");

    fireEvent.click(screen.getByRole("button", { name: /Copy reminder/ }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledOnce());
    expect(copyTextToClipboard.mock.calls[0][0]).toContain("Customer #1\nCustomer Name: Synthetic Customer");
  });
});
